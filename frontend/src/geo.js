/* Hình học bản đồ: chiếu tọa độ nội bộ (x phải, y xuống — như SVG; đơn vị × scale_meters_per_unit = mét)
 * <-> GPS thật (origin_lat/lng + rotation_deg), khoảng cách / hướng, tìm đường trên lưới lối đi (1 chiều / 2 chiều),
 * và sinh câu chỉ đường tiếng Việt. Công thức giống hệt backend/mapcfg.py. */
const M_PER_DEG = 111320
const rad = (d) => (d * Math.PI) / 180

export function toLatLng(cfg, x, y) {
  const s = Number(cfg.scale_meters_per_unit) || 1
  const th = rad(Number(cfg.rotation_deg) || 0)
  const e = x * s, n = -y * s
  const e2 = e * Math.cos(th) + n * Math.sin(th)
  const n2 = -e * Math.sin(th) + n * Math.cos(th)
  const lat0 = Number(cfg.origin_lat)
  return [lat0 + n2 / M_PER_DEG, Number(cfg.origin_lng) + e2 / (M_PER_DEG * Math.cos(rad(lat0)))]
}

export function fromLatLng(cfg, lat, lng) {
  const s = Number(cfg.scale_meters_per_unit) || 1
  const th = rad(Number(cfg.rotation_deg) || 0)
  const lat0 = Number(cfg.origin_lat)
  const e2 = (lng - Number(cfg.origin_lng)) * M_PER_DEG * Math.cos(rad(lat0))
  const n2 = (lat - lat0) * M_PER_DEG
  const e = e2 * Math.cos(th) - n2 * Math.sin(th)
  const n = e2 * Math.sin(th) + n2 * Math.cos(th)
  return [round3(e / s), round3(-n / s)]
}
const round3 = (v) => Math.round(v * 1000) / 1000

/** Tính lại lat/lng cho cổng, ô, waypoint (giống backend `project`). */
export function project(cfg) {
  const out = structuredClone(cfg)
  for (const k of ['gate_in', 'gate_out']) [out[k].lat, out[k].lng] = toLatLng(out, out[k].x, out[k].y).map((v) => +v.toFixed(7))
  for (const it of [...out.slots, ...out.waypoints]) [it.lat, it.lng] = toLatLng(out, it.x, it.y).map((v) => +v.toFixed(7))
  return out
}

/** 4 góc của hình chữ nhật (ô đỗ / vật cản) đã xoay quanh tâm -> danh sách [lat, lng] hoặc [x, y]. */
export function rectCorners(item, cfg = null) {
  const { x, y } = item
  const w = (item.w ?? 3) / 2, h = (item.h ?? 5) / 2
  const th = rad(item.rotation || 0)
  const pts = [[-w, -h], [w, -h], [w, h], [-w, h]].map(([dx, dy]) => [
    x + dx * Math.cos(th) - dy * Math.sin(th),
    y + dx * Math.sin(th) + dy * Math.cos(th),
  ])
  return cfg ? pts.map(([px, py]) => toLatLng(cfg, px, py)) : pts
}

/** Khoảng cách (m) giữa 2 điểm {lat, lng} hoặc [lat, lng]. */
export function distance(a, b) {
  const [la1, lo1] = Array.isArray(a) ? a : [a.lat, a.lng]
  const [la2, lo2] = Array.isArray(b) ? b : [b.lat, b.lng]
  const R = 6371000
  const dLat = rad(la2 - la1), dLng = rad(lo2 - lo1)
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(rad(la1)) * Math.cos(rad(la2)) * Math.sin(dLng / 2) ** 2
  return 2 * R * Math.asin(Math.sqrt(h))
}

/** Hướng (0–360°, 0 = Bắc) từ a tới b. */
export function bearing(a, b) {
  const [la1, lo1] = Array.isArray(a) ? a : [a.lat, a.lng]
  const [la2, lo2] = Array.isArray(b) ? b : [b.lat, b.lng]
  const y = Math.sin(rad(lo2 - lo1)) * Math.cos(rad(la2))
  const x = Math.cos(rad(la1)) * Math.sin(rad(la2)) - Math.sin(rad(la1)) * Math.cos(rad(la2)) * Math.cos(rad(lo2 - lo1))
  return ((Math.atan2(y, x) * 180) / Math.PI + 360) % 360
}

const COMPASS = ['Bắc', 'Đông Bắc', 'Đông', 'Đông Nam', 'Nam', 'Tây Nam', 'Tây', 'Tây Bắc']
export const compass = (deg) => COMPASS[Math.round(deg / 45) % 8]

export const fmtMeters = (m) => (m >= 1000 ? `${(m / 1000).toFixed(1).replace('.', ',')} km` : `${Math.round(m)} m`)

/** Điểm cách `p` một khoảng `meters` theo hướng `deg`. */
export function offset([lat, lng], meters, deg) {
  const dn = meters * Math.cos(rad(deg)), de = meters * Math.sin(rad(deg))
  return [lat + dn / M_PER_DEG, lng + de / (M_PER_DEG * Math.cos(rad(lat)))]
}

/* ---------------- Tìm đường trong bãi ---------------- */
function graph(cfg) {
  const pos = Object.fromEntries(cfg.waypoints.map((w) => [w.id, w]))
  const adj = Object.fromEntries(cfg.waypoints.map((w) => [w.id, []]))
  for (const e of cfg.edges) {
    const a = pos[e.from], b = pos[e.to]
    if (!a || !b) continue
    const d = Math.hypot(a.x - b.x, a.y - b.y) + (a.floor !== b.floor ? 8 : 0)
    adj[a.id].push([b.id, d])
    if (!e.oneway) adj[b.id].push([a.id, d])
  }
  return { pos, adj }
}

export function nearestWp(cfg, floor, x, y) {
  let best = null
  for (const w of cfg.waypoints) {
    if (w.floor !== floor || !['node', 'ramp'].includes(w.kind)) continue
    const d = Math.hypot(w.x - x, w.y - y)
    if (!best || d < best[0]) best = [d, w.id]
  }
  return best?.[1]
}

/** Đường đi từ cổng vào (hoặc `fromId`) tới ô `slotCode`: [{x, y, floor, lat, lng, wp}] — null nếu không có đường. */
export function routeToSlot(cfg, slotCode, fromId = null) {
  const slot = cfg?.slots?.find((s) => s.slot_code === slotCode)
  if (!slot) return null
  const { pos, adj } = graph(cfg)
  const start = fromId || cfg.waypoints.find((w) => w.kind === 'gate_in')?.id
  const goal = nearestWp(cfg, slot.floor, slot.x, slot.y)
  if (!start || !goal) return null
  const dist = { [start]: 0 }, prev = {}, done = new Set()
  while (true) {
    let u = null
    for (const k in dist) if (!done.has(k) && (u === null || dist[k] < dist[u])) u = k
    if (u === null || u === goal) break
    done.add(u)
    for (const [v, w] of adj[u] || []) {
      if (dist[u] + w < (dist[v] ?? Infinity)) { dist[v] = dist[u] + w; prev[v] = u }
    }
  }
  if (dist[goal] === undefined) return null
  const ids = [goal]
  while (ids[0] !== start) ids.unshift(prev[ids[0]])
  const pts = ids.map((id) => ({ ...pos[id], wp: id }))
  pts.push({ x: slot.x, y: slot.y, floor: slot.floor, wp: null, slot: slotCode })
  return pts.map((p) => { const [lat, lng] = toLatLng(cfg, p.x, p.y); return { ...p, lat, lng } })
}

/** Câu chỉ đường tiếng Việt từ danh sách điểm (tọa độ nội bộ, y xuống). */
export function instructions(cfg, pts, slotCode) {
  if (!pts?.length) return []
  const s = Number(cfg.scale_meters_per_unit) || 1
  const out = []
  let acc = 0
  for (let i = 1; i < pts.length; i++) {
    const a = pts[i - 1], b = pts[i]
    if (a.floor !== b.floor) {
      if (acc > 0.5) out.push({ text: `Đi thẳng ${Math.round(acc)} mét`, at: i - 1 })
      acc = 0
      out.push({ text: `Theo dốc ${b.floor > a.floor ? 'lên' : 'xuống'} Tầng ${b.floor}`, at: i, floor: b.floor })
      continue
    }
    acc += Math.hypot(b.x - a.x, b.y - a.y) * s
    const c = pts[i + 1]
    if (!c || c.floor !== b.floor) continue
    const d1 = [b.x - a.x, b.y - a.y], d2 = [c.x - b.x, c.y - b.y]
    const cross = d1[0] * d2[1] - d1[1] * d2[0]
    const dot = d1[0] * d2[0] + d1[1] * d2[1]
    const ang = Math.abs((Math.atan2(cross, dot) * 180) / Math.PI)
    if (ang < 30) continue
    const dir = cross > 0 ? 'phải' : 'trái'
    out.push({ text: `Đi thẳng ${Math.max(1, Math.round(acc))} mét rồi rẽ ${dir}${c.slot ? ` vào ô ${slotCode}` : ''}`, at: i })
    acc = 0
  }
  const last = pts[pts.length - 1]
  if (acc > 0.5 && !out.some((o) => o.text.includes(`ô ${slotCode}`))) out.push({ text: `Đi thẳng ${Math.round(acc)} mét tới ô ${slotCode}`, at: pts.length - 1 })
  out.push({ text: `Đã tới ô ${slotCode}, Tầng ${last.floor}. Đỗ xe gọn trong vạch kẻ.`, at: pts.length - 1, arrive: true })
  return out
}

export function routeLength(cfg, pts) {
  const s = Number(cfg?.scale_meters_per_unit) || 1
  let d = 0
  for (let i = 1; i < (pts?.length || 0); i++) d += Math.hypot(pts[i].x - pts[i - 1].x, pts[i].y - pts[i - 1].y) * s + (pts[i].floor !== pts[i - 1].floor ? 8 : 0)
  return d
}

/** Nội suy đều các điểm trên polyline [lat,lng] (bước ~stepM mét) — dùng cho Giả lập lộ trình GPS. */
export function densify(latlngs, stepM = 2) {
  const out = []
  for (let i = 1; i < latlngs.length; i++) {
    const a = latlngs[i - 1], b = latlngs[i]
    const n = Math.max(1, Math.round(distance(a, b) / stepM))
    for (let k = 0; k < n; k++) out.push([a[0] + ((b[0] - a[0]) * k) / n, a[1] + ((b[1] - a[1]) * k) / n])
  }
  if (latlngs.length) out.push(latlngs[latlngs.length - 1])
  return out
}
