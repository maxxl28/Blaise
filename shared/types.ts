export type ServerMessage =
  | { type: 'transcript'; speaker: number | null; text: string; isFinal: boolean }
  | { type: 'interjection'; audio: ArrayBuffer }
  | { type: 'interjection_end' }
  | { type: 'error'; message: string };
