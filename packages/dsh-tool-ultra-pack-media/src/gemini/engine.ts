import type { Settings } from '../settings.js'
import { analyseGemini, GeminiError } from './client.js'
import { geminiNotice, mediaMessages, NO_GEMINI_KEY } from './messages.js'
import { redactKey, resolveGeminiKey } from './settings.js'

export function engineParameter(settings: Settings) {
  return { type: 'string', enum: ['auto', 'local', 'gemini'], default: 'auto', description: mediaMessages(settings.html.lang).engine }
}

/** Both tools share selection, privacy notices, redaction and local fallback. */
export async function runMediaEngine(settings: Settings, engine: unknown, path: string, prompt: string,
  local: () => Promise<string>, remote: (text: string) => Promise<string>): Promise<string> {
  const messages = mediaMessages(settings.html.lang)
  if (engine !== undefined && !['auto', 'local', 'gemini'].includes(engine as string)) throw new Error(messages.badEngine)
  if (engine === 'local') return local()
  let key: string | undefined
  let reason: string | undefined
  try {
    key = await resolveGeminiKey(settings.gemini)
    if (key) {
      const text = await analyseGemini(path, prompt, settings.gemini.model, key)
      const output = await remote(text)
      return redactKey(`${geminiNotice(settings.gemini.model)}\n\n${output}`, key)
    }
    if (engine === 'gemini') reason = NO_GEMINI_KEY
  } catch (error) {
    const detail = error instanceof GeminiError
      ? error.status ? messages.http(error.status) : messages[error.reason]
      : key ? messages.invalid : messages.keyFile
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
    ? 'Describe scenes, on-screen text (OCR), actions and motion, speakers and tone with timestamps. '
    : 'Transcribe the audio as SRT subtitles only, with timestamps (HH:MM:SS,mmm --> HH:MM:SS,mmm). Include tone and meaningful sounds in the subtitle text. '
  const speech = args.transcript === false ? 'Do not include a speech transcript. ' : 'Include the complete speech transcript with timestamps. '
  const speakers = args.speakers === false ? 'Do not label speakers. ' : 'Label speakers consistently as Speaker 1, Speaker 2, etc. '
  return content + speech + speakers + `Keep spoken words in their original language${args.language ? ` (${args.language})` : ''}. `
    + `Write descriptions in ${settings.html.lang}. Report uncertainty instead of guessing.`
}
