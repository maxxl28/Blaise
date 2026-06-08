export type ServerMessage =
  | { type: 'transcript'; speaker: number | null; text: string; isFinal: boolean }
  | { type: 'interjection'; audio: ArrayBuffer }
  | { type: 'error'; message: string };
