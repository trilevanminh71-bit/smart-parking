/* Chọn nhanh 1 ô đang trống trên mọi tầng (Đổi ô 1 chạm). */
import { useState } from 'react'
import { ArrowRightLeft, Loader2 } from 'lucide-react'
import { Modal } from './ui.jsx'

export default function SlotPicker({ open, slots = [], current, onPick, onClose, busy }) {
  const floors = [...new Set(slots.map((s) => s.floor))].sort()
  const [floor, setFloor] = useState(null)
  const f = floor ?? floors[0]
  const free = slots.filter((s) => s.status === 'available' && s.floor === f)
  return (
    <Modal open={open} onClose={onClose} title="Đổi sang ô trống khác" icon={ArrowRightLeft}>
      <p className="mb-3 text-sm text-slate-300">Ô hiện tại: <b className="font-mono">{current}</b>. Chạm vào ô trống muốn chuyển — ô cũ sẽ được trả lại ngay.</p>
      <div className="mb-3 flex flex-wrap gap-1.5">
        {floors.map((x) => {
          const n = slots.filter((s) => s.floor === x && s.status === 'available').length
          return (
            <button key={x} onClick={() => setFloor(x)}
              className={`min-h-[40px] rounded-xl px-3 text-sm font-semibold ${x === f ? 'bg-sky-500 text-white' : 'border border-slate-700 text-slate-200'}`}>
              Tầng {x} <span className="text-xs font-normal opacity-80">({n} trống)</span>
            </button>
          )
        })}
      </div>
      {free.length === 0 ? <div className="py-6 text-center text-sm text-slate-400">Tầng này không còn ô trống</div> : (
        <div className="grid grid-cols-4 gap-2 sm:grid-cols-5">
          {free.map((s) => (
            <button key={s.code} disabled={busy} onClick={() => onPick(s)}
              className="slot-available flex min-h-[56px] flex-col items-center justify-center rounded-xl border-2 border-emerald-500/60 bg-emerald-500/15 font-mono text-sm font-bold text-emerald-300 hover:bg-emerald-500/25 disabled:opacity-50">
              {busy === s.code ? <Loader2 className="h-4 w-4 animate-spin" /> : s.code.slice(3)}
              <span className="font-sans text-[10px] font-normal opacity-80">{s.code}</span>
            </button>
          ))}
        </div>
      )}
    </Modal>
  )
}
