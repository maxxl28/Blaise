# Blaise

## What this is
Real-time voice app where two people in the same room talk and an AI (Blaise) 
interjects naturally as a third participant. Users can log in, start 
conversations, and receive notes/summary when the conversation ends.

## Stack
- Frontend: React + Vite + Tailwind
- Backend: Bun + WebSockets
- STT: Deepgram Nova-2 (streaming, silence detection via is_final)
- AI: claude-haiku-3-5-20251001 (interjection logic)
- TTS: OpenAI TTS-1

## Architecture
- server/src/index.ts   — Bun server entry point, health route
- server/src/ws.ts      — WebSocket handler, orchestrates pipeline
- server/src/session.ts — Deepgram bridge (audio in, transcripts out)
- server/src/ai.ts      — Claude interjection logic
- server/src/tts.ts     — OpenAI TTS streaming
- server/src/db/        — Postgres connection + queries
- client/src/hooks/     — useAudio, useWebSocket
- client/src/worklets/  — AudioWorklet PCM processor
- shared/types.ts       — shared message types

## Pipeline
ALWAYS RUNNING
Browser → [WebSocket] → Bun → [WebSocket] → Deepgram
↑
transcript events flowing back
is_final:false → ignore
is_final:true  → append to buffer
|
SILENCE DETECTED
↓
Bun → [HTTP] → Claude (streaming)
↓
Bun → [HTTP] → OpenAI TTS (streaming)
↓
Bun → [WebSocket] → Browser → speakers
|
done speaking
↓
back to passively piping audio

## Key constraints
- Latency is critical in the STT → Claude → TTS chain
- Same room conversation — one shared mic, no WebRTC needed
- Mute Deepgram pipe while TTS is playing to prevent Blaise 
  transcribing its own voice

## Commands
- `bun run dev` — starts backend (run from /server)
- `bun run dev` — starts frontend (run from /client)

## Git protocol
- All new features on a branch: `git checkout -b feature/<name>`
- Merge to main only when feature is working end to end
- Commit format: `git add -A && git commit -m "<what works>"`
- Never commit directly to main

## Current focus
Get TTS working so Claude's response is spoken back through the browser. 