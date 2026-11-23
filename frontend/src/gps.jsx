/* GPS: tự bật `watchPosition` (enableHighAccuracy) khi mở app đã đăng nhập, theo dõi quyền truy cập vị trí,
 * nút bật/tắt thủ công, tự chia sẻ vị trí (POST /api/telemetry/location, ~4 giây/lần) cho Bảo vệ/Admin,
 * và chế độ "Giả lập lộ trình GPS" (Bảng Demo) thay vị trí thật bằng một lộ trình mẫu chạy mượt. */
import { createContext, useCallback, useContext, useEffect, useRef, useState } from 'react'
import { api } from './api.js'

const KEY = 'sp_gps'
const SEND_EVERY_MS = 4000
const GeoCtx = createContext(null)
export const useGeo = () => useContext(GeoCtx)

const readOn = () => { try { return localStorage.getItem(KEY) !== '0' } catch { return true } }

export function GeoProvider({ user, children }) {
  const [enabled, setEnabled] = useState(readOn)
  // status: 'off' | 'unsupported' | 'prompt' | 'locating' | 'on' | 'denied' | 'error'
  const [status, setStatus] = useState('off')
  const [permission, setPermission] = useState('unknown')
  const [position, setPosition] = useState(null) // { lat, lng, accuracy, speed, heading, ts, simulated }
  const [error, setError] = useState('')
  const [sim, setSim] = useState(null) // { label }
  const lastSent = useRef(0)
  const simTimer = useRef(null)
  const shareRef = useRef(false)
  shareRef.current = !!user && user.role === 'customer'

  const send = useCallback((p) => {
    const now = Date.now()
    if (now - lastSent.current < SEND_EVERY_MS) return
    lastSent.current = now
    api('/api/telemetry/location', {
      method: 'POST',
      body: { lat: p.lat, lng: p.lng, accuracy: p.accuracy ?? null, speed: p.speed ?? null, heading: p.heading ?? null },
    }).catch(() => {})
  }, [])

  // Theo dõi quyền truy cập vị trí (Chrome/Edge/Firefox; Safari cũ không có Permissions API)
  useEffect(() => {
    let perm
    navigator.permissions?.query({ name: 'geolocation' }).then((p) => {
      perm = p
      setPermission(p.state)
      p.onchange = () => setPermission(p.state)
    }).catch(() => {})
    return () => { if (perm) perm.onchange = null }
  }, [])

  // Tự khởi chạy watchPosition khi đã đăng nhập và GPS đang bật
  useEffect(() => {
    if (!user || !enabled || sim) { if (!sim) setStatus('off'); return }
    if (!('geolocation' in navigator)) { setStatus('unsupported'); return }
    setStatus('locating')
    setError('')
    const id = navigator.geolocation.watchPosition(
      (pos) => {
        const c = pos.coords
        const p = { lat: c.latitude, lng: c.longitude, accuracy: c.accuracy, speed: c.speed ?? null,
          heading: Number.isFinite(c.heading) ? c.heading : null, ts: pos.timestamp || Date.now(), simulated: false }
        setPosition(p)
        setStatus('on')
        if (shareRef.current) send(p)
      },
      (err) => {
        if (err.code === 1) { setStatus('denied'); setError('Bạn đã chặn quyền truy cập vị trí — bật lại trong cài đặt trình duyệt (biểu tượng ổ khóa cạnh thanh địa chỉ).') }
        else if (err.code === 3) { setStatus((s) => (s === 'on' ? 'on' : 'locating')); setError('Đang chờ tín hiệu GPS…') }
        else { setStatus('error'); setError('Không lấy được vị trí — kiểm tra GPS / dịch vụ định vị của điện thoại.') }
      },
      { enableHighAccuracy: true, maximumAge: 2000, timeout: 20000 },
    )
    return () => navigator.geolocation.clearWatch(id)
  }, [user, enabled, sim, send])

  const toggle = useCallback((on) => {
    const next = typeof on === 'boolean' ? on : !enabled
    try { localStorage.setItem(KEY, next ? '1' : '0') } catch { /* ignore */ }
    setEnabled(next)
    if (!next) { setPosition((p) => (p?.simulated ? p : null)); setStatus('off') }
  }, [enabled])

  /** Giả lập lộ trình: chạy qua danh sách [lat, lng] với tốc độ `speedMps`, gọi onDone khi tới nơi. */
  const simulate = useCallback((latlngs, { speedMps = 6, label = 'Giả lập lộ trình', onDone } = {}) => {
    clearInterval(simTimer.current)
    if (!latlngs?.length) return
    let i = 0
    const stepMs = 250
    setSim({ label })
    setStatus('on')
    const tick = () => {
      const p = latlngs[Math.min(i, latlngs.length - 1)]
      const q = latlngs[Math.min(i + 1, latlngs.length - 1)]
      const heading = (Math.atan2((q[1] - p[1]) * Math.cos((p[0] * Math.PI) / 180), q[0] - p[0]) * 180 / Math.PI + 360) % 360
      const pos = { lat: p[0], lng: p[1], accuracy: 3, speed: speedMps, heading, ts: Date.now(), simulated: true }
      setPosition(pos)
      if (shareRef.current) send(pos)
      i += Math.max(1, Math.round((speedMps * stepMs) / 1000 / 2)) // điểm cách nhau ~2 m
      if (i >= latlngs.length) {
        clearInterval(simTimer.current)
        setPosition({ ...pos, lat: latlngs[latlngs.length - 1][0], lng: latlngs[latlngs.length - 1][1], speed: 0 })
        setTimeout(() => setSim(null), 4000)
        onDone?.()
      }
    }
    tick()
    simTimer.current = setInterval(tick, stepMs)
  }, [send])

  const stopSim = useCallback(() => { clearInterval(simTimer.current); setSim(null); setPosition(null) }, [])
  useEffect(() => () => clearInterval(simTimer.current), [])

  return (
    <GeoCtx.Provider value={{ enabled, status, permission, position, error, toggle, simulate, stopSim, sim }}>
      {children}
    </GeoCtx.Provider>
  )
}

/** Lấy vị trí hiện tại 1 lần (Trình chỉnh sửa bản đồ: "Lấy tọa độ GPS hiện tại của tôi"). */
export function getCurrentPosition() {
  return new Promise((resolve, reject) => {
    if (!('geolocation' in navigator)) return reject(new Error('Trình duyệt không hỗ trợ GPS'))
    navigator.geolocation.getCurrentPosition(
      (p) => resolve({ lat: p.coords.latitude, lng: p.coords.longitude, accuracy: p.coords.accuracy }),
      (e) => reject(new Error(e.code === 1 ? 'Bạn đã chặn quyền truy cập vị trí' : 'Không lấy được vị trí GPS — thử lại ngoài trời')),
      { enableHighAccuracy: true, timeout: 20000, maximumAge: 0 },
    )
  })
}
