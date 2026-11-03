/**
 * Pixel work on whole frames: transitions between two scenes, laying a
 * transparent layer (captions) over a frame, and fading to black. Frames are
 * raw RGBA buffers of one size; scene frames are opaque.
 */
import type { TransitionKind } from './timeline.js'

export interface FrameSize {
  width: number
  height: number
}

const WIPE_EDGE = 0.08
const CIRCLE_EDGE = 0.04

/** Slow at both ends, quick in the middle. */
export function ease(p: number): number {
  return p < 0.5 ? 4 * p * p * p : 1 - (-2 * p + 2) ** 3 / 2
}

function clamp01(x: number): number {
  return x < 0 ? 0 : x > 1 ? 1 : x
}

/** Mixes `b` over `a` by a per-pixel weight from `mask(x, y)` (0 = a, 1 = b). */
function mix(a: Buffer, b: Buffer, size: FrameSize, mask: (x: number, y: number) => number): Buffer {
  const out = Buffer.allocUnsafe(a.length)
  for (let y = 0; y < size.height; y++) {
    for (let x = 0; x < size.width; x++) {
      const m = mask(x, y)
      const i = (y * size.width + x) * 4
      out[i] = a[i] + (b[i] - a[i]) * m
      out[i + 1] = a[i + 1] + (b[i + 1] - a[i + 1]) * m
      out[i + 2] = a[i + 2] + (b[i + 2] - a[i + 2]) * m
      out[i + 3] = 255
    }
  }
  return out
}

/** `b` pushes `a` out of the frame, to the left or upward. */
function push(a: Buffer, b: Buffer, size: FrameSize, p: number, horizontal: boolean): Buffer {
  const out = Buffer.allocUnsafe(a.length)
  const row = size.width * 4
  if (horizontal) {
    const shift = Math.round(p * size.width) * 4
    for (let y = 0; y < size.height; y++) {
      const start = y * row
      a.copy(out, start, start + shift, start + row)
      b.copy(out, start + row - shift, start, start + shift)
    }
  } else {
    const shift = Math.round(p * size.height) * row
    a.copy(out, 0, shift, a.length)
    b.copy(out, a.length - shift, 0, shift)
  }
  return out
}

/** One frame of the transition from `a` to `b`, `progress` from 0 to 1. */
export function transition(a: Buffer, b: Buffer, size: FrameSize, kind: TransitionKind, progress: number): Buffer {
  const p = ease(clamp01(progress))
  switch (kind) {
    case 'cut':
      return p < 0.5 ? a : b
    case 'slide-left':
      return push(a, b, size, p, true)
    case 'slide-up':
      return push(a, b, size, p, false)
    case 'wipe': {
      const edge = p * (1 + WIPE_EDGE)
      return mix(a, b, size, (x) => clamp01((edge - x / size.width) / WIPE_EDGE))
    }
    case 'circle': {
      const cx = size.width / 2
      const cy = size.height / 2
      const reach = Math.hypot(cx, cy)
      const radius = p * (1 + CIRCLE_EDGE)
      return mix(a, b, size, (x, y) => clamp01((radius - Math.hypot(x - cx, y - cy) / reach) / CIRCLE_EDGE))
    }
    default:
      return mix(a, b, size, () => p)
  }
}

/** A copy of an opaque frame with a transparent RGBA layer (straight alpha) laid over it. */
export function overlay(frame: Buffer, layer: Buffer): Buffer {
  const out = Buffer.from(frame)
  for (let i = 0; i < out.length; i += 4) {
    const alpha = layer[i + 3]
    if (alpha === 0) continue
    const m = alpha / 255
    out[i] += (layer[i] - out[i]) * m
    out[i + 1] += (layer[i + 1] - out[i + 1]) * m
    out[i + 2] += (layer[i + 2] - out[i + 2]) * m
  }
  return out
}

/** Darkens a frame toward black; `level` 1 leaves it, 0 is black. */
export function dim(frame: Buffer, level: number): Buffer {
  if (level >= 1) return frame
  const out = Buffer.allocUnsafe(frame.length)
  for (let i = 0; i < frame.length; i += 4) {
    out[i] = frame[i] * level
    out[i + 1] = frame[i + 1] * level
    out[i + 2] = frame[i + 2] * level
    out[i + 3] = 255
  }
  return out
}

/** An opaque copy of an RGBA frame as if drawn over black. */
export function onBlack(frame: Buffer): Buffer {
  const out = Buffer.allocUnsafe(frame.length)
  for (let i = 0; i < frame.length; i += 4) {
    const m = frame[i + 3] / 255
    out[i] = frame[i] * m
    out[i + 1] = frame[i + 1] * m
    out[i + 2] = frame[i + 2] * m
    out[i + 3] = 255
  }
  return out
}
