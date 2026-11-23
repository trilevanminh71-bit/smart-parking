/* Dashboard Bảo vệ / Admin: ALPR Live Feed, Sức khỏe thiết bị (4 đèn), Vị trí GPS khách, Bảng điều khiển Demo 4 nút. */
import { useCallback, useEffect, useState } from 'react'
import {
  ScanLine, DoorOpen, DoorClosed, Siren, HeartPulse, Database, Wallet, Cpu, Camera, FileSpreadsheet, Loader2, RefreshCw,
  Route, CreditCard, RotateCcw, MapPin, Clapperboard, LogIn, LogOut,
} from 'lucide-react'
import { api, beep, downloadAuthed, fmtTime, useEvent, vnd } from '../api.js'
import { PlateImage } from './SimulationPanel.jsx'
import { Modal } from './ui.jsx'
import { useGeo } from '../gps.jsx'
import { useMapConfig } from '../mapStore.js'
import { densify, offset, routeToSlot } from '../geo.js'

/* ---------------- ALPR Live Feed + Barrier khẩn cấp ---------------- */
export function AlprLiveFeed({ barriers, toast }) {
  const [scans, setScans] = useState([])
  const [camera, setCamera] = useState(null)
  const [busy, setBusy] = useState('')
  const load = useCallback(() => api('/api/hardware/alpr/latest?limit=8').then((d) => { setScans(d.scans); setCamera(d.camera) }).catch(() => {}), [])
  useEffect(() => { load(); const t = setInterval(load, 10000); return () => clearInterval(t) }, [load])
  useEvent((ev) => {
    if (ev.event === 'alpr_event' && ev.data) {
      setScans((xs) => [ev.data, ...xs.filter((x) => x.id !== ev.data.id)].slice(0, 8))
      beep(ev.data.ok ? 'success' : 'warn')
    }
    if (ev.event === 'device') load()
  })
  const last = scans[0]

  const barrier = async (gate, action) => {
    const label = `${gate}-${action}`
    if (action === 'open' && !confirm(`Mở barrier cổng ${gate === 'entry' ? 'VÀO' : 'RA'} khẩn cấp? (Servo mở 5 giây, ghi vào nhật ký)`)) return
    setBusy(label)
    try {
      await api('/api/admin/barrier', { method: 'POST', body: { gate, action, auto_close: true } })
      toast(`Barrier cổng ${gate === 'entry' ? 'VÀO' : 'RA'}: ${action === 'open' ? 'ĐÃ MỞ (khẩn cấp)' : 'ĐÃ ĐÓNG'}`, action === 'open' ? 'success' : 'info')
    } catch (err) { toast(err.message, 'error') } finally { setBusy('') }
  }

  return (
    <div className="card !p-3 sm:!p-4">
      <div className="card-title"><ScanLine className="h-4 w-4" /> ALPR Live Feed
        <span className={`badge ml-auto normal-case ${camera?.online ? 'bg-emerald-500/20 text-emerald-300' : 'bg-rose-500/20 text-rose-300'}`}>
          {camera?.online ? `Webcam ${camera.camera?.camera_id} online` : 'Webcam offline'}
        </span>
      </div>
      <div className="grid gap-3 sm:grid-cols-[1fr_1.1fr]">
        <div className="flex min-h-[140px] flex-col items-center justify-center gap-2 rounded-xl border border-slate-800 bg-slate-950 p-3">
          {last ? (
            <>
              {last.image ? <img src={last.image} alt={`Ảnh cắt biển số ${last.license_plate}`} className="max-h-28 w-auto rounded-lg border border-slate-700" />
                : <PlateImage plate={last.license_plate} />}
              <div className="text-center">
                <div className="font-mono text-xl font-bold tracking-wide">{last.license_plate}</div>
                <div className="text-xs text-slate-400">Cổng {last.gate === 'IN' ? 'VÀO' : 'RA'} · {last.camera_id} · {fmtTime(last.at)}</div>
              </div>
              <div className="w-full">
                <div className="flex justify-between text-xs"><span className="text-slate-400">Độ tin cậy</span><b className={last.confidence >= 85 ? 'text-emerald-300' : last.confidence >= 60 ? 'text-amber-300' : 'text-rose-300'}>{last.confidence}%</b></div>
                <div className="mt-1 h-1.5 overflow-hidden rounded-full bg-slate-800"><div className={`h-full ${last.confidence >= 85 ? 'bg-emerald-500' : last.confidence >= 60 ? 'bg-amber-500' : 'bg-rose-500'}`} style={{ width: `${Math.min(100, last.confidence)}%` }} /></div>
              </div>
              <div className={`w-full rounded-lg px-2 py-1 text-center text-xs ${last.ok ? 'bg-emerald-500/15 text-emerald-300' : 'bg-rose-500/15 text-rose-300'}`}>{last.message}</div>
            </>
          ) : <div className="text-center text-sm text-slate-400">Chưa có lượt quét nào từ Webcam ALPR</div>}
        </div>
        <div className="space-y-2">
          {['entry', 'exit'].map((g) => {
            const open = barriers?.[g]?.state === 'OPEN'
            return (
              <div key={g} className="rounded-xl border border-slate-800 bg-slate-950/50 p-2.5">
                <div className="mb-2 flex items-center justify-between text-sm">
                  <b>Cổng {g === 'entry' ? 'VÀO' : 'RA'}</b>
                  <span className={`badge ${open ? 'bg-emerald-500/20 text-emerald-300' : 'bg-slate-700 text-slate-300'}`}>{open ? 'OPEN' : 'CLOSED'}</span>
                </div>
                <div className="grid grid-cols-2 gap-1.5">
                  <button className="btn-danger btn-sm min-h-[44px]" disabled={!!busy} onClick={() => barrier(g, 'open')}>
                    {busy === `${g}-open` ? <Loader2 className="h-4 w-4 animate-spin" /> : <Siren className="h-4 w-4" />} Mở khẩn cấp
                  </button>
                  <button className="btn-ghost btn-sm min-h-[44px]" disabled={!!busy} onClick={() => barrier(g, 'close')}>
                    {busy === `${g}-close` ? <Loader2 className="h-4 w-4 animate-spin" /> : g === 'entry' ? <DoorClosed className="h-4 w-4" /> : <DoorOpen className="h-4 w-4" />} Đóng
                  </button>
                </div>
              </div>
            )
          })}
          {scans.length > 1 && (
            <div className="max-h-32 space-y-1 overflow-y-auto text-xs">
              {scans.slice(1).map((s) => (
                <div key={s.id} className="flex items-center gap-2 rounded-lg bg-slate-950/50 px-2 py-1">
                  <span className={s.gate === 'IN' ? 'text-emerald-300' : 'text-rose-300'}>{s.gate === 'IN' ? <LogIn className="h-3.5 w-3.5" /> : <LogOut className="h-3.5 w-3.5" />}</span>
                  <span className="font-mono font-semibold">{s.license_plate}</span>
                  <span className="text-slate-400">{s.confidence}%</span>
                  <span className={`ml-auto truncate ${s.ok ? 'text-slate-300' : 'text-rose-300'}`}>{s.slot_code || (s.ok ? 'OK' : 'Từ chối')}</span>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  )
}

/* ---------------- Sức khỏe thiết bị ---------------- */
const ICONS = { database: Database, sepay: Wallet, esp32: Cpu, alpr: Camera }

export function DeviceHealth({ isAdmin, toast }) {
  const [data, setData] = useState(null)
  const [busy, setBusy] = useState(false)
  const load = useCallback(() => api('/api/system/health-devices').then(setData).catch((err) => setData({ error: err.message })), [])
  useEffect(() => { load(); const t = setInterval(load, 5000); return () => clearInterval(t) }, [load])
  useEvent((ev) => { if (ev.event === 'device') load() })
  const exportCsv = async () => {
    setBusy(true)
    try { await downloadAuthed('/api/reports/export', `bao-cao-bai-xe-${new Date().toISOString().slice(0, 10)}.csv`); toast('Đã xuất báo cáo Excel (.csv)', 'success') }
    catch (err) { toast(err.message, 'error') } finally { setBusy(false) }
  }
  return (
    <div className="card !p-3 sm:!p-4">
      <div className="card-title"><HeartPulse className="h-4 w-4" /> Sức khỏe thiết bị
        <button className="ml-auto rounded-lg p-1 text-slate-400 hover:text-white" onClick={load} aria-label="Làm mới"><RefreshCw className="h-4 w-4" /></button>
      </div>
      {data?.error ? <div className="text-sm text-rose-300">{data.error}</div> : !data ? <div className="text-sm text-slate-400">Đang kiểm tra…</div> : (
        <div className="grid gap-2 sm:grid-cols-2">
          {data.components.map((c) => {
            const I = ICONS[c.id] || Cpu
            return (
              <div key={c.id} className="flex items-start gap-2.5 rounded-xl border border-slate-800 bg-slate-950/50 p-2.5">
                <span className={`mt-1 h-3 w-3 shrink-0 rounded-full ${c.ok ? 'bg-emerald-500 shadow-[0_0_10px_rgba(16,185,129,.8)]' : 'animate-pulse bg-rose-500 shadow-[0_0_10px_rgba(244,63,94,.8)]'}`}
                  role="img" aria-label={c.ok ? 'Hoạt động' : 'Lỗi / mất kết nối'} />
                <div className="min-w-0">
                  <div className="flex items-center gap-1.5 text-sm font-semibold"><I className="h-4 w-4 text-slate-400" /> {c.name}</div>
                  <div className="break-words text-xs text-slate-400">{c.detail}</div>
                </div>
              </div>
            )
          })}
        </div>
      )}
      {data && !data.error && !data.hardware_key_configured && (
        <p className="mt-2 text-xs text-amber-300">Chưa cấu hình HARDWARE_API_KEY / SEPAY_API_KEY — ESP32 và Webcam ALPR không gửi được dữ liệu.</p>
      )}
      {isAdmin && (
        <button className="btn-primary mt-3 w-full sm:w-auto" onClick={exportCsv} disabled={busy}>
          {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <FileSpreadsheet className="h-4 w-4" />} Xuất báo cáo Excel (.csv)
        </button>
      )}
    </div>
  )
}

/* ---------------- Vị trí GPS khách (realtime) ---------------- */
export function LiveLocations() {
  const [list, setList] = useState([])
  const load = useCallback(() => api('/api/telemetry/locations').then(setList).catch(() => {}), [])
  useEffect(() => { load(); const t = setInterval(load, 5000); return () => clearInterval(t) }, [load])
  useEvent((ev) => {
    if (ev.event !== 'location' || !ev.data) return
    setList((xs) => [ev.data, ...xs.filter((x) => x.user_id !== ev.data.user_id)])
  })
  return (
    <div className="card !p-3 sm:!p-4">
      <div className="card-title"><MapPin className="h-4 w-4" /> Vị trí GPS khách ({list.filter((l) => !l.stale).length} đang chia sẻ)</div>
      {list.length === 0 ? <div className="text-sm text-slate-400">Chưa có khách nào chia sẻ vị trí</div> : (
        <div className="max-h-48 space-y-1.5 overflow-y-auto">
          {list.slice(0, 30).map((l) => (
            <div key={l.user_id} className="flex flex-wrap items-center gap-2 rounded-lg bg-slate-950/50 px-2.5 py-1.5 text-xs">
              <span className={`h-2.5 w-2.5 rounded-full ${l.stale ? 'bg-slate-500' : 'bg-emerald-500'}`} />
              <span className="font-semibold">{l.full_name || l.email}</span>
              {l.plate && <span className="font-mono text-slate-300">{l.plate}</span>}
              <span className="text-slate-400">{Number(l.lat).toFixed(5)}, {Number(l.lng).toFixed(5)}{l.accuracy ? ` ±${Math.round(l.accuracy)}m` : ''}</span>
              <span className={`ml-auto ${l.stale ? 'text-slate-500' : 'text-emerald-300'}`}>{l.stale ? 'mất tín hiệu' : `${l.age_seconds}s trước`}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

/* ---------------- Bảng điều khiển Demo & Trình diễn (Admin) ---------------- */
export function DemoPanel({ slots = [], toast, onPreview }) {
  const geo = useGeo()
  const cfg = useMapConfig()
  const [plate, setPlate] = useState('65A-123.45')
  const [gate, setGate] = useState('IN')
  const [target, setTarget] = useState('')
  const [busy, setBusy] = useState('')
  const [resetOpen, setResetOpen] = useState(false)
  const [resetText, setResetText] = useState('')
  const free = slots.filter((s) => s.status === 'available')
  const tgt = target || slots.find((s) => s.status !== 'occupied')?.code || slots[0]?.code

  const run = async (key, fn) => {
    setBusy(key)
    try { await fn() } catch (err) { toast(err.message, 'error') } finally { setBusy('') }
  }

  // 1) Lộ trình GPS mẫu: ngoài đường (~250 m) -> cổng vào -> theo lối đi nội bộ -> đúng ô
  const gpsRoute = () => run('gps', async () => {
    if (!cfg) throw new Error('Chưa tải được sơ đồ bãi')
    const route = routeToSlot(cfg, tgt)
    if (!route) throw new Error(`Không tìm được đường tới ô ${tgt} — kiểm tra lối đi trong Trình chỉnh sửa bản đồ`)
    const gateLL = [cfg.gate_in.lat, cfg.gate_in.lng]
    const away = (Number(cfg.rotation_deg) || 0) + 250 // phía trước cổng vào (bên trái sơ đồ)
    const start = offset(gateLL, 250, away)
    const bend = offset(gateLL, 60, away - 35)
    const pts = densify([start, bend, gateLL, ...route.map((p) => [p.lat, p.lng])], 2)
    onPreview?.({ slotCode: tgt, plate: 'GIẢ LẬP', demo: true, passed: false, title: `Giả lập lộ trình GPS tới ô ${tgt}` })
    geo.simulate(pts, { speedMps: 9, label: `Giả lập tới ô ${tgt}`, onDone: () => toast(`Xe giả lập đã tới ô ${tgt}`, 'success') })
    toast('Đang chạy lộ trình GPS mẫu — xem bản đồ dẫn đường đang mở', 'info')
  })

  // 2) Webcam quét biển số (luồng ALPR thật: Servo/LCD, gate_opened, bản đồ chi tiết)
  const alpr = () => run('alpr', async () => {
    const r = await api('/api/admin/demo/alpr', { method: 'POST', body: { plate, gate } })
    toast(r.message + (r.duplicate ? ' (trùng lần quét trước < 15 giây)' : ''), r.ok ? 'success' : 'error')
    if (r.ok && gate === 'IN' && r.slot_code) onPreview?.({ slotCode: r.slot_code, plate: r.license_plate, sessionId: r.session_id, gateOpened: true, passed: true, demo: true,
      title: `Barrier mở — xe ${r.license_plate} vào ô ${r.slot_code}` })
  })

  // 3) SePay báo tiền vào
  const sepay = () => run('sepay', async () => {
    const r = await api('/api/admin/demo/sepay', { method: 'POST', body: {} })
    const msg = r.kind === 'deposit' ? `Giả lập SePay: đã duyệt cọc vé ${r.reservation.ticket_code} (ô ${r.reservation.slot_code})`
      : r.kind === 'exit_paid' ? `Giả lập SePay: xe ${r.session.license_plate} đã trả ${vnd(r.session.amount_due)} — mở barrier ra`
        : `Giả lập SePay: xe ${r.session.license_plate} đã thanh toán trước`
    toast(msg, 'success')
  })

  // 4) Reset
  const reset = () => run('reset', async () => {
    const r = await api('/api/admin/demo/reset', { method: 'POST', body: { confirm: resetText } })
    setResetOpen(false); setResetText('')
    geo?.stopSim()
    toast(r.message, 'success')
  })

  const Btn = ({ k, icon: I, title, desc, onClick, tone }) => (
    <button onClick={onClick} disabled={!!busy}
      className={`flex min-h-[96px] flex-col items-start gap-1 rounded-2xl border p-3 text-left transition disabled:opacity-60 ${tone}`}>
      <span className="flex items-center gap-2 font-semibold">{busy === k ? <Loader2 className="h-5 w-5 animate-spin" /> : <I className="h-5 w-5" />} {title}</span>
      <span className="text-xs opacity-80">{desc}</span>
    </button>
  )

  return (
    <div className="space-y-4">
      <div className="card !p-3 sm:!p-4">
        <div className="card-title"><Clapperboard className="h-4 w-4" /> Bảng điều khiển Demo & Trình diễn</div>
        <div className="mb-3 grid gap-2 sm:grid-cols-3">
          <div>
            <label className="label" htmlFor="demo-plate">Biển số test</label>
            <input id="demo-plate" className="input font-mono uppercase" value={plate} onChange={(e) => setPlate(e.target.value)} />
          </div>
          <div>
            <label className="label" htmlFor="demo-gate">Cổng</label>
            <select id="demo-gate" className="input" value={gate} onChange={(e) => setGate(e.target.value)}>
              <option value="IN">Cổng VÀO</option><option value="OUT">Cổng RA</option>
            </select>
          </div>
          <div>
            <label className="label" htmlFor="demo-slot">Ô đích (lộ trình GPS)</label>
            <select id="demo-slot" className="input" value={tgt || ''} onChange={(e) => setTarget(e.target.value)}>
              {slots.map((s) => <option key={s.code} value={s.code}>{s.code} · {s.status === 'available' ? 'trống' : s.status === 'occupied' ? 'có xe' : 'đã giữ'}</option>)}
            </select>
          </div>
        </div>
        <div className="grid gap-2 sm:grid-cols-2">
          <Btn k="gps" icon={Route} title="1. Giả lập lộ trình GPS mẫu" onClick={gpsRoute}
            desc="Xe chạy mượt từ ngoài đường vào cổng rồi theo lối đi tới đúng ô; bản đồ dẫn đường + giọng nói tự chạy." tone="border-sky-500/40 bg-sky-500/10 text-sky-200 hover:bg-sky-500/20" />
          <Btn k="alpr" icon={ScanLine} title="2. Giả lập Webcam quét biển số" onClick={alpr}
            desc="Chạy đúng luồng ALPR thật: vào/ra cổng, lệnh Servo 5 giây + LCD cho ESP32, tự mở bản đồ chi tiết." tone="border-emerald-500/40 bg-emerald-500/10 text-emerald-200 hover:bg-emerald-500/20" />
          <Btn k="sepay" icon={CreditCard} title="3. Giả lập SePay thanh toán thành công" onClick={sepay}
            desc="Tự duyệt đơn chờ cọc cũ nhất, hoặc phí của xe đang chờ ở cổng ra. Không tính vào doanh thu." tone="border-violet-500/40 bg-violet-500/10 text-violet-200 hover:bg-violet-500/20" />
          <Btn k="reset" icon={RotateCcw} title="4. Reset toàn bộ bãi xe" onClick={() => setResetOpen(true)}
            desc="Đưa toàn bộ ô về trống, đóng phiên đang mở. Giữ lịch sử doanh thu & tài khoản." tone="border-rose-500/40 bg-rose-500/10 text-rose-200 hover:bg-rose-500/20" />
        </div>
        <p className="mt-2 text-xs text-slate-400">Còn {free.length}/{slots.length} ô trống. {geo?.sim ? `Đang chạy: ${geo.sim.label}.` : ''}</p>
      </div>

      <Modal open={resetOpen} onClose={() => setResetOpen(false)} title="Reset toàn bộ bãi xe" icon={RotateCcw}>
        <p className="text-sm text-slate-300">Toàn bộ ô về <b>Trống</b>; đơn đang giữ chỗ bị hủy; xe đang đỗ được kết thúc 0đ (ghi "Đã reset (Demo)").
          Lịch sử doanh thu, nhật ký thanh toán và tài khoản <b>được giữ nguyên</b>.</p>
        <label className="label mt-3" htmlFor="reset-confirm">Gõ RESET để xác nhận</label>
        <input id="reset-confirm" className="input font-mono" value={resetText} onChange={(e) => setResetText(e.target.value)} autoComplete="off" />
        <div className="mt-3 flex justify-end gap-2">
          <button className="btn-ghost" onClick={() => setResetOpen(false)}>Hủy</button>
          <button className="btn-danger" disabled={resetText.trim().toUpperCase() !== 'RESET' || !!busy} onClick={reset}>
            {busy === 'reset' ? <Loader2 className="h-4 w-4 animate-spin" /> : <RotateCcw className="h-4 w-4" />} Reset bãi xe
          </button>
        </div>
      </Modal>
    </div>
  )
}
