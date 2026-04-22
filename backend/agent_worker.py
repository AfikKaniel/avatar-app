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

def crop_face_portrait(img: Image.Image) -> Image.Image:
    """
    Crop the top 35% of a full-body image to get a usable face portrait for Hedra.
    Hedra works best with a 512×512 face portrait, not a full-body shot.
    """
    w, h = img.size
    face_h = int(h * 0.35)
    face = img.crop((0, 0, w, face_h))
    return face.resize((512, 512), Image.LANCZOS)


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
    voice_id     = None
    photo_url    = None
    mode         = "digital_twin"
    language     = "en"
    memory       = ""
    goal         = ""
    goal_target  = ""
    goal_current = ""
    is_checkin   = False

    def apply_meta(meta: dict):
        nonlocal voice_id, photo_url, mode, language, memory
        nonlocal goal, goal_target, goal_current, is_checkin
        mode         = meta.get("mode", "digital_twin")
        voice_id     = meta.get("voice_id")
        photo_url    = meta.get("photo_url")
        language     = meta.get("language", "en")
        memory       = meta.get("memory", "")
        goal         = meta.get("goal", "")
        goal_target  = meta.get("goal_target", "")
        goal_current = meta.get("goal_current", "")
        is_checkin   = meta.get("is_checkin", "0") == "1"

    room_raw = ctx.room.metadata
    if room_raw:
        try:
            apply_meta(json.loads(room_raw))
            logger.info(f"Room metadata parsed: mode={mode}, language={language}, voice_id={voice_id}")
        except Exception as e:
            logger.warning(f"Failed to parse room metadata: {e}")

    # Fallback: try participant metadata
    if mode == "digital_twin" and not voice_id:
        for p in ctx.room.remote_participants.values():
            raw = p.metadata
            if raw:
                try:
                    apply_meta(json.loads(raw))
                    logger.info(f"Participant metadata parsed: mode={mode}")
                    break
                except Exception:
                    pass

    logger.info(f"Session config — mode={mode}, voice_id={voice_id}, photo_url={'set' if photo_url else 'none'}")

    # ── 2. Wait for the iOS user to be in the room ──────────────────────────────
    ios_user = await wait_for_user(ctx)
    if ios_user is None:
        logger.error("No iOS user — aborting session")
        return

    # Give iOS a moment to fully subscribe to the agent's audio track
    await asyncio.sleep(0.8)
    logger.info(f"Starting session with participant: {ios_user.identity}")

    # ── 3. Run the appropriate session type ─────────────────────────────────────
    if mode == "therapist":
        await run_therapist_session(
            ctx, ios_user, language, memory,
            goal, goal_target, goal_current, is_checkin
        )
    else:
        await run_digital_twin_session(
            ctx, ios_user, voice_id, photo_url, language, memory,
            goal, goal_target, goal_current, is_checkin
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
):
    lang_name = LANGUAGE_NAMES.get(language, "English")
    logger.info(f"Digital twin session — voice_id={voice_id}, lang={language}, goal={goal}")

    if not voice_id:
        logger.error("voice_id is missing — cannot start digital twin session")
        return

    # ── Trim env vars to avoid whitespace/newline bugs (same root cause as FAL_KEY) ─
    el_key  = (os.environ.get("ELEVENLABS_API_KEY") or "").strip()
    oai_key = (os.environ.get("OPENAI_API_KEY")     or "").strip()

    if not el_key:
        logger.error("ELEVENLABS_API_KEY is empty — cannot produce TTS audio")
        return
    if not oai_key:
        logger.error("OPENAI_API_KEY is empty — cannot run STT")
        return

    logger.info(f"API keys loaded — ElevenLabs prefix={el_key[:6]}… OpenAI prefix={oai_key[:6]}…")

    # ── AgentSession (VAD → STT → LLM → TTS) ─────────────────────────────────
    session = AgentSession(
        vad=_VAD or silero.VAD.load(),
        stt=openai.STT(api_key=oai_key),
        llm=anthropic.LLM(model="claude-haiku-4-5-20251001"),
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

    logger.info("Running audio-only digital twin (Hedra disabled — audio guaranteed)")

    # ── Build system prompt ────────────────────────────────────────────────────
    coaching     = GOAL_COACHING.get(goal, {})
    goal_section = f"\n\n{coaching['twin_system']}" if coaching.get("twin_system") else ""
    mem_section  = f"\n\nContext from previous sessions:\n{memory}" if memory else ""
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

    instructions = (
        f"You are the user's digital twin — a first-person AI version of themselves.\n"
        f"Speak entirely in first person, as if you ARE the user.\n"
        f"Keep every response to 2–3 sentences maximum. Be direct and energetic.\n"
        f"Never break character. Never say you are an AI.\n"
        f"IMPORTANT: Always respond in {lang_name}."
        f"{goal_section}{setup_section}{mem_section}{checkin_note}"
    )

    # ── Start session targeted at the iOS participant ─────────────────────────
    try:
        await session.start(
            agent=Agent(instructions=instructions),
            room=ctx.room,
            room_options=RoomOptions(participant_identity=ios_user.identity),
        )
        logger.info("AgentSession started ✓")
    except Exception as e:
        logger.error(f"session.start() failed: {e}", exc_info=True)
        return

    # Give RoomIO._init_task time to publish the audio track and wait for
    # iOS client subscription before queuing TTS (avoids capture_frame blocking).
    await asyncio.sleep(1.5)
    logger.info("Post-start delay done — queuing greeting…")

    # ── Fire opening greeting (fire-and-forget; session handles delivery) ────
    try:
        session.generate_reply(instructions=f"{greeting} Respond in {lang_name}.")
        logger.info("Greeting queued ✓")
    except Exception as e:
        logger.error(f"generate_reply() failed: {e}", exc_info=True)


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
):
    lang_name = LANGUAGE_NAMES.get(language, "English")
    logger.info(f"Therapist session — lang={language}, goal={goal}")

    therapist_voice_id = os.environ.get("THERAPIST_VOICE_ID", DEFAULT_THERAPIST_VOICE_ID)
    avatar_image = load_therapist_image()

    oai_key = (os.environ.get("OPENAI_API_KEY") or "").strip()
    if not oai_key:
        logger.error("OPENAI_API_KEY is empty — cannot run therapist session")
        return

    session = AgentSession(
        vad=_VAD or silero.VAD.load(),
        stt=openai.STT(api_key=oai_key),
        llm=anthropic.LLM(model="claude-haiku-4-5-20251001"),
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
    mem_section   = f"\n\nContext from previous sessions with this user:\n{memory}" if memory else ""
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

    instructions = (
        f"You are a warm, professional coach and therapist.\n"
        f"Listen with empathy, then push the user toward concrete action.\n"
        f"Keep every response to 2–3 sentences. Be direct, warm, and action-focused.\n"
        f"Never diagnose or give medical advice. If the user is in crisis, encourage them to contact emergency services.\n"
        f"IMPORTANT: Always respond in {lang_name}."
        f"{goal_section}{setup_section}{mem_section}{checkin_note}"
    )

    try:
        await session.start(
            agent=Agent(instructions=instructions),
            room=ctx.room,
            room_options=RoomOptions(participant_identity=ios_user.identity),
        )
        logger.info("Therapist session started ✓")
    except Exception as e:
        logger.error(f"Therapist session.start() failed: {e}", exc_info=True)
        return

    await asyncio.sleep(1.5)
    logger.info("Therapist post-start delay done — queuing greeting…")

    try:
        session.generate_reply(instructions=f"{greeting} Respond in {lang_name}.")
        logger.info("Therapist greeting queued ✓")
    except Exception as e:
        logger.error(f"Therapist generate_reply() failed: {e}", exc_info=True)


if __name__ == "__main__":
    cli.run_app(WorkerOptions(
        entrypoint_fnc=entrypoint,
        worker_type=WorkerType.ROOM,
        agent_name="avatar-agent",
    ))
