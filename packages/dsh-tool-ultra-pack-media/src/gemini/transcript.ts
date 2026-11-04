import type { Segment } from '../speech/transcript.js'
import { GeminiError } from './client.js'

/** Native structured output; timestamps are seconds, speaker IDs start at 1. */
export const TRANSCRIPT_SCHEMA = {
  type: 'object',
  properties: {
    segments: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          start: { type: 'number', minimum: 0 },
          end: { type: 'number', minimum: 0 },
          speaker: { type: 'integer', minimum: 1 },
          text: { type: 'string', minLength: 1 },
          tone: { type: 'string' },
        },
        required: ['start', 'end', 'speaker', 'text'],
        additionalProperties: false,
      },
    },
  },
  required: ['segments'],
  additionalProperties: false,
}

function readSegment(value: unknown, speakers: boolean): Segment {
  if (!value || typeof value !== 'object') {
    throw new GeminiError('invalid')
  }
  const { start, end, speaker, text, tone } = value as Record<string, unknown>
  const validStart = typeof start === 'number' && Number.isFinite(start) && start >= 0
  const validEnd = typeof end === 'number' && Number.isFinite(end) && validStart && end > start
  const validSpeaker = typeof speaker === 'number' && Number.isInteger(speaker) && speaker >= 1
  const validText = typeof text === 'string' && Boolean(text.trim())
  const validTone = tone === undefined || typeof tone === 'string'
  if (!validStart || !validEnd || !validSpeaker || !validText || !validTone) {
    throw new GeminiError('invalid')
  }
  return {
    start,
    end,
    speaker: speakers ? speaker : undefined,
    text,
    emotion: tone?.trim() || undefined,
  }
}

export function parseGeminiSegments(text: string, speakers = true): Segment[] {
  try {
    const data = JSON.parse(text)
    if (!data || !Array.isArray(data.segments)) {
      throw new GeminiError('invalid')
    }
    return data.segments.map((value: unknown) => readSegment(value, speakers))
  } catch {
    // JSON syntax errors can quote response text, including a credential echoed by the model.
    throw new GeminiError('invalid')
  }
}
