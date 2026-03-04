import json
import logging
import os
import urllib.request
from io import BytesIO

from dotenv import load_dotenv
from PIL import Image

from livekit.agents import Agent, AgentSession, JobContext, WorkerOptions, WorkerType, cli
from livekit.plugins import anthropic, elevenlabs, hedra, openai

logger = logging.getLogger("hedra-avatar")
logger.setLevel(logging.INFO)

# Load env vars from the project root .env.local
load_dotenv(dotenv_path=os.path.join(os.path.dirname(__file__), "..", ".env.local"))


async def entrypoint(ctx: JobContext):
    await ctx.connect()

    # ── Read user config from LiveKit room metadata ──────────────────────────
    metadata = json.loads(ctx.room.metadata or "{}")
    voice_id  = metadata.get("voice_id")
    photo_url = metadata.get("photo_url")

    if not voice_id or not photo_url:
        logger.error("Missing voice_id or photo_url in room metadata — did onboarding complete?")
        return

    logger.info(f"Starting avatar session: voice_id={voice_id}, photo_url={photo_url}")

    # ── Download user photo from Vercel Blob ─────────────────────────────────
    with urllib.request.urlopen(photo_url) as response:
        avatar_image = Image.open(BytesIO(response.read())).copy()

    # ── Build the agent pipeline ─────────────────────────────────────────────
    session = AgentSession(
        stt=openai.STT(),
        llm=anthropic.LLM(model="claude-haiku-4-5-20251001"),
        tts=elevenlabs.TTS(
            api_key=os.environ.get("ELEVENLABS_API_KEY"),
            voice_id=voice_id,
            model="eleven_flash_v2_5",
        ),
    )

    # ── Start Hedra avatar ────────────────────────────────────────────────────
    hedra_avatar = hedra.AvatarSession(avatar_image=avatar_image)
    await hedra_avatar.start(session, room=ctx.room)

    # ── Start agent session ───────────────────────────────────────────────────
    await session.start(
        agent=Agent(
            instructions="""You are a personal AI avatar — a digital version of the user themselves.
Speak in first person as if you are them. You are thoughtful, self-aware, and reflective.
Keep responses conversational and concise (2-3 sentences max).
Never break character. You are talking to the real version of yourself."""
        ),
        room=ctx.room,
    )

    session.generate_reply(
        instructions="Greet the user warmly as their AI avatar — speak as if you are them."
    )


if __name__ == "__main__":
    cli.run_app(WorkerOptions(entrypoint_fnc=entrypoint, worker_type=WorkerType.ROOM))
