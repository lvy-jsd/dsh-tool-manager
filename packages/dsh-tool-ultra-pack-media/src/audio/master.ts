/**
 * Mastering: measure loudness the way streaming services and broadcasters
 * do (ITU-R BS.1770 integrated loudness, in LUFS), bring every piece to the
 * same level with a look-ahead limiter keeping peaks under a ceiling, and
 * write a WAV file.
 */

export interface Audio {
  /** One buffer per channel (1 = mono, 2 = stereo), all the same length. */
  channels: Float32Array[]
  sampleRate: number
}

/** Streaming platforms play music at about -14 LUFS. */
export const TARGET_LUFS = -14
/** Highest sample peak after mastering, in dBFS, leaving room for lossy encoders. */
export const CEILING_DB = -1

const BLOCK_SECONDS = 0.4
const BLOCK_STEP = 0.25
const ABSOLUTE_GATE = -70
const RELATIVE_GATE = -10

interface Biquad {
  b: [number, number, number]
  a: [number, number]
}

/** BS.1770 K-weighting at any sample rate: a high shelf (head effect), then a high pass. */
function kWeighting(sampleRate: number): Biquad[] {
  const shelf = (() => {
    const gain = 3.999843853973347
    const q = 0.7071752369554196
    const w = (2 * Math.PI * 1681.974450955533) / sampleRate
    const a = 10 ** (gain / 40)
    const alpha = Math.sin(w) / (2 * q)
    const cos = Math.cos(w)
    const root = 2 * Math.sqrt(a) * alpha
    const a0 = a + 1 - (a - 1) * cos + root
    return {
      b: [(a * (a + 1 + (a - 1) * cos + root)) / a0, (-2 * a * (a - 1 + (a + 1) * cos)) / a0, (a * (a + 1 + (a - 1) * cos - root)) / a0],
      a: [(2 * (a - 1 - (a + 1) * cos)) / a0, (a + 1 - (a - 1) * cos - root) / a0],
    } satisfies Biquad
  })()
  const highPass = (() => {
    const w = (2 * Math.PI * 38.13547087602444) / sampleRate
    const alpha = Math.sin(w) / (2 * 0.5003270373238773)
    const a0 = 1 + alpha
    return { b: [1, -2, 1], a: [(-2 * Math.cos(w)) / a0, (1 - alpha) / a0] } satisfies Biquad
  })()
  return [shelf, highPass]
}

function filter(input: Float32Array, { b, a }: Biquad): Float32Array {
  const out = new Float32Array(input.length)
  let x1 = 0, x2 = 0, y1 = 0, y2 = 0
  for (let i = 0; i < input.length; i++) {
    const x = input[i]
    const y = b[0] * x + b[1] * x1 + b[2] * x2 - a[0] * y1 - a[1] * y2
    x2 = x1; x1 = x; y2 = y1; y1 = y
    out[i] = y
  }
  return out
}

/** Mean square of each 400 ms block (75 % overlap), summed over channels. */
function blockPowers(audio: Audio): number[] {
  const weighted = audio.channels.map((channel) => kWeighting(audio.sampleRate).reduce(filter, channel))
  const size = Math.round(BLOCK_SECONDS * audio.sampleRate)
  const step = Math.round(BLOCK_STEP * size)
  const powers: number[] = []
  for (let start = 0; start + size <= weighted[0].length; start += step) {
    let power = 0
    for (const channel of weighted) {
      let sum = 0
      for (let i = start; i < start + size; i++) sum += channel[i] * channel[i]
      power += sum / size
    }
    powers.push(power)
  }
  return powers
}

const toLufs = (power: number) => -0.691 + 10 * Math.log10(power)
const mean = (values: number[]) => values.reduce((sum, v) => sum + v, 0) / values.length

/** Integrated loudness in LUFS; -Infinity for silence or audio shorter than one block. */
export function loudness(audio: Audio): number {
  const audible = blockPowers(audio).filter((p) => toLufs(p) > ABSOLUTE_GATE)
  if (!audible.length) return -Infinity
  const gate = toLufs(mean(audible)) + RELATIVE_GATE
  const gated = audible.filter((p) => toLufs(p) > gate)
  return toLufs(mean(gated))
}

export function peak(audio: Audio): number {
  let max = 0
  for (const channel of audio.channels) for (const s of channel) max = Math.max(max, Math.abs(s))
  return max
}

/** Lowest value of `values` within `radius` samples of each index (a monotonic queue, linear time). */
function windowMin(values: Float32Array, radius: number): Float32Array {
  const out = new Float32Array(values.length)
  const queue: number[] = []
  let head = 0
  for (let i = 0; i < values.length + radius; i++) {
    if (i < values.length) {
      while (queue.length > head && values[queue[queue.length - 1]] >= values[i]) queue.pop()
      queue.push(i)
    }
    const centre = i - radius
    if (centre < 0) continue
    while (queue[head] < centre - radius) head++
    out[centre] = values[queue[head]]
  }
  return out
}

/** Moving average over `width` samples centred on each index. */
function boxAverage(values: Float32Array, width: number): Float32Array {
  const out = new Float32Array(values.length)
  const half = Math.floor(width / 2)
  let sum = 0
  let count = 0
  for (let i = -half; i < values.length; i++) {
    const enter = i + half
    const leave = i - half - 1
    if (enter < values.length) { sum += values[enter]; count++ }
    if (leave >= 0) { sum -= values[leave]; count-- }
    if (i >= 0) out[i] = sum / count
  }
  return out
}

/**
 * A look-ahead peak limiter: the gain each sample needs to stay under the
 * ceiling, spread over the 5 ms before and after it (so it never clicks),
 * then released smoothly over about 80 ms.
 */
export function limit(audio: Audio, ceiling: number): Audio {
  const { channels, sampleRate } = audio
  const lookahead = Math.max(1, Math.round(0.005 * sampleRate))
  const release = Math.exp(-1 / (0.08 * sampleRate))
  const need = new Float32Array(channels[0].length).map((_, i) => {
    const top = channels.reduce((max, channel) => Math.max(max, Math.abs(channel[i])), 0)
    return top > ceiling ? ceiling / top : 1
  })
  const gain = boxAverage(windowMin(need, lookahead), lookahead)
  for (let i = 1, held = gain[0]; i < gain.length; i++) {
    held = Math.min(gain[i], gain[i] - (gain[i] - held) * release)
    gain[i] = Math.min(held, need[i])
  }
  return { channels: channels.map((channel) => channel.map((s, i) => s * gain[i])), sampleRate }
}

export interface Mastered {
  audio: Audio
  /** Loudness after mastering, in LUFS. */
  lufs: number
}

/** Brings the audio to `target` LUFS, with the limiter holding peaks under the ceiling. */
export function master(audio: Audio, target = TARGET_LUFS): Mastered {
  const measured = loudness(audio)
  if (!Number.isFinite(measured)) return { audio, lufs: measured }
  const gain = 10 ** ((target - measured) / 20)
  const raised = { channels: audio.channels.map((channel) => channel.map((s) => s * gain)), sampleRate: audio.sampleRate }
  const limited = limit(raised, 10 ** (CEILING_DB / 20))
  return { audio: limited, lufs: loudness(limited) }
}

/** 16-bit PCM WAV, mono or stereo. */
export function encodeWav(audio: Audio): Buffer {
  const { channels, sampleRate } = audio
  const frames = channels[0]?.length ?? 0
  const blockAlign = channels.length * 2
  const data = Buffer.alloc(frames * blockAlign)
  for (let i = 0; i < frames; i++) {
    channels.forEach((channel, c) => data.writeInt16LE(Math.round(Math.max(-1, Math.min(1, channel[i])) * 32767), i * blockAlign + c * 2))
  }
  const header = Buffer.alloc(44)
  header.write('RIFF', 0, 'ascii')
  header.writeUInt32LE(36 + data.length, 4)
  header.write('WAVEfmt ', 8, 'ascii')
  header.writeUInt32LE(16, 16)
  header.writeUInt16LE(1, 20)
  header.writeUInt16LE(channels.length, 22)
  header.writeUInt32LE(sampleRate, 24)
  header.writeUInt32LE(sampleRate * blockAlign, 28)
  header.writeUInt16LE(blockAlign, 32)
  header.writeUInt16LE(16, 34)
  header.write('data', 36, 'ascii')
  header.writeUInt32LE(data.length, 40)
  return Buffer.concat([header, data])
}
