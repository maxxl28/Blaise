import { describe, it, expect } from 'bun:test';
import { openSession, speakerSegments } from './session';

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

// --- speakerSegments unit tests ---

describe('speakerSegments', () => {
  it('returns empty array for no words', () => {
    expect(speakerSegments([])).toEqual([]);
  });

  it('groups single speaker into one segment', () => {
    const words = [
      { word: 'hello', speaker: 0 },
      { word: 'world', speaker: 0 },
    ];
    expect(speakerSegments(words)).toEqual([{ speaker: 0, text: 'hello world' }]);
  });

  it('splits on speaker change', () => {
    const words = [
      { word: 'hey', speaker: 0 },
      { word: 'hi', speaker: 1 },
      { word: 'there', speaker: 1 },
    ];
    expect(speakerSegments(words)).toEqual([
      { speaker: 0, text: 'hey' },
      { speaker: 1, text: 'hi there' },
    ]);
  });

  it('defaults to speaker 0 when speaker field is undefined', () => {
    const words = [{ word: 'test' }];
    expect(speakerSegments(words)).toEqual([{ speaker: 0, text: 'test' }]);
  });

  it('prefers punctuated_word over word', () => {
    const words = [
      { word: 'hello', punctuated_word: 'Hello,', speaker: 0 },
      { word: 'world', punctuated_word: 'world.', speaker: 0 },
    ];
    expect(speakerSegments(words)).toEqual([{ speaker: 0, text: 'Hello, world.' }]);
  });
});

// --- openSession integration tests ---

describe('openSession', () => {
  it('resolves when socket opens', async () => {
    const m = makeMockSocket();
    const session = await openSession(noopWs, () => Promise.resolve(m.socket as any));
    expect(session).toBeDefined();
  });

  it('rejects on timeout', async () => {
    const m = makeMockSocket({ neverOpen: true });
    await expect(
      openSession(noopWs, () => Promise.resolve(m.socket as any), 20)
    ).rejects.toThrow('timeout');
  });

  it('rejects if createSocket throws', async () => {
    await expect(
      openSession(noopWs, () => Promise.reject(new Error('auth failed')))
    ).rejects.toThrow('auth failed');
  });

  it('forwards audio to Deepgram after open', async () => {
    const m = makeMockSocket();
    const session = await openSession(noopWs, () => Promise.resolve(m.socket as any));
    session.send(new Uint8Array([1, 2, 3]).buffer);
    expect(m.sent).toHaveLength(1);
  });

  it('sends final transcript with speaker to browser', async () => {
    const m = makeMockSocket();
    const { ws, msgs } = makeWs();
    await openSession(ws, () => Promise.resolve(m.socket as any));

    m.emitMessage({
      type: 'Results',
      channel: { alternatives: [{ transcript: 'hello world', words: [
        { word: 'hello', punctuated_word: 'hello', speaker: 0 },
        { word: 'world', punctuated_word: 'world', speaker: 0 },
      ]}] },
      is_final: true,
    });

    expect(msgs).toHaveLength(1);
    expect(JSON.parse(msgs[0])).toEqual({ type: 'transcript', speaker: 0, text: 'hello world', isFinal: true });
  });

  it('splits a final result across two speakers into two messages', async () => {
    const m = makeMockSocket();
    const { ws, msgs } = makeWs();
    await openSession(ws, () => Promise.resolve(m.socket as any));

    m.emitMessage({
      type: 'Results',
      channel: { alternatives: [{ transcript: 'hey hi there', words: [
        { word: 'hey', speaker: 0 },
        { word: 'hi', speaker: 1 },
        { word: 'there', speaker: 1 },
      ]}] },
      is_final: true,
    });

    expect(msgs).toHaveLength(2);
    expect(JSON.parse(msgs[0])).toEqual({ type: 'transcript', speaker: 0, text: 'hey', isFinal: true });
    expect(JSON.parse(msgs[1])).toEqual({ type: 'transcript', speaker: 1, text: 'hi there', isFinal: true });
  });

  it('sends interim transcript with null speaker to browser', async () => {
    const m = makeMockSocket();
    const { ws, msgs } = makeWs();
    await openSession(ws, () => Promise.resolve(m.socket as any));

    m.emitMessage({ type: 'Results', channel: { alternatives: [{ transcript: 'hel', words: [] }] }, is_final: false });

    expect(JSON.parse(msgs[0])).toMatchObject({ speaker: null, isFinal: false, text: 'hel' });
  });

  it('ignores non-Results message types', async () => {
    const m = makeMockSocket();
    const { ws, msgs } = makeWs();
    await openSession(ws, () => Promise.resolve(m.socket as any));

    m.emitMessage({ type: 'Metadata' });
    m.emitMessage({ type: 'UtteranceEnd' });
    m.emitMessage({ type: 'SpeechStarted' });

    expect(msgs).toHaveLength(0);
  });

  it('ignores final results with no words', async () => {
    const m = makeMockSocket();
    const { ws, msgs } = makeWs();
    await openSession(ws, () => Promise.resolve(m.socket as any));

    m.emitMessage({ type: 'Results', channel: { alternatives: [{ transcript: '', words: [] }] }, is_final: true });

    expect(msgs).toHaveLength(0);
  });

  it('ignores empty interim transcripts', async () => {
    const m = makeMockSocket();
    const { ws, msgs } = makeWs();
    await openSession(ws, () => Promise.resolve(m.socket as any));

    m.emitMessage({ type: 'Results', channel: { alternatives: [{ transcript: '', words: [] }] }, is_final: false });

    expect(msgs).toHaveLength(0);
  });

  it('closes the Deepgram socket on session.close()', async () => {
    const m = makeMockSocket();
    const session = await openSession(noopWs, () => Promise.resolve(m.socket as any));
    session.close();
    expect(m.closed).toBe(true);
  });
});
