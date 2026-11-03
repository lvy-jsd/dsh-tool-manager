/** video_render. */
import { safeBaseName, saveFile } from '../output.js'
import { NAME_PARAMETER, type Settings, type ToolSpec } from '../settings.js'
import { renderVideo, runProgram, type RunProgram } from '../video/render.js'
import { parseVideoRequest, totalSeconds } from '../video/scenes.js'

const SCENE = {
  type: 'object',
  additionalProperties: false,
  properties: {
    svg: { type: 'string', required: true, description: 'The frame as a complete SVG document; draw titles and captions into it.' },
    seconds: { type: 'number', description: 'How long the frame shows, 0.5-60. Default 3.' },
  },
}

export function videoTool(settings: Settings, run: RunProgram = runProgram): ToolSpec {
  async function render(args: any): Promise<string> {
    const request = parseVideoRequest(args, settings.videoLimits)
    const runtime = { outputDir: settings.outputDir, ffmpegPath: settings.ffmpegPath, timeoutMs: settings.ffmpegTimeoutMs, svgLimits: settings.svgLimits }
    const video = await renderVideo(request, runtime, run)
    const path = await saveFile(settings.outputDir, safeBaseName(args.name, 'video'), 'mp4', video)
    const kb = Math.max(1, Math.round(video.byteLength / 1024))
    return `Saved MP4 ${request.width}×${request.height}, ${totalSeconds(request.scenes)} s, ${request.scenes.length} scene(s) (${kb} KB): ${path}`
  }

  return {
    name: 'video_render',
    description: 'Make a short MP4 video (slideshow, animated card, explainer) from scenes you draw as SVG, each shown for some seconds with a soft fade, '
      + 'optionally with a soundtrack made by music_render. Needs ffmpeg on the server.',
    parameters: {
      scenes: { type: 'array', required: true, description: 'Scenes in order, up to 60.', items: SCENE },
      audio: { type: 'string', description: 'File name of a soundtrack saved by music_render, e.g. "song-20261103T080000Z.wav". The video keeps its own length.' },
      width: { type: 'integer', description: 'Even number of pixels. Default 1280.' },
      height: { type: 'integer', description: 'Even number of pixels. Default 720.' },
      fade: { type: 'boolean', description: 'Fade each scene in and out. Default true.' },
      name: NAME_PARAMETER,
    },
    execute: render,
  }
}
