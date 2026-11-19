import { forwardRef, useEffect, useImperativeHandle, useRef, useState } from 'react'
import {
  Camera, Upload, LogIn, LogOut, Loader2, ScanLine, Lock, Unlock, Radio, Cpu, Car, Video, VideoOff, Aperture, Siren, Zap,
} from 'lucide-react'
import { api, useEvent } from '../api.js'

const SAMPLES = ['65A-123.45', '51G-678.90', '30H-246.81', '43A-135.79', '59X1-234.56', '29C-112.23']

/** Ảnh biển số mẫu vẽ bằng SVG (không cần file ảnh). */
function PlateImage({ plate, small }) {
  const [top, bottom] = plate.includes('-') ? plate.split('-') : [plate, '']
  return (
    <svg viewBox="0 0 140 64" className={small ? 'h-9 w-auto' : 'h-16 w-auto'}>
      <rect x="1" y="1" width="138" height="62" rx="6" fill="#f8fafc" stroke="#0f172a" strokeWidth="3" />
      <text x="70" y="28" textAnchor="middle" fontSize="22" fontWeight="700" fontFamily="Arial" fill="#0f172a">{top}</text>
      <text x="70" y="54" textAnchor="middle" fontSize="22" fontWeight="700" fontFamily="Arial" fill="#0f172a">{bottom}</text>
    </svg>
  )
}

/**
 * Khung camera 1 cổng: webcam thật (getUserMedia) hoặc ảnh mẫu / upload, ALPR giả lập, nút "Xe tới cổng".
 * `ref.autoCapture()` dùng cho Auto-Gate: chụp khung hình webcam (nếu bật) và trả về biển số.
 */
const GateCamera = forwardRef(function GateCamera({ gate, onResult, toast, autoGate }, ref) {
  const isEntry = gate === 'entry'
  const [plate, setPlate] = useState('')
  const [preview, setPreview] = useState(null)
  const [busy, setBusy] = useState(false)
  const [scan, setScan] = useState(null)
  const [stream, setStream] = useState(null)
  const [camErr, setCamErr] = useState('')
  const [flash, setFlash] = useState(false)
  const fileRef = useRef()
  const videoRef = useRef()
  const plateRef = useRef(plate)
  plateRef.current = plate

  // Gắn stream vào thẻ <video>; tắt camera khi rời trang
  useEffect(() => { if (videoRef.current && stream) videoRef.current.srcObject = stream }, [stream])
  useEffect(() => () => stream?.getTracks().forEach((t) => t.stop()), [stream])

  const startCam = async () => {
    setCamErr('')
    if (!navigator.mediaDevices?.getUserMedia) {
      const msg = 'Trình duyệt chặn camera: hãy mở trang bằng http://localhost hoặc link HTTPS (ngrok).'
      setCamErr(msg); return toast(msg, 'error')
    }
    try {
      const s = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'environment', width: { ideal: 1280 } }, audio: false })
      setPreview(null); setScan(null); setStream(s)
    } catch (err) {
      const msg = err.name === 'NotAllowedError' ? 'Bạn đã từ chối quyền camera — bật lại trong biểu tượng ổ khóa trên thanh địa chỉ.'
        : err.name === 'NotFoundError' ? 'Không tìm thấy webcam nào trên máy.' : `Không mở được camera: ${err.message}`
      setCamErr(msg); toast(msg, 'error')
    }
  }
  const stopCam = () => { stream?.getTracks().forEach((t) => t.stop()); setStream(null) }

  /** Chụp 1 khung hình từ webcam -> File JPEG (null nếu chưa bật camera). */
  const snapshot = () => new Promise((resolve) => {
    const v = videoRef.current
    if (!stream || !v || !v.videoWidth) return resolve(null)
    const c = document.createElement('canvas')
    c.width = v.videoWidth
    c.height = v.videoHeight
    c.getContext('2d').drawImage(v, 0, 0)
    setFlash(true); setTimeout(() => setFlash(false), 180)
    c.toBlob((b) => resolve(b ? new File([b], `cong-${gate}-${Date.now()}.jpg`, { type: 'image/jpeg' }) : null), 'image/jpeg', 0.85)
  })

  const recognize = async (file, hint = '', keepLive = false) => {
    if (!keepLive) setPreview(URL.createObjectURL(file))
    setScan(null)
    const form = new FormData()
    form.append('file', file)
    if (hint) form.append('hint', hint)
    setBusy(true)
    try {
      const r = await api('/api/hardware/alpr', { method: 'POST', form })
      setPlate(r.plate)
      setScan(r)
      return r.plate
    } catch (err) { toast(err.message, 'error'); return null } finally { setBusy(false) }
  }

  // Nút "Chụp": chụp khung hình webcam rồi chạy ALPR giả lập (biển số lấy theo biển số test đang chọn/nhập)
  const capture = async () => {
    const f = await snapshot()
    if (!f) return toast('Chưa bật camera', 'error')
    setPreview(URL.createObjectURL(f)) // camera vẫn chạy; khung vừa chụp hiện ở góc
    await recognize(f, plateRef.current, true)
  }

  useImperativeHandle(ref, () => ({
    /** Auto-Gate: lấy biển số cho xe vừa tới cổng. Ưu tiên chụp webcam (kèm biển số test đang chọn làm gợi ý). */
    autoCapture: async () => {
      const hint = plateRef.current.trim()
      const f = await snapshot()
      if (f) { setPreview(URL.createObjectURL(f)); return recognize(f, hint, true) }
      if (hint) { setScan({ plate: hint.toUpperCase(), confidence: 1 }); return hint }
      return null
    },
    flash: () => { setFlash(true); setTimeout(() => setFlash(false), 180) },
  }))

  // Nút "Xe tới cổng": giả lập ESP32 báo có xe đứng trước barrier (không gửi biển số)
  const arrive = async () => {
    try {
      const r = await api('/api/hardware/gate-trigger', { method: 'POST', body: { gate } })
      if (r.action === 'manual') toast(`Xe tới cổng ${isEntry ? 'VÀO' : 'RA'} — Auto-Gate đang tắt: bấm nút quét bên dưới để xác nhận tay.`, 'info')
    } catch (err) { toast(err.message, 'error') }
  }

  const submit = async (p = plate) => {
    if (!p.trim()) return toast('Nhập hoặc chọn biển số trước', 'error')
    setBusy(true)
    try {
      const r = await api('/api/admin/gate', { method: 'POST', body: { gate, plate: p } })
      onResult(gate, r)
      setPlate('')
      setPreview(null)
      setScan(null)
    } catch (err) { toast(err.message, 'error') } finally { setBusy(false) }
  }

  return (
    <div className="rounded-xl border border-slate-800 bg-slate-950/50 p-3">
      <div className="mb-2 flex items-center justify-between">
        <div className={`flex items-center gap-1.5 text-sm font-semibold ${isEntry ? 'text-emerald-300' : 'text-rose-300'}`}>
          <Camera className="h-4 w-4" /> Camera ALPR cổng {isEntry ? 'VÀO' : 'RA'}
        </div>
        <span className={`flex items-center gap-1 text-[10px] ${stream ? 'text-rose-400' : 'text-slate-500'}`}>
          <span className={`h-1.5 w-1.5 rounded-full ${stream ? 'animate-pulse bg-rose-500' : 'bg-slate-600'}`} /> {stream ? 'LIVE · webcam' : 'Giả lập'}
        </span>
      </div>
      <div className="relative mb-2 flex h-40 items-center justify-center overflow-hidden rounded-lg bg-[repeating-linear-gradient(45deg,#0f172a,#0f172a_10px,#111c33_10px,#111c33_20px)] sm:h-44">
        {stream
          ? <video ref={videoRef} autoPlay playsInline muted className="h-full w-full object-cover" aria-label={`Webcam cổng ${isEntry ? 'vào' : 'ra'}`} />
          : preview ? <img src={preview} alt="Khung hình đã chụp" className="h-full w-full object-contain" />
            : plate ? <PlateImage plate={plate.toUpperCase()} /> : <span className="px-3 text-center text-xs text-slate-500">{camErr || 'Chưa có xe'}</span>}
        {stream && plate && <div className="absolute right-1 top-1 rounded bg-black/70 p-0.5"><PlateImage plate={plate.toUpperCase()} small /></div>}
        {stream && preview && <img src={preview} alt="Khung hình vừa chụp" className="absolute bottom-1 right-1 h-12 rounded border border-white/60 object-cover shadow" />}
        {flash && <div className="absolute inset-0 bg-white/70" />}
        {busy && <div className="absolute inset-x-0 top-0 h-1 animate-[ping_1s_linear_infinite] bg-sky-400/70" />}
        {scan && (
          <div className="absolute bottom-1 left-1 rounded bg-black/70 px-1.5 py-0.5 text-[10px] text-emerald-300">
            <ScanLine className="mr-1 inline h-3 w-3" />{scan.plate} · {Math.round(scan.confidence * 100)}%
          </div>
        )}
      </div>
      <div className="mb-2 grid grid-cols-2 gap-1.5">
        {stream ? (
          <>
            <button className="btn-primary btn-sm" onClick={capture} disabled={busy}><Aperture className="h-3.5 w-3.5" /> Chụp & đọc biển số</button>
            <button className="btn-ghost btn-sm" onClick={stopCam}><VideoOff className="h-3.5 w-3.5" /> Tắt camera</button>
          </>
        ) : (
          <button className="btn-ghost btn-sm col-span-2" onClick={startCam}><Video className="h-3.5 w-3.5" /> Bật Camera thật (webcam)</button>
        )}
      </div>
      <div className="mb-2 flex flex-wrap gap-1">
        {SAMPLES.map((s) => (
          <button key={s} onClick={() => { setPreview(null); setScan(null); setPlate(s) }} className="rounded-md border border-slate-700 bg-white/5 p-0.5 hover:border-sky-400" title={`Ảnh mẫu ${s}`}>
            <PlateImage plate={s} small />
          </button>
        ))}
      </div>
      <div className="flex gap-2">
        <input className="input font-mono uppercase" placeholder="Biển số" value={plate} onChange={(e) => setPlate(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && submit()} />
        <button className="btn-ghost !px-2.5" title="Upload ảnh biển số (tên file chứa biển số, vd 65A12345.jpg)" onClick={() => fileRef.current.click()}>
          <Upload className="h-4 w-4" />
        </button>
        <input ref={fileRef} type="file" accept="image/*" hidden onChange={(e) => { const f = e.target.files[0]; if (f) recognize(f); e.target.value = '' }} />
      </div>
      <div className="mt-2 grid grid-cols-[1fr_auto] gap-1.5">
        <button className={`${isEntry ? 'btn-success' : 'btn-danger'} w-full`} disabled={busy} onClick={() => submit()}>
          {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : isEntry ? <LogIn className="h-4 w-4" /> : <LogOut className="h-4 w-4" />}
          {isEntry ? 'Quét & cho xe vào' : 'Quét & tính tiền xe ra'}
        </button>
        <button className={`btn ${autoGate ? 'border border-sky-400 bg-sky-500/20 text-sky-200' : 'btn-ghost'}`} onClick={arrive}
          title="Giả lập ESP32 báo có xe đứng trước barrier: POST /api/hardware/gate-trigger">
          <Siren className="h-4 w-4" /> Xe tới cổng
        </button>
      </div>
    </div>
  )
})

function Barrier({ gate, info, toast }) {
  const open = info?.state === 'OPEN'
  const cmd = async (action, auto_close = true) => {
    try { await api('/api/admin/barrier', { method: 'POST', body: { gate, action, auto_close } }) } catch (err) { toast(err.message, 'error') }
  }
  return (
    <div className="rounded-xl border border-slate-800 bg-slate-950/50 p-3">
      <div className="flex items-center justify-between">
        <div className="text-sm font-semibold">Barrier {gate === 'entry' ? 'VÀO' : 'RA'}</div>
        <span className={`badge ${open ? 'bg-emerald-500/20 text-emerald-300' : 'bg-slate-700 text-slate-300'}`}>{info?.state || 'CLOSED'}</span>
      </div>
      {/* Hình barrier */}
      <div className="relative my-3 h-12">
        <div className="absolute bottom-0 left-2 h-10 w-3 rounded bg-slate-600" />
        <div className={`absolute bottom-8 left-4 h-2 w-[80%] origin-left rounded-full bg-[repeating-linear-gradient(90deg,#f43f5e_0_14px,#f8fafc_14px_28px)] transition-transform duration-700 ${open ? '-rotate-[70deg]' : 'rotate-0'}`} />
      </div>
      <div className="truncate text-xs text-slate-500" title={info?.reason}>{info?.reason || '—'}</div>
      <div className="mt-2 grid grid-cols-3 gap-1.5">
        <button className="btn-success btn-sm" onClick={() => cmd('open', true)} title="Mở rồi tự đóng sau 5 giây"><Unlock className="h-3.5 w-3.5" /> Mở 5s</button>
        <button className="btn-ghost btn-sm" onClick={() => cmd('open', false)} title="Mở giữ nguyên">Giữ mở</button>
        <button className="btn-danger btn-sm" onClick={() => cmd('close')}><Lock className="h-3.5 w-3.5" /> Đóng</button>
      </div>
    </div>
  )
}

function SensorSim({ slots, toast }) {
  const [code, setCode] = useState('T1-A01')
  const send = async (occupied) => {
    try {
      const r = await api('/api/hardware/sensor', { method: 'POST', body: { slot_code: code, occupied } })
      toast(`Cảm biến ${r.slot_code} → ${r.status}`, 'info')
    } catch (err) { toast(err.message, 'error') }
  }
  return (
    <div className="rounded-xl border border-slate-800 bg-slate-950/50 p-3">
      <div className="mb-2 flex items-center gap-1.5 text-sm font-semibold"><Radio className="h-4 w-4 text-violet-400" /> Giả lập cảm biến ESP32</div>
      <select className="input mb-2" value={code} onChange={(e) => setCode(e.target.value)}>
        {slots.map((s) => <option key={s.code} value={s.code}>{s.code} ({s.status})</option>)}
      </select>
      <div className="grid grid-cols-2 gap-1.5">
        <button className="btn btn-sm border border-[#64748b] bg-[#475569] text-white hover:bg-[#526178]" onClick={() => send(true)}>
          <Car className="h-3.5 w-3.5" strokeWidth={2.4} /> Có xe
        </button>
        <button className="btn-success btn-sm" onClick={() => send(false)}>Trống</button>
      </div>
      <p className="mt-2 text-[11px] leading-snug text-slate-500"><Cpu className="mr-1 inline h-3 w-3" />Gửi giống ESP32: POST /api/hardware/sensor</p>
    </div>
  )
}

export default function SimulationPanel({ slots, barriers, onGateResult, toast, autoGate = false }) {
  const cams = { entry: useRef(), exit: useRef() }
  const [saving, setSaving] = useState(false)
  const [lastAuto, setLastAuto] = useState(null) // { gate, plate, ok, message, at }

  const toggleAuto = async () => {
    setSaving(true)
    try {
      await api('/api/admin/settings', { method: 'PUT', body: { auto_gate: !autoGate } })
      toast(!autoGate ? 'Đã BẬT Auto-Gate: xe tới cổng sẽ tự đọc biển số và mở barrier nếu hợp lệ' : 'Đã TẮT Auto-Gate: Bảo vệ xác nhận tay', 'success')
    } catch (err) { toast(err.message, 'error') } finally { setSaving(false) }
  }

  // Tín hiệu "xe tới cổng" (ESP32 / nút giả lập) khi Auto-Gate BẬT -> camera cổng đó lấy biển số -> backend check-in/out
  useEvent(async (ev) => {
    if (ev.event === 'auto_gate' && ev.data) setLastAuto({ ...ev.data, at: Date.now() })
    if (ev.event !== 'gate_trigger' || !ev.data?.need_plate) return
    const { gate, trigger_id } = ev.data
    const cam = cams[gate]?.current
    if (!cam) return
    const plate = await cam.autoCapture()
    if (!plate) {
      toast(`Xe tới cổng ${gate === 'entry' ? 'VÀO' : 'RA'} nhưng chưa có biển số: bật webcam và chọn/nhập biển số test, hoặc quét tay.`, 'error')
      return
    }
    try {
      const r = await api('/api/hardware/gate-trigger/resolve', { method: 'POST', body: { trigger_id, plate } })
      onGateResult(gate, r, { quiet: true }) // thông báo do sự kiện auto_gate hiển thị
    } catch (err) {
      if (err.status !== 409) toast(err.message, 'error') // 409: tab Bảo vệ khác đã xử lý trước
    }
  })

  return (
    <div className="space-y-3">
      {/* Auto-Gate */}
      <div className={`flex flex-col gap-2 rounded-xl border p-3 sm:flex-row sm:items-center ${autoGate ? 'border-sky-500/50 bg-sky-500/10' : 'border-slate-800 bg-slate-950/50'}`}>
        <button role="switch" aria-checked={autoGate} onClick={toggleAuto} disabled={saving}
          className="flex min-h-[44px] items-center gap-3 text-left">
          <span className={`relative inline-flex h-6 w-11 shrink-0 rounded-full transition ${autoGate ? 'bg-sky-500' : 'bg-slate-700'}`}>
            <span className={`absolute top-0.5 h-5 w-5 rounded-full bg-white transition ${autoGate ? 'left-[22px]' : 'left-0.5'}`} />
          </span>
          <span className="min-w-0">
            <span className="flex items-center gap-1.5 text-sm font-semibold"><Zap className="h-4 w-4 text-sky-300" /> Tự động mở barrier (Auto-Gate): {autoGate ? 'BẬT' : 'TẮT'}</span>
            <span className="block text-xs text-slate-400">
              {autoGate
                ? 'Có tín hiệu xe tới → tự đọc biển số (webcam / biển số test đang chọn) → hợp lệ thì mở barrier 5 giây, không cần bấm tay.'
                : 'Tín hiệu xe tới chỉ báo cho Bảo vệ; barrier mở khi bấm quét/xác nhận tay.'}
            </span>
          </span>
        </button>
        {lastAuto && Date.now() - lastAuto.at < 15000 && (
          <span className={`badge sm:ml-auto ${lastAuto.ok ? 'bg-emerald-500/20 text-emerald-300' : 'bg-rose-500/20 text-rose-300'}`}>
            {lastAuto.ok ? 'Đã mở' : 'Từ chối'} · {lastAuto.gate === 'entry' ? 'VÀO' : 'RA'} · {lastAuto.plate}
          </span>
        )}
      </div>
      <div className="grid gap-3 md:grid-cols-2">
        <GateCamera ref={cams.entry} gate="entry" onResult={onGateResult} toast={toast} autoGate={autoGate} />
        <GateCamera ref={cams.exit} gate="exit" onResult={onGateResult} toast={toast} autoGate={autoGate} />
      </div>
      <p className="text-[11px] leading-snug text-slate-500">
        <Cpu className="mr-1 inline h-3 w-3" />ESP32 báo xe tới: <span className="font-mono">POST /api/hardware/gate-trigger {'{"gate":"entry"}'}</span> (thêm
        <span className="font-mono"> "plate"</span> nếu thiết bị tự đọc biển số). Webcam chỉ hoạt động trên localhost hoặc HTTPS. Nhận diện biển số là giả lập
        (không dùng AI): biển số lấy theo biển số test đang chọn/nhập, ảnh webcam được chụp làm minh chứng.
      </p>
      <div className="grid gap-3 sm:grid-cols-3">
        <Barrier gate="entry" info={barriers?.entry} toast={toast} />
        <Barrier gate="exit" info={barriers?.exit} toast={toast} />
        <SensorSim slots={slots} toast={toast} />
      </div>
    </div>
  )
}
