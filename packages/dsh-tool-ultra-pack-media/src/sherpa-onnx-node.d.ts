/** The parts of sherpa-onnx-node (Apache-2.0) this pack uses; the package ships no types. */
declare module 'sherpa-onnx-node' {
  export interface SpeechSegment { start: number; samples: Float32Array }
  export interface DiarizationTurn { start: number; end: number; speaker: number }
  export interface RecognizerResult { text: string; lang?: string; emotion?: string; event?: string }
  export class Vad {
    constructor(config: object, bufferSizeInSeconds: number)
    acceptWaveform(samples: Float32Array): void
    isEmpty(): boolean
    front(enableExternalBuffer?: boolean): SpeechSegment
    pop(): void
    flush(): void
  }
  export class OfflineSpeakerDiarization {
    constructor(config: object)
    process(samples: Float32Array): DiarizationTurn[]
  }
  export interface OfflineStream { acceptWaveform(input: { sampleRate: number; samples: Float32Array }): void }
  export class OfflineRecognizer {
    static createAsync(config: object): Promise<OfflineRecognizer>
    createStream(): OfflineStream
    decodeAsync(stream: OfflineStream): Promise<RecognizerResult>
  }
  const sherpa: { Vad: typeof Vad; OfflineSpeakerDiarization: typeof OfflineSpeakerDiarization; OfflineRecognizer: typeof OfflineRecognizer }
  export default sherpa
}
