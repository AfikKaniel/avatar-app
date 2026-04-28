#!/usr/bin/env python3
import asyncio
import json
import logging
import os
import urllib.request
from io import BytesIO

from dotenv import load_dotenv
from PIL import Image, ImageDraw

from livekit import rtc
from livekit.agents import Agent, AgentSession, JobContext, WorkerOptions, WorkerType, cli
from livekit.agents.voice.room_io import RoomOptions
from livekit.plugins import anthropic, elevenlabs, hedra, openai, silero

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger("gaging-avatar")

load_dotenv(dotenv_path=os.path.join(os.path.dirname(__file__), "..", ".env.local"))

ASSETS_DIR = os.path.join(os.path.dirname(__file__), "assets")
DEFAULT_THERAPIST_VOICE_ID = "21m00Tcm4TlvDq8ikWAM"

# ── Pre-load Silero VAD once at startup (not per-session) ─────────────────────
# This avoids a 5-10s model download delay on the first session.
try:
    logger.info("Pre-loading Silero VAD model…")
    _VAD = silero.VAD.load(activation_threshold=0.65, min_silence_duration=0.4)
    logger.info("Silero VAD ready ✓")
except Exception as _vad_err:
    logger.error(f"Silero VAD pre-load failed: {_vad_err} — will load lazily per session")
    _VAD = None


# ── Image helpers ──────────────────────────────────────────────────────────────

def download_image(url: str, timeout: int = 15) -> Image.Image | None:
    try:
        req = urllib.request.Request(url, headers={"User-Agent": "GagingAI/1.0"})
        with urllib.request.urlopen(req, timeout=timeout) as r:
            img = Image.open(BytesIO(r.read())).copy()
        logger.info(f"Downloaded image {img.size} from {url[:60]}…")
        return img
    except Exception as e:
        logger.error(f"Image download failed: {e}")
        return None


def load_therapist_image() -> Image.Image:
    local_path = os.path.join(ASSETS_DIR, "therapist.jpg")
    if os.path.exists(local_path):
        return Image.open(local_path).copy()
    url = os.environ.get("THERAPIST_PHOTO_URL")
    if url:
        img = download_image(url)
        if img:
            return img
    logger.warning("Using placeholder therapist image")
    img = Image.new("RGB", (512, 512), color=(220, 220, 230))
    draw = ImageDraw.Draw(img)
    draw.ellipse([176, 80, 336, 240], fill=(180, 180, 190))
    draw.ellipse([112, 280, 400, 560], fill=(100, 120, 160))
    return img


# ── Wait for the iOS participant to be present in the room ────────────────────
async def wait_for_user(ctx: JobContext, timeout: float = 30.0) -> rtc.RemoteParticipant | None:
    """
    Return the first non-agent remote participant.
    Checks pre-existing participants first, then waits up to `timeout` seconds.
    """
    # First pass — participant may already be in the room
    for p in ctx.room.remote_participants.values():
        logger.info(f"User already in room: {p.identity}")
        return p

    found_event = asyncio.Event()
    found_participant: list[rtc.RemoteParticipant] = []

    @ctx.room.on("participant_connected")
    def on_join(participant: rtc.RemoteParticipant):
        if not found_participant:
            found_participant.append(participant)
            found_event.set()

    # Second pass — close the race window between ctx.connect() and listener
    for p in ctx.room.remote_participants.values():
        logger.info(f"User in room (second pass): {p.identity}")
        return p

    logger.info("Waiting for iOS user to join the room…")
    try:
        await asyncio.wait_for(found_event.wait(), timeout=timeout)
        logger.info(f"iOS user joined: {found_participant[0].identity}")
        return found_participant[0]
    except asyncio.TimeoutError:
        logger.error("Timed out waiting for iOS user")
        return None


# ── Main entrypoint ────────────────────────────────────────────────────────────

async def entrypoint(ctx: JobContext):
    await ctx.connect()
    logger.info(f"Agent connected to room: {ctx.room.name}")

    # ── 1. Read session config from room metadata (set at creation, always ready) ──
    voice_id      = None
    photo_url     = None
    mode          = "digital_twin"
    language      = "en"
    memory        = ""
    goal          = ""
    goal_target   = ""
    goal_current  = ""
    is_checkin    = False
    system_prompt = ""

    def apply_meta(meta: dict):
        nonlocal voice_id, photo_url, mode, language, memory
        nonlocal goal, goal_target, goal_current, is_checkin, system_prompt
        mode          = meta.get("mode", "digital_twin")
        voice_id      = meta.get("voice_id")
        photo_url     = meta.get("photo_url")
        language      = meta.get("language", "en")
        memory        = meta.get("memory", "")
        goal          = meta.get("goal", "")
        goal_target   = meta.get("goal_target", "")
        goal_current  = meta.get("goal_current", "")
        is_checkin    = meta.get("is_checkin", "0") == "1"
        system_prompt = meta.get("system_prompt") or ""

    room_raw = ctx.room.metadata
    if room_raw:
        try:
            apply_meta(json.loads(room_raw))
            logger.info(f"Room metadata parsed: mode={mode}, language={language}, voice_id={voice_id}")
        except Exception as e:
            logger.warning(f"Failed to parse room metadata: {e}")

    # ── 2. Wait for the iOS user to be in the room ──────────────────────────────
    # NOTE: participant metadata fallback MUST come after wait_for_user() because the
    # iOS participant is not in the room yet when the agent first connects. Reading
    # ctx.room.remote_participants before this point always returns an empty dict.
    ios_user = await wait_for_user(ctx)
    if ios_user is None:
        logger.error("No iOS user — aborting session")
        return

    # Fallback: read voice_id / photo_url from the iOS participant's JWT metadata.
    # This is the primary delivery path when LiveKit room metadata is not populated.
    if not voice_id:
        raw = ios_user.metadata
        if raw:
            try:
                apply_meta(json.loads(raw))
                logger.info(f"iOS participant metadata parsed: mode={mode}, voice_id={voice_id}")
            except Exception as e:
                logger.warning(f"Failed to parse iOS participant metadata: {e}")
        else:
            logger.warning("iOS participant has no metadata — voice_id will remain None")

    logger.info(f"Session config — mode={mode}, voice_id={voice_id}, photo_url={'set' if photo_url else 'none'}")

    logger.info(f"Starting session with participant: {ios_user.identity}")

    # ── 3. Run the appropriate session type ─────────────────────────────────────
    if mode == "therapist":
        await run_therapist_session(
            ctx, ios_user, language, memory,
            goal, goal_target, goal_current, is_checkin, system_prompt
        )
    else:
        await run_digital_twin_session(
            ctx, ios_user, voice_id, photo_url, language, memory,
            goal, goal_target, goal_current, is_checkin, system_prompt
        )


# ── Coaching content ───────────────────────────────────────────────────────────

LANGUAGE_NAMES = {"en": "English", "he": "Hebrew (עברית)"}

GOAL_COACHING: dict[str, dict[str, str]] = {
    "quit_smoking": {
        "twin_system": """Your shared mission is quitting smoking.
You know firsthand how brutal cravings hit — the specific triggers (stress, coffee, after meals), the lies nicotine tells ("just one won't hurt"), and how proud it feels to say no.
As a coach speaking to yourself:
- You already know the user's goal and baseline — do NOT ask for them again unless this is a designated check-in session.
- When cravings come up, suggest specific coping tactics: deep breathing, cold water, a 5-minute walk, chewing gum.
- Call out excuses directly — "I know that voice, it's lying to us."
- Remind yourself of the real reasons: health, money, freedom, people who matter.
- Be honest but tough: acknowledge it's hard without giving up ground.
- End each session with one concrete commitment for the next 24 hours.""",
        "therapist_system": """You are a professional smoking-cessation coach and therapist.
Your patient is actively trying to quit smoking. Your job is to push them forward every single session.
- You already know the patient's goal and baseline — do NOT ask for them again unless this is a designated check-in session.
- Use motivational interviewing: explore ambivalence, amplify their own reasons for quitting.
- Teach concrete coping skills: the 4Ds (Delay, Deep breath, Drink water, Do something else).
- Help identify triggers and build avoidance/replacement plans.
- Celebrate every smoke-free hour, day, or week as a real achievement.
- When they slip, reframe as data: "What triggered it? What will you do differently?"
- Be warm but direct: your job is accountability, not just listening.""",
        "first_twin_greeting": "Ask yourself in first person, warmly: how many cigarettes are you smoking per day right now, and what's the goal — quit completely or cut down to a certain number? One natural sentence.",
        "checkin_twin_greeting": "Ask yourself in first person, directly: how many cigarettes today compared to your goal? One short sentence.",
        "continue_twin_greeting": "Welcome yourself back in first person. Reference something from the previous sessions briefly and jump straight into coaching. One or two energetic sentences — no need to ask for numbers again.",
        "first_therapist_greeting": "Greet your patient warmly and ask: how many cigarettes per day are they smoking right now, and what's their goal — to quit entirely or cut down to how many? One or two sentences.",
        "checkin_therapist_greeting": "Greet your patient and immediately ask: how many cigarettes today compared to their goal? One or two sentences.",
        "continue_therapist_greeting": "Welcome your patient back warmly. Reference something meaningful from previous sessions and move straight into coaching. Two sentences — do not ask them to re-introduce their goal.",
    },
    "drink_water": {
        "twin_system": """Your shared mission is drinking enough water every single day.""",
        "first_twin_greeting": "Ask yourself in first person, warmly: how many glasses of water do you want to drink per day as your goal, and how many are you actually drinking right now? One natural sentence.",
        "checkin_twin_greeting": "Ask yourself in first person, directly: how many glasses of water have you had so far today — are you on track? One short sentence.",
        "continue_twin_greeting": "Welcome yourself back in first person. Reference the hydration progress from before and dive straight into coaching. One or two energetic sentences.",
        "first_therapist_greeting": "Greet your patient warmly and ask: how many glasses of water per day is their goal, and how many are they currently drinking? One or two sentences.",
        "checkin_therapist_greeting": "Greet your patient and immediately ask: how many glasses of water today so far — on track with their goal? One or two sentences.",
        "continue_therapist_greeting": "Welcome your patient back warmly. Reference their hydration journey from previous sessions and move straight into coaching. Two sentences.",
    },
    "stand_more": {
        "twin_system": """Your shared mission is to stand up and move regularly throughout the day.""",
        "first_twin_greeting": "Ask yourself in first person, warmly: how many times a day do you want to stand up and move as your goal, and how often are you actually doing it right now? One natural sentence.",
        "checkin_twin_greeting": "Ask yourself in first person, directly: how many standing breaks have you taken today — are you hitting your goal? One short sentence.",
        "continue_twin_greeting": "Welcome yourself back in first person. Reference the movement habits we've been building and jump straight into coaching. One or two energetic sentences.",
        "first_therapist_greeting": "Greet your patient warmly and ask: how many standing breaks per day is their goal, and how many are they currently taking? One or two sentences.",
        "checkin_therapist_greeting": "Greet your patient and immediately ask: how many standing breaks today so far — on track with their goal? One or two sentences.",
        "continue_therapist_greeting": "Welcome your patient back warmly. Reference their movement progress from previous sessions and dive straight into coaching. Two sentences.",
    },
}


# ── Agent subclasses with on_enter() for proactive greeting ───────────────────

class _TwinAgent(Agent):
    """Digital twin that speaks a greeting the moment the activity starts."""
    def __init__(self, *, instructions: str, greeting: str, lang_name: str):
        super().__init__(instructions=instructions)
        self._greeting  = greeting
        self._lang_name = lang_name

    async def on_enter(self) -> None:
        logger.info("TwinAgent.on_enter — sending greeting…")
        self.session.generate_reply(
            instructions=f"{self._greeting} Respond in {self._lang_name}."
        )


class _TherapistAgent(Agent):
    """Therapist that speaks a greeting the moment the activity starts."""
    def __init__(self, *, instructions: str, greeting: str, lang_name: str):
        super().__init__(instructions=instructions)
        self._greeting  = greeting
        self._lang_name = lang_name

    async def on_enter(self) -> None:
        logger.info("TherapistAgent.on_enter — sending greeting…")
        self.session.generate_reply(
            instructions=f"{self._greeting} Respond in {self._lang_name}."
        )


# ── Digital Twin session ───────────────────────────────────────────────────────

async def run_digital_twin_session(
    ctx: JobContext,
    ios_user: rtc.RemoteParticipant,
    voice_id: str | None,
    photo_url: str | None,
    language: str = "en",
    memory: str = "",
    goal: str = "",
    goal_target: str = "",
    goal_current: str = "",
    is_checkin: bool = False,
    system_prompt: str = "",
):
    lang_name = LANGUAGE_NAMES.get(language, "English")
    logger.info(f"Digital twin session — voice_id={voice_id}, lang={language}, goal={goal}")

    if not voice_id:
        logger.error("voice_id is missing — cannot start digital twin session")
        return

    # ── Trim env vars to avoid whitespace/newline bugs (same root cause as FAL_KEY) ─
    el_key       = (os.environ.get("ELEVENLABS_API_KEY") or "").strip()
    oai_key      = (os.environ.get("OPENAI_API_KEY")     or "").strip()
    anthropic_key = (os.environ.get("ANTHROPIC_API_KEY") or "").strip()

    if not el_key:
        logger.error("ELEVENLABS_API_KEY is empty — cannot produce TTS audio")
        return
    if not oai_key:
        logger.error("OPENAI_API_KEY is empty — cannot run STT")
        return
    if not anthropic_key:
        logger.error("ANTHROPIC_API_KEY is empty — cannot run Claude LLM")
        return

    logger.info(f"API keys OK — ElevenLabs={el_key[:6]}… OpenAI={oai_key[:6]}… Anthropic={anthropic_key[:6]}…")

    # ── AgentSession (VAD → STT → Claude LLM → TTS) ───────────────────────────
    session = AgentSession(
        vad=_VAD or silero.VAD.load(),
        stt=openai.STT(api_key=oai_key),
        llm=anthropic.LLM(model="claude-haiku-4-5-20251001", api_key=anthropic_key),
        tts=elevenlabs.TTS(
            api_key=el_key,
            voice_id=voice_id,
            model="eleven_turbo_v2_5",
        ),
        min_interruption_duration=1.2,
        min_interruption_words=2,
        min_endpointing_delay=0.2,
        max_endpointing_delay=3.0,
    )
    logger.info("AgentSession created ✓")

    # ── Hedra lip-sync — start BEFORE session.start() so Hedra sets output.audio first ──
    # When Hedra is active, session.start() sees output.audio already set → RoomIO skips
    # creating a duplicate audio track. Audio flows: TTS → DataStream → Hedra → video+audio.
    hedra_key = (os.environ.get("HEDRA_API_KEY") or "").strip()
    hedra_active = False   # True only if Hedra API call succeeded AND agent joined room

    if hedra_key and photo_url:
        logger.info(f"Hedra key prefix: {hedra_key[:8]}…  photo_url: {photo_url[:60]}…")
        avatar_img = download_image(photo_url)
        if avatar_img:
            logger.info(f"Avatar image ready: {avatar_img.size} — posting to Hedra API…")
            try:
                hedra_sess = hedra.AvatarSession(avatar_image=avatar_img, api_key=hedra_key)
                await hedra_sess.start(agent_session=session, room=ctx.room)
                logger.info("Hedra API call succeeded — waiting up to 15s for hedra-avatar-agent to join room…")

                # Log every participant that joins so we can see if Hedra's server arrives
                @ctx.room.on("participant_connected")
                def _log_join(p: rtc.RemoteParticipant):
                    logger.info(f"Participant joined room: identity={p.identity}")

                # Wait for hedra-avatar-agent to join AND publish its video track.
                # DataStreamAudioOutput sets wait_remote_track=KIND_VIDEO, which means
                # capture_frame() blocks (via asyncio.shield) until the video track appears.
                # Checking only for participant join is insufficient — Hedra may join the
                # room before its video track is ready, leaving TTS permanently blocked.
                # We mirror the same condition as DataStreamAudioOutput: video track published.
                _HEDRA_ID = "hedra-avatar-agent"
                for _i in range(60):   # 60 × 0.5s = 30 seconds max
                    hedra_p = next(
                        (p for p in ctx.room.remote_participants.values()
                         if p.identity == _HEDRA_ID),
                        None,
                    )
                    if hedra_p:
                        has_video = any(
                            pub.kind == rtc.TrackKind.KIND_VIDEO
                            for pub in hedra_p.track_publications.values()
                        )
                        if has_video:
                            hedra_active = True
                            logger.info(f"Hedra video track ready after {(_i+1)*0.5:.1f}s ✓ — lip-sync enabled")
                            break
                        else:
                            logger.debug(f"Hedra participant joined but no video track yet (attempt {_i+1}/60)…")
                    await asyncio.sleep(0.5)

                if not hedra_active:
                    logger.warning("Hedra video track NOT ready within 30s — resetting to direct audio output so voice works")
                    session.output.audio = None   # let session.start() use default RoomAudioOutput

            except Exception as e:
                logger.error(f"Hedra start FAILED: {type(e).__name__}: {e}", exc_info=True)
        else:
            logger.warning("Could not download avatar image — Hedra disabled")
    else:
        logger.info(
            f"Hedra skipped — HEDRA_API_KEY={'set' if hedra_key else 'MISSING'}, "
            f"photo_url={'set' if photo_url else 'MISSING'} — running direct audio"
        )

    # ── Build instructions ─────────────────────────────────────────────────────
    coaching     = GOAL_COACHING.get(goal, {})
    goal_section = f"\n\n{coaching['twin_system']}" if coaching.get("twin_system") else ""
    setup_section = ""
    if goal_target or goal_current:
        setup_section = "\n\nUser's goal setup (already collected — do NOT ask for this again):"
        if goal_target:  setup_section += f"\n- Target: {goal_target}"
        if goal_current: setup_section += f"\n- Current baseline: {goal_current}"

    is_first   = not memory.strip()
    has_setup  = bool(goal_target or goal_current)
    checkin_note = ""
    if not is_first:
        checkin_note = (
            "\n\nSESSION TYPE: CHECK-IN — ask for today's progress numbers."
            if is_checkin else
            "\n\nSESSION TYPE: CONTINUATION — do NOT ask for goal or baseline. Jump straight into coaching."
        )

    if is_first and has_setup:
        greeting = (
            f"You know the user's target ({goal_target}) and baseline ({goal_current}). "
            f"Welcome them and start coaching immediately. One or two energetic sentences in {lang_name}."
        )
    elif is_first:
        greeting = coaching.get("first_twin_greeting", f"Greet yourself warmly in first person in {lang_name}. One sentence.")
    elif is_checkin:
        greeting = coaching.get("checkin_twin_greeting", f"Ask yourself how you're doing today with your goal. One sentence.")
    else:
        greeting = coaching.get("continue_twin_greeting", f"Welcome yourself back briefly and continue coaching. One or two sentences.")

    # If the backend sent an enriched system prompt (brain config + health data + memory + RAG),
    # use it as the base — it already contains persona, health context, and session memory.
    # Otherwise fall back to the hardcoded default persona.
    if system_prompt:
        instructions = (
            system_prompt
            + f"\n\nIMPORTANT: Always respond in {lang_name}."
            + goal_section
            + setup_section
            + checkin_note
        )
    else:
        mem_section = f"\n\nContext from previous sessions:\n{memory}" if memory else ""
        instructions = (
            f"You are the user's digital twin — a first-person AI version of themselves.\n"
            f"Speak entirely in first person, as if you ARE the user.\n"
            f"Keep every response to 2–3 sentences maximum. Be direct and energetic.\n"
            f"Never break character. Never say you are an AI.\n"
            f"IMPORTANT: Always respond in {lang_name}."
            + goal_section + setup_section + mem_section + checkin_note
        )

    # ── Start session — on_enter() fires the greeting automatically ─────────
    try:
        await session.start(
            agent=_TwinAgent(instructions=instructions, greeting=greeting, lang_name=lang_name),
            room=ctx.room,
            room_options=RoomOptions(participant_identity=ios_user.identity),
        )
        logger.info("AgentSession started ✓")
    except Exception as e:
        logger.error(f"session.start() failed: {e}", exc_info=True)
        return


# ── Therapist session ──────────────────────────────────────────────────────────

async def run_therapist_session(
    ctx: JobContext,
    ios_user: rtc.RemoteParticipant,
    language: str = "en",
    memory: str = "",
    goal: str = "",
    goal_target: str = "",
    goal_current: str = "",
    is_checkin: bool = False,
    system_prompt: str = "",
):
    lang_name = LANGUAGE_NAMES.get(language, "English")
    logger.info(f"Therapist session — lang={language}, goal={goal}")

    therapist_voice_id = os.environ.get("THERAPIST_VOICE_ID", DEFAULT_THERAPIST_VOICE_ID)
    avatar_image = load_therapist_image()

    oai_key       = (os.environ.get("OPENAI_API_KEY")     or "").strip()
    anthropic_key = (os.environ.get("ANTHROPIC_API_KEY") or "").strip()
    if not oai_key:
        logger.error("OPENAI_API_KEY is empty — cannot run STT")
        return
    if not anthropic_key:
        logger.error("ANTHROPIC_API_KEY is empty — cannot run Claude LLM")
        return

    logger.info(f"Therapist API keys OK — OpenAI={oai_key[:6]}… Anthropic={anthropic_key[:6]}…")

    session = AgentSession(
        vad=_VAD or silero.VAD.load(),
        stt=openai.STT(api_key=oai_key),
        llm=anthropic.LLM(model="claude-haiku-4-5-20251001", api_key=anthropic_key),
        tts=openai.TTS(model="tts-1", voice="nova"),
        min_interruption_duration=2.0,
        min_interruption_words=2,
        min_endpointing_delay=0.3,
        max_endpointing_delay=5.0,
    )

    # Hedra disabled — same reason as digital twin (DataStreamAudioOutput blocks TTS)
    logger.info("Therapist running audio-only (Hedra disabled)")

    coaching      = GOAL_COACHING.get(goal, {})
    goal_section  = f"\n\n{coaching.get('therapist_system', '')}" if coaching.get("therapist_system") else ""
    setup_section = ""
    if goal_target or goal_current:
        setup_section = "\n\nUser's goal setup (already collected — do NOT ask again):"
        if goal_target:  setup_section += f"\n- Target: {goal_target}"
        if goal_current: setup_section += f"\n- Current baseline: {goal_current}"

    is_first   = not memory.strip()
    has_setup  = bool(goal_target or goal_current)
    checkin_note = ""
    if not is_first:
        checkin_note = (
            "\n\nSESSION TYPE: CHECK-IN — ask for today's progress numbers."
            if is_checkin else
            "\n\nSESSION TYPE: CONTINUATION — do NOT ask for goal or baseline. Jump straight into coaching."
        )

    if is_first and has_setup:
        greeting = (
            f"You know the patient's target ({goal_target}) and baseline ({goal_current}). "
            f"Greet them and start coaching immediately. One or two warm sentences in {lang_name}."
        )
    elif is_first:
        greeting = coaching.get("first_therapist_greeting", f"Greet the user warmly and invite them to share what's on their mind. 1–2 sentences.")
    elif is_checkin:
        greeting = coaching.get("checkin_therapist_greeting", f"Greet the user and check in on their progress today. 1–2 sentences.")
    else:
        greeting = coaching.get("continue_therapist_greeting", f"Welcome the user back warmly. Reference previous sessions and continue coaching. 1–2 sentences.")

    if system_prompt:
        instructions = (
            system_prompt
            + f"\n\nIMPORTANT: Always respond in {lang_name}."
            + goal_section
            + setup_section
            + checkin_note
        )
    else:
        mem_section = f"\n\nContext from previous sessions with this user:\n{memory}" if memory else ""
        instructions = (
            f"You are a warm, professional coach and therapist.\n"
            f"Listen with empathy, then push the user toward concrete action.\n"
            f"Keep every response to 2–3 sentences. Be direct, warm, and action-focused.\n"
            f"Never diagnose or give medical advice. If the user is in crisis, encourage them to contact emergency services.\n"
            f"IMPORTANT: Always respond in {lang_name}."
            + goal_section + setup_section + mem_section + checkin_note
        )

    try:
        await session.start(
            agent=_TherapistAgent(instructions=instructions, greeting=greeting, lang_name=lang_name),
            room=ctx.room,
            room_options=RoomOptions(participant_identity=ios_user.identity),
        )
        logger.info("Therapist session started ✓")
    except Exception as e:
        logger.error(f"Therapist session.start() failed: {e}", exc_info=True)
        return


if __name__ == "__main__":
    cli.run_app(WorkerOptions(
        entrypoint_fnc=entrypoint,
        worker_type=WorkerType.ROOM,
        agent_name="avatar-agent",
    ))
