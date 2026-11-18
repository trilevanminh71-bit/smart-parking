import { useEffect, useState } from 'react'
import { Search, ScrollText, Loader2, X } from 'lucide-react'
import ActivityList from './ActivityList.jsx'
import { activityLabel, api } from '../api.js'

/** Toàn bộ lịch sử đăng nhập & hoạt động của tất cả tài khoản, lọc theo email/nội dung và hành động. */
export default function AdminActivityPanel({ tick, toast }) {
  const [q, setQ] = useState('')
  const [action, setAction] = useState('')
  const [data, setData] = useState(null)
  const [loading, setLoading] = useState(false)

  useEffect(() => {
    const t = setTimeout(() => {
      setLoading(true)
      const params = new URLSearchParams({ q, action, limit: '300' })
      api(`/api/admin/activity?${params}`)
        .then(setData)
        .catch((err) => toast(err.message, 'error'))
        .finally(() => setLoading(false))
    }, 250) // chờ gõ xong rồi mới tìm
    return () => clearTimeout(t)
  }, [q, action, tick, toast])

  return (
    <div className="card">
      <div className="card-title"><ScrollText className="h-4 w-4" /> Lịch sử đăng nhập & hoạt động tài khoản</div>
      <div className="mb-3 grid gap-2 sm:grid-cols-[1fr_220px]">
        <div className="relative">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-500" />
          <input className="input px-9" placeholder="Tìm theo email, biển số, mã vé…" value={q} onChange={(e) => setQ(e.target.value)} aria-label="Tìm kiếm" />
          {q && (
            <button className="absolute right-2 top-1/2 -translate-y-1/2 p-1.5 text-slate-500 hover:text-white" onClick={() => setQ('')} aria-label="Xóa tìm kiếm">
              <X className="h-4 w-4" />
            </button>
          )}
        </div>
        <select className="input" value={action} onChange={(e) => setAction(e.target.value)} aria-label="Lọc theo hành động">
          <option value="">Tất cả hành động</option>
          {(data?.actions || []).map((a) => <option key={a} value={a}>{activityLabel(a).label}</option>)}
        </select>
      </div>
      <div className="mb-2 flex items-center gap-2 text-xs text-slate-500">
        {loading && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
        {data ? `${data.items.length} kết quả${data.items.length >= 300 ? ' (300 gần nhất)' : ''}` : 'Đang tải…'}
      </div>
      {data && <ActivityList items={data.items} showEmail empty="Không có hoạt động khớp bộ lọc" />}
    </div>
  )
}
