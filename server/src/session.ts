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
export type SpeakerSegment = { speaker: number; text: string };

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

export async function openSession(
  ws: { send(msg: string): void },
  createSocket: () => Promise<DgSocket>,
  timeoutMs = 5000,
): Promise<Session> {
  const socket = await createSocket();

  socket.on('message', (data: unknown) => {
    const msg = data as {
      type: string;
      channel?: { alternatives?: { transcript: string; words?: Word[] }[] };
      is_final?: boolean;
    };

    if (msg.type === 'UtteranceEnd') {
      console.log('[utterance] silence detected');
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

    // Final: group words by speaker to handle mid-utterance speaker switches
    const segs = speakerSegments(alt.words ?? []);
    if (segs.length === 0) return;
    for (const seg of segs) {
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
    send(data) { socket.sendMedia(data); },
    close() { socket.close(); },
  };
}
