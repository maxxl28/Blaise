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

export async function openSession(
  ws: { send(msg: string): void },
  createSocket: () => Promise<DgSocket>,
  timeoutMs = 5000,
): Promise<Session> {
  const socket = await createSocket();

  socket.on('message', (data: unknown) => {
    const msg = data as { type: string; channel?: { alternatives?: { transcript: string }[] }; is_final?: boolean };
    if (msg.type !== 'Results') return;
    const text = msg.channel?.alternatives?.[0]?.transcript ?? '';
    if (!text) return;
    ws.send(JSON.stringify({ type: 'transcript', text, isFinal: msg.is_final ?? false }));
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