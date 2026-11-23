/* Bản đồ GPS thực tế (Leaflet + OpenStreetMap): nền CartoDB Positron (Sáng) / Dark Matter (Tối),
 * vẽ ô đỗ theo tọa độ thật (đã xoay), cổng vào/ra, vật cản, tuyến dẫn đường, vị trí GPS của người dùng.
 * File này được tải lười (React.lazy) để không làm nặng trang đầu. */
import { useEffect, useMemo } from 'react'
import { CircleMarker, MapContainer, Marker, Polygon, Polyline, TileLayer, Tooltip, useMap } from 'react-leaflet'
import L from 'leaflet'
import 'leaflet/dist/leaflet.css'
import { useTheme } from '../theme.jsx'
import { rectCorners } from '../geo.js'

const TILES = {
  light: 'https://{s}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}{r}.png',
  dark: 'https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png',
}
const ATTR = '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> &copy; <a href="https://carto.com/attributions">CARTO</a>'

export function slotColor(status, dark) {
  return { available: '#10b981', reserved: '#f59e0b', pending_payment: dark ? '#f97316' : '#f59e0b', occupied: dark ? '#64748b' : '#ef4444' }[status] || '#94a3b8'
}
const OBS = { pillar: '#64748b', wall: '#475569', booth: '#2563eb' }

const gateIcon = (label, color) => L.divIcon({
  className: '',
  html: `<div style="width:max-content;transform:translate(-50%,-50%);background:${color};color:#fff;font:700 11px/1 Inter,system-ui;padding:5px 7px;border-radius:8px;white-space:nowrap;box-shadow:0 2px 6px rgba(0,0,0,.35)">${label}</div>`,
})
const userIcon = (heading) => L.divIcon({
  className: '',
  html: `<div style="transform:translate(-50%,-50%) rotate(${heading || 0}deg);width:26px;height:26px;border-radius:50%;background:#fff;box-shadow:0 1px 6px rgba(0,0,0,.45);display:flex;align-items:center;justify-content:center">
    <svg width="16" height="16" viewBox="-8 -8 16 16"><path d="M0 -7 L6 6 L0 3 L-6 6 Z" fill="#2563eb"/></svg></div>`,
})

function Fit({ bounds, deps }) {
  const map = useMap()
  useEffect(() => {
    if (!bounds?.length) return
    const b = L.latLngBounds(bounds)
    if (b.isValid()) map.fitBounds(b.pad(0.15), { maxZoom: 21, animate: true })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [deps])
  return null
}

function Follow({ pos, on }) {
  const map = useMap()
  useEffect(() => { if (on && pos) map.panTo(pos, { animate: true }) }, [on, pos, map])
  return null
}

/**
 * @param cfg      cấu hình bản đồ
 * @param slots    trạng thái ô [{code, status}]
 * @param floor    tầng đang xem (ô/vật cản tầng khác bị ẩn)
 * @param route    [{lat,lng,floor}] tuyến trong bãi
 * @param outside  [[lat,lng],[lat,lng]] đường từ vị trí người dùng tới cổng (chặng 1)
 * @param user     {lat,lng,heading,accuracy}
 * @param focus    'route' | 'outside' | 'all' | 'user' (mặc định 'all')
 */
export default function LeafletMap({ cfg, slots = [], floor = 1, route, outside, user, focus = 'all', highlightCode, flashCode,
  onSlotClick, follow = false, height = 360, className = '' }) {
  const { resolved } = useTheme()
  const dark = resolved === 'dark'
  const statusOf = useMemo(() => Object.fromEntries(slots.map((s) => [s.code, s.status])), [slots])
  if (!cfg) return <div className="flex items-center justify-center rounded-xl bg-slate-950/50 text-sm text-slate-400" style={{ height }}>Đang tải bản đồ…</div>

  const floorSlots = cfg.slots.filter((s) => s.floor === floor)
  const floorObs = cfg.obstacles.filter((o) => o.floor === floor)
  const routeLL = (route || []).map((p) => [p.lat, p.lng])
  const gateIn = [cfg.gate_in.lat, cfg.gate_in.lng]
  const gateOut = [cfg.gate_out.lat, cfg.gate_out.lng]
  const lotBounds = [...floorSlots.map((s) => [s.lat, s.lng]), gateIn, gateOut]
  const bounds = focus === 'outside' && outside ? [...outside, ...routeLL]
    : focus === 'route' && routeLL.length ? [gateIn, ...routeLL]
      : focus === 'user' && user ? [[user.lat, user.lng]] : lotBounds
  const fitKey = `${focus}|${floor}|${cfg.updated_at}|${highlightCode}|${outside ? 'o' : ''}|${routeLL.length}`

  return (
    <div className={`overflow-hidden rounded-xl border border-slate-800 ${className}`} style={{ height }}>
      <MapContainer center={gateIn} zoom={19} maxZoom={22} scrollWheelZoom style={{ height: '100%', width: '100%' }} attributionControl>
        <TileLayer key={dark ? 'd' : 'l'} url={TILES[dark ? 'dark' : 'light']} attribution={ATTR} subdomains="abcd" maxNativeZoom={18} maxZoom={22} />
        <Fit bounds={bounds} deps={fitKey} />
        <Follow pos={user ? [user.lat, user.lng] : null} on={follow} />

        {floorObs.map((o) => (
          <Polygon key={o.id} positions={rectCorners(o, cfg)} pathOptions={{ color: OBS[o.kind], fillColor: OBS[o.kind], fillOpacity: 0.55, weight: 1 }}>
            <Tooltip>{{ pillar: 'Cột', wall: 'Tường', booth: 'Bốt bảo vệ' }[o.kind]}</Tooltip>
          </Polygon>
        ))}

        {floorSlots.map((s) => {
          const st = statusOf[s.slot_code] || 'available'
          const hi = s.slot_code === highlightCode
          const flash = s.slot_code === flashCode
          const color = flash ? '#ef4444' : slotColor(st, dark)
          return (
            <Polygon key={s.slot_code} positions={rectCorners(s, cfg)}
              className={flash ? 'leaflet-flash' : ''}
              eventHandlers={onSlotClick ? { click: () => onSlotClick(s, st) } : undefined}
              pathOptions={{ color: hi ? '#2563eb' : color, weight: hi || flash ? 4 : 1.5, fillColor: color, fillOpacity: hi ? 0.75 : 0.45 }}>
              <Tooltip direction="center" permanent className="slot-tip">{s.slot_code.slice(3)}</Tooltip>
            </Polygon>
          )
        })}

        {outside && <Polyline positions={outside} pathOptions={{ color: '#2563eb', weight: 5, dashArray: '8 10', opacity: 0.9 }} />}
        {routeLL.length > 1 && (
          <>
            <Polyline positions={routeLL} pathOptions={{ color: dark ? '#0f172a' : '#ffffff', weight: 9, opacity: 0.9 }} />
            <Polyline positions={routeLL} pathOptions={{ color: '#2563eb', weight: 5, opacity: 1 }} />
          </>
        )}

        <Marker position={gateIn} icon={gateIcon('CỔNG VÀO', '#059669')} />
        <Marker position={gateOut} icon={gateIcon('CỔNG RA', '#e11d48')} />

        {user && (
          <>
            {user.accuracy > 3 && <CircleMarker center={[user.lat, user.lng]} radius={Math.min(60, user.accuracy * 2)} pathOptions={{ color: '#2563eb', weight: 1, fillOpacity: 0.12 }} />}
            <Marker position={[user.lat, user.lng]} icon={userIcon(user.heading)} zIndexOffset={1000} />
          </>
        )}
      </MapContainer>
    </div>
  )
}
