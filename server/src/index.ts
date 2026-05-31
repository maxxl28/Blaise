const server = Bun.serve({
  port: 3001,
  fetch(req, server) {
    if (server.upgrade(req)) return;
    return new Response('Blaise server running');
  },
  websocket: {
    open(ws) {
      console.log('[ws] client connected');
    },
    message(ws, message) {
      const bytes = message instanceof Buffer
        ? message.byteLength
        : typeof message === 'string'
        ? message.length
        : 0;
      console.log(`[pcm] ${bytes} bytes`);
    },
    close(ws) {
      console.log('[ws] client disconnected');
    },
  },
});

console.log(`Server listening on port ${server.port}`);
