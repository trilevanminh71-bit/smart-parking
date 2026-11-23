/* Bản đồ Kép: chuyển 1 chạm giữa Bản đồ GPS thực tế (Leaflet) và Sơ đồ 2D chi tiết từng tầng. */
import { lazy, Suspense, useState } from 'react'
import { Globe2, LayoutGrid, Loader2 } from 'lucide-react'
import FloorPlan from './FloorPlan.jsx'

const LeafletMap = lazy(() => import('./LeafletMap.jsx'))
const MODE_KEY = 'sp_map_mode'
const readMode = (d) => { try { return localStorage.getItem(MODE_KEY) || d } catch { return d } }

export function MapFallback({ height = 360 }) {
  return <div className="flex items-center justify-center gap-2 rounded-xl bg-slate-950/50 text-sm text-slate-400" style={{ height }}><Loader2 className="h-4 w-4 animate-spin" /> Đang tải bản đồ…</div>
}

export default function DualMap({ cfg, slots, floor, onFloor, floors, route, outside, user, highlightCode, flashCode, onSlotClick,
  focus, follow, height = 360, defaultMode = 'gps', mode: forced, onMode, extra }) {
  const [own, setOwn] = useState(() => readMode(defaultMode))
  const mode = forced || own
  const setMode = (m) => {
    setOwn(m)
    try { localStorage.setItem(MODE_KEY, m) } catch { /* ignore */ }
    onMode?.(m)
  }
  const fl = floors || [...new Set((cfg?.slots || []).map((s) => s.floor))].sort()

  return (
    <div className="space-y-2">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex rounded-xl border border-slate-800 bg-slate-950/60 p-1" role="tablist" aria-label="Chế độ bản đồ">
          {[['gps', 'Bản đồ GPS', Globe2], ['plan', 'Sơ đồ 2D', LayoutGrid]].map(([id, label, I]) => (
            <button key={id} role="tab" aria-selected={mode === id} onClick={() => setMode(id)}
              className={`flex min-h-[36px] items-center gap-1.5 rounded-lg px-3 text-xs font-semibold transition sm:text-sm ${mode === id ? 'bg-sky-500 text-white' : 'text-slate-300 hover:text-white'}`}>
              <I className="h-4 w-4" /> {label}
            </button>
          ))}
        </div>
        {onFloor && fl.length > 1 && (
          <div className="flex rounded-xl border border-slate-800 bg-slate-950/60 p-1">
            {fl.map((f) => (
              <button key={f} onClick={() => onFloor(f)}
                className={`min-h-[36px] rounded-lg px-3 text-xs font-semibold sm:text-sm ${floor === f ? 'bg-sky-500 text-white' : 'text-slate-300 hover:text-white'}`}>Tầng {f}</button>
            ))}
          </div>
        )}
        {extra}
      </div>
      {mode === 'gps' ? (
        <Suspense fallback={<MapFallback height={height} />}>
          <LeafletMap cfg={cfg} slots={slots} floor={floor} route={route} outside={outside} user={user} focus={focus}
            highlightCode={highlightCode} flashCode={flashCode} onSlotClick={onSlotClick} follow={follow} height={height} />
        </Suspense>
      ) : (
        <div className="overflow-hidden rounded-xl border border-slate-800 bg-slate-950/60" style={{ height }}>
          <FloorPlan cfg={cfg} floor={floor} slots={slots} route={route} user={user} highlightCode={highlightCode} flashCode={flashCode} onSlotClick={onSlotClick}
            className="!h-full !w-full !rounded-none" />
        </div>
      )}
    </div>
  )
}
