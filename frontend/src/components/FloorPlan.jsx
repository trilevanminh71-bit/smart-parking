/* Sơ đồ 2D chi tiết 1 tầng vẽ đúng theo cấu hình bản đồ (vị trí, góc xoay ô, vật cản, lối đi, cổng),
 * kèm tuyến dẫn đường và vị trí GPS người dùng (quy đổi về tọa độ nội bộ). */
import { useMemo } from 'react'
import { useTheme } from '../theme.jsx'
import { fromLatLng } from '../geo.js'
import { slotColorFor } from './mapColors.js'

export function planBounds(cfg, floor, pad = 3) {
  const items = [...cfg.slots.filter((s) => s.floor === floor), ...cfg.obstacles.filter((o) => o.floor === floor),
    ...cfg.waypoints.filter((w) => w.floor === floor)]
  if (floor === Math.min(...cfg.slots.map((s) => s.floor))) items.push(cfg.gate_in, cfg.gate_out)
  if (!items.length) return { x: 0, y: 0, w: 30, h: 20 }
  const xs = items.flatMap((i) => [i.x - (i.w || 1) / 2, i.x + (i.w || 1) / 2])
  const ys = items.flatMap((i) => [i.y - (i.h || 1) / 2, i.y + (i.h || 1) / 2])
  const x0 = Math.min(...xs) - pad, y0 = Math.min(...ys) - pad
  return { x: x0, y: y0, w: Math.max(...xs) + pad - x0, h: Math.max(...ys) + pad - y0 }
}

export default function FloorPlan({ cfg, floor, slots = [], route, user, highlightCode, flashCode, onSlotClick, showGraph = false, className = '' }) {
  const { resolved } = useTheme()
  const dark = resolved === 'dark'
  const statusOf = useMemo(() => Object.fromEntries(slots.map((s) => [s.code, s.status])), [slots])
  if (!cfg) return null
  const b = planBounds(cfg, floor)
  const firstFloor = Math.min(...cfg.slots.map((s) => s.floor))
  const wps = Object.fromEntries(cfg.waypoints.map((w) => [w.id, w]))
  const seg = (route || []).filter((p) => p.floor === floor)
  const me = user ? fromLatLng(cfg, user.lat, user.lng) : null
  const meInside = me && me[0] > b.x - 20 && me[0] < b.x + b.w + 20 && me[1] > b.y - 20 && me[1] < b.y + b.h + 20
  const fs = Math.max(0.9, Math.min(b.w, b.h) / 22)

  return (
    <svg viewBox={`${b.x} ${b.y} ${b.w} ${b.h}`} className={`h-auto w-full rounded-xl bg-slate-950/60 ${className}`} role="img"
      aria-label={`Sơ đồ chi tiết Tầng ${floor}`}>
      <defs>
        <marker id="fp-arrow" viewBox="0 0 10 10" refX="5" refY="5" markerWidth="4" markerHeight="4" orient="auto-start-reverse">
          <path d="M0 0 L10 5 L0 10 z" fill="#2563eb" />
        </marker>
      </defs>
      {/* Lối đi */}
      {cfg.edges.map((e, i) => {
        const a = wps[e.from], c = wps[e.to]
        if (!a || !c || a.floor !== floor || c.floor !== floor) return null
        return <line key={i} x1={a.x} y1={a.y} x2={c.x} y2={c.y} stroke={dark ? '#334155' : '#cbd5e1'} strokeWidth={showGraph ? 0.25 : 4}
          strokeLinecap="round" strokeDasharray={showGraph && e.oneway ? '0.8 0.5' : undefined} markerEnd={showGraph && e.oneway ? 'url(#fp-arrow)' : undefined} />
      })}
      {showGraph && cfg.waypoints.filter((w) => w.floor === floor).map((w) => (
        <circle key={w.id} cx={w.x} cy={w.y} r={0.45} fill={w.kind === 'ramp' ? '#8b5cf6' : '#64748b'} />
      ))}
      {/* Vật cản */}
      {cfg.obstacles.filter((o) => o.floor === floor).map((o) => (
        <rect key={o.id} x={o.x - o.w / 2} y={o.y - o.h / 2} width={o.w} height={o.h} rx={o.kind === 'pillar' ? 0.15 : 0.1}
          transform={`rotate(${o.rotation || 0} ${o.x} ${o.y})`} fill={o.kind === 'booth' ? '#2563eb' : dark ? '#64748b' : '#94a3b8'} opacity={o.kind === 'wall' ? 0.8 : 1} />
      ))}
      {/* Ô đỗ */}
      {cfg.slots.filter((s) => s.floor === floor).map((s) => {
        const st = statusOf[s.slot_code] || 'available'
        const c = slotColorFor(flashCode === s.slot_code ? 'flash' : st, dark)
        const hi = s.slot_code === highlightCode
        return (
          <g key={s.slot_code} transform={`rotate(${s.rotation || 0} ${s.x} ${s.y})`} className={flashCode === s.slot_code ? 'animate-pulse' : ''}
            onClick={onSlotClick ? () => onSlotClick(s, st) : undefined} style={onSlotClick ? { cursor: 'pointer' } : undefined}>
            <rect x={s.x - s.w / 2} y={s.y - s.h / 2} width={s.w} height={s.h} rx={0.35} fill={c.fill} stroke={hi ? '#2563eb' : c.stroke}
              strokeWidth={hi ? 0.45 : 0.15} />
            <text x={s.x} y={s.y} textAnchor="middle" dominantBaseline="central" fontSize={fs} fontWeight="700" fill={c.text}>{s.slot_code.slice(3)}</text>
          </g>
        )
      })}
      {/* Cổng */}
      {floor === firstFloor && (
        <>
          <g><rect x={cfg.gate_in.x - 1.2} y={cfg.gate_in.y - 0.6} width={2.4} height={1.2} rx={0.3} fill="#059669" />
            <text x={cfg.gate_in.x} y={cfg.gate_in.y} textAnchor="middle" dominantBaseline="central" fontSize={fs * 0.6} fontWeight="700" fill="#fff">VÀO</text></g>
          <g><rect x={cfg.gate_out.x - 1.2} y={cfg.gate_out.y - 0.6} width={2.4} height={1.2} rx={0.3} fill="#e11d48" />
            <text x={cfg.gate_out.x} y={cfg.gate_out.y} textAnchor="middle" dominantBaseline="central" fontSize={fs * 0.6} fontWeight="700" fill="#fff">RA</text></g>
        </>
      )}
      {/* Tuyến dẫn đường */}
      {seg.length > 1 && (
        <polyline points={seg.map((p) => `${p.x},${p.y}`).join(' ')} fill="none" stroke="#2563eb" strokeWidth={0.6}
          strokeLinecap="round" strokeLinejoin="round" strokeDasharray="1.2 0.7" markerEnd="url(#fp-arrow)">
          <animate attributeName="stroke-dashoffset" from="3.8" to="0" dur="0.8s" repeatCount="indefinite" />
        </polyline>
      )}
      {meInside && (
        <g transform={`translate(${me[0]} ${me[1]})`}>
          <circle r={1.1} fill="#2563eb" opacity="0.25"><animate attributeName="r" values="0.8;1.8;0.8" dur="1.6s" repeatCount="indefinite" /></circle>
          <circle r={0.6} fill="#2563eb" stroke="#fff" strokeWidth={0.2} />
        </g>
      )}
    </svg>
  )
}
