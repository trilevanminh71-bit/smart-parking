import { Empty } from './ui.jsx'
import { activityLabel, fmtTime } from '../api.js'

/** Danh sách lịch sử đăng nhập & hoạt động tài khoản. `showEmail` cho trang Admin. */
export default function ActivityList({ items, showEmail = false, empty = 'Không có hoạt động nào' }) {
  if (!items?.length) return <Empty>{empty}</Empty>
  return (
    <ol className="max-h-[480px] space-y-1.5 overflow-y-auto pr-1">
      {items.map((a) => {
        const { label, tone } = activityLabel(a.action)
        return (
          <li key={a.id} className="rounded-xl border border-slate-800 bg-slate-950/50 px-3 py-2 text-sm">
            <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-0.5">
              <span className={`font-semibold ${tone}`}>{label}</span>
              <time className="text-xs tabular-nums text-slate-500">{fmtTime(a.created_at)}</time>
            </div>
            {showEmail && a.email && <div className="break-all text-xs text-sky-300/80">{a.email}</div>}
            {a.details && <div className="break-words text-xs text-slate-400">{a.details}</div>}
          </li>
        )
      })}
    </ol>
  )
}
