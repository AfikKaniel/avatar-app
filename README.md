# Avatar App

Talk to an AI avatar that looks and sounds like you — powered by **HeyGen**, **ElevenLabs**, and **Claude**.

---

## What You Need to Do (Step by Step)

### Step 1 — Install Node.js
Go to https://nodejs.org and download the **LTS** version. Install it like any Mac app.

Verify it worked by opening Terminal and running:
```bash
node --version   # should print v20 or higher
npm --version
```

---

### Step 2 — Install GitHub CLI
Go to https://cli.github.com and download it, OR run:
```bash
brew install gh
```

Then log in:
```bash
gh auth login
```
Follow the prompts (choose GitHub.com → HTTPS → Login with browser).

---

### Step 3 — Get Your API Keys

#### HeyGen
1. Go to https://app.heygen.com/settings → **API** tab
2. Copy your API key

#### ElevenLabs
1. Go to https://elevenlabs.io/app/settings/api-keys
2. Create a new key and copy it
3. **Important:** Also go to **Settings → Integrations** in HeyGen and connect your ElevenLabs key there — this allows HeyGen to use your cloned voice in the streaming avatar

#### Anthropic (Claude)
1. Go to https://console.anthropic.com/settings/keys
2. Create a new key and copy it

---

### Step 4 — Add Your API Keys to the Project

In the `avatar-app` folder, copy the example env file:
```bash
cp .env.local.example .env.local
```

Open `.env.local` and fill in your three keys:
```
HEYGEN_API_KEY=your_key_here
ELEVENLABS_API_KEY=your_key_here
ANTHROPIC_API_KEY=your_key_here
```

---

### Step 5 — Install Dependencies and Run

```bash
cd ~/Documents/avatar-app
npm install
npm run dev
```

Open your browser at **http://localhost:3000**

---

### Step 6 — Push to GitHub

```bash
cd ~/Documents/avatar-app
gh repo create avatar-app --public --source=. --remote=origin --push
```

---

## How the App Works

```
ONBOARDING (once):
  📸 Take photo  →  HeyGen creates your avatar face
  🎙️ Record voice (60+ sec)  →  ElevenLabs clones your voice

CHAT (ongoing):
  You speak/type  →  Claude generates a reply  →
  HeyGen streams your avatar speaking in your cloned voice
```

## Project Structure

```
avatar-app/
├── app/
│   ├── page.tsx                    ← Home / landing page
│   ├── onboarding/page.tsx         ← Photo + voice capture
│   ├── chat/page.tsx               ← Live avatar conversation
│   └── api/
│       ├── heygen/token/route.ts   ← Gets HeyGen session token
│       ├── heygen/avatar/route.ts  ← Creates photo avatar
│       ├── heygen/train/route.ts   ← Trains the avatar model
│       ├── elevenlabs/clone/route.ts  ← Clones voice
│       └── chat/route.ts           ← Claude LLM replies
├── components/
│   ├── PhotoCapture.tsx            ← Webcam photo component
│   └── VoiceRecorder.tsx           ← Microphone recorder
└── .env.local                      ← Your API keys (never commit this!)
```
