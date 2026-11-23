/* Dẫn đường 2 chặng (toàn màn hình, Mobile PWA & Web):
 *  - Chặng 1: GPS điện thoại ngoài đường -> Cổng vào (khoảng cách, hướng, mở Google Maps chỉ đường xe hơi).
 *  - Chặng 2: tự chuyển khi vào bán kính 15 m quanh cổng hoặc khi cổng mở cho xe vào: vẽ đường theo lối đi nội bộ tới đúng ô.
 *  - Giọng nói tiếng Việt (vi-VN) bật/tắt; thanh thao tác tại ô: Xác nhận đã vào ô / Đổi sang ô trống khác;
 *  - Cảnh báo đỗ nhầm ô: rung, nháy đỏ ô sai, 2 lựa chọn Đổi sang ô vừa vào / Giữ ô cũ & chỉ đường về. */
import { useEffect, useMemo, useRef, useState } from 'react'
import {
  X, Navigation, Volume2, VolumeX, MapPin, CheckCircle2, ArrowRightLeft, Loader2, ExternalLink, AlertTriangle, LocateFixed, LocateOff, Undo2,
} from 'lucide-react'
import DualMap from './DualMap.jsx'
import SlotPicker from './SlotPicker.jsx'
import { useMapConfig } from '../mapStore.js'
import { useGeo } from '../gps.jsx'
import { api } from '../api.js'
import { bearing, compass, distance, fmtMeters, fromLatLng, instructions, nearestWp, routeLength, routeToSlot } from '../geo.js'
import { onVoiceChange, setVoiceEnabled, speak, vibrate, voiceEnabled, voiceSupported } from '../voice.js'

const GATE_RADIUS_M = 15

export default function NavigationPanel({ nav, slots = [], onClose, onUpdate, toast }) {
  const cfg = useMapConfig()
  const geo = useGeo()
  const user = geo?.position
  const [voice, setVoice] = useState(voiceEnabled())
  const [picker, setPicker] = useState(false)
  const [busy, setBusy] = useState('')
  const [confirmed, setConfirmed] = useState(!!nav?.confirmed)
  const [routeFrom, setRouteFrom] = useState(null)
  const [wrong, setWrong] = useState(nav?.wrongAlert || null)
  const [floorView, setFloorView] = useState(null)
  const spoken = useRef({ stage: 0, idx: -1, dist: Infinity, arrived: false })
  useEffect(() => onVoiceChange(setVoice), [])
  useEffect(() => { setWrong(nav?.wrongAlert || null); if (nav?.wrongAlert) setRouteFrom(null) }, [nav?.wrongAlert])
  useEffect(() => { setConfirmed(!!nav?.confirmed) }, [nav?.slotCode, nav?.confirmed])

  const slotCode = nav?.slotCode
  const slot = cfg?.slots.find((s) => s.slot_code === slotCode)
  const route = useMemo(() => (cfg && slotCode ? routeToSlot(cfg, slotCode, routeFrom) : null), [cfg, slotCode, routeFrom])
  const steps = useMemo(() => (cfg && route ? instructions(cfg, route, slotCode) : []), [cfg, route, slotCode])
  const gateLL = cfg ? [cfg.gate_in.lat, cfg.gate_in.lng] : null
  const dGate = user && gateLL ? distance(user, gateLL) : null
  const dSlot = user && slot ? distance(user, [slot.lat, slot.lng]) : null
  const stage = nav?.gateOpened || nav?.passed || routeFrom || (dGate !== null && dGate <= GATE_RADIUS_M) || dGate === null ? 2 : 1
  const floor = floorView ?? slot?.floor ?? 1
  const arrived = stage === 2 && dSlot !== null && dSlot <= (slot?.gps_radius_m || 2.5) + Math.min(user?.accuracy || 0, 8)

  // Chỉ số bước hiện tại theo vị trí GPS (gần điểm nào của tuyến nhất)
  const curIdx = useMemo(() => {
    if (!user || !route || stage !== 2 || !cfg) return 0
    const [ux, uy] = fromLatLng(cfg, user.lat, user.lng)
    let best = 0, bd = Infinity
    route.forEach((p, i) => { const d = Math.hypot(p.x - ux, p.y - uy); if (d < bd) { bd = d; best = i } })
    return bd < 12 ? best : 0
  }, [user, route, stage, cfg])
  const nextStep = steps.find((s) => s.at > curIdx) || steps[steps.length - 1]

  // ------- Giọng nói
  useEffect(() => {
    if (!nav || !cfg || !slot) return
    const sp = spoken.current
    if (stage === 1 && dGate !== null) {
      if (sp.stage !== 1) {
        sp.stage = 1
        speak(`Bắt đầu dẫn đường tới cổng vào bãi. Còn ${fmtMeters(dGate)}, đi về hướng ${compass(bearing(user, gateLL))}.`, { interrupt: true })
        sp.dist = dGate
      } else {
        const marks = [500, 200, 100, 50, 30]
        const crossed = marks.find((m) => sp.dist > m && dGate <= m)
        if (crossed) speak(`Còn ${crossed} mét tới cổng vào.`)
        sp.dist = dGate
      }
    }
    if (stage === 2 && sp.stage !== 2) {
      sp.stage = 2
      sp.idx = -1
      const head = nav.gateOpened ? 'Barrier đã mở. ' : 'Bạn đã tới cổng vào. '
      speak(`${head}Mời vào ô ${slotCode}, Tầng ${slot.floor}. ${steps[0]?.text || ''}`, { interrupt: true })
    }
    if (stage === 2 && nextStep && user && nextStep.at !== sp.idx && curIdx > 0) {
      sp.idx = nextStep.at
      speak(nextStep.text)
    }
    if (arrived && !sp.arrived) {
      sp.arrived = true
      speak(`Bạn đã tới ô ${slotCode}. Đỗ xe xong, bấm Xác nhận đã vào ô.`, { interrupt: true })
    }
  }, [nav, cfg, slot, stage, dGate, nextStep, curIdx, arrived, slotCode, steps, user, gateLL])

  // Đổi ô / tuyến -> đọc lại hướng dẫn
  useEffect(() => { spoken.current = { stage: 0, idx: -1, dist: Infinity, arrived: false } }, [slotCode, routeFrom])
  useEffect(() => () => { try { window.speechSynthesis?.cancel() } catch { /* ignore */ } }, [])

  if (!nav) return null

  const endpoint = (action) => (nav.reservationId ? `/api/reservations/${nav.reservationId}/${action}` : `/api/parking/sessions/${nav.sessionId}/${action}`)
  const canAct = !nav.demo && (nav.reservationId || nav.sessionId)

  const confirmPark = async () => {
    setBusy('confirm')
    try {
      await api(endpoint('confirm-parked'), { method: 'POST' })
      vibrate(80)
      setConfirmed(true)
      speak(`Đã xác nhận xe đỗ tại ô ${slotCode}. Chúc quý khách một ngày tốt lành.`, { interrupt: true })
      toast?.(`Đã xác nhận xe đỗ tại ô ${slotCode}`, 'success')
      onUpdate?.({ confirmed: true })
    } catch (err) { toast?.(err.message, 'error') } finally { setBusy('') }
  }

  const switchTo = async (code, floorNo) => {
    setBusy(code)
    try {
      const r = await api(endpoint('switch-slot'), { method: 'POST', body: { new_slot_code: code, floor: floorNo } })
      vibrate([60, 40, 60])
      setPicker(false)
      setWrong(null)
      setRouteFrom(null)
      setFloorView(null)
      toast?.(`Đã đổi sang ô ${r.new_slot_code}`, 'success')
      speak(`Đã đổi sang ô ${r.new_slot_code}, Tầng ${r.floor}.`, { interrupt: true })
      onUpdate?.({ slotCode: r.new_slot_code, wrongAlert: null, confirmed: false })
    } catch (err) { toast?.(err.message, 'error') } finally { setBusy('') }
  }

  const keepOld = () => {
    const det = cfg?.slots.find((s) => s.slot_code === wrong.detected_slot_code)
    setRouteFrom(det ? nearestWp(cfg, det.floor, det.x, det.y) : null)
    setFloorView(null)
    setWrong(null)
    onUpdate?.({ wrongAlert: null, flash: wrong.detected_slot_code })
    speak(`Giữ ô cũ. Mời quay lại ô ${wrong.assigned_slot_code}, Tầng ${wrong.assigned_floor}.`, { interrupt: true })
  }

  const outside = stage === 1 && user && gateLL ? [[user.lat, user.lng], gateLL] : null
  const gmaps = gateLL ? `https://www.google.com/maps/dir/?api=1&destination=${gateLL[0]},${gateLL[1]}&travelmode=driving` : '#'
  const total = route ? routeLength(cfg, route) : 0

  return (
    <div className="fixed inset-0 z-[55] flex flex-col bg-slate-950/95 backdrop-blur-sm" role="dialog" aria-modal="true" aria-label="Dẫn đường tới ô đỗ">
      <div className="modal-panel flex flex-1 flex-col overflow-y-auto border-0 bg-slate-950 pb-[env(safe-area-inset-bottom)] sm:mx-auto sm:my-4 sm:w-full sm:max-w-3xl sm:flex-none sm:rounded-2xl sm:border sm:border-slate-800">
        {/* Tiêu đề */}
        <div className="sticky top-0 z-10 flex items-center gap-2 border-b border-slate-800 bg-slate-950/95 px-3 py-2 pt-[calc(0.5rem+env(safe-area-inset-top))] sm:px-4">
          <Navigation className="h-5 w-5 shrink-0 text-sky-400" />
          <div className="min-w-0 flex-1">
            <div className="truncate text-sm font-bold sm:text-base">{nav.title || `Dẫn đường tới ô ${slotCode}`}</div>
            <div className="truncate text-xs text-slate-400">{nav.plate ? <span className="font-mono">{nav.plate}</span> : null}{nav.plate ? ' · ' : ''}Ô {slotCode} · Tầng {slot?.floor ?? '—'}{nav.demo ? ' · Giả lập' : ''}</div>
          </div>
          {voiceSupported() && (
            <button onClick={() => setVoiceEnabled(!voice)} className={`btn-sm btn border ${voice ? 'border-sky-500/50 bg-sky-500/15 text-sky-300' : 'border-slate-700 text-slate-400'}`}
              aria-pressed={voice} title="Giọng nói chỉ đường">
              {voice ? <Volume2 className="h-4 w-4" /> : <VolumeX className="h-4 w-4" />}<span className="hidden sm:inline">Giọng nói chỉ đường</span>
            </button>
          )}
          <button onClick={onClose} className="rounded-lg p-2 text-slate-400 hover:bg-slate-800 hover:text-white" aria-label="Đóng"><X className="h-5 w-5" /></button>
        </div>

        <div className="space-y-3 p-3 sm:p-4">
          {/* Chặng */}
          <div className="grid grid-cols-2 gap-2 text-xs font-semibold">
            {[[1, 'Chặng 1: Tới cổng vào'], [2, 'Chặng 2: Trong bãi tới ô']].map(([n, label]) => (
              <div key={n} className={`flex items-center justify-center gap-1.5 rounded-xl px-2 py-2 text-center ${stage === n ? 'bg-sky-500 text-white' : stage > n ? 'bg-emerald-500/15 text-emerald-300' : 'bg-slate-800 text-slate-400'}`}>
                {stage > n ? <CheckCircle2 className="h-4 w-4" /> : <MapPin className="h-4 w-4" />} {label}
              </div>
            ))}
          </div>

          {/* Hướng dẫn hiện tại */}
          <div className="rounded-2xl border border-sky-500/40 bg-sky-500/10 p-3" aria-live="polite">
            {stage === 1 ? (
              <>
                <div className="text-xs text-sky-200">Còn tới cổng vào</div>
                <div className="text-3xl font-bold tabular-nums text-sky-300">{fmtMeters(dGate)}</div>
                <div className="text-sm text-slate-200">Đi về hướng <b>{compass(bearing(user, gateLL))}</b> · tự chuyển sang dẫn đường trong bãi khi cách cổng ≤ {GATE_RADIUS_M} m hoặc khi barrier mở.</div>
                <a href={gmaps} target="_blank" rel="noopener noreferrer" className="btn-ghost btn-sm mt-2 inline-flex"><ExternalLink className="h-3.5 w-3.5" /> Mở Google Maps chỉ đường xe tới cổng</a>
              </>
            ) : confirmed ? (
              <div className="flex items-center gap-2 text-emerald-300"><CheckCircle2 className="h-6 w-6" /><div><div className="font-bold">Đã đỗ tại ô {slotCode}</div><div className="text-xs text-slate-300">Dẫn đường đã tắt. Khi ra, camera cổng ra quét biển số để tính phí.</div></div></div>
            ) : (
              <>
                <div className="flex items-center justify-between text-xs text-sky-200">
                  <span>{routeFrom ? `Quay lại ô ${slotCode}` : `Từ cổng vào tới ô ${slotCode}`} · {fmtMeters(total)}</span>
                  {dSlot !== null && <span>Còn ~{fmtMeters(dSlot)}</span>}
                </div>
                <div className="mt-1 text-lg font-bold leading-snug text-slate-100">{arrived ? `Bạn đã tới ô ${slotCode}` : (nextStep?.text || `Tới ô ${slotCode}`)}</div>
                <ol className="mt-2 space-y-0.5 text-xs text-slate-300">
                  {steps.map((s, i) => <li key={i} className={s.at <= curIdx && curIdx > 0 ? 'text-slate-500 line-through' : ''}>{i + 1}. {s.text}</li>)}
                </ol>
              </>
            )}
          </div>

          {/* Bản đồ */}
          <DualMap cfg={cfg} slots={slots} floor={floor} onFloor={setFloorView} route={stage === 2 && !confirmed ? route : null} outside={outside}
            user={user} highlightCode={slotCode} flashCode={nav.flash || wrong?.detected_slot_code} focus={stage === 1 ? 'outside' : 'route'}
            follow={stage === 2 && !!user} height={Math.min(440, Math.max(260, Math.round(window.innerHeight * 0.42)))} defaultMode="gps"
            extra={(
              <button onClick={() => geo?.toggle()} className={`btn-sm btn border ${geo?.enabled ? 'border-emerald-500/50 text-emerald-300' : 'border-slate-700 text-slate-400'}`}>
                {geo?.enabled ? <LocateFixed className="h-4 w-4" /> : <LocateOff className="h-4 w-4" />} GPS {geo?.sim ? '(giả lập)' : geo?.enabled ? 'bật' : 'tắt'}
              </button>
            )} />
          {!user && <p className="text-xs text-slate-400">{geo?.error || 'Chưa có vị trí GPS — đang hiển thị đường đi trong bãi từ cổng vào. Bật GPS để được dẫn đường từ vị trí của bạn.'}</p>}

          {/* Thanh thao tác tại ô */}
          {canAct && nav.passed && !confirmed && (
            <div className="sticky bottom-0 -mx-3 space-y-2 border-t border-slate-800 bg-slate-950/95 px-3 pb-[calc(0.75rem+env(safe-area-inset-bottom))] pt-3 sm:static sm:mx-0 sm:border-0 sm:bg-transparent sm:p-0">
              <button className="btn-success min-h-[56px] w-full text-base" onClick={confirmPark} disabled={!!busy}>
                {busy === 'confirm' ? <Loader2 className="h-5 w-5 animate-spin" /> : <CheckCircle2 className="h-5 w-5" />} Xác nhận đã vào ô {slotCode}
              </button>
              <button className="btn-ghost w-full" onClick={() => setPicker(true)} disabled={!!busy}><ArrowRightLeft className="h-4 w-4" /> Đổi sang ô trống khác</button>
            </div>
          )}
        </div>
      </div>

      <SlotPicker open={picker} slots={slots} current={slotCode} busy={busy} onClose={() => setPicker(false)} onPick={(s) => switchTo(s.code, s.floor)} />

      {/* Cảnh báo đỗ nhầm ô */}
      {wrong && (
        <div className="fixed inset-0 z-[60] flex items-end justify-center bg-black/60 p-3 sm:items-center">
          <div className="modal-panel w-full max-w-md rounded-2xl border-2 border-rose-500 bg-slate-900 p-4 shadow-2xl" role="alertdialog" aria-label="Đỗ nhầm ô">
            <div className="flex items-center gap-2 text-lg font-bold text-rose-300"><AlertTriangle className="h-6 w-6 animate-pulse" /> Xe đang đỗ nhầm ô!</div>
            <p className="mt-2 text-sm text-slate-200">
              Cảm biến phát hiện xe <b className="font-mono">{wrong.license_plate}</b> vào ô <b className="text-rose-300">{wrong.detected_slot_code}</b>,
              nhưng ô đã đặt của bạn là <b className="text-emerald-300">{wrong.assigned_slot_code}</b>.
            </p>
            <div className="mt-4 grid gap-2">
              <button className="btn-primary min-h-[52px]" disabled={!!busy || !canAct} onClick={() => switchTo(wrong.detected_slot_code, wrong.detected_floor)}>
                {busy === wrong.detected_slot_code ? <Loader2 className="h-4 w-4 animate-spin" /> : <ArrowRightLeft className="h-4 w-4" />} Xác nhận đổi sang ô {wrong.detected_slot_code}
              </button>
              <button className="btn-ghost min-h-[52px]" onClick={keepOld}><Undo2 className="h-4 w-4" /> Giữ ô cũ & Chỉ đường về {wrong.assigned_slot_code}</button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
