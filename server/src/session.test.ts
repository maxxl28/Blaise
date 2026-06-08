import { describe, it, expect } from 'bun:test';
import { openSession } from './session';

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

  it('sends final transcript to browser', async () => {
    const m = makeMockSocket();
    const { ws, msgs } = makeWs();
    await openSession(ws, () => Promise.resolve(m.socket as any));

    m.emitMessage({ type: 'Results', channel: { alternatives: [{ transcript: 'hello world' }] }, is_final: true });

    expect(msgs).toHaveLength(1);
    expect(JSON.parse(msgs[0])).toEqual({ type: 'transcript', text: 'hello world', isFinal: true });
  });

  it('sends interim transcript to browser', async () => {
    const m = makeMockSocket();
    const { ws, msgs } = makeWs();
    await openSession(ws, () => Promise.resolve(m.socket as any));

    m.emitMessage({ type: 'Results', channel: { alternatives: [{ transcript: 'hel' }] }, is_final: false });

    expect(JSON.parse(msgs[0])).toMatchObject({ isFinal: false, text: 'hel' });
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

  it('ignores empty transcript strings', async () => {
    const m = makeMockSocket();
    const { ws, msgs } = makeWs();
    await openSession(ws, () => Promise.resolve(m.socket as any));

    m.emitMessage({ type: 'Results', channel: { alternatives: [{ transcript: '' }] }, is_final: true });

    expect(msgs).toHaveLength(0);
  });

  it('closes the Deepgram socket on session.close()', async () => {
    const m = makeMockSocket();
    const session = await openSession(noopWs, () => Promise.resolve(m.socket as any));
    session.close();
    expect(m.closed).toBe(true);
  });
});
