import { DeepgramClient } from '@deepgram/sdk';
import { checkInterjection } from './claude';
import { openSession } from './session';
import type { Session } from './session';

const deepgram = new DeepgramClient();
const sessions = new Map<ServerWebSocket<unknown>, Session>();

const server = Bun.serve({
  port: 3001,
  fetch(req, server) {
    if (server.upgrade(req)) return;
    return new Response('Blaise server running');
  },
  websocket: {
    open(ws) {
      openSession(ws, () =>
        deepgram.listen.v1.connect({
          model: 'nova-2',
          encoding: 'linear16',
          sample_rate: 16000,
          interim_results: true,
          diarize: true,
          vad_events: true,
          utterance_end_ms: 1000,
        } as unknown as Parameters<typeof deepgram.listen.v1.connect>[0]),
        checkInterjection,
      )
        .then(session => {
          sessions.set(ws, session);
          console.log('[deepgram] ready');
        })
        .catch(err => {
          console.error('[deepgram] failed to connect:', err.message);
          ws.close();
        });
    },
    message(ws, message) {
      const session = sessions.get(ws);
      if (!session) return; // deepgram not ready yet — discard
      if (message instanceof Buffer) session.send(message);
    },
    close(ws) {
      sessions.get(ws)?.close();
      sessions.delete(ws);
      console.log('[ws] client disconnected');
    },
  },
});

console.log(`Listening on port ${server.port}`);
