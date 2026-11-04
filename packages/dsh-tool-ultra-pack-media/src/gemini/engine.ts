import type { Settings } from '../settings.js'
import { analyseGemini, GeminiError } from './client.js'
import { geminiNotice, mediaMessages, NO_GEMINI_KEY } from './messages.js'
import { redactKey, resolveGeminiKey } from './settings.js'

export function engineParameter(settings: Settings) {
  return {
    type: 'string',
    enum: ['auto', 'local', 'gemini'],
    default: 'auto',
    description: mediaMessages(settings.html.lang).engine,
  }
}

/** Both tools share selection, privacy notices, redaction and local fallback. */
export async function runMediaEngine(
  settings: Settings,
  engine: unknown,
  path: string,
  prompt: string,
  local: () => Promise<string>,
  remote: (text: string) => Promise<string>,
  responseJsonSchema?: Record<string, unknown>,
): Promise<string> {
  const messages = mediaMessages(settings.html.lang)
  if (engine !== undefined && !['auto', 'local', 'gemini'].includes(engine as string)) {
    throw new Error(messages.badEngine)
  }
  if (engine === 'local' || !settings.gemini.uploads) {
    const output = await local()
    return engine === 'gemini' ? `${messages.uploadsOff}\n${output}` : output
  }
  let key: string | undefined
  let reason: string | undefined
  try {
    key = await resolveGeminiKey(settings.gemini)
    if (key) {
      const text = await analyseGemini(path, prompt, settings.gemini.model, key, { responseJsonSchema })
      const output = await remote(text)
      return redactKey(`${geminiNotice(settings.gemini.model)}\n\n${output}`, key)
    }
    if (engine === 'gemini') {
      reason = NO_GEMINI_KEY
    }
  } catch (error) {
    let detail = key ? messages.invalid : messages.keyFile
    if (error instanceof GeminiError) {
      detail = error.status ? messages.http(error.status) : messages[error.reason]
    }
    reason = messages.fallback(detail)
  }
  try {
    const output = await local()
    return redactKey(reason ? `${reason}\n${output}` : output, key)
  } catch (error) {
    // The local pipeline's errors can contain file names; keep the resolved key out.
    const detail = error instanceof Error ? error.message : messages.invalid
    throw new Error(redactKey([reason, detail].filter(Boolean).join('\n'), key))
  }
}

export function mediaPrompt(settings: Settings, kind: 'audio' | 'video', args: any): string {
  const content = kind === 'video'
    ? 'Write Markdown describing scenes, on-screen text (OCR), actions and motion, speakers and tone with timestamps. '
    : 'Transcribe the audio into JSON segments. Use start and end times in seconds, positive integer speaker IDs, text and optional tone. Include meaningful sounds in the text. Return an empty segments array for silence. '
  const speech = args.transcript === false ? 'Do not include a speech transcript. ' : 'Include the complete speech transcript with timestamps. '
  const speakers = args.speakers === false ? 'Do not distinguish speakers; use speaker ID 1 for every segment. ' : 'Assign consistent speaker IDs starting at 1. '
  return content + speech + speakers + `Keep spoken words in their original language${args.language ? ` (${args.language})` : ''}. `
    + `Write descriptions in ${settings.html.lang}. Report uncertainty instead of guessing.`
}
