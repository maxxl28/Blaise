import { streamTTS } from './tts';

interface DgSocket {
  on(event: 'message', cb: (data: unknown) => void): void;
  on(event: 'error', cb: (err: Error) => void): void;
  connect(): unknown;
  waitForOpen(): Promise<unknown>;
  sendMedia(data: ArrayBuffer | ArrayBufferView | Blob): void;
  close(): void;
}

export type Session = {
  send(data: ArrayBuffer | ArrayBufferView): void;
  close(): void;
};

type Word = { word: string; punctuated_word?: string; speaker?: number };
export type SpeakerSegment = { speaker: number | null; text: string };

export type InterjectionChecker = (
  fullTranscript: string,
  newSegments: SpeakerSegment[],
) => AsyncIterable<string>;

export function speakerSegments(words: Word[]): SpeakerSegment[] {
  const segments: SpeakerSegment[] = [];
  for (const w of words) {
    const speaker = w.speaker ?? 0;
    const token = w.punctuated_word ?? w.word;
    const last = segments[segments.length - 1];
    if (last && last.speaker === speaker) {
      last.text += ' ' + token;
    } else {
      segments.push({ speaker, text: token });
    }
  }
  return segments;
}

export function formatSegments(segments: SpeakerSegment[]): string {
  return segments
    .map(s => s.speaker !== null ? `Speaker ${s.speaker}: ${s.text}` : `Blaise: ${s.text}`)
    .join('\n');
}

export async function openSession(
  ws: { send(msg: string | Buffer): void },
  createSocket: () => Promise<DgSocket>,
  checkInterjection: InterjectionChecker,
  timeoutMs = 5000,
): Promise<Session> {
  const socket = await createSocket();

  let fullTranscript = '';
  let pendingSegments: SpeakerSegment[] = [];
  let isSpeaking = false;
  let abortController: AbortController | null = null;

  socket.on('message', (data: unknown) => {
    const msg = data as {
      type: string;
      channel?: { alternatives?: { transcript: string; words?: Word[] }[] };
      is_final?: boolean;
    };

    if (msg.type === 'SpeechStarted') {
      if (isSpeaking) {
        abortController?.abort();
      }
      return;
    }

    if (msg.type === 'UtteranceEnd') {
      console.log('[utterance] silence detected');
      if (isSpeaking || pendingSegments.length === 0) return;
      isSpeaking = true;
      abortController = new AbortController();
      const { signal } = abortController;
      const batch = pendingSegments.splice(0);
      console.log('[claude] thinking on:', formatSegments(batch));
      ws.send(JSON.stringify({ type: 'blaise_thinking' }));
      (async () => {
        const spoken: string[] = [];
        try {
          for await (const sentence of checkInterjection(fullTranscript, batch)) {
            if (signal.aborted) break;
            ws.send(JSON.stringify({ type: 'blaise_text', text: sentence }));
            for await (const chunk of streamTTS(sentence, signal)) {
              ws.send(chunk);
            }
            spoken.push(sentence);
          }
        } catch (err) {
          if (signal.aborted) {
            console.log('[claude] interrupted');
          } else {
            const message = (err as Error).message;
            console.error('[claude] error:', message);
            ws.send(JSON.stringify({ type: 'error', message }));
          }
        } finally {
          ws.send(JSON.stringify({ type: 'interjection_end', spoke: spoken.length > 0 }));
          console.log(spoken.length > 0 ? `[claude] spoke: ${spoken.join(' ')}` : '[claude] stayed silent');
          const parts = [fullTranscript, formatSegments(batch)];
          if (spoken.length > 0) parts.push(`Blaise: ${spoken.join(' ')}`);
          fullTranscript = parts.filter(Boolean).join('\n');
          isSpeaking = false;
          abortController = null;
        }
      })();
      return;
    }

    if (msg.type !== 'Results') return;
    const alt = msg.channel?.alternatives?.[0];
    if (!alt) return;

    if (!msg.is_final) {
      if (!alt.transcript) return;
      ws.send(JSON.stringify({ type: 'transcript', speaker: null, text: alt.transcript, isFinal: false }));
      return;
    }

    const segs = speakerSegments(alt.words ?? []);
    if (segs.length === 0) return;
    for (const seg of segs) {
      pendingSegments.push(seg);
      ws.send(JSON.stringify({ type: 'transcript', speaker: seg.speaker, text: seg.text, isFinal: true }));
    }
  });

  socket.on('error', (err) => console.error('[deepgram] error:', err.message));

  socket.connect();

  await Promise.race([
    socket.waitForOpen(),
    new Promise<never>((_, reject) =>
      setTimeout(() => reject(new Error('Deepgram connection timeout')), timeoutMs)
    ),
  ]);

  return {
    // Mute the mic→Deepgram pipe while Blaise is speaking so he doesn't transcribe
    // his own voice or get interrupted by the speaker's trailing audio / room noise.
    send(data) { if (!isSpeaking) socket.sendMedia(data); },
    close() { socket.close(); },
  };
}
