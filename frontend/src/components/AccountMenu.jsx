/* Khối tài khoản trên Header: 1 nút duy nhất (Avatar + Tên + Email + mũi tên) mở menu
 * Vai trò · Chuyển tài khoản / Đăng nhập tài khoản khác · Đổi mật khẩu · Hướng dẫn · Đăng xuất. */
import { useEffect, useRef, useState } from 'react'
import { ChevronDown, HelpCircle, KeyRound, LogOut, Repeat, ShieldCheck, User, UserCog } from 'lucide-react'

export const ROLE_LABEL = { admin: 'Quản trị viên', guard: 'Bảo vệ trực cổng', customer: 'Khách hàng' }
const ROLE_STYLE = {
  admin: { avatar: 'bg-sky-500 text-white', badge: 'bg-sky-500/15 text-sky-300', icon: UserCog },
  guard: { avatar: 'bg-amber-500 text-slate-950', badge: 'bg-amber-500/15 text-amber-300', icon: ShieldCheck },
  customer: { avatar: 'bg-slate-700 text-slate-200', badge: 'bg-slate-700/60 text-slate-200', icon: User },
}

export default function AccountMenu({ user, onSwitch, onPassword, onGuide, onLogout }) {
  const [open, setOpen] = useState(false)
  const ref = useRef(null)
  const st = ROLE_STYLE[user.role] || ROLE_STYLE.customer
  const RoleIcon = st.icon
  const initials = (user.full_name || user.email).trim().split(/\s+/).slice(-2).map((w) => w[0]).join('').toUpperCase()

  // Đóng khi bấm ra ngoài hoặc nhấn Esc
  useEffect(() => {
    if (!open) return
    const onDown = (e) => { if (ref.current && !ref.current.contains(e.target)) setOpen(false) }
    const onKey = (e) => e.key === 'Escape' && setOpen(false)
    document.addEventListener('pointerdown', onDown)
    document.addEventListener('keydown', onKey)
    return () => { document.removeEventListener('pointerdown', onDown); document.removeEventListener('keydown', onKey) }
  }, [open])

  const item = (Icon, label, onClick, cls = '') => (
    <button role="menuitem" onClick={() => { setOpen(false); onClick() }}
      className={`flex min-h-[48px] w-full items-center gap-2.5 px-3 text-left text-sm transition hover:bg-slate-800 ${cls}`}>
      <Icon className="h-4 w-4 shrink-0" /> {label}
    </button>
  )

  return (
    <div ref={ref} className="relative shrink-0">
      <button onClick={() => setOpen((o) => !o)} aria-expanded={open} aria-haspopup="menu" aria-label={`Tài khoản ${user.email}`}
        className={`flex min-h-[44px] items-center gap-2 rounded-xl border bg-slate-900 py-1 pl-1 pr-1.5 transition sm:pr-2 ${open ? 'border-sky-500' : 'border-slate-800 hover:border-slate-600'}`}>
        <span className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-xs font-bold ${st.avatar}`}>{initials}</span>
        <span className="hidden w-[120px] min-w-0 text-left lg:block xl:w-[160px]">
          <span className="block truncate text-sm font-semibold leading-tight">{user.full_name}</span>
          <span className="block truncate text-[11px] leading-tight text-slate-400">{user.email}</span>
        </span>
        <ChevronDown className={`h-4 w-4 shrink-0 text-slate-500 transition ${open ? 'rotate-180' : ''}`} />
      </button>

      {open && (
        <div role="menu" className="absolute right-0 top-full z-[70] mt-2 w-[min(calc(100vw-1.5rem),300px)] overflow-hidden rounded-2xl border border-slate-700 bg-slate-900 shadow-2xl">
          <div className="flex items-start gap-3 border-b border-slate-800 p-3">
            <span className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-full text-sm font-bold ${st.avatar}`}>{initials}</span>
            <div className="min-w-0">
              <div className="truncate font-semibold">{user.full_name}</div>
              <div className="break-all text-xs text-slate-400">{user.email}</div>
              <span className={`badge mt-1.5 ${st.badge}`}><RoleIcon className="h-3 w-3" /> {ROLE_LABEL[user.role] || 'Khách hàng'}</span>
              {(user.phone || user.default_plate) && (
                <div className="mt-1 text-xs text-slate-500">{[user.phone, user.default_plate].filter(Boolean).join(' · ')}</div>
              )}
            </div>
          </div>
          {item(Repeat, 'Chuyển tài khoản / Đăng nhập tài khoản khác', onSwitch, 'text-slate-100 [&>svg]:text-sky-400')}
          {item(KeyRound, 'Đổi mật khẩu', onPassword, '[&>svg]:text-slate-400')}
          {item(HelpCircle, 'Hướng dẫn sử dụng', onGuide, '[&>svg]:text-slate-400')}
          <div className="border-t border-slate-800">
            {item(LogOut, 'Đăng xuất', onLogout, 'font-semibold text-rose-300 hover:!bg-rose-500/10')}
          </div>
        </div>
      )}
    </div>
  )
}
