/** New media-engine copy. Existing local-pipeline copy is kept compatible. */
const en = {
  pack: 'Images, music and video made from code, and local understanding: recordings as text with speakers and emotions, videos as storyboards. Optional Gemini uploads when a key is configured.',
  engine: 'auto: use Gemini if a key is set, otherwise local. local: keep the file here. gemini: upload to Google, with local fallback.',
  badEngine: 'engine must be auto, local or gemini.',
  audio: 'Turn speech into timestamped text with speakers and tone. Saves SRT subtitles. Local by default; a Gemini key enables uploads to Google. Needs ffmpeg and ffprobe.',
  video: 'Describe a video with file facts, a saved storyboard and timestamped speech. Local by default; a Gemini key enables Google uploads for scenes, screen text and actions. Needs ffmpeg and ffprobe.',
  fallback: (reason: string) => `Gemini unavailable; using local: ${reason}`,
  subtitles: (path: string) => `Subtitles saved: ${path}`,
  network: 'network request failed',
  timeout: 'request or file processing timed out',
  failed: 'Google could not process the file',
  invalid: 'Google returned an unreadable response',
  uploadUrl: 'Google returned an unsafe upload address',
  model: 'invalid Gemini model name',
  mime: 'this file type is not supported by Gemini',
  tooLarge: 'file exceeds the 2 GB upload limit',
  keyFile: 'could not read the Gemini key file',
  http: (status: number) => `HTTP ${status}`,
}

const zh: typeof en = {
  pack: '用代码制作图片、音乐和视频；在本地识别录音中的说话人和情绪、生成视频故事板。设置密钥后可选用 Gemini，并将文件上传到 Google。',
  engine: 'auto：有密钥时使用 Gemini，否则本地处理。local：文件留在本机。gemini：上传到 Google，失败时改用本地处理。',
  badEngine: 'engine 必须是 auto、local 或 gemini。',
  audio: '将语音转为带时间、说话人和语气的文字，并保存 SRT 字幕。默认本地处理；设置 Gemini 密钥即启用上传到 Google。需要 ffmpeg 和 ffprobe。',
  video: '读取视频信息、保存故事板并生成带时间的语音文字。默认本地处理；设置 Gemini 密钥即启用上传到 Google，识别场景、画面文字和动作。需要 ffmpeg 和 ffprobe。',
  fallback: (reason: string) => `Gemini 不可用，已改用本地处理：${reason}`,
  subtitles: (path: string) => `字幕已保存：${path}`,
  network: '网络请求失败',
  timeout: '请求或文件处理超时',
  failed: 'Google 无法处理此文件',
  invalid: 'Google 返回了无法读取的结果',
  uploadUrl: 'Google 返回了不安全的上传地址',
  model: 'Gemini 模型名称无效',
  mime: 'Gemini 不支持此文件类型',
  tooLarge: '文件超过 2 GB 上传限制',
  keyFile: '无法读取 Gemini 密钥文件',
  http: (status: number) => `HTTP ${status}`,
}

export const mediaMessages = (lang: string) => lang.startsWith('en') ? en : zh

// These two strings are part of the tool's public privacy contract, in both languages.
export const NO_GEMINI_KEY = 'no Gemini key configured (set geminiApiKey or ~/.config/swiftnest/gemini.key)'
export const geminiNotice = (model: string) => `analysed by Gemini ${model} (file uploaded to Google)`
