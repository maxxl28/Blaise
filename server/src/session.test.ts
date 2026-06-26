import { describe, it, expect } from 'bun:test';
import { openSession, speakerSegments, formatSegments } from './session';
import type { SpeakerSegment } from './session';

async function* noop() {}

function makeMockSocket({ neverOpen = false } = {}) {
  let onMessage: ((data: unknown) => void) | undefined;
  let onError: ((err: Error) => void) | undefined;
  const sent: (ArrayBuffer | ArrayBufferView)[] = [];
  let closed = false;

  const socket = {
    on(event: string, cb: (arg?: any) => void) {
      if (event === 'message') onMessage = cb;
      if (event === 'error') onError = cb;
    },
    connect() { return this; },
    waitForOpen: () => neverOpen ? new Promise(() => {}) : Promise.resolve({}),
    sendMedia(data: ArrayBuffer | ArrayBufferView) { sent.push(data); },
    close() { closed = true; },
  };

  return {
    socket,
    emitMessage(data: unknown) { onMessage?.(data); },
    emitError(err: Error) { onError?.(err); },
    get sent() { return sent; },
    get closed() { return closed; },
  };
}

const noopWs = { send: () => {} };
const makeWs = () => { const msgs: string[] = []; return { ws: { send: (m: string) => msgs.push(m) }, msgs }; };

function finalResult(words: { word: string; speaker: number }[]) {
  return { type: 'Results', channel: { alternatives: [{ transcript: words.map(w => w.word).join(' '), words }] }, is_final: true };
}

// --- formatSegments ---

describe('formatSegments', () => {
  it('formats speaker segments', () => {
    const segs: SpeakerSegment[] = [{ speaker: 0, text: 'hello' }, { speaker: 1, text: 'hi' }];
    expect(formatSegments(segs)).toBe('Speaker 0: hello\nSpeaker 1: hi');
  });

  it('formats Blaise segments (speaker null)', () => {
    const segs: SpeakerSegment[] = [{ speaker: null, text: 'interesting point' }];
    expect(formatSegments(segs)).toBe('Blaise: interesting point');
  });
});

// --- speakerSegments ---

describe('speakerSegments', () => {
  it('returns empty array for no words', () => {
    expect(speakerSegments([])).toEqual([]);
  });

  it('groups single speaker into one segment', () => {
    const words = [{ word: 'hello', speaker: 0 }, { word: 'world', speaker: 0 }];
    expect(speakerSegments(words)).toEqual([{ speaker: 0, text: 'hello world' }]);
  });

  it('splits on speaker change', () => {
    const words = [{ word: 'hey', speaker: 0 }, { word: 'hi', speaker: 1 }, { word: 'there', speaker: 1 }];
    expect(speakerSegments(words)).toEqual([
      { speaker: 0, text: 'hey' },
      { speaker: 1, text: 'hi there' },
    ]);
  });

  it('defaults to speaker 0 when speaker field is undefined', () => {
    expect(speakerSegments([{ word: 'test' }])).toEqual([{ speaker: 0, text: 'test' }]);
  });

  it('prefers punctuated_word over word', () => {
    const words = [
      { word: 'hello', punctuated_word: 'Hello,', speaker: 0 },
      { word: 'world', punctuated_word: 'world.', speaker: 0 },
    ];
    expect(speakerSegments(words)).toEqual([{ speaker: 0, text: 'Hello, world.' }]);
  });
});

// --- openSession ---

describe('openSession', () => {
  it('resolves when socket opens', async () => {
    const m = makeMockSocket();
    const session = await openSession(noopWs, () => Promise.resolve(m.socket as any), noop);
    expect(session).toBeDefined();
  });

  it('rejects on timeout', async () => {
    const m = makeMockSocket({ neverOpen: true });
    await expect(
      openSession(noopWs, () => Promise.resolve(m.socket as any), noop, 20)
    ).rejects.toThrow('timeout');
  });

  it('rejects if createSocket throws', async () => {
    await expect(
      openSession(noopWs, () => Promise.reject(new Error('auth failed')), noop)
    ).rejects.toThrow('auth failed');
  });

  it('forwards audio to Deepgram after open', async () => {
    const m = makeMockSocket();
    const session = await openSession(noopWs, () => Promise.resolve(m.socket as any), noop);
    session.send(new Uint8Array([1, 2, 3]).buffer);
    expect(m.sent).toHaveLength(1);
  });

  it('sends final transcript with speaker to browser', async () => {
    const m = makeMockSocket();
    const { ws, msgs } = makeWs();
    await openSession(ws, () => Promise.resolve(m.socket as any), noop);

    m.emitMessage(finalResult([
      { word: 'hello', speaker: 0 },
      { word: 'world', speaker: 0 },
    ]));

    expect(msgs).toHaveLength(1);
    expect(JSON.parse(msgs[0])).toEqual({ type: 'transcript', speaker: 0, text: 'hello world', isFinal: true });
  });

  it('splits a final result across two speakers into two messages', async () => {
    const m = makeMockSocket();
    const { ws, msgs } = makeWs();
    await openSession(ws, () => Promise.resolve(m.socket as any), noop);

    m.emitMessage(finalResult([
      { word: 'hey', speaker: 0 },
      { word: 'hi', speaker: 1 },
      { word: 'there', speaker: 1 },
    ]));

    expect(msgs).toHaveLength(2);
    expect(JSON.parse(msgs[0])).toEqual({ type: 'transcript', speaker: 0, text: 'hey', isFinal: true });
    expect(JSON.parse(msgs[1])).toEqual({ type: 'transcript', speaker: 1, text: 'hi there', isFinal: true });
  });

  it('sends interim transcript with null speaker to browser', async () => {
    const m = makeMockSocket();
    const { ws, msgs } = makeWs();
    await openSession(ws, () => Promise.resolve(m.socket as any), noop);

    m.emitMessage({ type: 'Results', channel: { alternatives: [{ transcript: 'hel', words: [] }] }, is_final: false });

    expect(JSON.parse(msgs[0])).toMatchObject({ speaker: null, isFinal: false, text: 'hel' });
  });

  it('ignores non-Results message types', async () => {
    const m = makeMockSocket();
    const { ws, msgs } = makeWs();
    await openSession(ws, () => Promise.resolve(m.socket as any), noop);

    m.emitMessage({ type: 'Metadata' });
    m.emitMessage({ type: 'SpeechStarted' });

    expect(msgs).toHaveLength(0);
  });

  it('ignores final results with no words', async () => {
    const m = makeMockSocket();
    const { ws, msgs } = makeWs();
    await openSession(ws, () => Promise.resolve(m.socket as any), noop);

    m.emitMessage({ type: 'Results', channel: { alternatives: [{ transcript: '', words: [] }] }, is_final: true });

    expect(msgs).toHaveLength(0);
  });

  it('ignores empty interim transcripts', async () => {
    const m = makeMockSocket();
    const { ws, msgs } = makeWs();
    await openSession(ws, () => Promise.resolve(m.socket as any), noop);

    m.emitMessage({ type: 'Results', channel: { alternatives: [{ transcript: '', words: [] }] }, is_final: false });

    expect(msgs).toHaveLength(0);
  });

  it('closes the Deepgram socket on session.close()', async () => {
    const m = makeMockSocket();
    const session = await openSession(noopWs, () => Promise.resolve(m.socket as any), noop);
    session.close();
    expect(m.closed).toBe(true);
  });

  it('calls checkInterjection with pending segments on UtteranceEnd', async () => {
    const m = makeMockSocket();
    const calls: { transcript: string; segments: SpeakerSegment[] }[] = [];
    async function* checker(t: string, s: SpeakerSegment[]) { calls.push({ transcript: t, segments: s }); }

    await openSession(noopWs, () => Promise.resolve(m.socket as any), checker);

    m.emitMessage(finalResult([{ word: 'hello', speaker: 0 }]));
    m.emitMessage({ type: 'UtteranceEnd' });

    await Bun.sleep(10);

    expect(calls).toHaveLength(1);
    expect(calls[0].transcript).toBe('');
    expect(calls[0].segments).toEqual([{ speaker: 0, text: 'hello' }]);
  });

  it('skips UtteranceEnd when no pending segments', async () => {
    const m = makeMockSocket();
    const calls: unknown[] = [];
    async function* checker() { calls.push(1); }

    await openSession(noopWs, () => Promise.resolve(m.socket as any), checker);
    m.emitMessage({ type: 'UtteranceEnd' });

    await Bun.sleep(10);
    expect(calls).toHaveLength(0);
  });

  it('blocks second UtteranceEnd while first is processing (speaking gate)', async () => {
    const m = makeMockSocket();
    let resume!: () => void;
    const calls: number[] = [];
    async function* checker() {
      calls.push(1);
      await new Promise<void>(r => { resume = r; });
    }

    await openSession(noopWs, () => Promise.resolve(m.socket as any), checker);

    m.emitMessage(finalResult([{ word: 'hello', speaker: 0 }]));
    m.emitMessage({ type: 'UtteranceEnd' });
    m.emitMessage(finalResult([{ word: 'world', speaker: 0 }]));
    m.emitMessage({ type: 'UtteranceEnd' }); // should be blocked

    await Bun.sleep(10);
    expect(calls).toHaveLength(1); // only one call fired

    resume();
    await Bun.sleep(10);
    expect(calls).toHaveLength(1); // second UtteranceEnd was dropped, not queued
  });

  it('accumulates fullTranscript across multiple checks', async () => {
    const m = makeMockSocket();
    const calls: string[] = [];
    async function* checker(transcript: string) { calls.push(transcript); }

    await openSession(noopWs, () => Promise.resolve(m.socket as any), checker);

    m.emitMessage(finalResult([{ word: 'hello', speaker: 0 }]));
    m.emitMessage({ type: 'UtteranceEnd' });
    await Bun.sleep(10);

    m.emitMessage(finalResult([{ word: 'world', speaker: 1 }]));
    m.emitMessage({ type: 'UtteranceEnd' });
    await Bun.sleep(10);

    expect(calls[0]).toBe('');
    expect(calls[1]).toBe('Speaker 0: hello');
  });

  it('handles UtteranceEnd without sending a browser message', async () => {
    const m = makeMockSocket();
    const { ws, msgs } = makeWs();
    await openSession(ws, () => Promise.resolve(m.socket as any), noop);

    m.emitMessage({ type: 'UtteranceEnd' });

    expect(msgs).toHaveLength(0);
  });
});
