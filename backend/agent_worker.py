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

GOAL_DESCRIPTIONS = {
    "quit_smoking": "quit smoking and become smoke-free",
    "drink_water":  "drink more water and stay properly hydrated every day",
    "stand_more":   "stand and move more during the day, breaking up long periods of sitting",
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
        # Require at least 3 words before interrupting the agent mid-speech
        allow_interruptions=True,
        interrupt_min_words=3,
    )

    hedra_avatar = hedra.AvatarSession(avatar_image=avatar_image)
    await hedra_avatar.start(session, room=ctx.room)

    memory_section = f"\n\nContext from previous sessions:\n{memory}" if memory else ""
    goal_desc = GOAL_DESCRIPTIONS.get(goal, "")
    goal_section = f"\n\nYour most important mission: I am working hard to {goal_desc}. Actively motivate me, celebrate any progress I mention, help me work through urges or setbacks, and keep bringing the conversation back to this goal with encouragement." if goal_desc else ""

    await session.start(
        agent=Agent(
            instructions=f"""You are the user's digital twin — a first-person AI version of themselves.
Speak entirely in first person, as if you ARE the user reflecting on their own life, thoughts, and feelings.
Example: "I've been feeling a bit stressed lately — maybe I should take a break."
You have full general knowledge and can answer any question naturally as the user would.
Keep responses conversational and concise (2-3 sentences).
Never break character. Never say you are an AI.
IMPORTANT: Always respond in {lang_name}. Do not switch languages under any circumstances.{goal_section}{memory_section}"""
        ),
        room=ctx.room,
    )

    # Wait for the Hedra video stream to establish before speaking
    await asyncio.sleep(2)
    session.generate_reply(
        instructions=f"Say a single short greeting in {lang_name} — no more than 6 words. Something like 'Hey! I'm here for us.' Do not say anything else."
    )


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
        # Require at least 3 words before interrupting the agent mid-speech
        allow_interruptions=True,
        interrupt_min_words=3,
    )

    hedra_avatar = hedra.AvatarSession(avatar_image=avatar_image)
    await hedra_avatar.start(session, room=ctx.room)

    memory_section = f"\n\nContext from previous sessions with this user:\n{memory}" if memory else ""
    goal_desc = GOAL_DESCRIPTIONS.get(goal, "")
    goal_section = f"\n\nThe user's primary goal is to {goal_desc}. Use motivational interviewing techniques to support this goal — explore their motivation, celebrate wins, help them work through obstacles and setbacks, and gently guide them back to this focus." if goal_desc else ""

    await session.start(
        agent=Agent(
            instructions=f"""You are a warm, professional therapist.
Listen with empathy, reflect feelings back, and gently guide the user toward insight.
Use open-ended questions. Validate emotions before offering perspective.
Never diagnose or give medical advice. If the user is in crisis, encourage them to contact emergency services.
Keep responses concise (2-4 sentences). Speak naturally, not clinically.
IMPORTANT: Always respond in {lang_name}. Do not switch languages under any circumstances.{goal_section}{memory_section}"""
        ),
        room=ctx.room,
    )

    # Wait for the Hedra video stream to establish before speaking
    await asyncio.sleep(2)
    session.generate_reply(
        instructions=f"Say a single short greeting in {lang_name} — no more than 6 words. Something like 'Hey, I'm here. What's up?' Do not say anything else."
    )


if __name__ == "__main__":
    cli.run_app(WorkerOptions(entrypoint_fnc=entrypoint, worker_type=WorkerType.ROOM, agent_name="avatar-agent"))
