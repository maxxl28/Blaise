export type ServerMessage =
  | { type: 'transcript'; text: string; isFinal: boolean }
  | { type: 'interjection'; audio: ArrayBuffer }
  | { type: 'error'; message: string };
