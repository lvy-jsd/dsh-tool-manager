/**
 * Each scene as a source of frames: given a time on the scene's own clock,
 * an opaque RGBA frame the size of the video. SVG scenes are drawn once;
 * HTML and photo scenes are drawn per frame so their CSS animations play.
 */
import sharp from 'sharp'
import type { HtmlRenderer } from '../html/render.js'
import { rasterizeSvg, type RasterLimits } from '../svg.js'
import { onBlack, type FrameSize } from './compose.js'
import type { Motion, Scene } from './scenes.js'

export type SceneFrames = (local: number) => Promise<Buffer>

/** Start and end transforms of a photo's slow camera move. */
const MOTION: Record<Motion, [string, string]> = {
  'zoom-in': ['scale(1)', 'scale(1.15)'],
  'zoom-out': ['scale(1.15)', 'scale(1)'],
  'pan-left': ['scale(1.15) translateX(5%)', 'scale(1.15) translateX(-5%)'],
  'pan-right': ['scale(1.15) translateX(-5%)', 'scale(1.15) translateX(5%)'],
  none: ['none', 'none'],
}
const UNSAFE_NAME = /["'()<>]/

/** A photo filling the frame, moving slowly over `seconds`. */
export function photoPage(image: string, motion: Motion, seconds: number): string {
  if (UNSAFE_NAME.test(image)) throw new Error(`image "${image}" has characters a file name cannot use here: " ' ( ) < >.`)
  const [from, to] = MOTION[motion]
  return `<style>@keyframes move{from{transform:${from}}to{transform:${to}}}
.root{width:100%;height:100%;display:flex;overflow:hidden;background:#000}
.photo{width:100%;height:100%;background-image:url('${image}');background-size:cover;background-position:center;animation:move ${seconds}s linear both}</style>
<div class="root"><div class="photo"></div></div>`
}

async function svgFrames(svg: string, size: FrameSize, limits: RasterLimits): Promise<SceneFrames> {
  const raster = await rasterizeSvg(svg, { format: 'png', width: size.width }, limits)
  const frame = await sharp(raster.data)
    .resize(size.width, size.height, { fit: 'contain', background: '#000000' })
    .flatten({ background: '#000000' })
    .ensureAlpha()
    .raw()
    .toBuffer()
  return async () => frame
}

async function htmlFrames(html: string, size: FrameSize, renderer: HtmlRenderer): Promise<SceneFrames> {
  const page = await renderer.open(html)
  const box = { width: size.width, height: size.height, scale: 1 }
  return async (local) => onBlack((await renderer.still(page, box, 'raw', Math.max(0, local) * 1000)).data)
}

export function sceneFrames(scene: Scene, size: FrameSize, renderer: HtmlRenderer, svgLimits: RasterLimits): Promise<SceneFrames> {
  if ('svg' in scene) return svgFrames(scene.svg, size, svgLimits)
  if ('html' in scene) return htmlFrames(scene.html, size, renderer)
  // The move runs a little past the scene so it never stops while a transition is still showing it.
  return htmlFrames(photoPage(scene.image, scene.motion, scene.seconds + 1), size, renderer)
}
