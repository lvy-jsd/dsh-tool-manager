/** Runs the host's ffmpeg: a separate program, an argument list, no shell, a time limit. */
import { execFile } from 'node:child_process'

export type RunProgram = (file: string, args: string[], timeoutMs: number) => Promise<void>

/** Runs a program without a shell; a missing ffmpeg gets a plain-language error. */
export const runProgram: RunProgram = (file, args, timeoutMs) => new Promise((resolve, reject) => {
  execFile(file, args, { timeout: timeoutMs, windowsHide: true, maxBuffer: 1024 * 1024 }, (error, _stdout, stderr) => {
    if (!error) return resolve()
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return reject(new Error(`This tool needs ffmpeg on the server, and "${file}" was not found. Install ffmpeg or set ffmpegPath.`))
    if (error.killed) return reject(new Error(`ffmpeg took longer than ${timeoutMs / 1000} seconds and was stopped.`))
    reject(new Error(`ffmpeg failed: ${String(stderr).trim().slice(0, 500) || error.message}`))
  })
})
