#!/opt/homebrew/bin/python3.11
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
from livekit.plugins import anthropic, elevenlabs, hedra, openai, silero

logger = logging.getLogger("hedra-avatar")
logger.setLevel(logging.INFO)

load_dotenv(dotenv_path=os.path.join(os.path.dirname(__file__), "..", ".env.local"))

ASSETS_DIR = os.path.join(os.path.dirname(__file__), "assets")

# Default ElevenLabs "Rachel" voice — calm, professional
DEFAULT_THERAPIST_VOICE_ID = "21m00Tcm4TlvDq8ikWAM"


def load_therapist_image() -> Image.Image:
    """Load therapist avatar image from local asset, env URL, or generate placeholder."""
    local_path = os.path.join(ASSETS_DIR, "therapist.jpg")
    if os.path.exists(local_path):
        logger.info("Loaded therapist image from local asset")
        return Image.open(local_path).copy()

    photo_url = os.environ.get("THERAPIST_PHOTO_URL")
    if photo_url:
        logger.info("Loaded therapist image from THERAPIST_PHOTO_URL")
        with urllib.request.urlopen(photo_url) as response:
            return Image.open(BytesIO(response.read())).copy()

    # Fallback: generate a simple neutral silhouette placeholder
    logger.warning("No therapist.jpg or THERAPIST_PHOTO_URL found — using placeholder")
    img = Image.new("RGB", (512, 512), color=(220, 220, 230))
    draw = ImageDraw.Draw(img)
    draw.ellipse([176, 80, 336, 240], fill=(180, 180, 190))
    draw.ellipse([112, 280, 400, 560], fill=(100, 120, 160))
    return img


async def entrypoint(ctx: JobContext):
    await ctx.connect()

    voice_id     = None
    photo_url    = None
    mode         = None
    language     = "en"
    memory       = ""
    goal         = ""
    goal_target  = ""
    goal_current = ""
    is_checkin   = False

    for participant in ctx.room.remote_participants.values():
        if participant.metadata:
            try:
                meta         = json.loads(participant.metadata)
                voice_id     = meta.get("voice_id")
                photo_url    = meta.get("photo_url")
                mode         = meta.get("mode", "digital_twin")
                language     = meta.get("language", "en")
                memory       = meta.get("memory", "")
                goal         = meta.get("goal", "")
                goal_target  = meta.get("goal_target", "")
                goal_current = meta.get("goal_current", "")
                is_checkin   = meta.get("is_checkin", "0") == "1"
                logger.info(f"Found metadata from existing participant {participant.identity}: mode={mode}, language={language}, goal={goal}, is_checkin={is_checkin}")
                break
            except Exception:
                pass

    if mode is None:
        logger.info("No participant with metadata yet — waiting for user to join…")
        found = asyncio.Event()

        @ctx.room.on("participant_connected")
        def on_participant(participant: rtc.RemoteParticipant):
            nonlocal voice_id, photo_url, mode, language, memory, goal, goal_target, goal_current, is_checkin
            if participant.metadata:
                try:
                    meta         = json.loads(participant.metadata)
                    voice_id     = meta.get("voice_id")
                    photo_url    = meta.get("photo_url")
                    mode         = meta.get("mode", "digital_twin")
                    language     = meta.get("language", "en")
                    memory       = meta.get("memory", "")
                    goal         = meta.get("goal", "")
                    goal_target  = meta.get("goal_target", "")
                    goal_current = meta.get("goal_current", "")
                    is_checkin   = meta.get("is_checkin", "0") == "1"
                    logger.info(f"Got metadata from participant {participant.identity}: mode={mode}, language={language}, goal={goal}, is_checkin={is_checkin}")
                    found.set()
                except Exception:
                    pass

        try:
            await asyncio.wait_for(found.wait(), timeout=10.0)
        except asyncio.TimeoutError:
            logger.error("Timed out waiting for participant metadata")

    if mode is None:
        logger.error("Could not determine session mode")
        return

    if mode == "therapist":
        await run_therapist_session(ctx, language, memory, goal, goal_target, goal_current, is_checkin)
    else:
        await run_digital_twin_session(ctx, voice_id, photo_url, language, memory, goal, goal_target, goal_current, is_checkin)


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
        "twin_system": """Your shared mission is drinking enough water every single day.
You know how easy it is to forget — busy days, always another task first.
As a coach speaking to yourself:
- You already know the user's hydration goal and baseline — do NOT ask for them again unless this is a designated check-in session.
- Celebrate when the goal is hit — make it feel like a real win.
- Suggest practical systems: water bottle always on the desk, phone reminders, habit stacking (drink a glass every time you check your phone).
- Remind yourself why it matters: energy, focus, skin, long-term health.
- Call out the pattern when water gets skipped.
- End each session with one concrete hydration commitment for the next day.""",
        "therapist_system": """You are a wellness and habit coach specializing in hydration and healthy routines.
Your patient wants to drink more water consistently. Push them forward every session.
- You already know the patient's hydration goal and baseline — do NOT ask for them again unless this is a designated check-in session.
- Celebrate consistency and hitting the daily target.
- Teach habit-stacking: link drinking water to existing habits.
- Help set up environmental cues: water bottle placement, phone reminders, visual trackers.
- Explore what gets in the way and build specific solutions.
- End every session with a concrete, small commitment for the next day.
- Be practical and action-oriented, not just supportive.""",
        "first_twin_greeting": "Ask yourself in first person, warmly: how many glasses of water do you want to drink per day as your goal, and how many are you actually drinking right now? One natural sentence.",
        "checkin_twin_greeting": "Ask yourself in first person, directly: how many glasses of water have you had so far today — are you on track? One short sentence.",
        "continue_twin_greeting": "Welcome yourself back in first person. Reference the hydration progress from before and dive straight into coaching. One or two energetic sentences — no need to re-ask for numbers.",
        "first_therapist_greeting": "Greet your patient warmly and ask: how many glasses of water per day is their goal, and how many are they currently drinking? One or two sentences.",
        "checkin_therapist_greeting": "Greet your patient and immediately ask: how many glasses of water today so far — on track with their goal? One or two sentences.",
        "continue_therapist_greeting": "Welcome your patient back warmly. Reference their hydration journey from previous sessions and move straight into coaching. Two sentences — do not re-ask for their goal numbers.",
    },
    "stand_more": {
        "twin_system": """Your shared mission is to stand up and move regularly throughout the day, breaking long sitting periods.
You know the pattern — sitting down and suddenly 3 hours have passed without moving.
As a coach speaking to yourself:
- You already know the user's standing goal and baseline — do NOT ask for them again unless this is a designated check-in session.
- Celebrate when the habit sticks — even one extra break is real progress.
- Suggest systems: a phone alarm every 50 minutes, standing desk, walking during calls, standing while reading.
- Remind yourself of the real stakes: back pain, energy levels, long-term cardiovascular health.
- Call out the "I'll stand up in 5 minutes" trap.
- End each session with a concrete standing plan for the next day.""",
        "therapist_system": """You are a wellness coach and movement specialist helping your patient break sedentary habits.
Your patient wants to stand and move more throughout the day. Be an active, accountability-focused coach.
- You already know the patient's standing goal and baseline — do NOT ask for them again unless this is a designated check-in session.
- Celebrate every extra break taken.
- Teach the 50/10 rule: 50 minutes sitting, 10 minutes moving.
- Help set up automatic triggers: alarms, habit stacking, walking meetings.
- Explore what's blocking them and solve it concretely.
- End every session with a specific, measurable commitment for tomorrow.
- Be direct and action-focused, not just reflective.""",
        "first_twin_greeting": "Ask yourself in first person, warmly: how many times a day do you want to stand up and move as your goal, and how often are you actually doing it right now? One natural sentence.",
        "checkin_twin_greeting": "Ask yourself in first person, directly: how many standing breaks have you taken today — are you hitting your goal? One short sentence.",
        "continue_twin_greeting": "Welcome yourself back in first person. Reference the movement habits we've been building and jump straight into coaching. One or two energetic sentences — no need to re-ask for numbers.",
        "first_therapist_greeting": "Greet your patient warmly and ask: how many standing breaks per day is their goal, and how many are they currently taking? One or two sentences.",
        "checkin_therapist_greeting": "Greet your patient and immediately ask: how many standing breaks today so far — on track with their goal? One or two sentences.",
        "continue_therapist_greeting": "Welcome your patient back warmly. Reference their movement progress from previous sessions and dive straight into coaching. Two sentences — do not re-ask for their goal numbers.",
    },
}


async def run_digital_twin_session(ctx: JobContext, voice_id: str | None, photo_url: str | None, language: str = "en", memory: str = "", goal: str = "", goal_target: str = "", goal_current: str = "", is_checkin: bool = False):
    if not voice_id or not photo_url:
        logger.error("Digital twin mode requires voice_id and photo_url")
        return

    lang_name = LANGUAGE_NAMES.get(language, "English")
    logger.info(f"Starting digital twin session: voice_id={voice_id}, language={language}, goal={goal}")

    with urllib.request.urlopen(photo_url) as response:
        avatar_image = Image.open(BytesIO(response.read())).copy()

    session = AgentSession(
        vad=silero.VAD.load(
            activation_threshold=0.85,
            min_silence_duration=0.6,
        ),
        stt=openai.STT(),
        llm=anthropic.LLM(model="claude-haiku-4-5-20251001"),
        tts=elevenlabs.TTS(
            api_key=os.environ.get("ELEVENLABS_API_KEY"),
            voice_id=voice_id,
            model="eleven_multilingual_v2",
        ),
        min_interruption_duration=2.0,
        min_interruption_words=2,
        min_endpointing_delay=0.3,
        max_endpointing_delay=5.0,
    )

    hedra_avatar = hedra.AvatarSession(avatar_image=avatar_image)
    await hedra_avatar.start(session, room=ctx.room)

    coaching = GOAL_COACHING.get(goal, {})
    goal_section = f"\n\n{coaching['twin_system']}" if coaching else ""
    memory_section = f"\n\nContext from previous sessions:\n{memory}" if memory else ""
    setup_section = ""
    if goal_target or goal_current:
        setup_section = f"\n\nUser's goal setup (already collected — do NOT ask for this again):"
        if goal_target:
            setup_section += f"\n- Target: {goal_target}"
        if goal_current:
            setup_section += f"\n- Current baseline: {goal_current}"

    is_first_session = not memory.strip()
    checkin_note = ""
    if not is_first_session:
        checkin_note = (
            "\n\nSESSION TYPE: CHECK-IN — ask for today's progress numbers."
            if is_checkin else
            "\n\nSESSION TYPE: CONTINUATION — do NOT ask for goal or baseline numbers. Jump straight into coaching using the context from previous sessions."
        )

    has_setup = bool(goal_target or goal_current)
    if is_first_session and has_setup:
        greeting_instructions = (
            f"You already know the user's goal target ({goal_target}) and current baseline ({goal_current}). "
            f"Welcome them to their first session in first person. Acknowledge their numbers and start coaching immediately. "
            f"One or two energetic sentences in {lang_name}."
        )
    elif is_first_session:
        greeting_instructions = coaching.get("first_twin_greeting", f"Greet yourself warmly in first person in {lang_name}. One sentence.")
    elif is_checkin:
        greeting_instructions = coaching.get("checkin_twin_greeting", f"Ask yourself in first person how you're doing today with your goal. One sentence.")
    else:
        greeting_instructions = coaching.get("continue_twin_greeting", f"Welcome yourself back in first person. Reference the previous sessions briefly and continue coaching. One or two sentences.")

    await session.start(
        agent=Agent(
            instructions=f"""You are the user's digital twin — a first-person AI version of themselves.
Speak entirely in first person, as if you ARE the user.
Keep every response to 2–3 sentences maximum. Be direct and energetic.
Never break character. Never say you are an AI.
IMPORTANT: Always respond in {lang_name}. Do not switch languages under any circumstances.{goal_section}{setup_section}{memory_section}{checkin_note}"""
        ),
        room=ctx.room,
    )

    session.generate_reply(instructions=f"{greeting_instructions} Respond in {lang_name}.")


async def run_therapist_session(ctx: JobContext, language: str = "en", memory: str = "", goal: str = "", goal_target: str = "", goal_current: str = "", is_checkin: bool = False):
    lang_name = LANGUAGE_NAMES.get(language, "English")
    logger.info(f"Starting therapist session, language={language}, goal={goal}")

    therapist_voice_id = os.environ.get("THERAPIST_VOICE_ID", DEFAULT_THERAPIST_VOICE_ID)
    avatar_image = load_therapist_image()

    session = AgentSession(
        vad=silero.VAD.load(
            activation_threshold=0.85,
            min_silence_duration=0.6,
        ),
        stt=openai.STT(),
        llm=anthropic.LLM(model="claude-haiku-4-5-20251001"),
        tts=openai.TTS(
            model="tts-1",
            voice="nova",
        ),
        min_interruption_duration=2.0,
        min_interruption_words=2,
        min_endpointing_delay=0.3,
        max_endpointing_delay=5.0,
    )

    hedra_avatar = hedra.AvatarSession(avatar_image=avatar_image)
    await hedra_avatar.start(session, room=ctx.room)

    coaching = GOAL_COACHING.get(goal, {})
    goal_section = f"\n\n{coaching['therapist_system']}" if coaching else ""
    memory_section = f"\n\nContext from previous sessions with this user:\n{memory}" if memory else ""
    setup_section = ""
    if goal_target or goal_current:
        setup_section = f"\n\nUser's goal setup (already collected — do NOT ask for this again):"
        if goal_target:
            setup_section += f"\n- Target: {goal_target}"
        if goal_current:
            setup_section += f"\n- Current baseline: {goal_current}"

    is_first_session = not memory.strip()
    checkin_note = ""
    if not is_first_session:
        checkin_note = (
            "\n\nSESSION TYPE: CHECK-IN — ask for today's progress numbers."
            if is_checkin else
            "\n\nSESSION TYPE: CONTINUATION — do NOT ask for goal or baseline numbers. Jump straight into coaching using the context from previous sessions."
        )

    has_setup = bool(goal_target or goal_current)
    if is_first_session and has_setup:
        greeting_instructions = (
            f"You already know the user's goal target ({goal_target}) and current baseline ({goal_current}). "
            f"Greet them warmly for their first session. Acknowledge their numbers and jump straight into coaching. "
            f"One or two warm, direct sentences in {lang_name}."
        )
    elif is_first_session:
        greeting_instructions = coaching.get("first_therapist_greeting", f"Greet the user warmly and invite them to share what's on their mind. 1–2 sentences.")
    elif is_checkin:
        greeting_instructions = coaching.get("checkin_therapist_greeting", f"Greet the user and check in on their progress today. 1–2 sentences.")
    else:
        greeting_instructions = coaching.get("continue_therapist_greeting", f"Welcome the user back warmly. Reference the previous sessions and continue coaching. 1–2 sentences.")

    await session.start(
        agent=Agent(
            instructions=f"""You are a warm, professional coach and therapist.
Listen with empathy, then push the user toward concrete action.
Keep every response to 2–3 sentences. Be direct, warm, and action-focused.
Never diagnose or give medical advice. If the user is in crisis, encourage them to contact emergency services.
IMPORTANT: Always respond in {lang_name}. Do not switch languages under any circumstances.{goal_section}{setup_section}{memory_section}{checkin_note}"""
        ),
        room=ctx.room,
    )

    session.generate_reply(instructions=f"{greeting_instructions} Respond in {lang_name}.")


if __name__ == "__main__":
    cli.run_app(WorkerOptions(entrypoint_fnc=entrypoint, worker_type=WorkerType.ROOM, agent_name="avatar-agent"))
