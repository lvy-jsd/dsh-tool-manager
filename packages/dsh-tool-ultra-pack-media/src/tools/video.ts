/** video_render. */
import type { FeedProgram } from '../ffmpeg.js'
import { createHtmlRenderer, type HtmlRenderer } from '../html/render.js'
import { safeBaseName, saveFile } from '../output.js'
import { NAME_PARAMETER, type Settings, type ToolSpec } from '../settings.js'
import { CAPTION_STYLES } from '../video/captions.js'
import { renderVideo } from '../video/render.js'
import { FRAME_RATES, MOTIONS, parseVideoRequest } from '../video/scenes.js'
import { TRANSITIONS } from '../video/timeline.js'

const SCENE = {
  type: 'object',
  additionalProperties: false,
  properties: {
    html: { type: 'string', description: 'The scene as an HTML page the size of the video, animated with CSS @keyframes (they start when the scene appears). Same rules as html_render.' },
    svg: { type: 'string', description: 'Or: the scene as a still SVG drawing.' },
    image: { type: 'string', description: 'Or: a photo file from the output folder (by name) or an allowed input folder, shown full-frame with a slow camera move.' },
    motion: { type: 'string', enum: [...MOTIONS], description: 'Camera move for an image scene. Default zoom-in.' },
    seconds: { type: 'number', description: 'How long the scene shows, 0.5-60. Default 3.' },
    transition: { type: 'string', enum: [...TRANSITIONS], description: 'How this scene hands over to the next. Default: the video\'s transition.' },
  },
}

const CAPTION = {
  type: 'object',
  additionalProperties: false,
  properties: {
    start: { type: 'number', required: true, description: 'Seconds from the start of the video.' },
    end: { type: 'number', required: true, description: 'Seconds from the start of the video.' },
    text: { type: 'string', required: true, description: 'Up to 200 characters.' },
  },
}

export interface VideoDeps {
  renderer?: HtmlRenderer
  feed?: FeedProgram
}

export function videoTool(settings: Settings, deps: VideoDeps = {}): ToolSpec {
  const renderer = deps.renderer ?? createHtmlRenderer(settings.html)
  async function render(args: any): Promise<string> {
    const request = parseVideoRequest(args, settings.videoLimits)
    const folders = { outputDir: settings.outputDir, inputDirs: settings.inputDirs }
    const runtime = { folders, ffmpegPath: settings.ffmpegPath, timeoutMs: settings.ffmpegTimeoutMs, svgLimits: settings.svgLimits, renderer, feed: deps.feed }
    const video = await renderVideo(request, runtime)
    const path = await saveFile(settings.outputDir, safeBaseName(args.name, 'video'), 'mp4', video)
    const kb = Math.max(1, Math.round(video.byteLength / 1024))
    return `Saved MP4 ${request.width}×${request.height}, ${request.timeline.total} s, ${request.scenes.length} scene(s) (${kb} KB): ${path}`
  }

  return {
    name: 'video_render',
    description: 'Make an MP4 video (short-video clip, animated explainer, photo slideshow, kinetic-typography title, data story) from scenes: '
      + 'HTML pages animated with CSS (best: anything html_render can draw, moving), still SVG drawings, or photos with a slow camera move. '
      + 'Scenes are joined by transitions (fade, slide-left, slide-up, wipe, circle, cut); add captions or an .srt from audio_transcribe, '
      + 'and a soundtrack from music_render. The video is exactly as long as its scenes. Needs ffmpeg on the server.',
    parameters: {
      scenes: { type: 'array', required: true, description: 'Scenes in order, up to 60. Each has one of html, svg or image.', items: SCENE },
      transition: { type: 'string', enum: [...TRANSITIONS], description: 'Default transition between scenes. Default fade (cut when fade is false).' },
      captions: { type: 'array', description: 'Captions over the video.', items: CAPTION },
      subtitles: { type: 'string', description: 'File name of an .srt in the output folder to show as captions, e.g. one saved by audio_transcribe.' },
      captionStyle: { type: 'string', enum: [...CAPTION_STYLES], description: 'subtitle (default: small, at the bottom) or pop (big, bold, bouncing in, short-video style).' },
      audio: { type: 'string', description: 'File name of a soundtrack in the output folder, e.g. one saved by music_render. The video keeps its own length.' },
      width: { type: 'integer', description: 'Even number of pixels. Default 1280 (use 1080×1920 for a vertical phone video).' },
      height: { type: 'integer', description: 'Even number of pixels. Default 720.' },
      fps: { type: 'integer', enum: [...FRAME_RATES], description: 'Frames per second. Default 30.' },
      fade: { type: 'boolean', description: 'Fade in from black at the start and out at the end. Default true.' },
      name: NAME_PARAMETER,
    },
    execute: render,
  }
}
