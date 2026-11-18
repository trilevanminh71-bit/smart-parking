import { useEffect, useRef, useState } from 'react'

/* ---------------- Đăng nhập (token lưu localStorage để F5 không mất) ---------------- */
const TOKEN_KEY = 'sp_token'
const USER_KEY = 'sp_user'

export function loadAuth() {
  try {
    const token = localStorage.getItem(TOKEN_KEY)
    const user = JSON.parse(localStorage.getItem(USER_KEY) || 'null')
    return token && user ? { token, user } : null
  } catch { return null }
}
export function saveAuth(auth) {
  try {
    if (auth) {
      localStorage.setItem(TOKEN_KEY, auth.token)
      localStorage.setItem(USER_KEY, JSON.stringify(auth.user))
    } else {
      localStorage.removeItem(TOKEN_KEY)
      localStorage.removeItem(USER_KEY)
    }
  } catch { /* ignore */ }
}
/* ---------------- Danh sách tài khoản đã đăng nhập trên trình duyệt (chuyển nhanh) ---------------- */
const ACCOUNTS_KEY = 'sp_accounts'

/** Hạn của token (giây, epoch) đọc từ phần payload; 0 nếu không đọc được. */
export function tokenExp(token) {
  try {
    const b64 = token.split('.')[0].replace(/-/g, '+').replace(/_/g, '/')
    return JSON.parse(atob(b64 + '='.repeat((4 - (b64.length % 4)) % 4))).exp || 0
  } catch { return 0 }
}
export const tokenValid = (token) => !!token && tokenExp(token) * 1000 > Date.now()

/** [{ email, full_name, role, token, user, last_used }] — chỉ giữ token còn hạn. */
export function loadAccounts() {
  try {
    const list = JSON.parse(localStorage.getItem(ACCOUNTS_KEY) || '[]')
    return list.map((a) => (tokenValid(a.token) ? a : { ...a, token: '' }))
  } catch { return [] }
}
function writeAccounts(list) {
  try { localStorage.setItem(ACCOUNTS_KEY, JSON.stringify(list.slice(0, 8))) } catch { /* ignore */ }
}
/** Thêm / cập nhật tài khoản vào danh sách (đưa lên đầu). */
export function rememberAccount({ token, user }) {
  const rest = loadAccounts().filter((a) => a.email !== user.email)
  writeAccounts([{ email: user.email, full_name: user.full_name, role: user.role, token, user, last_used: Date.now() }, ...rest])
}
export function forgetAccount(email) {
  writeAccounts(loadAccounts().filter((a) => a.email !== email))
}
/** Token bị vô hiệu -> giữ tài khoản trong danh sách nhưng bỏ token (phải nhập lại mật khẩu). */
export function expireAccount(email) {
  writeAccounts(loadAccounts().map((a) => (a.email === email ? { ...a, token: '' } : a)))
}

const getToken = () => { try { return localStorage.getItem(TOKEN_KEY) || '' } catch { return '' } }

/** Gọi API backend. Ném Error với thông báo tiếng Việt từ backend nếu lỗi. */
export async function api(path, { method = 'GET', body, form } = {}) {
  const headers = {}
  const token = getToken()
  if (token) headers.Authorization = `Bearer ${token}`
  let payload
  if (form) payload = form
  else if (body !== undefined) {
    headers['Content-Type'] = 'application/json'
    payload = JSON.stringify(body)
  }
  let res
  try {
    res = await fetch(path, { method, headers, body: payload })
  } catch {
    throw new Error('Không kết nối được backend (cổng 8000). Hãy kiểm tra server đã chạy chưa.')
  }
  const data = await res.json().catch(() => ({}))
  if (!res.ok) {
    let msg = data.detail
    if (Array.isArray(msg)) msg = msg.map((d) => `${d.loc?.slice(-1)[0]}: ${d.msg}`).join('; ')
    if (res.status === 401 && token && !path.startsWith('/api/auth/login')) {
      window.dispatchEvent(new Event('sp-logout')) // token hết hạn / bị vô hiệu
    }
    const err = new Error(msg || `Lỗi ${res.status}`)
    err.status = res.status
    throw err
  }
  return data
}

/** Kết nối WebSocket /ws, tự kết nối lại. Gọi onEvent(msg) mỗi khi có sự kiện. */
export function useRealtime(onEvent) {
  const [connected, setConnected] = useState(false)
  const cb = useRef(onEvent)
  cb.current = onEvent

  useEffect(() => {
    let ws, retry, ping, closed = false
    const connect = () => {
      const proto = location.protocol === 'https:' ? 'wss' : 'ws'
      ws = new WebSocket(`${proto}://${location.host}/ws`)
      ws.onopen = () => {
        setConnected(true)
        ping = setInterval(() => ws.readyState === 1 && ws.send('ping'), 20000)
      }
      ws.onmessage = (e) => {
        try {
          const msg = JSON.parse(e.data)
          if (msg.event !== 'pong') cb.current?.(msg)
        } catch { /* ignore */ }
      }
      ws.onclose = () => {
        setConnected(false)
        clearInterval(ping)
        if (!closed) retry = setTimeout(connect, 2000)
      }
      ws.onerror = () => ws.close()
    }
    connect()
    return () => {
      closed = true
      clearTimeout(retry)
      clearInterval(ping)
      ws?.close()
    }
  }, [])

  return connected
}

/* ---------------- Bus sự kiện realtime ----------------
 * Mỗi tin WebSocket được chuyển TỪNG CÁI tới mọi nơi đang nghe (không qua 1 state `lastEvent` duy nhất —
 * khi backend gửi liền nhiều sự kiện, React gộp cập nhật state và chỉ còn thấy sự kiện cuối cùng). */
const listeners = new Set()
export function emitEvent(msg) {
  listeners.forEach((fn) => { try { fn(msg) } catch (e) { console.error('Lỗi xử lý sự kiện', msg?.event, e) } })
}
/** Lắng nghe mọi sự kiện realtime; `handler` luôn thấy state mới nhất. */
export function useEvent(handler) {
  const ref = useRef(handler)
  ref.current = handler
  useEffect(() => {
    const fn = (m) => ref.current(m)
    listeners.add(fn)
    return () => listeners.delete(fn)
  }, [])
}

/** Trả về thời gian hiện tại, cập nhật mỗi `ms`. */
export function useNow(ms = 1000) {
  const [now, setNow] = useState(Date.now())
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), ms)
    return () => clearInterval(t)
  }, [ms])
  return now
}

/* ---------------- Âm thanh 'bíp' bằng Web Audio API (không cần file mp3) ---------------- */
let audioCtx
function ctx() {
  const AC = window.AudioContext || window.webkitAudioContext
  if (!AC) return null
  if (!audioCtx) audioCtx = new AC()
  return audioCtx
}
// Trình duyệt chỉ cho phát âm thanh sau khi người dùng tương tác -> mở khóa ở lần chạm đầu tiên
if (typeof window !== 'undefined') {
  const unlock = () => { try { ctx()?.resume() } catch { /* ignore */ } }
  window.addEventListener('pointerdown', unlock, { once: true })
  window.addEventListener('keydown', unlock, { once: true })
}

/** Phát tiếng bíp. kind: 'info' | 'success' | 'warn' */
export function beep(kind = 'info') {
  try {
    const ac = ctx()
    if (!ac) return
    if (ac.state === 'suspended') ac.resume()
    const tones = { info: [880], success: [660, 990], warn: [520, 520] }[kind] || [880]
    tones.forEach((freq, i) => {
      const t0 = ac.currentTime + i * 0.16
      const osc = ac.createOscillator()
      const gain = ac.createGain()
      osc.type = 'sine'
      osc.frequency.value = freq
      gain.gain.setValueAtTime(0.0001, t0)
      gain.gain.exponentialRampToValueAtTime(0.18, t0 + 0.015)
      gain.gain.exponentialRampToValueAtTime(0.0001, t0 + 0.13)
      osc.connect(gain).connect(ac.destination)
      osc.start(t0)
      osc.stop(t0 + 0.14)
    })
  } catch { /* ignore */ }
}

/* ---------------- VietQR MB Bank ---------------- */
export const BANK = { id: 'MB', name: 'MB Bank', account: '366730042011', holder: 'LE VAN MINH TRI' }

/** Nội dung CK: chỉ chữ/số/khoảng trắng, tối đa 50 ký tự (yêu cầu của ngân hàng). */
export const transferNote = (s) =>
  s.normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/đ/gi, 'D').replace(/[^A-Za-z0-9 ]/g, '').toUpperCase().slice(0, 50)

export const vietQrUrl = (amount, note) =>
  `https://img.vietqr.io/image/${BANK.id}-${BANK.account}-compact2.png?amount=${Math.round(amount)}` +
  `&addInfo=${encodeURIComponent(transferNote(note))}&accountName=${encodeURIComponent(BANK.holder)}`

/** Tải file từ API cần đăng nhập (gửi kèm token) rồi lưu về máy. */
export async function downloadAuthed(path, filename) {
  const res = await fetch(path, { headers: { Authorization: `Bearer ${getToken()}` } })
  if (!res.ok) {
    const d = await res.json().catch(() => ({}))
    throw new Error(d.detail || `Lỗi ${res.status}`)
  }
  saveBlob(await res.blob(), filename)
}
export function saveBlob(blob, filename) {
  const url = URL.createObjectURL(blob)
  const a = Object.assign(document.createElement('a'), { href: url, download: filename })
  document.body.appendChild(a)
  a.click()
  a.remove()
  setTimeout(() => URL.revokeObjectURL(url), 4000)
}
/** Mở ảnh từ API cần đăng nhập -> object URL để hiển thị trong <img>. */
export async function fetchBlobUrl(path) {
  const res = await fetch(path, { headers: { Authorization: `Bearer ${getToken()}` } })
  if (!res.ok) throw new Error(`Lỗi ${res.status}`)
  return URL.createObjectURL(await res.blob())
}

/* ---------------- Định dạng ---------------- */
export const vnd = (n) => `${Number(n || 0).toLocaleString('vi-VN')}đ`

export const fmtTime = (iso) =>
  iso ? new Date(iso).toLocaleString('vi-VN', { hour: '2-digit', minute: '2-digit', second: '2-digit', day: '2-digit', month: '2-digit' }) : '—'

export const fmtDuration = (sec) => {
  sec = Math.max(0, Math.floor(sec))
  const h = Math.floor(sec / 3600)
  const m = Math.floor((sec % 3600) / 60)
  const s = sec % 60
  const pad = (x) => String(x).padStart(2, '0')
  return h ? `${h}:${pad(m)}:${pad(s)}` : `${pad(m)}:${pad(s)}`
}

export const FLOOR_LETTER = { 1: 'A', 2: 'B', 3: 'C' }

export const STATUS = {
  available: { label: 'Trống', dot: 'bg-emerald-400', cls: 'border-emerald-500/60 bg-emerald-500/15 text-emerald-300 hover:bg-emerald-500/25' },
  reserved: { label: 'Đã đặt cọc', dot: 'bg-amber-400', cls: 'border-amber-500/60 bg-amber-500/15 text-amber-300' },
  pending_payment: { label: 'Chờ chuyển khoản', short: 'Chờ CK', dot: 'bg-orange-400', cls: 'border-orange-500/60 bg-orange-500/15 text-orange-300' },
  // Có xe: xám xanh đậm #475569, viền #64748b, chữ/icon sáng — dịu mắt, khác hẳn xanh lá / vàng / cam
  occupied: { label: 'Có xe', dot: 'bg-[#64748b]', cls: '!border-solid border-[#64748b] bg-[#475569] text-slate-50' },
}

export const RES_STATUS = {
  active: { label: 'Đang giữ chỗ', cls: 'bg-amber-500/20 text-amber-300' },
  pending_payment: { label: 'Chờ chuyển khoản', cls: 'bg-orange-500/20 text-orange-300' },
  checked_in: { label: 'Đã vào bãi', cls: 'bg-emerald-500/20 text-emerald-300' },
  expired: { label: 'Hết hạn', cls: 'bg-rose-500/20 text-rose-300' },
  cancelled: { label: 'Đã hủy', cls: 'bg-slate-700 text-slate-300' },
}

/** Hình thức thanh toán lượt gửi xe. */
export const PAY_METHOD = {
  cash: { label: 'Tiền mặt', cls: 'bg-amber-500/20 text-amber-300' },
  online_qr: { label: 'Online QR', cls: 'bg-violet-500/20 text-violet-300' },
  admin_free: { label: 'Miễn phí (Admin)', cls: 'bg-emerald-500/20 text-emerald-300' },
  deposit: { label: 'Đã trừ đủ bằng cọc', cls: 'bg-slate-700 text-slate-200' },
}
export const payMethod = (m) => PAY_METHOD[m] || { label: m || '—', cls: 'bg-slate-700 text-slate-300' }
export const isFreeRes = (r) => r?.deposit_mode === 'admin_free'

/** Nhãn tiếng Việt cho lịch sử hoạt động tài khoản. */
export const ACTIVITY = {
  register: { label: 'Tạo tài khoản', tone: 'text-sky-300' },
  login: { label: 'Đăng nhập', tone: 'text-sky-300' },
  login_failed: { label: 'Đăng nhập sai', tone: 'text-rose-300' },
  change_password: { label: 'Đổi mật khẩu', tone: 'text-amber-300' },
  reservation_deposit: { label: 'Đặt chỗ có cọc', tone: 'text-amber-300' },
  reservation_pending: { label: 'Đặt chỗ — chờ chuyển khoản', tone: 'text-orange-300' },
  reservation_free: { label: 'Đặt chỗ miễn phí (Admin)', tone: 'text-emerald-300' },
  payment_issue: { label: 'Giao dịch cần đối soát', tone: 'text-rose-300' },
  receipt_upload: { label: 'Gửi ảnh biên lai', tone: 'text-sky-300' },
  payment_reconcile: { label: 'Duyệt bù (đối soát)', tone: 'text-emerald-300' },
  payment_refund: { label: 'Đánh dấu hoàn tiền', tone: 'text-amber-300' },
  reservation_cancel: { label: 'Hủy đặt chỗ', tone: 'text-slate-300' },
  reservation_expired: { label: 'Hết hạn giữ chỗ', tone: 'text-rose-300' },
  deposit_approved: { label: 'Cọc được duyệt', tone: 'text-emerald-300' },
  deposit_approve: { label: 'Duyệt cọc', tone: 'text-emerald-300' },
  check_in: { label: 'Xe vào', tone: 'text-emerald-300' },
  check_out: { label: 'Xe ra', tone: 'text-sky-300' },
  prepay: { label: 'Thanh toán trước khi ra cổng', tone: 'text-emerald-300' },
  settings_update: { label: 'Đổi cài đặt', tone: 'text-amber-300' },
  user_role: { label: 'Đổi quyền', tone: 'text-amber-300' },
  user_create: { label: 'Tạo Admin', tone: 'text-amber-300' },
  user_delete: { label: 'Xóa tài khoản', tone: 'text-rose-300' },
}
// Bản ghi cũ của hình thức "đặt chỗ không cọc" (đã bỏ) — chỉ để hiển thị lịch sử, không có trong bộ lọc
const LEGACY_ACTIVITY = {
  reservation_soft: { label: 'Đặt chỗ (hình thức cũ)', tone: 'text-slate-400' },
  reservation_upgraded: { label: 'Đặt chỗ (hình thức cũ)', tone: 'text-slate-400' },
  reservation_bumped: { label: 'Đặt chỗ (hình thức cũ)', tone: 'text-slate-400' },
}
export const activityLabel = (a) => ACTIVITY[a] || LEGACY_ACTIVITY[a] || { label: a, tone: 'text-slate-300' }
