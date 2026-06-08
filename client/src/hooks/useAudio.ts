import { useRef, useState, useCallback } from 'react';
import processorUrl from '../worklets/pcm-processor.js?url';

const WS_URL = 'ws://localhost:3001';

export function useAudio() {
  const [isRecording, setIsRecording] = useState(false);
  const [status, setStatus] = useState('idle');

  const ctxRef = useRef<AudioContext | null>(null);
  const wsRef = useRef<WebSocket | null>(null);
  const streamRef = useRef<MediaStream | null>(null);

  const start = useCallback(async () => {
    setStatus('connecting...');

    const ws = new WebSocket(WS_URL);
    wsRef.current = ws;

    await new Promise<void>((resolve, reject) => {
      ws.onopen = () => resolve();
      ws.onerror = () => reject(new Error('WebSocket failed'));
    });

    setStatus('requesting mic...');
    const stream = await navigator.mediaDevices.getUserMedia({ audio: true, video: false });
    streamRef.current = stream;

    const ctx = new AudioContext({ sampleRate: 16000 });
    ctxRef.current = ctx;

    await ctx.audioWorklet.addModule(processorUrl);

    const source = ctx.createMediaStreamSource(stream);
    const worklet = new AudioWorkletNode(ctx, 'pcm-processor');

    // Silent sink — keeps the graph alive without mic feedback
    const sink = ctx.createGain();
    sink.gain.value = 0;
    worklet.connect(sink);
    sink.connect(ctx.destination);

    worklet.port.onmessage = (e: MessageEvent<Float32Array>) => {
      if (ws.readyState !== WebSocket.OPEN) return;
      const f32 = e.data;
      const i16 = new Int16Array(f32.length);
      for (let i = 0; i < f32.length; i++) {
        i16[i] = Math.max(-32768, Math.min(32767, f32[i] * 32768));
      }
      ws.send(i16.buffer);
    };

    source.connect(worklet);

    setIsRecording(true);
    setStatus(`recording @ ${ctx.sampleRate} Hz`);
  }, []);

  const stop = useCallback(() => {
    streamRef.current?.getTracks().forEach(t => t.stop());
    ctxRef.current?.close();
    wsRef.current?.close();
    streamRef.current = null;
    ctxRef.current = null;
    wsRef.current = null;
    setIsRecording(false);
    setStatus('idle');
  }, []);

  return { isRecording, status, start, stop };
}
