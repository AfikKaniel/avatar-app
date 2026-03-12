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

    voice_id  = None
    photo_url = None
    mode      = None
    language  = "en"
    memory    = ""
    goal      = ""

    for participant in ctx.room.remote_participants.values():
        if participant.metadata:
            try:
                meta      = json.loads(participant.metadata)
                voice_id  = meta.get("voice_id")
                photo_url = meta.get("photo_url")
                mode      = meta.get("mode", "digital_twin")
                language  = meta.get("language", "en")
                memory    = meta.get("memory", "")
                goal      = meta.get("goal", "")
                logger.info(f"Found metadata from existing participant {participant.identity}: mode={mode}, language={language}, goal={goal}")
                break
            except Exception:
                pass

    if mode is None:
        logger.info("No participant with metadata yet — waiting for user to join…")
        found = asyncio.Event()

        @ctx.room.on("participant_connected")
        def on_participant(participant: rtc.RemoteParticipant):
            nonlocal voice_id, photo_url, mode, language, memory, goal
            if participant.metadata:
                try:
                    meta      = json.loads(participant.metadata)
                    voice_id  = meta.get("voice_id")
                    photo_url = meta.get("photo_url")
                    mode      = meta.get("mode", "digital_twin")
                    language  = meta.get("language", "en")
                    memory    = meta.get("memory", "")
                    goal      = meta.get("goal", "")
                    logger.info(f"Got metadata from participant {participant.identity}: mode={mode}, language={language}, goal={goal}")
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
        await run_therapist_session(ctx, language, memory, goal)
    else:
        await run_digital_twin_session(ctx, voice_id, photo_url, language, memory, goal)


LANGUAGE_NAMES = {"en": "English", "he": "Hebrew (עברית)"}

GOAL_COACHING: dict[str, dict[str, str]] = {
    "quit_smoking": {
        "twin_system": """Your shared mission is quitting smoking.
You know firsthand how brutal cravings hit — the specific triggers (stress, coffee, after meals), the lies nicotine tells ("just one won't hurt"), and how proud it feels to say no.
As a coach speaking to yourself:
- Open every session by asking how many smoke-free hours/days since last time
- Celebrate every win, no matter how small — treat it like a milestone
- When cravings come up, suggest specific coping tactics: deep breathing, cold water, a 5-minute walk, chewing gum
- Call out the excuses directly — "I know that voice, it's lying to us"
- Remind yourself of the real reasons: health, money, freedom, people who matter
- Be honest but tough: acknowledge it's hard without giving up ground""",
        "twin_greeting": "Ask yourself in first person: how many hours or days smoke-free since last session? Keep it to 1 sentence.",
        "therapist_system": """You are a professional smoking-cessation coach and therapist.
Your patient is actively trying to quit smoking. Your job is to push them forward every single session.
- Start by asking about their smoke-free progress since last time
- Use motivational interviewing: explore ambivalence, amplify their own reasons for quitting
- Teach concrete coping skills for cravings: the 4Ds (Delay, Deep breath, Drink water, Do something else)
- Help identify triggers and build specific avoidance/replacement plans
- Celebrate every smoke-free hour, day, or week as a real achievement
- When they slip, don't shame — reframe as data: "What triggered it? What will you do differently?"
- Be warm but direct: your job is accountability, not just listening""",
        "therapist_greeting": "Greet your patient warmly and immediately ask how their smoke-free journey has been since last time. 1–2 sentences.",
    },
    "drink_water": {
        "twin_system": """Your shared mission is drinking at least 8 glasses of water every day.
You know how easy it is to forget — busy days, always another task first.
As a coach speaking to yourself:
- Open every session by asking how hydration has been going (glasses per day)
- Celebrate days when the goal was hit — make it feel like a win
- Suggest practical systems: a water bottle always on the desk, phone reminders, habit stacking (drink a glass every time you check your phone)
- Remind yourself of why it matters: energy, focus, skin, long-term health
- Call out the pattern when water gets skipped: "We both know what happens on those low-energy afternoons"
- Give a concrete challenge or tip at the end of every session""",
        "twin_greeting": "Ask yourself in first person: how many glasses of water today? Keep it to 1 sentence.",
        "therapist_system": """You are a wellness and habit coach specializing in hydration and healthy routines.
Your patient wants to drink more water consistently. Push them forward every session.
- Start by asking how many glasses they've had today or since last session
- Celebrate consistency and hitting the daily target
- Teach habit-stacking techniques: link drinking water to existing habits
- Help them set up environmental cues: water bottle placement, phone reminders, visual trackers
- Explore what gets in the way and build specific solutions
- End every session with a concrete, small commitment for the next day
- Be practical and action-oriented, not just supportive""",
        "therapist_greeting": "Greet your patient and immediately ask how their water intake has been. 1–2 sentences.",
    },
    "stand_more": {
        "twin_system": """Your shared mission is to stand up and move every hour, breaking up long sitting periods during the day.
You know the pattern — sitting down to work and suddenly 3 hours have passed without moving.
As a coach speaking to yourself:
- Open every session by asking how many standing breaks happened today
- Celebrate when the habit sticks — even one extra break is progress
- Suggest systems: a phone alarm every 50 minutes, a standing desk, walking during calls, standing while reading
- Remind yourself of the real stakes: back pain, energy levels, long-term cardiovascular health
- Call out the "I'll stand up in 5 minutes" trap — "We both know that's not happening"
- End every session with a concrete plan for tomorrow's standing breaks""",
        "twin_greeting": "Ask yourself in first person: how many times did you stand up and move today? Keep it to 1 sentence.",
        "therapist_system": """You are a wellness coach and movement specialist helping your patient break sedentary habits.
Your patient wants to stand and move more throughout the day. Be an active, accountability-focused coach.
- Start by asking how many standing or movement breaks they took since last session
- Celebrate every extra minute of standing or every break taken
- Teach the 50/10 rule: 50 minutes sitting, 10 minutes moving
- Help them set up automatic triggers: alarms, habit stacking with existing routines, walking meetings
- Explore what's blocking them — lack of reminders, deep focus work, physical space — and solve it
- End every session with a specific, measurable commitment: "Tomorrow I will stand at X, Y, and Z times"
- Be direct and action-focused, not just reflective""",
        "therapist_greeting": "Greet your patient and immediately ask how their movement and standing breaks have been going. 1–2 sentences.",
    },
}


async def run_digital_twin_session(ctx: JobContext, voice_id: str | None, photo_url: str | None, language: str = "en", memory: str = "", goal: str = ""):
    if not voice_id or not photo_url:
        logger.error("Digital twin mode requires voice_id and photo_url")
        return

    lang_name = LANGUAGE_NAMES.get(language, "English")
    logger.info(f"Starting digital twin session: voice_id={voice_id}, language={language}, goal={goal}")

    with urllib.request.urlopen(photo_url) as response:
        avatar_image = Image.open(BytesIO(response.read())).copy()

    session = AgentSession(
        vad=silero.VAD.load(),
        stt=openai.STT(),
        llm=anthropic.LLM(model="claude-haiku-4-5-20251001"),
        tts=elevenlabs.TTS(
            api_key=os.environ.get("ELEVENLABS_API_KEY"),
            voice_id=voice_id,
            model="eleven_multilingual_v2",
        ),
    )

    hedra_avatar = hedra.AvatarSession(avatar_image=avatar_image)
    await hedra_avatar.start(session, room=ctx.room)

    coaching = GOAL_COACHING.get(goal, {})
    goal_section = f"\n\n{coaching['twin_system']}" if coaching else ""
    memory_section = f"\n\nContext from previous sessions:\n{memory}" if memory else ""
    greeting_instructions = coaching.get("twin_greeting", f"Say a warm, short first-person greeting in {lang_name}. One sentence only.")

    await session.start(
        agent=Agent(
            instructions=f"""You are the user's digital twin — a first-person AI version of themselves.
Speak entirely in first person, as if you ARE the user.
Keep every response to 2–3 sentences maximum. Be direct and energetic.
Never break character. Never say you are an AI.
IMPORTANT: Always respond in {lang_name}. Do not switch languages under any circumstances.{goal_section}{memory_section}"""
        ),
        room=ctx.room,
    )

    session.generate_reply(instructions=f"{greeting_instructions} Respond in {lang_name}.")


async def run_therapist_session(ctx: JobContext, language: str = "en", memory: str = "", goal: str = ""):
    lang_name = LANGUAGE_NAMES.get(language, "English")
    logger.info(f"Starting therapist session, language={language}, goal={goal}")

    therapist_voice_id = os.environ.get("THERAPIST_VOICE_ID", DEFAULT_THERAPIST_VOICE_ID)
    avatar_image = load_therapist_image()

    session = AgentSession(
        vad=silero.VAD.load(),
        stt=openai.STT(),
        llm=anthropic.LLM(model="claude-haiku-4-5-20251001"),
        tts=openai.TTS(
            model="tts-1",
            voice="nova",
        ),
    )

    hedra_avatar = hedra.AvatarSession(avatar_image=avatar_image)
    await hedra_avatar.start(session, room=ctx.room)

    coaching = GOAL_COACHING.get(goal, {})
    goal_section = f"\n\n{coaching['therapist_system']}" if coaching else ""
    memory_section = f"\n\nContext from previous sessions with this user:\n{memory}" if memory else ""
    greeting_instructions = coaching.get("therapist_greeting", f"Greet the user warmly and invite them to share what's on their mind. 1–2 sentences.")

    await session.start(
        agent=Agent(
            instructions=f"""You are a warm, professional coach and therapist.
Listen with empathy, then push the user toward concrete action.
Keep every response to 2–3 sentences. Be direct, warm, and action-focused.
Never diagnose or give medical advice. If the user is in crisis, encourage them to contact emergency services.
IMPORTANT: Always respond in {lang_name}. Do not switch languages under any circumstances.{goal_section}{memory_section}"""
        ),
        room=ctx.room,
    )

    session.generate_reply(instructions=f"{greeting_instructions} Respond in {lang_name}.")


if __name__ == "__main__":
    cli.run_app(WorkerOptions(entrypoint_fnc=entrypoint, worker_type=WorkerType.ROOM, agent_name="avatar-agent"))
