import { CheckCircle2, ChevronRight, KeyRound, ShieldCheck, Trash2, UserPlus, Users } from 'lucide-react'

const initials = (name = '', email = '') =>
  (name.trim().split(/\s+/).slice(-2).map((w) => w[0]).join('') || email[0] || '?').toUpperCase()

/** Danh sách tài khoản đã lưu trên trình duyệt: chọn nhanh, thêm tài khoản, xóa khỏi thiết bị. */
export default function AccountSwitcher({ accounts, currentEmail, onPick, onAdd, onForget }) {
  return (
    <div className="space-y-2">
      {accounts.length === 0 && (
        <div className="rounded-xl border border-dashed border-slate-700 p-4 text-center text-sm text-slate-500">Chưa có tài khoản nào được lưu trên thiết bị này</div>
      )}
      {accounts.map((a) => {
        const current = a.email === currentEmail
        const needLogin = !a.token
        return (
          <div key={a.email} className={`flex items-center gap-2 rounded-xl border p-2 ${current ? 'border-sky-500/60 bg-sky-500/10' : 'border-slate-800 bg-slate-950/50'}`}>
            <button type="button" onClick={() => !current && onPick(a)} disabled={current}
              className="flex min-h-[52px] min-w-0 flex-1 items-center gap-3 rounded-lg px-1 text-left enabled:hover:bg-slate-800/60">
              <span className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-full text-sm font-bold ${a.role === 'admin' ? 'bg-sky-500 text-white' : 'bg-slate-700 text-slate-200'}`}>
                {initials(a.full_name, a.email)}
              </span>
              <span className="min-w-0 flex-1">
                <span className="flex items-center gap-1.5 truncate font-medium">
                  {a.full_name || a.email}
                  {a.role === 'admin' && <ShieldCheck className="h-3.5 w-3.5 shrink-0 text-sky-400" />}
                </span>
                <span className="block truncate text-xs text-slate-400">{a.email}</span>
                {needLogin && !current && <span className="flex items-center gap-1 text-[11px] text-amber-400"><KeyRound className="h-3 w-3" /> Đã đăng xuất — chạm để nhập lại mật khẩu</span>}
              </span>
              {current
                ? <span className="flex shrink-0 items-center gap-1 text-xs text-sky-300"><CheckCircle2 className="h-4 w-4" /> Đang dùng</span>
                : <ChevronRight className="h-4 w-4 shrink-0 text-slate-500" />}
            </button>
            {!current && (
              <button type="button" title="Xóa tài khoản khỏi thiết bị này" aria-label="Xóa khỏi thiết bị"
                onClick={() => confirm(`Xóa ${a.email} khỏi danh sách trên thiết bị này?`) && onForget(a.email)}
                className="flex h-11 w-11 shrink-0 items-center justify-center rounded-lg text-slate-500 hover:bg-rose-500/15 hover:text-rose-300">
                <Trash2 className="h-4 w-4" />
              </button>
            )}
          </div>
        )
      })}
      <button type="button" onClick={() => onAdd('')} className="btn-ghost w-full !min-h-[48px]">
        <UserPlus className="h-4 w-4" /> Đăng nhập / Tạo tài khoản khác
      </button>
    </div>
  )
}

export function SwitcherHeader() {
  return (
    <div className="mb-3 flex items-center gap-2 text-sm text-slate-400">
      <Users className="h-4 w-4" /> Chọn tài khoản để tiếp tục
    </div>
  )
}
