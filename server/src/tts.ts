import OpenAI from 'openai';

let client: OpenAI | null = null;

export async function* streamTTS(
  sentence: string,
  signal: AbortSignal,
): AsyncGenerator<Buffer> {
  client ??= new OpenAI();
  const response = await client.audio.speech.create({
    model: 'tts-1',
    voice: 'alloy',
    input: sentence,
    response_format: 'pcm',
  }, { signal });

  for await (const chunk of response.body as unknown as AsyncIterable<Uint8Array>) {
    if (signal.aborted) return;
    yield Buffer.from(chunk);
  }
}