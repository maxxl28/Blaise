import Anthropic from '@anthropic-ai/sdk';
import { formatSegments } from './session';
import type { SpeakerSegment } from './session';

const client = new Anthropic();

const SYSTEM_PROMPT = `You are Blaise, an AI that listens to a live conversation between two people and occasionally interjects. Only speak when you have something genuinely useful to add — a relevant fact, a clarifying question, a different perspective, or when directly addressed. Keep interjections brief (1-3 sentences) and conversational. If you have nothing worthwhile to add, stay silent.`;

export async function checkInterjection(
  fullTranscript: string,
  newSegments: SpeakerSegment[],
): Promise<string | null> {
  const userContent: Anthropic.Messages.ContentBlockParam[] = [];

  if (fullTranscript) {
    userContent.push({
      type: 'text',
      text: fullTranscript,
      cache_control: { type: 'ephemeral' },
    });
  }

  userContent.push({
    type: 'text',
    text: formatSegments(newSegments),
  });

  const response = await client.messages.create({
    model: 'claude-haiku-4-5-20251001',
    max_tokens: 256,
    system: [{
      type: 'text',
      text: SYSTEM_PROMPT,
      cache_control: { type: 'ephemeral' },
    }],
    tools: [{
      name: 'interject',
      description: 'Speak up in the conversation with a brief, natural response.',
      input_schema: {
        type: 'object' as const,
        properties: {
          text: { type: 'string', description: 'What to say. Keep it brief and natural.' },
        },
        required: ['text'],
      },
    }],
    tool_choice: { type: 'auto' },
    messages: [{ role: 'user', content: userContent }],
  });

  for (const block of response.content) {
    if (block.type === 'tool_use' && block.name === 'interject') {
      return (block.input as { text: string }).text;
    }
  }

  return null;
}
