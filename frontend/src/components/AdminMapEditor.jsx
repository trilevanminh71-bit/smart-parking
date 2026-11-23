/* Trình chỉnh sửa Bản đồ & GPS (Admin): kéo-thả ô đỗ, thêm/xóa ô & tầng, xoay góc ô 0–360°, đặt cổng vào/ra & vật cản,
 * vẽ / nối waypoint (1 chiều / 2 chiều), gán cảm biến ESP32 (NONE, IR_1..IR_5) cho từng ô, ghim tọa độ GPS thật từ điện thoại,
 * xoay cả bãi (tự quy đổi lat/lng mọi ô), Xuất / Nhập JSON để sao lưu nhiều sơ đồ. */
import { lazy, Suspense, useEffect, useMemo, useRef, useState } from 'react'
import {
  MousePointer2, SquarePlus, Square, CircleDot, Spline, Trash2, Save, Loader2, Download, Upload, Crosshair, LocateFixed, RotateCw,
  Plus, Minus, Maximize, Layers, Globe2, LayoutGrid, Undo2, ArrowLeftRight, Map as MapIcon, RefreshCcw,
} from 'lucide-react'
import { api, saveBlob } from '../api.js'
import { setMapConfigCache, useMapConfig } from '../mapStore.js'
import { getCurrentPosition } from '../gps.jsx'
import { fromLatLng, project } from '../geo.js'
import { planBounds } from './FloorPlan.jsx'
import { slotColorFor } from './mapColors.js'
import { useTheme } from '../theme.jsx'
import { MapFallback } from './DualMap.jsx'

const LeafletMap = lazy(() => import('./LeafletMap.jsx'))
const SENSORS = ['NONE', 'IR_1', 'IR_2', 'IR_3', 'IR_4', 'IR_5']
const OBS_LABEL = { pillar: 'Cột', wall: 'Tường', booth: 'Bốt bảo vệ' }
const WP_LABEL = { node: 'Điểm lối đi', ramp: 'Dốc / thang lên xuống', gate_in: 'Điểm cổng vào', gate_out: 'Điểm cổng ra' }
const TOOLS = [
  ['select', 'Chọn / kéo', MousePointer2], ['slot', 'Thêm ô', SquarePlus], ['obstacle', 'Thêm vật cản', Square],
  ['waypoint', 'Thêm waypoint', CircleDot], ['edge', 'Nối lối đi', Spline],
]
const r1 = (v) => Math.round(v * 10) / 10

export default function AdminMapEditor({ slots = [], toast }) {
  const live = useMapConfig()
  const { resolved } = useTheme()
  const dark = resolved === 'dark'
  const [draft, setDraft] = useState(null)
  const [dirty, setDirty] = useState(false)
  const [floor, setFloor] = useState(1)
  const [tool, setTool] = useState('select')
  const [sel, setSel] = useState(null) // {type, id}
  const [edgeFrom, setEdgeFrom] = useState(null)
  const [oneway, setOneway] = useState(false)
  const [snap, setSnap] = useState(true)
  const [view, setView] = useState(null) // viewBox {x,y,w,h}
  const [preview, setPreview] = useState('plan')
  const [busy, setBusy] = useState('')
  const [history, setHistory] = useState([])
  const svgRef = useRef(null)
  const drag = useRef(null)
  const itemDownAt = useRef(0)
  const fileRef = useRef(null)

  useEffect(() => { if (live && !dirty) setDraft(structuredClone(live)) }, [live, dirty])
  const floors = useMemo(() => [...new Set((draft?.slots || []).map((s) => s.floor).concat((draft?.waypoints || []).map((w) => w.floor)))].sort((a, b) => a - b), [draft])
  useEffect(() => { if (draft && !floors.includes(floor)) setFloor(floors[0] || 1) }, [floors, floor, draft])
  const fit = () => draft && setView(planBounds(draft, floor, 4))
  useEffect(() => { fit() }, [floor, !!draft]) // eslint-disable-line react-hooks/exhaustive-deps

  const statusOf = useMemo(() => Object.fromEntries(slots.map((s) => [s.code, s.status])), [slots])
  if (!draft || !view) return <div className="card text-sm text-slate-400">Đang tải sơ đồ…</div>

  const firstFloor = Math.min(...draft.slots.map((s) => s.floor))
  const sn = (v) => (snap ? Math.round(v * 2) / 2 : r1(v))

  // ---------------- cập nhật bản nháp
  const commit = (fn) => {
    setHistory((h) => [...h.slice(-30), draft])
    setDraft((d) => { const n = structuredClone(d); fn(n); return n })
    setDirty(true)
  }
  const undo = () => { const prev = history[history.length - 1]; if (!prev) return; setHistory((h) => h.slice(0, -1)); setDraft(prev); setDirty(true) }
  const list = (d, type) => ({ slot: d.slots, obstacle: d.obstacles, waypoint: d.waypoints })[type]
  const keyOf = (type) => (type === 'slot' ? 'slot_code' : 'id')
  const find = (d, s) => {
    if (!s) return null
    if (s.type === 'gate_in' || s.type === 'gate_out') return d[s.type]
    if (s.type === 'edge') return d.edges[s.id]
    return list(d, s.type)?.find((x) => x[keyOf(s.type)] === s.id)
  }
  const selected = find(draft, sel)
  const setField = (k, v) => commit((d) => { const it = find(d, sel); if (it) it[k] = v })

  // ---------------- chuột / cảm ứng
  const toLocal = (e) => {
    const svg = svgRef.current
    const pt = svg.createSVGPoint()
    pt.x = e.clientX; pt.y = e.clientY
    const p = pt.matrixTransform(svg.getScreenCTM().inverse())
    return [p.x, p.y]
  }
  const startDrag = (e, type, id) => {
    e.stopPropagation()
    itemDownAt.current = Date.now()
    if (tool === 'edge' && type === 'waypoint') return edgeClick(id)
    setSel({ type, id })
    if (tool !== 'select') return
    const it = find(draft, { type, id })
    const [px, py] = toLocal(e)
    drag.current = { type, id, dx: it.x - px, dy: it.y - py, moved: false }
    svgRef.current.setPointerCapture?.(e.pointerId)
  }
  const onMove = (e) => {
    const g = drag.current
    if (!g) return
    const [px, py] = toLocal(e)
    if (!g.moved) { setHistory((h) => [...h.slice(-30), draft]); g.moved = true }
    setDraft((d) => {
      const n = { ...d, slots: d.slots, obstacles: d.obstacles, waypoints: d.waypoints }
      const arr = g.type === 'gate_in' || g.type === 'gate_out' ? null : [...list(n, g.type)]
      if (arr) {
        const i = arr.findIndex((x) => x[keyOf(g.type)] === g.id)
        arr[i] = { ...arr[i], x: sn(px + g.dx), y: sn(py + g.dy) }
        n[{ slot: 'slots', obstacle: 'obstacles', waypoint: 'waypoints' }[g.type]] = arr
      } else n[g.type] = { ...n[g.type], x: sn(px + g.dx), y: sn(py + g.dy) }
      return n
    })
    setDirty(true)
  }
  const endDrag = () => { if (drag.current) itemDownAt.current = Date.now(); drag.current = null }

  const nextSlotCode = (d, f) => {
    const onFloor = d.slots.filter((s) => s.floor === f)
    const letter = onFloor[0]?.slot_code[3] || String.fromCharCode(64 + Math.min(26, f))
    const used = new Set(d.slots.map((s) => s.slot_code))
    for (let i = 1; i < 100; i++) { const c = `T${f}-${letter}${String(i).padStart(2, '0')}`; if (!used.has(c)) return c }
    return null
  }
  const canvasClick = (e) => {
    // Sau khi chạm / kéo 1 đối tượng, trình duyệt có thể phát 'click' lên khung vẽ (pointer capture) -> bỏ qua
    if (drag.current || Date.now() - itemDownAt.current < 400) return
    const [px, py] = toLocal(e)
    const x = sn(px), y = sn(py)
    if (tool === 'slot') {
      const code = nextSlotCode(draft, floor)
      if (!code) return toast('Tầng này đã đủ 99 ô', 'error')
      commit((d) => d.slots.push({ slot_code: code, floor, x, y, w: 3, h: 5, rotation: 0, gps_radius_m: 2.5, hardware_sensor_id: 'NONE' }))
      setSel({ type: 'slot', id: code })
    } else if (tool === 'obstacle') {
      const id = `OB_${Date.now().toString(36).toUpperCase()}`
      commit((d) => d.obstacles.push({ id, floor, kind: 'pillar', x, y, w: 0.6, h: 0.6, rotation: 0 }))
      setSel({ type: 'obstacle', id })
    } else if (tool === 'waypoint') {
      const id = `F${floor}_W${Date.now().toString(36).toUpperCase()}`
      commit((d) => d.waypoints.push({ id, floor, kind: 'node', x, y }))
      setSel({ type: 'waypoint', id })
    } else {
      setSel(null); setEdgeFrom(null)
    }
  }
  const edgeClick = (id) => {
    if (!edgeFrom) { setEdgeFrom(id); setSel({ type: 'waypoint', id }); return }
    if (edgeFrom === id) { setEdgeFrom(null); return }
    const dup = draft.edges.findIndex((e) => (e.from === edgeFrom && e.to === id) || (e.from === id && e.to === edgeFrom))
    if (dup >= 0) { toast('Hai điểm này đã được nối', 'info'); setSel({ type: 'edge', id: dup }); setEdgeFrom(null); return }
    commit((d) => d.edges.push({ from: edgeFrom, to: id, oneway }))
    setSel({ type: 'edge', id: draft.edges.length })
    setEdgeFrom(id) // nối tiếp chuỗi
  }

  const remove = () => {
    if (!sel) return
    commit((d) => {
      if (sel.type === 'edge') d.edges.splice(sel.id, 1)
      else if (sel.type === 'slot') d.slots = d.slots.filter((s) => s.slot_code !== sel.id)
      else if (sel.type === 'obstacle') d.obstacles = d.obstacles.filter((o) => o.id !== sel.id)
      else if (sel.type === 'waypoint') {
        d.waypoints = d.waypoints.filter((w) => w.id !== sel.id)
        d.edges = d.edges.filter((e) => e.from !== sel.id && e.to !== sel.id)
      }
    })
    setSel(null)
  }

  // ---------------- tầng
  const addFloor = () => {
    const f = Math.max(...floors) + 1
    if (f > 9) return toast('Tối đa 9 tầng', 'error')
    const prevRamp = draft.waypoints.find((w) => w.floor === f - 1 && w.kind === 'ramp')
    const letter = String.fromCharCode(64 + f)
    commit((d) => {
      const rampId = `F${f}_RAMP`
      d.waypoints.push({ id: rampId, floor: f, kind: 'ramp', x: prevRamp?.x ?? 26, y: prevRamp?.y ?? 10 })
      if (prevRamp) d.edges.push({ from: prevRamp.id, to: rampId, oneway: false })
      d.slots.push({ slot_code: `T${f}-${letter}01`, floor: f, x: (prevRamp?.x ?? 26) - 6, y: (prevRamp?.y ?? 10) - 6, w: 3, h: 5, rotation: 0, gps_radius_m: 2.5, hardware_sensor_id: 'NONE' })
      d.floors = [...(d.floors || []), { floor: f, name: `Tầng ${f}` }]
    })
    setFloor(f)
    toast(`Đã thêm Tầng ${f} (1 ô mẫu + dốc nối với Tầng ${f - 1}) — kéo-thả để bố trí`, 'success')
  }
  const removeFloor = () => {
    if (floors.length <= 1) return toast('Bãi phải còn ít nhất 1 tầng', 'error')
    if (!confirm(`Xóa Tầng ${floor} cùng toàn bộ ô, vật cản, waypoint của tầng này? (Chỉ lưu được khi các ô đều đang trống)`)) return
    commit((d) => {
      const ids = new Set(d.waypoints.filter((w) => w.floor === floor).map((w) => w.id))
      d.slots = d.slots.filter((s) => s.floor !== floor)
      d.obstacles = d.obstacles.filter((o) => o.floor !== floor)
      d.waypoints = d.waypoints.filter((w) => w.floor !== floor)
      d.edges = d.edges.filter((e) => !ids.has(e.from) && !ids.has(e.to))
      d.floors = (d.floors || []).filter((x) => x.floor !== floor)
    })
    setSel(null)
  }

  // ---------------- GPS
  const pinGps = async () => {
    setBusy('gps')
    try {
      const p = await getCurrentPosition()
      const [x, y] = fromLatLng(draft, p.lat, p.lng)
      commit((d) => { const it = find(d, sel); if (it) { it.x = r1(x); it.y = r1(y) } })
      toast(`Đã ghim tọa độ GPS (±${Math.round(p.accuracy)} m) cho ${sel.type === 'slot' ? `ô ${sel.id}` : 'điểm đang chọn'}`, 'success')
    } catch (err) { toast(err.message, 'error') } finally { setBusy('') }
  }
  const pinOrigin = async () => {
    setBusy('origin')
    try {
      const p = await getCurrentPosition()
      commit((d) => { d.origin_lat = +p.lat.toFixed(7); d.origin_lng = +p.lng.toFixed(7) })
      toast(`Đã đặt điểm gốc (0,0) của bãi tại vị trí của bạn (±${Math.round(p.accuracy)} m)`, 'success')
    } catch (err) { toast(err.message, 'error') } finally { setBusy('') }
  }

  // ---------------- lưu / xuất / nhập
  const save = async () => {
    setBusy('save')
    try {
      const out = await api('/api/map/config', { method: 'PUT', body: draft })
      setMapConfigCache(out)
      setDraft(structuredClone(out)); setDirty(false); setHistory([])
      toast(`Đã lưu sơ đồ "${out.name}" — ${out.slots.length} ô, đồng bộ realtime tới mọi màn hình`, 'success')
    } catch (err) { toast(err.message, 'error') } finally { setBusy('') }
  }
  const discard = () => { if (dirty && !confirm('Bỏ mọi thay đổi chưa lưu?')) return; setDraft(structuredClone(live)); setDirty(false); setHistory([]); setSel(null) }
  const resetDefault = async () => {
    if (!confirm('Khôi phục bố cục mặc định cho các ô hiện có (giữ neo GPS và góc xoay)? Bố cục đang có sẽ bị thay thế.')) return
    setBusy('default')
    try {
      const out = await api('/api/map/reset-default', { method: 'POST' })
      setMapConfigCache(out); setDraft(structuredClone(out)); setDirty(false); setHistory([])
      toast('Đã khôi phục sơ đồ mặc định', 'success')
    } catch (err) { toast(err.message, 'error') } finally { setBusy('') }
  }
  const exportJson = () => {
    const { updated_at, updated_by, ...data } = project(draft) // eslint-disable-line no-unused-vars
    saveBlob(new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' }), `so-do-${(draft.name || 'bai-xe').normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9]+/gi, '-').toLowerCase()}.json`)
  }
  const importJson = async (file) => {
    try {
      const data = JSON.parse(await file.text())
      if (!Array.isArray(data.slots) || !Array.isArray(data.waypoints) || !data.gate_in) throw new Error('File không phải sơ đồ bãi xe hợp lệ')
      setHistory((h) => [...h, draft])
      setDraft({ obstacles: [], edges: [], floors: [], ...data })
      setDirty(true); setSel(null)
      toast(`Đã nạp "${data.name || file.name}" — kiểm tra rồi bấm Lưu sơ đồ`, 'info')
    } catch (err) { toast(err.message || 'File JSON không hợp lệ', 'error') }
  }

  // ---------------- vẽ
  const wps = Object.fromEntries(draft.waypoints.map((w) => [w.id, w]))
  const fs = Math.max(0.8, Math.min(view.w, view.h) / 26)
  const isSel = (type, id) => sel?.type === type && sel?.id === id
  const zoom = (k) => setView((v) => ({ x: v.x + (v.w * (1 - k)) / 2, y: v.y + (v.h * (1 - k)) / 2, w: v.w * k, h: v.h * k }))
  const sensorsUsed = Object.fromEntries(draft.slots.filter((s) => s.hardware_sensor_id !== 'NONE').map((s) => [s.hardware_sensor_id, s.slot_code]))
  const projected = preview === 'gps' ? project(draft) : null

  return (
    <div className="space-y-4">
      {/* Thanh công cụ */}
      <div className="card !p-3">
        <div className="flex flex-wrap items-center gap-2">
          <div className="flex flex-wrap rounded-xl border border-slate-800 bg-slate-950/60 p-1">
            {TOOLS.map(([id, label, I]) => (
              <button key={id} onClick={() => { setTool(id); setEdgeFrom(null) }} title={label}
                className={`flex min-h-[38px] items-center gap-1.5 rounded-lg px-2.5 text-xs font-medium sm:text-sm ${tool === id ? 'bg-sky-500 text-white' : 'text-slate-300 hover:text-white'}`}>
                <I className="h-4 w-4" /> <span className="hidden md:inline">{label}</span>
              </button>
            ))}
          </div>
          {tool === 'edge' && (
            <label className="flex items-center gap-1.5 text-sm"><input type="checkbox" checked={oneway} onChange={(e) => setOneway(e.target.checked)} /> Đường 1 chiều</label>
          )}
          <label className="flex items-center gap-1.5 text-sm"><input type="checkbox" checked={snap} onChange={(e) => setSnap(e.target.checked)} /> Bắt lưới 0,5</label>
          <div className="ml-auto flex flex-wrap gap-1.5">
            <button className="btn-ghost btn-sm" onClick={undo} disabled={!history.length}><Undo2 className="h-3.5 w-3.5" /> Hoàn tác</button>
            <button className="btn-ghost btn-sm" onClick={exportJson}><Download className="h-3.5 w-3.5" /> Xuất JSON</button>
            <button className="btn-ghost btn-sm" onClick={() => fileRef.current?.click()}><Upload className="h-3.5 w-3.5" /> Nhập JSON</button>
            <input ref={fileRef} type="file" accept="application/json,.json" hidden onChange={(e) => { const f = e.target.files?.[0]; if (f) importJson(f); e.target.value = '' }} />
            <button className="btn-ghost btn-sm" onClick={resetDefault} disabled={!!busy}><RefreshCcw className="h-3.5 w-3.5" /> Mặc định</button>
            {dirty && <button className="btn-ghost btn-sm" onClick={discard}>Bỏ thay đổi</button>}
            <button className="btn-primary btn-sm" onClick={save} disabled={!dirty || !!busy}>
              {busy === 'save' ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Save className="h-3.5 w-3.5" />} Lưu sơ đồ
            </button>
          </div>
        </div>
        <p className="mt-2 text-xs text-slate-400">
          {tool === 'select' && 'Kéo-thả ô, vật cản, waypoint, cổng để di chuyển. Chạm để xem/sửa thuộc tính bên phải.'}
          {tool === 'slot' && 'Chạm vào vùng trống để thêm ô mới (mã tự đặt theo tầng).'}
          {tool === 'obstacle' && 'Chạm để thêm vật cản (cột / tường / bốt bảo vệ — đổi loại bên phải).'}
          {tool === 'waypoint' && 'Chạm để thêm điểm lối đi; dùng công cụ "Nối lối đi" để nối các điểm.'}
          {tool === 'edge' && (edgeFrom ? `Đang nối từ ${edgeFrom} — chạm waypoint kế tiếp (chạm lại điểm đang chọn để dừng).` : 'Chạm waypoint đầu, rồi các waypoint tiếp theo để nối thành lối đi.')}
          {dirty && <b className="ml-1 text-amber-300">· Có thay đổi chưa lưu</b>}
        </p>
      </div>

      <div className="grid gap-4 xl:grid-cols-[1fr_340px]">
        {/* Khung vẽ */}
        <div className="card !p-3">
          <div className="mb-2 flex flex-wrap items-center gap-2">
            <div className="flex flex-wrap rounded-xl border border-slate-800 bg-slate-950/60 p-1">
              {floors.map((f) => (
                <button key={f} onClick={() => { setFloor(f); setSel(null) }} className={`min-h-[34px] rounded-lg px-3 text-xs font-semibold sm:text-sm ${floor === f ? 'bg-sky-500 text-white' : 'text-slate-300'}`}>Tầng {f}</button>
              ))}
            </div>
            <button className="btn-ghost btn-sm" onClick={addFloor}><Plus className="h-3.5 w-3.5" /> Tầng</button>
            <button className="btn-ghost btn-sm" onClick={removeFloor}><Minus className="h-3.5 w-3.5" /> Xóa tầng</button>
            <div className="ml-auto flex gap-1">
              <div className="flex rounded-lg border border-slate-800 p-0.5">
                {[['plan', LayoutGrid, 'Sơ đồ 2D'], ['gps', Globe2, 'Xem trên GPS']].map(([id, I, label]) => (
                  <button key={id} onClick={() => setPreview(id)} title={label} className={`flex min-h-[30px] items-center gap-1 rounded-md px-2 text-xs ${preview === id ? 'bg-sky-500 text-white' : 'text-slate-300'}`}><I className="h-3.5 w-3.5" /><span className="hidden sm:inline">{label}</span></button>
                ))}
              </div>
              {preview === 'plan' && <>
                <button className="btn-ghost btn-sm" onClick={() => zoom(0.8)} aria-label="Phóng to"><Plus className="h-3.5 w-3.5" /></button>
                <button className="btn-ghost btn-sm" onClick={() => zoom(1.25)} aria-label="Thu nhỏ"><Minus className="h-3.5 w-3.5" /></button>
                <button className="btn-ghost btn-sm" onClick={fit} aria-label="Vừa khung"><Maximize className="h-3.5 w-3.5" /></button>
              </>}
            </div>
          </div>
          {preview === 'gps' ? (
            <Suspense fallback={<MapFallback height={460} />}>
              <LeafletMap cfg={projected} slots={slots} floor={floor} height={460} highlightCode={sel?.type === 'slot' ? sel.id : null}
                onSlotClick={(s) => setSel({ type: 'slot', id: s.slot_code })} />
            </Suspense>
          ) : (
            <svg ref={svgRef} viewBox={`${view.x} ${view.y} ${view.w} ${view.h}`} className="h-[min(62vh,560px)] w-full touch-none select-none rounded-xl bg-slate-950/70"
              onPointerMove={onMove} onPointerUp={endDrag} onPointerLeave={endDrag} onClick={canvasClick} role="application" aria-label={`Trình chỉnh sửa sơ đồ Tầng ${floor}`}>
              <defs>
                <pattern id="ed-grid" width="1" height="1" patternUnits="userSpaceOnUse"><path d="M1 0 L0 0 0 1" fill="none" stroke={dark ? '#1e293b' : '#e2e8f0'} strokeWidth="0.04" /></pattern>
                <marker id="ed-arrow" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="5" markerHeight="5" orient="auto"><path d="M0 0 L10 5 L0 10 z" fill="#8b5cf6" /></marker>
              </defs>
              <rect x={view.x - 200} y={view.y - 200} width={view.w + 400} height={view.h + 400} fill="url(#ed-grid)" />
              {draft.edges.map((e, i) => {
                const a = wps[e.from], b = wps[e.to]
                if (!a || !b || a.floor !== floor || b.floor !== floor) return null
                return (
                  <g key={i} onClick={(ev) => { ev.stopPropagation(); setSel({ type: 'edge', id: i }) }} style={{ cursor: 'pointer' }}>
                    <line x1={a.x} y1={a.y} x2={b.x} y2={b.y} stroke="transparent" strokeWidth={1.2} />
                    <line x1={a.x} y1={a.y} x2={b.x} y2={b.y} stroke={isSel('edge', i) ? '#2563eb' : '#8b5cf6'} strokeWidth={isSel('edge', i) ? 0.35 : 0.2}
                      strokeDasharray={e.oneway ? '0.6 0.4' : undefined} markerEnd={e.oneway ? 'url(#ed-arrow)' : undefined} />
                  </g>
                )
              })}
              {draft.obstacles.filter((o) => o.floor === floor).map((o) => (
                <rect key={o.id} x={o.x - o.w / 2} y={o.y - o.h / 2} width={o.w} height={o.h} transform={`rotate(${o.rotation || 0} ${o.x} ${o.y})`}
                  fill={o.kind === 'booth' ? '#2563eb' : '#64748b'} stroke={isSel('obstacle', o.id) ? '#f59e0b' : 'none'} strokeWidth={0.2}
                  onPointerDown={(e) => startDrag(e, 'obstacle', o.id)} onClick={(e) => e.stopPropagation()} style={{ cursor: 'move' }} />
              ))}
              {draft.slots.filter((s) => s.floor === floor).map((s) => {
                const c = slotColorFor(statusOf[s.slot_code] || 'available', dark)
                return (
                  <g key={s.slot_code} transform={`rotate(${s.rotation || 0} ${s.x} ${s.y})`} onPointerDown={(e) => startDrag(e, 'slot', s.slot_code)}
                    onClick={(e) => e.stopPropagation()} style={{ cursor: 'move' }}>
                    <rect x={s.x - s.w / 2} y={s.y - s.h / 2} width={s.w} height={s.h} rx={0.3} fill={c.fill}
                      stroke={isSel('slot', s.slot_code) ? '#2563eb' : c.stroke} strokeWidth={isSel('slot', s.slot_code) ? 0.4 : 0.12} />
                    <text x={s.x} y={s.y - 0.3} textAnchor="middle" dominantBaseline="central" fontSize={fs} fontWeight="700" fill={c.text} pointerEvents="none">{s.slot_code.slice(3)}</text>
                    {s.hardware_sensor_id !== 'NONE' && (
                      <text x={s.x} y={s.y + fs} textAnchor="middle" dominantBaseline="central" fontSize={fs * 0.6} fill="#8b5cf6" fontWeight="700" pointerEvents="none">{s.hardware_sensor_id}</text>
                    )}
                  </g>
                )
              })}
              {draft.waypoints.filter((w) => w.floor === floor).map((w) => (
                <circle key={w.id} cx={w.x} cy={w.y} r={isSel('waypoint', w.id) || edgeFrom === w.id ? 0.65 : 0.45}
                  fill={{ ramp: '#8b5cf6', gate_in: '#059669', gate_out: '#e11d48' }[w.kind] || '#0ea5e9'} stroke={edgeFrom === w.id ? '#f59e0b' : '#fff'} strokeWidth={0.12}
                  onPointerDown={(e) => startDrag(e, 'waypoint', w.id)} onClick={(e) => e.stopPropagation()} style={{ cursor: tool === 'edge' ? 'crosshair' : 'move' }} />
              ))}
              {floor === firstFloor && ['gate_in', 'gate_out'].map((g) => (
                <g key={g} onPointerDown={(e) => startDrag(e, g, g)} onClick={(e) => e.stopPropagation()} style={{ cursor: 'move' }}>
                  <rect x={draft[g].x - 1.3} y={draft[g].y - 0.65} width={2.6} height={1.3} rx={0.3} fill={g === 'gate_in' ? '#059669' : '#e11d48'}
                    stroke={isSel(g, g) ? '#f59e0b' : 'none'} strokeWidth={0.2} />
                  <text x={draft[g].x} y={draft[g].y} textAnchor="middle" dominantBaseline="central" fontSize={fs * 0.6} fontWeight="700" fill="#fff" pointerEvents="none">{g === 'gate_in' ? 'VÀO' : 'RA'}</text>
                </g>
              ))}
            </svg>
          )}
        </div>

        {/* Bảng thuộc tính */}
        <div className="space-y-4">
          <div className="card !p-3">
            <div className="card-title"><MapIcon className="h-4 w-4" /> Neo GPS cả bãi</div>
            <div className="grid grid-cols-2 gap-2">
              <div className="col-span-2"><label className="label" htmlFor="me-name">Tên sơ đồ</label><input id="me-name" className="input" value={draft.name} maxLength={80} onChange={(e) => commit((d) => { d.name = e.target.value })} /></div>
              <div><label className="label" htmlFor="me-lat">origin_lat</label><input id="me-lat" className="input font-mono" type="number" step="0.000001" value={draft.origin_lat} onChange={(e) => commit((d) => { d.origin_lat = Number(e.target.value) })} /></div>
              <div><label className="label" htmlFor="me-lng">origin_lng</label><input id="me-lng" className="input font-mono" type="number" step="0.000001" value={draft.origin_lng} onChange={(e) => commit((d) => { d.origin_lng = Number(e.target.value) })} /></div>
              <div className="col-span-2">
                <label className="label" htmlFor="me-rot">Góc xoay bãi: <b>{Math.round(draft.rotation_deg)}°</b> (tự quy đổi lat/lng toàn bộ {draft.slots.length} ô)</label>
                <input id="me-rot" type="range" min="0" max="359" step="1" className="w-full accent-sky-500" value={draft.rotation_deg}
                  onChange={(e) => { setDraft((d) => ({ ...d, rotation_deg: Number(e.target.value) })); setDirty(true) }} />
              </div>
              <div><label className="label" htmlFor="me-scale">Mét / đơn vị</label><input id="me-scale" className="input" type="number" min="0.01" max="100" step="0.05" value={draft.scale_meters_per_unit} onChange={(e) => commit((d) => { d.scale_meters_per_unit = Number(e.target.value) || 1 })} /></div>
              <div className="flex items-end"><button className="btn-ghost btn-sm w-full" onClick={pinOrigin} disabled={!!busy}>{busy === 'origin' ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Crosshair className="h-3.5 w-3.5" />} Gốc = vị trí tôi</button></div>
            </div>
          </div>

          <div className="card !p-3">
            <div className="card-title"><Layers className="h-4 w-4" /> {sel ? ({ slot: `Ô ${sel.id}`, obstacle: 'Vật cản', waypoint: `Waypoint ${sel.id}`, edge: 'Lối đi', gate_in: 'Cổng vào', gate_out: 'Cổng ra' })[sel.type] : 'Thuộc tính'}</div>
            {!selected ? <p className="text-sm text-slate-400">Chạm một đối tượng trên sơ đồ để sửa. Cảm biến đang gán: {Object.entries(sensorsUsed).map(([k, v]) => `${k}→${v}`).join(', ') || 'chưa có'}.</p> : (
              <div className="space-y-2">
                {sel.type === 'edge' ? (
                  <>
                    <div className="text-sm"><span className="font-mono">{selected.from}</span> {selected.oneway ? '→' : '↔'} <span className="font-mono">{selected.to}</span></div>
                    <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={selected.oneway} onChange={(e) => setField('oneway', e.target.checked)} /> Đường 1 chiều</label>
                    <button className="btn-ghost btn-sm" onClick={() => commit((d) => { const e = d.edges[sel.id]; [e.from, e.to] = [e.to, e.from] })}><ArrowLeftRight className="h-3.5 w-3.5" /> Đảo chiều</button>
                  </>
                ) : (
                  <>
                    {sel.type === 'slot' && (
                      <div className="grid grid-cols-2 gap-2">
                        <div className="col-span-2"><label className="label" htmlFor="me-code">Mã ô</label>
                          <input id="me-code" className="input font-mono uppercase" defaultValue={selected.slot_code} key={selected.slot_code}
                            onBlur={(e) => {
                              const v = e.target.value.trim().toUpperCase()
                              if (v === selected.slot_code) return
                              if (!/^T[1-9]-[A-Z]\d{2}$/.test(v) || +v[1] !== selected.floor) { toast(`Mã ô phải dạng T${selected.floor}-A01 (đúng số tầng)`, 'error'); e.target.value = selected.slot_code; return }
                              if (draft.slots.some((s) => s.slot_code === v)) { toast(`Đã có ô ${v}`, 'error'); e.target.value = selected.slot_code; return }
                              commit((d) => { find(d, sel).slot_code = v }); setSel({ type: 'slot', id: v })
                            }} /></div>
                        <div><label className="label" htmlFor="me-sensor">Cảm biến ESP32</label>
                          <select id="me-sensor" className="input" value={selected.hardware_sensor_id} onChange={(e) => {
                            const v = e.target.value
                            commit((d) => { if (v !== 'NONE') d.slots.forEach((s) => { if (s.hardware_sensor_id === v) s.hardware_sensor_id = 'NONE' }); find(d, sel).hardware_sensor_id = v })
                          }}>
                            {SENSORS.map((s) => <option key={s} value={s}>{s}{sensorsUsed[s] && sensorsUsed[s] !== selected.slot_code ? ` (đang ở ${sensorsUsed[s]})` : ''}</option>)}
                          </select></div>
                        <div><label className="label" htmlFor="me-radius">Bán kính GPS (m)</label><input id="me-radius" className="input" type="number" min="0.5" max="50" step="0.5" value={selected.gps_radius_m} onChange={(e) => setField('gps_radius_m', Number(e.target.value))} /></div>
                      </div>
                    )}
                    {sel.type === 'obstacle' && (
                      <div><label className="label" htmlFor="me-kind">Loại</label>
                        <select id="me-kind" className="input" value={selected.kind} onChange={(e) => setField('kind', e.target.value)}>
                          {Object.entries(OBS_LABEL).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
                        </select></div>
                    )}
                    {sel.type === 'waypoint' && (
                      <div><label className="label" htmlFor="me-wkind">Loại điểm</label>
                        <select id="me-wkind" className="input" value={selected.kind} onChange={(e) => setField('kind', e.target.value)}>
                          {Object.entries(WP_LABEL).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
                        </select></div>
                    )}
                    <div className="grid grid-cols-2 gap-2">
                      <div><label className="label" htmlFor="me-x">x</label><input id="me-x" className="input" type="number" step="0.1" value={selected.x} onChange={(e) => setField('x', Number(e.target.value))} /></div>
                      <div><label className="label" htmlFor="me-y">y</label><input id="me-y" className="input" type="number" step="0.1" value={selected.y} onChange={(e) => setField('y', Number(e.target.value))} /></div>
                      {['slot', 'obstacle'].includes(sel.type) && <>
                        <div><label className="label" htmlFor="me-w">Rộng</label><input id="me-w" className="input" type="number" min="0.1" step="0.1" value={selected.w} onChange={(e) => setField('w', Number(e.target.value))} /></div>
                        <div><label className="label" htmlFor="me-h">Dài</label><input id="me-h" className="input" type="number" min="0.1" step="0.1" value={selected.h} onChange={(e) => setField('h', Number(e.target.value))} /></div>
                        <div className="col-span-2">
                          <label className="label" htmlFor="me-r"><RotateCw className="mr-1 inline h-3 w-3" />Góc xoay: <b>{Math.round(selected.rotation || 0)}°</b></label>
                          <input id="me-r" type="range" min="0" max="359" step="1" className="w-full accent-sky-500" value={selected.rotation || 0} onChange={(e) => setField('rotation', Number(e.target.value))} />
                        </div>
                      </>}
                    </div>
                    {sel.type !== 'obstacle' && (
                      <button className="btn-primary btn-sm w-full" onClick={pinGps} disabled={!!busy}>
                        {busy === 'gps' ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <LocateFixed className="h-3.5 w-3.5" />} Lấy tọa độ GPS hiện tại của tôi
                      </button>
                    )}
                    {sel.type === 'slot' && selected.lat && <p className="text-[11px] text-slate-400">GPS đã lưu: {Number(selected.lat).toFixed(6)}, {Number(selected.lng).toFixed(6)}</p>}
                  </>
                )}
                {!['gate_in', 'gate_out'].includes(sel.type) && (
                  <button className="btn-danger btn-sm w-full" onClick={remove}><Trash2 className="h-3.5 w-3.5" /> Xóa {sel.type === 'slot' ? `ô ${sel.id}` : sel.type === 'edge' ? 'lối đi' : 'đối tượng'}</button>
                )}
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}
