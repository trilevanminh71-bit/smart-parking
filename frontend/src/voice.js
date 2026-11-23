/* Giọng nói chỉ đường tiếng Việt (window.speechSynthesis, vi-VN). Bật/tắt lưu localStorage. */
const KEY = 'sp_voice'
let enabled = (() => { try { return localStorage.getItem(KEY) !== '0' } catch { return true } })()
const subs = new Set()

export const voiceSupported = () => typeof window !== 'undefined' && 'speechSynthesis' in window
export const voiceEnabled = () => enabled && voiceSupported()

export function setVoiceEnabled(on) {
  enabled = !!on
  try { localStorage.setItem(KEY, on ? '1' : '0') } catch { /* ignore */ }
  if (!on) try { window.speechSynthesis?.cancel() } catch { /* ignore */ }
  subs.forEach((fn) => fn(enabled))
}
export function onVoiceChange(fn) { subs.add(fn); return () => subs.delete(fn) }

function pickVoice() {
  const voices = window.speechSynthesis.getVoices() || []
  return voices.find((v) => /^vi(-|_)?VN/i.test(v.lang)) || voices.find((v) => /^vi/i.test(v.lang)) || null
}

let last = { text: '', at: 0 }
/** Đọc 1 câu. `interrupt` = ngắt câu đang đọc. Bỏ qua câu trùng lặp trong 4 giây. */
export function speak(text, { interrupt = false } = {}) {
  if (!voiceEnabled() || !text) return
  const now = Date.now()
  if (text === last.text && now - last.at < 4000) return
  last = { text, at: now }
  try {
    const synth = window.speechSynthesis
    if (interrupt) synth.cancel()
    const u = new SpeechSynthesisUtterance(text)
    u.lang = 'vi-VN'
    u.rate = 1
    const v = pickVoice()
    if (v) u.voice = v
    synth.speak(u)
  } catch { /* ignore */ }
}

/** Rung điện thoại (Android Chrome; iOS Safari bỏ qua). */
export function vibrate(pattern) {
  try { navigator.vibrate?.(pattern) } catch { /* ignore */ }
}
