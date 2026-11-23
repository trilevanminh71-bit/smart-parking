import { useCallback, useEffect, useState } from 'react'
import { KeyRound, Loader2, Save, UserPlus, Users, ShieldCheck, Trash2, AlertTriangle } from 'lucide-react'
import { Modal, useToast } from './ui.jsx'
import { api, fmtTime } from '../api.js'

const ROOT_ADMIN = 'trilevanminh71@gmail.com' // tài khoản Admin gốc: không xóa / hạ quyền

/** Form đổi mật khẩu (dùng cho mọi tài khoản). */
export function ChangePasswordForm({ onDone, onToken }) {
  const toast = useToast()
  const [f, setF] = useState({ old_password: '', new_password: '', confirm: '' })
  const [busy, setBusy] = useState(false)
  const set = (k) => (e) => setF((x) => ({ ...x, [k]: e.target.value }))
  const submit = async (e) => {
    e.preventDefault()
    if (f.new_password.length < 6) return toast('Mật khẩu mới phải có ít nhất 6 ký tự', 'error')
    if (f.new_password !== f.confirm) return toast('Mật khẩu nhập lại không khớp', 'error')
    setBusy(true)
    try {
      const r = await api('/api/auth/change-password', { method: 'POST', body: { old_password: f.old_password, new_password: f.new_password } })
      onToken?.(r.token)
      toast('Đã đổi mật khẩu thành công', 'success')
      setF({ old_password: '', new_password: '', confirm: '' })
      onDone?.()
    } catch (err) { toast(err.message, 'error') } finally { setBusy(false) }
  }
  return (
    <form onSubmit={submit} className="space-y-3">
      <div><label className="label">Mật khẩu hiện tại</label><input className="input" type="password" autoComplete="current-password" value={f.old_password} onChange={set('old_password')} required /></div>
      <div><label className="label">Mật khẩu mới (≥ 6 ký tự)</label><input className="input" type="password" autoComplete="new-password" value={f.new_password} onChange={set('new_password')} required /></div>
      <div><label className="label">Nhập lại mật khẩu mới</label><input className="input" type="password" autoComplete="new-password" value={f.confirm} onChange={set('confirm')} required /></div>
      <button className="btn-primary w-full" disabled={busy}>{busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />} Đổi mật khẩu</button>
    </form>
  )
}

export function AccountModal({ open, onClose, user, onToken }) {
  return (
    <Modal open={open} onClose={onClose} title="Tài khoản" icon={KeyRound}>
      <div className="mb-4 rounded-xl bg-slate-950/60 p-3 text-sm">
        <div className="font-semibold">{user?.full_name}</div>
        <div className="break-all text-slate-400">{user?.email}{user?.phone ? ` · ${user.phone}` : ''}</div>
        <div className="mt-1 text-xs text-sky-300">{ROLE_VI[user?.role] || 'Khách hàng'}</div>
      </div>
      <ChangePasswordForm onDone={onClose} onToken={onToken} />
    </Modal>
  )
}

/** Quản lý tài khoản Admin: tạo admin mới / nâng quyền, danh sách tài khoản, đổi mật khẩu. */
const ROLE_VI = { admin: 'Quản trị viên', guard: 'Bảo vệ trực cổng', customer: 'Khách hàng' }
const ROLE_BADGE = { admin: 'bg-sky-500/20 text-sky-300', guard: 'bg-amber-500/20 text-amber-300', customer: 'bg-slate-700 text-slate-300' }

export function AdminAccountsPanel({ me, onToken }) {
  const toast = useToast()
  const [users, setUsers] = useState([])
  const [f, setF] = useState({ email: '', full_name: '', phone: '', password: '', role: 'guard' })
  const [busy, setBusy] = useState(false)
  const [deleting, setDeleting] = useState(null)
  const set = (k) => (e) => setF((x) => ({ ...x, [k]: e.target.value }))

  const load = useCallback(() => api('/api/admin/users').then(setUsers).catch((err) => toast(err.message, 'error')), [toast])
  useEffect(() => { load() }, [load])

  const existing = users.find((u) => u.email === f.email.trim().toLowerCase())

  const submit = async (e) => {
    e.preventDefault()
    setBusy(true)
    try {
      const body = existing ? { email: f.email, role: f.role } : f
      const r = await api('/api/admin/users', { method: 'POST', body })
      const rv = f.role === 'admin' ? 'Admin' : 'Bảo vệ'
      toast(r.action === 'promoted' ? `Đã đổi quyền ${r.user.email} thành ${rv}` : `Đã tạo tài khoản ${rv} ${r.user.email}`, 'success')
      setF({ email: '', full_name: '', phone: '', password: '', role: f.role })
      load()
    } catch (err) { toast(err.message, 'error') } finally { setBusy(false) }
  }

  const setRole = async (u, role) => {
    if (role === u.role) return
    if (!confirm(`Đổi quyền ${u.email} thành ${ROLE_VI[role]}?`)) return
    try { await api(`/api/admin/users/${u.id}/role`, { method: 'PUT', body: { role } }); toast('Đã cập nhật quyền', 'success'); load() } catch (err) { toast(err.message, 'error') }
  }

  return (
    <div className="grid gap-5 lg:grid-cols-[1fr_1.3fr]">
      <div className="space-y-5">
        <form className="card space-y-3" onSubmit={submit}>
          <div className="card-title !mb-1"><UserPlus className="h-4 w-4" /> Tạo tài khoản Bảo vệ / Admin</div>
          <p className="text-xs text-slate-500">Nhập email đã có để đổi quyền, hoặc email mới để tạo tài khoản. Bảo vệ: vận hành cổng, barrier khẩn cấp, thu tiền mặt; không sửa bản đồ, không xóa dữ liệu.</p>
          <div className="grid grid-cols-2 gap-1 rounded-xl bg-slate-950/70 p-1">
            {[['guard', 'Bảo vệ'], ['admin', 'Admin']].map(([id, label]) => (
              <button key={id} type="button" onClick={() => setF((x) => ({ ...x, role: id }))}
                className={`min-h-[40px] rounded-lg text-sm font-medium ${f.role === id ? 'bg-sky-500 text-white' : 'text-slate-400'}`}>{label}</button>
            ))}
          </div>
          <div><label className="label">Email</label><input className="input" type="email" inputMode="email" value={f.email} onChange={set('email')} required /></div>
          {existing ? (
            <div className="rounded-lg bg-sky-500/10 px-3 py-2 text-sm text-sky-200">
              Đã có tài khoản <b>{existing.full_name}</b> (đang là {ROLE_VI[existing.role] || 'Khách hàng'}).
            </div>
          ) : (
            <>
              <div><label className="label">Họ và tên</label><input className="input" value={f.full_name} onChange={set('full_name')} required /></div>
              <div><label className="label">Số điện thoại (tuỳ chọn)</label><input className="input" type="tel" inputMode="tel" value={f.phone} onChange={set('phone')} /></div>
              <div><label className="label">Mật khẩu (≥ 6 ký tự)</label><input className="input" type="password" autoComplete="new-password" value={f.password} onChange={set('password')} required /></div>
            </>
          )}
          <button className="btn-primary w-full" disabled={busy || existing?.role === f.role}>
            {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <ShieldCheck className="h-4 w-4" />}
            {existing ? `Đổi quyền thành ${f.role === 'admin' ? 'Admin' : 'Bảo vệ'}` : `Tạo tài khoản ${f.role === 'admin' ? 'Admin' : 'Bảo vệ'}`}
          </button>
        </form>
        <div className="card">
          <div className="card-title"><KeyRound className="h-4 w-4" /> Đổi mật khẩu của bạn</div>
          <ChangePasswordForm onToken={onToken} />
        </div>
      </div>

      <div className="card">
        <div className="card-title"><Users className="h-4 w-4" /> Danh sách tài khoản ({users.length})</div>
        <div className="space-y-2">
          {users.map((u) => (
            <div key={u.id} className="flex flex-wrap items-center gap-3 rounded-xl border border-slate-800 bg-slate-950/50 p-3">
              <div className="min-w-0 flex-1">
                <div className="font-medium">{u.full_name} {u.id === me.id && <span className="text-xs text-slate-500">(bạn)</span>}</div>
                <div className="break-all text-xs text-slate-400">{u.email}{u.phone ? ` · ${u.phone}` : ''} · tạo {fmtTime(u.created_at)}</div>
              </div>
              <span className={`badge ${ROLE_BADGE[u.role] || ROLE_BADGE.customer}`}>
                {u.email === ROOT_ADMIN ? 'Admin gốc' : ROLE_VI[u.role] || 'Khách hàng'}
              </span>
              {u.id !== me.id && u.email !== ROOT_ADMIN && (
                <div className="flex gap-1.5">
                  <select className="input !min-h-[38px] !w-auto !py-1 text-xs" value={u.role} onChange={(e) => setRole(u, e.target.value)} aria-label={`Quyền của ${u.email}`}>
                    <option value="customer">Khách hàng</option><option value="guard">Bảo vệ</option><option value="admin">Admin</option>
                  </select>
                  <button className="btn-sm btn border border-rose-500/40 bg-rose-500/10 text-rose-300 hover:bg-rose-500/25"
                    onClick={() => setDeleting(u)} aria-label={`Xóa tài khoản ${u.email}`}>
                    <Trash2 className="h-3.5 w-3.5" /> Xóa
                  </button>
                </div>
              )}
            </div>
          ))}
        </div>
      </div>

      <DeleteUserModal user={deleting} onClose={() => setDeleting(null)}
        onDeleted={(r) => {
          toast(`Đã xóa tài khoản ${r.email}` + (r.freed_slots.length ? ` · hủy đặt chỗ & trả ô ${r.freed_slots.join(', ')}` : ''), 'success')
          setDeleting(null)
          load()
        }} />
    </div>
  )
}

/** Hộp thoại xác nhận xóa tài khoản (phải gõ đúng email để tránh bấm nhầm). */
function DeleteUserModal({ user, onClose, onDeleted }) {
  const toast = useToast()
  const [typed, setTyped] = useState('')
  const [busy, setBusy] = useState(false)
  useEffect(() => { setTyped('') }, [user?.id])
  if (!user) return null
  const ok = typed.trim().toLowerCase() === user.email

  const remove = async () => {
    setBusy(true)
    try { onDeleted(await api(`/api/admin/users/${user.id}`, { method: 'DELETE' })) }
    catch (err) { toast(err.message, 'error') } finally { setBusy(false) }
  }

  return (
    <Modal open onClose={busy ? undefined : onClose} title="Xóa tài khoản?" icon={AlertTriangle}>
      <div className="space-y-3 text-sm">
        <div className="rounded-xl bg-slate-950/60 p-3">
          <div className="font-semibold">{user.full_name}</div>
          <div className="break-all text-slate-400">{user.email}{user.phone ? ` · ${user.phone}` : ''}</div>
          <div className="mt-1 text-xs text-slate-500">{ROLE_VI[user.role] || 'Khách hàng'} · tạo {fmtTime(user.created_at)}</div>
        </div>
        <ul className="list-disc space-y-1 pl-5 text-slate-300">
          <li>Tài khoản bị xóa vĩnh viễn và đăng xuất ngay trên mọi thiết bị.</li>
          <li>Các đặt chỗ đang giữ ô (đã cọc hoặc chờ chuyển khoản) sẽ <b>tự hủy</b> và ô được <b>trả về trống</b>.</li>
          <li>Hóa đơn, doanh thu và nhật ký cũ <b>được giữ lại</b> (không còn gắn với tài khoản).</li>
        </ul>
        <div>
          <label className="label" htmlFor="del-confirm">Gõ lại email <b className="text-slate-200">{user.email}</b> để xác nhận</label>
          <input id="del-confirm" className="input" value={typed} onChange={(e) => setTyped(e.target.value)} autoComplete="off" autoCapitalize="off" spellCheck={false} />
        </div>
        <div className="flex flex-col-reverse gap-2 sm:flex-row">
          <button className="btn-ghost sm:flex-1" onClick={onClose} disabled={busy}>Hủy</button>
          <button className="btn-danger sm:flex-1" onClick={remove} disabled={!ok || busy}>
            {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Trash2 className="h-4 w-4" />} Xóa tài khoản
          </button>
        </div>
      </div>
    </Modal>
  )
}
