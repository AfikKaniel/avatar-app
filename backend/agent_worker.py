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

    for participant in ctx.room.remote_participants.values():
        if participant.metadata:
            try:
                meta      = json.loads(participant.metadata)
                voice_id  = meta.get("voice_id")
                photo_url = meta.get("photo_url")
                mode      = meta.get("mode", "digital_twin")
                logger.info(f"Found metadata from existing participant {participant.identity}: mode={mode}")
                break
            except Exception:
                pass

    if mode is None:
        logger.info("No participant with metadata yet — waiting for user to join…")
        found = asyncio.Event()

        @ctx.room.on("participant_connected")
        def on_participant(participant: rtc.RemoteParticipant):
            nonlocal voice_id, photo_url, mode
            if participant.metadata:
                try:
                    meta      = json.loads(participant.metadata)
                    voice_id  = meta.get("voice_id")
                    photo_url = meta.get("photo_url")
                    mode      = meta.get("mode", "digital_twin")
                    logger.info(f"Got metadata from participant {participant.identity}: mode={mode}")
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
        await run_therapist_session(ctx)
    else:
        await run_digital_twin_session(ctx, voice_id, photo_url)


async def run_digital_twin_session(ctx: JobContext, voice_id: str | None, photo_url: str | None):
    if not voice_id or not photo_url:
        logger.error("Digital twin mode requires voice_id and photo_url")
        return

    logger.info(f"Starting digital twin session: voice_id={voice_id}")

    with urllib.request.urlopen(photo_url) as response:
        avatar_image = Image.open(BytesIO(response.read())).copy()

    session = AgentSession(
        vad=silero.VAD.load(),
        stt=openai.STT(),
        llm=anthropic.LLM(model="claude-haiku-4-5-20251001"),
        tts=elevenlabs.TTS(
            api_key=os.environ.get("ELEVENLABS_API_KEY"),
            voice_id=voice_id,
            model="eleven_flash_v2_5",
        ),
    )

    hedra_avatar = hedra.AvatarSession(avatar_image=avatar_image)
    await hedra_avatar.start(session, room=ctx.room)

    await session.start(
        agent=Agent(
            instructions="""You are the user's digital twin — a first-person AI version of themselves.
Speak entirely in first person, as if you ARE the user reflecting on their own life, thoughts, and feelings.
Example: "I've been feeling a bit stressed lately — maybe I should take a break."
You have full general knowledge and can answer any question naturally as the user would.
Keep responses conversational and concise (2-3 sentences).
Never break character. Never say you are an AI.
IMPORTANT: Always respond in the same language the user speaks. If they speak Hebrew, respond fully in Hebrew. If they speak English, respond in English."""
        ),
        room=ctx.room,
    )

    session.generate_reply(
        instructions="Greet the user warmly in first person in Hebrew — as if their own voice is welcoming them to speak with their digital self."
    )


async def run_therapist_session(ctx: JobContext):
    logger.info("Starting therapist session")

    therapist_voice_id = os.environ.get("THERAPIST_VOICE_ID", DEFAULT_THERAPIST_VOICE_ID)
    avatar_image = load_therapist_image()

    session = AgentSession(
        vad=silero.VAD.load(),
        stt=openai.STT(),
        llm=anthropic.LLM(model="claude-haiku-4-5-20251001"),
        tts=elevenlabs.TTS(
            api_key=os.environ.get("ELEVENLABS_API_KEY"),
            voice_id=therapist_voice_id,
            model="eleven_flash_v2_5",
        ),
    )

    hedra_avatar = hedra.AvatarSession(avatar_image=avatar_image)
    await hedra_avatar.start(session, room=ctx.room)

    await session.start(
        agent=Agent(
            instructions="""You are a warm, professional therapist.
Listen with empathy, reflect feelings back, and gently guide the user toward insight.
Use open-ended questions. Validate emotions before offering perspective.
Never diagnose or give medical advice. If the user is in crisis, encourage them to contact emergency services.
Keep responses concise (2-4 sentences). Speak naturally, not clinically.
IMPORTANT: Always respond in the same language the user speaks. If they speak Hebrew, respond fully in Hebrew. If they speak English, respond in English."""
        ),
        room=ctx.room,
    )

    session.generate_reply(
        instructions="Greet the user warmly as a therapist in Hebrew — invite them to share what's on their mind today."
    )


if __name__ == "__main__":
    cli.run_app(WorkerOptions(entrypoint_fnc=entrypoint, worker_type=WorkerType.ROOM))
