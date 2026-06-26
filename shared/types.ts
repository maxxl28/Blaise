export type ServerMessage =
  | { type: 'transcript'; speaker: number | null; text: string; isFinal: boolean }
  | { type: 'blaise_thinking' }
  | { type: 'blaise_text'; text: string }
  | { type: 'interjection'; audio: ArrayBuffer }
  | { type: 'interjection_end'; spoke: boolean }
  | { type: 'error'; message: string };
