import Anthropic from '@anthropic-ai/sdk';
import { formatSegments } from './session';
import type { SpeakerSegment } from './session';

const client = new Anthropic();

// Sentinel Claude emits when it has nothing worth saying. Filtered out before TTS.
const SILENT = 'PASS';

const SYSTEM_PROMPT = `You are Blaise, an AI that listens to a live conversation between people and interjects. Only speak when you have something genuinely useful to add — a relevant fact, a clarifying question, a different perspective, or when directly addressed. Keep interjections brief (1-3 sentences) and conversational. If you have nothing worthwhile to add, reply with exactly "${SILENT}" and nothing else.`;

function isSilent(sentence: string): boolean {
  return sentence.replace(/[.!?]+$/, '').trim().toUpperCase() === SILENT;
}

export async function* checkInterjection(
  fullTranscript: string,
  newSegments: SpeakerSegment[],
): AsyncGenerator<string> {
  const userContent: Anthropic.Messages.ContentBlockParam[] = [];

  if (fullTranscript) {
    userContent.push({ type: 'text', text: fullTranscript, cache_control: { type: 'ephemeral' } });
  }

  userContent.push({ type: 'text', text: formatSegments(newSegments) });

  const stream = client.messages.stream({
    model: 'claude-haiku-4-5-20251001',
    max_tokens: 256,
    system: [{ type: 'text', text: SYSTEM_PROMPT, cache_control: { type: 'ephemeral' } }],
    messages: [{ role: 'user', content: userContent }],
  });

  let sentenceBuffer = '';

  for await (const event of stream) {
    if (event.type !== 'content_block_delta') continue;
    if (event.delta.type !== 'text_delta') continue;

    sentenceBuffer += event.delta.text;

    // Yield each complete sentence as it arrives so TTS can start immediately
    let sentenceEnd: number;
    while ((sentenceEnd = sentenceBuffer.search(/[.!?](\s|$)/)) !== -1) {
      const sentence = sentenceBuffer.slice(0, sentenceEnd + 1).trim();
      sentenceBuffer = sentenceBuffer.slice(sentenceEnd + 1).trimStart();
      if (sentence && !isSilent(sentence)) yield sentence;
    }
  }

  // Flush any remaining text that had no closing punctuation
  const remaining = sentenceBuffer.trim();
  if (remaining && !isSilent(remaining)) yield remaining;
}
