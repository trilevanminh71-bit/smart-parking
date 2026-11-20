import { Car, ArrowRight, DoorOpen, ArrowUpRight, Hourglass } from 'lucide-react'
import { STATUS } from '../api.js'

/** Tổng quan 3 tầng dạng 3D (xếp chồng isometric) — bấm để chọn tầng. */
export function ParkingMap3D({ summary, floor, onFloor }) {
  return (
    <div className="flex flex-col items-center py-2" style={{ perspective: '900px' }}>
      {[3, 2, 1].map((f) => {
        const s = summary?.[f] || { total: 10, available: 0, reserved: 0, occupied: 0 }
        const active = f === floor
        return (
          <button
            key={f}
            onClick={() => onFloor(f)}
            className={`relative -mb-6 h-20 w-full max-w-[260px] rounded-xl border-2 transition-all duration-300 ${
              active ? 'z-10 border-sky-400 bg-sky-500/25 shadow-[0_0_30px_rgba(56,189,248,.35)]' : 'border-slate-700 bg-slate-800/80 hover:border-slate-500'
            }`}
            style={{ transform: `rotateX(58deg) rotateZ(-38deg) translateZ(${active ? 18 : 0}px)` }}
          >
            <div className="absolute inset-1.5 grid grid-cols-5 grid-rows-2 gap-1">
              {Array.from({ length: s.total }).map((_, i) => {
                const st = i < s.occupied ? 'dot-occupied bg-[#475569] ring-1 ring-inset ring-[#64748b] !opacity-100' : i < s.occupied + s.reserved ? 'dot-reserved bg-amber-400' : 'dot-available bg-emerald-400'
                return <span key={i} className={`rounded-sm ${st} opacity-80`} />
              })}
            </div>
          </button>
        )
      })}
      <div className="mt-10 grid w-full grid-cols-3 gap-2 text-center text-xs">
        {[1, 2, 3].map((f) => (
          <button key={f} onClick={() => onFloor(f)} className={`rounded-lg px-2 py-1 ${f === floor ? 'bg-sky-500/20 text-sky-300' : 'text-slate-400 hover:text-slate-200'}`}>
            Tầng {f}: <b className="text-emerald-800 dark:text-emerald-400">{summary?.[f]?.available ?? 0}</b> trống
          </button>
        ))}
      </div>
    </div>
  )
}

function Slot({ slot, selectable, highlight, onSelect, large }) {
  const st = STATUS[slot.status] || STATUS.available
  const can = selectable && slot.status === 'available'
  const num = slot.code.slice(-3)
  const size = large ? 'h-24 sm:h-32 text-sm' : 'h-20 sm:h-28 text-xs'
  return (
    <button
      disabled={!can}
      onClick={() => can && onSelect?.(slot)}
      title={`${slot.code} — ${st.label}`}
      aria-label={`Ô ${slot.code}: ${st.label}${can ? ' — chạm để đặt chỗ' : ''}`}
      className={`group relative flex min-w-0 flex-col items-center justify-center rounded-xl border-2 font-semibold transition ${size} ${st.cls} ${
        can ? `cursor-pointer hover:-translate-y-0.5 ${large ? 'border-solid shadow-[0_0_0_1px_rgba(16,185,129,.15)] active:scale-95' : 'border-dashed'}` : 'cursor-default border-dashed'
      } ${highlight ? 'ring-4 ring-sky-400 ring-offset-2 ring-offset-slate-900 animate-pulse' : ''}`}
    >
      {slot.status === 'available' ? (
        <span className={`font-black ${large ? 'text-3xl opacity-60' : 'text-2xl opacity-30'}`}>P</span>
      ) : slot.status === 'pending_payment' ? (
        <Hourglass className="h-6 w-6 opacity-70" />
      ) : (
        slot.status === 'occupied'
          ? <Car className={large ? 'h-9 w-9' : 'h-8 w-8'} strokeWidth={2.4} />
          : <Car className="h-7 w-7 opacity-50" />
      )}
      <span className="mt-1 font-mono">{num}</span>
      <span className={`${large ? 'block text-[11px] sm:text-xs' : 'hidden text-[10px] min-[420px]:block'} font-normal leading-tight opacity-90`}>{st.short || st.label}</span>
    </button>
  )
}

/** Sơ đồ 2D một tầng: dãy trên (01–05), làn xe, dãy dưới (06–10). */
export default function ParkingMap2D({ slots, floor, selectable = false, onSelect, highlightCode, large = false }) {
  const top = slots.filter((s) => +s.code.slice(-2) <= 5)
  const bottom = slots.filter((s) => +s.code.slice(-2) > 5)
  return (
    <div className="rounded-2xl border border-slate-800 bg-slate-950/60 p-3 sm:p-4">
      <div className="grid grid-cols-5 gap-2 sm:gap-3">
        {top.map((s) => <Slot key={s.id} slot={s} selectable={selectable} onSelect={onSelect} highlight={s.code === highlightCode} large={large} />)}
      </div>
      <div className="relative my-2 flex h-12 items-center rounded-xl bg-slate-800/70 px-2 sm:my-3 sm:h-14 sm:px-3">
        <div className="flex shrink-0 items-center gap-1 rounded-lg bg-sky-500/20 px-2 py-1 text-[11px] font-semibold text-sky-300 sm:text-xs">
          {floor === 1 ? <DoorOpen className="h-4 w-4" /> : <ArrowUpRight className="h-4 w-4" />}
          {floor === 1 ? 'Cổng vào' : `Dốc lên T${floor}`}
        </div>
        <div className="mx-2 flex min-w-0 flex-1 items-center justify-around border-t-2 border-dashed border-slate-600 sm:mx-3">
          {[0, 1, 2, 3].map((i) => <ArrowRight key={i} className={`-mt-[13px] h-6 w-6 text-slate-500 ${i > 1 ? 'hidden sm:block' : ''}`} />)}
        </div>
        <div className="shrink-0 text-[11px] text-slate-500 sm:text-xs">{floor < 3 ? `Lên T${floor + 1}` : 'Cuối tầng'}</div>
      </div>
      <div className="grid grid-cols-5 gap-2 sm:gap-3">
        {bottom.map((s) => <Slot key={s.id} slot={s} selectable={selectable} onSelect={onSelect} highlight={s.code === highlightCode} large={large} />)}
      </div>
      <div className="mt-3 flex flex-wrap justify-center gap-x-4 gap-y-1.5 text-xs text-slate-400">
        {Object.entries(STATUS).map(([k, v]) => (
          <span key={k} className="flex items-center gap-1.5"><span className={`h-2.5 w-2.5 rounded-full ${v.dot}`} />{v.label}</span>
        ))}
      </div>
    </div>
  )
}
