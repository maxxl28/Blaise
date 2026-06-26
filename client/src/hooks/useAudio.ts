import { useRef, useState, useCallback } from 'react';
import processorUrl from '../worklets/pcm-processor.js?url';

const WS_URL = 'ws://localhost:3001';
const TTS_SAMPLE_RATE = 24000;

export type TranscriptLine = { speaker: number | null; text: string };
export type BlaiseStatus = 'idle' | 'thinking' | 'speaking' | 'silent';

export function useAudio() {
  const [isRecording, setIsRecording] = useState(false);
  const [status, setStatus] = useState('idle');
  const [transcript, setTranscript] = useState<TranscriptLine[]>([]);
  const [interim, setInterim] = useState('');
  const [replies, setReplies] = useState<string[]>([]);
  const [blaiseStatus, setBlaiseStatus] = useState<BlaiseStatus>('idle');
  const [error, setError] = useState<string | null>(null);

  const ctxRef = useRef<AudioContext | null>(null);
  const wsRef = useRef<WebSocket | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const audioChunksRef = useRef<ArrayBuffer[]>([]);
  const nextPlayTimeRef = useRef(0);

  const playChunks = useCallback((chunks: ArrayBuffer[]) => {
    const ctx = ctxRef.current;
    if (!ctx) return;
    // A user gesture started the context, but it can suspend; make sure it's running
    if (ctx.state === 'suspended') void ctx.resume();

    // Concatenate raw bytes first — chunk boundaries can land mid-sample, so we
    // can't treat each chunk as Int16 on its own (odd-length chunks would throw).
    const totalBytes = chunks.reduce((n, c) => n + c.byteLength, 0);
    const bytes = new Uint8Array(totalBytes);
    let offset = 0;
    for (const chunk of chunks) {
      bytes.set(new Uint8Array(chunk), offset);
      offset += chunk.byteLength;
    }

    // Interpret the aligned byte buffer as Int16 PCM (drop a trailing odd byte)
    const sampleCount = Math.floor(totalBytes / 2);
    const merged = new Int16Array(bytes.buffer, 0, sampleCount);

    // Convert Int16 → Float32
    const float32 = new Float32Array(sampleCount);
    for (let i = 0; i < sampleCount; i++) {
      float32[i] = merged[i] / 32768;
    }

    // Create and schedule an AudioBuffer
    const buffer = ctx.createBuffer(1, float32.length, TTS_SAMPLE_RATE);
    buffer.copyToChannel(float32, 0);

    const source = ctx.createBufferSource();
    source.buffer = buffer;
    source.connect(ctx.destination);

    const startTime = Math.max(ctx.currentTime, nextPlayTimeRef.current);
    source.start(startTime);
    nextPlayTimeRef.current = startTime + buffer.duration;
  }, []);

  const start = useCallback(async () => {
    setStatus('connecting...');
    setTranscript([]);
    setInterim('');
    setReplies([]);
    setBlaiseStatus('idle');
    setError(null);

    const ws = new WebSocket(WS_URL);
    wsRef.current = ws;

    await new Promise<void>((resolve, reject) => {
      ws.onopen = () => resolve();
      ws.onerror = () => reject(new Error('WebSocket failed'));
    });

    ws.binaryType = 'arraybuffer';

    ws.onmessage = (e: MessageEvent) => {
      if (e.data instanceof ArrayBuffer) {
        audioChunksRef.current.push(e.data);
        return;
      }
      const msg = JSON.parse(e.data as string);
      switch (msg.type) {
        case 'transcript':
          if (msg.isFinal) {
            setTranscript(t => [...t, { speaker: msg.speaker, text: msg.text }]);
            setInterim('');
          } else {
            setInterim(msg.text);
          }
          break;
        case 'blaise_thinking':
          setBlaiseStatus('thinking');
          break;
        case 'blaise_text':
          setBlaiseStatus('speaking');
          setReplies(r => [...r, msg.text]);
          break;
        case 'interjection_end': {
          const chunks = audioChunksRef.current.splice(0);
          if (chunks.length > 0) playChunks(chunks);
          setBlaiseStatus(msg.spoke ? 'idle' : 'silent');
          break;
        }
        case 'error':
          setError(msg.message);
          setBlaiseStatus('idle');
          break;
      }
    };

    setStatus('requesting mic...');
    const stream = await navigator.mediaDevices.getUserMedia({ audio: true, video: false });
    streamRef.current = stream;

    const ctx = new AudioContext({ sampleRate: 16000 });
    ctxRef.current = ctx;
    nextPlayTimeRef.current = 0;

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
  }, [playChunks]);

  const stop = useCallback(() => {
    streamRef.current?.getTracks().forEach(t => t.stop());
    ctxRef.current?.close();
    wsRef.current?.close();
    streamRef.current = null;
    ctxRef.current = null;
    wsRef.current = null;
    audioChunksRef.current = [];
    nextPlayTimeRef.current = 0;
    setIsRecording(false);
    setStatus('idle');
    setInterim('');
    setBlaiseStatus('idle');
  }, []);

  return { isRecording, status, transcript, interim, replies, blaiseStatus, error, start, stop };
}
