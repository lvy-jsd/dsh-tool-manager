/** Runs the host's ffmpeg / ffprobe: a separate program, an argument list, no shell, a time limit. */
import { execFile, spawn } from 'node:child_process'
import { once } from 'node:events'

/** Runs a program and resolves with its standard output. */
export type RunProgram = (file: string, args: string[], timeoutMs: number) => Promise<string>

/** Streams `input` into a program's standard input and resolves when it exits cleanly. */
export type FeedProgram = (file: string, args: string[], input: AsyncIterable<Buffer>, timeoutMs: number) => Promise<void>

function missingProgram(file: string): Error {
  return new Error(`This tool needs ffmpeg on the server, and "${file}" was not found. Install ffmpeg or set ffmpegPath / ffprobePath.`)
}

function tooSlow(file: string, timeoutMs: number): Error {
  return new Error(`${file} took longer than ${timeoutMs / 1000} seconds and was stopped.`)
}

function failed(file: string, stderr: string, fallback: string): Error {
  return new Error(`${file} failed: ${stderr.trim().slice(0, 500) || fallback}`)
}

/** Runs a program without a shell; a missing ffmpeg or ffprobe gets a plain-language error. */
export const runProgram: RunProgram = (file, args, timeoutMs) => new Promise((resolve, reject) => {
  execFile(file, args, { timeout: timeoutMs, windowsHide: true, maxBuffer: 4 * 1024 * 1024 }, (error, stdout, stderr) => {
    if (!error) return resolve(String(stdout))
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return reject(missingProgram(file))
    if (error.killed) return reject(tooSlow(file, timeoutMs))
    reject(failed(file, String(stderr), error.message))
  })
})

export const feedProgram: FeedProgram = async (file, args, input, timeoutMs) => {
  const child = spawn(file, args, { stdio: ['pipe', 'ignore', 'pipe'], windowsHide: true })
  let stderr = ''
  child.stderr.on('data', (chunk) => { stderr = (stderr + chunk).slice(-4000) })
  child.stdin.on('error', () => {}) // A broken pipe shows up as the exit status below.
  const exited = once(child, 'close').catch((error) => { throw error.code === 'ENOENT' ? missingProgram(file) : error })
  let running = true
  exited.then(() => { running = false }, () => { running = false })
  const timer = setTimeout(() => child.kill('SIGKILL'), timeoutMs)
  try {
    for await (const chunk of input) {
      if (!running) break
      if (!child.stdin.write(chunk)) await Promise.race([once(child.stdin, 'drain'), exited])
    }
    child.stdin.end()
    const [code, signal] = await exited
    if (signal === 'SIGKILL') throw tooSlow(file, timeoutMs)
    if (code !== 0) throw failed(file, stderr, `exit code ${code}`)
  } finally {
    clearTimeout(timer)
    if (child.exitCode === null) child.kill('SIGKILL')
  }
}
