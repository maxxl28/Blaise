# Blaise

## What this is
Real-time 2-person voice chat where an AI interjects naturally as a third participant. Should be a website where users can log in, add conversations, and have their notes recorded

## Stack
- Frontend: React + Vite + Tailwind
- Backend: Bun + WebSockets
- STT: Deepgram Nova-2 (streaming, silence detection via is_final)
- AI: Claude Haiku 3.5 (interjection logic)
- TTS: OpenAI TTS-1

## Flow
1. User logs in and starts a conversation. 
2. As the user and others are talking, STT  (note that this is same room conversation)
3. Claude interjects when necessary with OpenAI TTS-1
4. After the conversation is done, the user gets notes on the conversation

## Key constraint
Latency is critical. Every added ms matters in the STT → Claude → TTS chain.

## Commands
- `bun run dev` — starts backend
- `bun run client` — starts frontend
- `bun test` — runs tests

