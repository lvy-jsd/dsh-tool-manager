/**
 * Captions on a video: given as a list, or read from an .srt file (such as
 * the subtitles audio_transcribe saves). Each caption is drawn as its own
 * small HTML page with a short entrance animation and laid over the frame.
 */

export interface Caption {
  start: number
  end: number
  text: string
}

export const CAPTION_STYLES = ['subtitle', 'pop'] as const
export type CaptionStyle = (typeof CAPTION_STYLES)[number]

const MAX_CAPTION_CHARS = 200
const SRT_TIME = /(\d+):(\d{2}):(\d{2})[,.](\d{1,3})/

function srtSeconds(text: string): number {
  const [, h, m, s, ms] = SRT_TIME.exec(text) ?? []
  if (h === undefined) throw new Error(`Bad SRT time "${text}".`)
  return Number(h) * 3600 + Number(m) * 60 + Number(s) + Number(ms.padEnd(3, '0')) / 1000
}

/** Reads SubRip subtitles: numbered blocks of "start --> end" and text lines. */
export function parseSrt(text: string): Caption[] {
  const captions: Caption[] = []
  for (const block of text.replace(/\r/g, '').split(/\n\s*\n/)) {
    const lines = block.trim().split('\n')
    const timing = lines.findIndex((line) => line.includes('-->'))
    if (timing < 0) continue
    const [from, to] = lines[timing].split('-->')
    captions.push({ start: srtSeconds(from), end: srtSeconds(to), text: lines.slice(timing + 1).join('\n').trim() })
  }
  return captions.filter((c) => c.text)
}

/** Checks a caption list against the video's length. */
export function checkCaptions(raw: unknown, total: number): Caption[] {
  if (!Array.isArray(raw)) throw new Error('captions must be a list of {start, end, text}.')
  return raw.map((c: any, i) => {
    const label = `Caption ${i + 1}`
    if (typeof c?.text !== 'string' || !c.text.trim()) throw new Error(`${label} needs text.`)
    if (c.text.length > MAX_CAPTION_CHARS) throw new Error(`${label} is longer than ${MAX_CAPTION_CHARS} characters.`)
    if (!(typeof c.start === 'number' && typeof c.end === 'number' && c.start >= 0 && c.end > c.start)) {
      throw new Error(`${label}: start and end must be seconds, with end after start.`)
    }
    return { start: c.start, end: Math.min(c.end, total), text: c.text.trim() }
  }).filter((c) => c.start < total)
}

export function isShowing(caption: Caption, t: number): boolean {
  return t >= caption.start && t < caption.end
}

function escapeHtml(text: string): string {
  return text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/\n/g, '<br/>')
}

const STYLE_CSS: Record<CaptionStyle, (height: number) => string> = {
  subtitle: (h) => `
    .root{width:100%;height:100%;display:flex;flex-direction:column;justify-content:flex-end;align-items:center;padding-bottom:${Math.round(h * 0.06)}px}
    .text{max-width:86%;text-align:center;font-family:sans-serif;font-size:${Math.round(h * 0.045)}px;line-height:1.35;color:#fff;
      background:rgba(0,0,0,.55);border-radius:${Math.round(h * 0.012)}px;padding:${Math.round(h * 0.008)}px ${Math.round(h * 0.02)}px;animation:in .25s ease-out both}
    @keyframes in{from{opacity:0;transform:translateY(${Math.round(h * 0.015)}px)}to{opacity:1;transform:none}}`,
  pop: (h) => `
    .root{width:100%;height:100%;display:flex;flex-direction:column;justify-content:flex-end;align-items:center;padding-bottom:${Math.round(h * 0.16)}px}
    .text{max-width:84%;text-align:center;font-family:sans-serif;font-weight:700;font-size:${Math.round(h * 0.075)}px;line-height:1.2;color:#ffe14d;
      text-shadow:0 ${Math.round(h * 0.004)}px ${Math.round(h * 0.012)}px rgba(0,0,0,.85);animation:pop .3s ease-out both}
    @keyframes pop{0%{opacity:0;transform:scale(.6)}70%{opacity:1;transform:scale(1.08)}100%{transform:scale(1)}}`,
}

/** The caption as a transparent HTML page the size of the video. */
export function captionPage(caption: Caption, style: CaptionStyle, height: number): string {
  return `<style>${STYLE_CSS[style](height)}</style><div class="root"><div class="text">${escapeHtml(caption.text)}</div></div>`
}
