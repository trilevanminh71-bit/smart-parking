import { createContext, useCallback, useContext, useEffect, useState } from 'react'
import { CheckCircle2, AlertTriangle, Info, X } from 'lucide-react'

/* ---------------- Modal ---------------- */
export function Modal({ open, onClose, title, icon: Icon, children, width = 'max-w-md' }) {
  useEffect(() => {
    if (!open) return
    const onKey = (e) => e.key === 'Escape' && onClose?.()
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [open, onClose])
  if (!open) return null
  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/70 backdrop-blur-sm sm:items-center sm:p-4" onMouseDown={onClose}>
      <div className={`w-full ${width} max-h-[94dvh] overflow-y-auto rounded-t-2xl border border-slate-700 bg-slate-900 p-4 pb-[calc(1rem+env(safe-area-inset-bottom))] shadow-2xl sm:max-h-[92vh] sm:rounded-2xl sm:p-5`} onMouseDown={(e) => e.stopPropagation()}>
        <div className="mb-4 flex items-center justify-between gap-3">
          <h3 className="flex items-center gap-2 text-lg font-semibold">
            {Icon && <Icon className="h-5 w-5 text-sky-400" />} {title}
          </h3>
          <button className="rounded-lg p-1 text-slate-400 hover:bg-slate-800 hover:text-white" onClick={onClose} aria-label="Đóng">
            <X className="h-5 w-5" />
          </button>
        </div>
        {children}
      </div>
    </div>
  )
}

/* ---------------- Toast ---------------- */
const ToastCtx = createContext(() => {})
export const useToast = () => useContext(ToastCtx)

export function ToastProvider({ children }) {
  const [items, setItems] = useState([])
  const push = useCallback((message, type = 'info') => {
    const id = Math.random().toString(36).slice(2)
    setItems((xs) => [...xs.slice(-3), { id, message, type }])
    setTimeout(() => setItems((xs) => xs.filter((x) => x.id !== id)), 4500)
  }, [])
  const icons = { success: CheckCircle2, error: AlertTriangle, info: Info }
  const colors = {
    success: 'border-emerald-500/50 text-emerald-200',
    error: 'border-rose-500/50 text-rose-200',
    info: 'border-sky-500/50 text-sky-200',
  }
  return (
    <ToastCtx.Provider value={push}>
      {children}
      <div className="pointer-events-none fixed inset-x-3 top-[calc(4rem+env(safe-area-inset-top))] z-[60] flex flex-col gap-2 sm:inset-x-auto sm:bottom-4 sm:right-4 sm:top-auto sm:w-[380px]">
        {items.map((t) => {
          const I = icons[t.type]
          return (
            <div key={t.id} className={`pointer-events-auto flex items-start gap-2 rounded-xl border bg-slate-900/95 px-3 py-2.5 text-sm shadow-xl ${colors[t.type]}`}>
              <I className="mt-0.5 h-4 w-4 shrink-0" />
              <span>{t.message}</span>
            </div>
          )
        })}
      </div>
    </ToastCtx.Provider>
  )
}

/* ---------------- Misc ---------------- */
export function Stat({ icon: Icon, label, value, sub, tone = 'sky' }) {
  const tones = {
    sky: 'text-sky-400 bg-sky-500/10',
    emerald: 'text-emerald-400 bg-emerald-500/10',
    amber: 'text-amber-400 bg-amber-500/10',
    rose: 'text-rose-400 bg-rose-500/10',
    slate: 'text-slate-50 bg-[#475569] ring-1 ring-[#64748b]', // màu "Có xe"
    violet: 'text-violet-400 bg-violet-500/10',
  }
  return (
    <div className="card flex items-center gap-2.5 !p-3 sm:gap-3 sm:!p-3.5">
      <div className={`shrink-0 rounded-xl p-2 sm:p-2.5 ${tones[tone]}`}><Icon className="h-4 w-4 sm:h-5 sm:w-5" /></div>
      <div className="min-w-0">
        <div className="truncate text-xs text-slate-400">{label}</div>
        <div className="truncate text-lg font-bold tabular-nums sm:text-xl">{value}</div>
        {sub && <div className="truncate text-xs text-slate-500">{sub}</div>}
      </div>
    </div>
  )
}

export function Empty({ children }) {
  return <div className="rounded-xl border border-dashed border-slate-700 p-4 text-center text-sm text-slate-500">{children}</div>
}
