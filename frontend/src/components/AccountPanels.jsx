import { useCallback, useEffect, useState } from 'react'
import { KeyRound, Loader2, Save, UserPlus, Users, ShieldCheck, ShieldOff, Trash2, AlertTriangle } from 'lucide-react'
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
        <div className="mt-1 text-xs text-sky-300">{user?.role === 'admin' ? 'Quản trị viên / Bảo vệ' : 'Khách hàng'}</div>
      </div>
      <ChangePasswordForm onDone={onClose} onToken={onToken} />
    </Modal>
  )
}

/** Quản lý tài khoản Admin: tạo admin mới / nâng quyền, danh sách tài khoản, đổi mật khẩu. */
export function AdminAccountsPanel({ me, onToken }) {
  const toast = useToast()
  const [users, setUsers] = useState([])
  const [f, setF] = useState({ email: '', full_name: '', phone: '', password: '' })
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
      const body = existing ? { email: f.email } : f
      const r = await api('/api/admin/users', { method: 'POST', body })
      toast(r.action === 'promoted' ? `Đã nâng quyền ${r.user.email} lên Admin` : `Đã tạo tài khoản Admin ${r.user.email}`, 'success')
      setF({ email: '', full_name: '', phone: '', password: '' })
      load()
    } catch (err) { toast(err.message, 'error') } finally { setBusy(false) }
  }

  const setRole = async (u, role) => {
    if (!confirm(`${role === 'admin' ? 'Nâng' : 'Hạ'} quyền ${u.email} thành ${role === 'admin' ? 'Admin' : 'Khách hàng'}?`)) return
    try { await api(`/api/admin/users/${u.id}/role`, { method: 'PUT', body: { role } }); toast('Đã cập nhật quyền', 'success'); load() } catch (err) { toast(err.message, 'error') }
  }

  return (
    <div className="grid gap-5 lg:grid-cols-[1fr_1.3fr]">
      <div className="space-y-5">
        <form className="card space-y-3" onSubmit={submit}>
          <div className="card-title !mb-1"><UserPlus className="h-4 w-4" /> Tạo thêm tài khoản Admin</div>
          <p className="text-xs text-slate-500">Nhập email của tài khoản đã có để nâng quyền lên Admin, hoặc email mới để tạo tài khoản Admin mới.</p>
          <div><label className="label">Email</label><input className="input" type="email" inputMode="email" value={f.email} onChange={set('email')} required /></div>
          {existing ? (
            <div className="rounded-lg bg-sky-500/10 px-3 py-2 text-sm text-sky-200">
              Đã có tài khoản <b>{existing.full_name}</b> ({existing.role === 'admin' ? 'đang là Admin' : 'Khách hàng'}).
            </div>
          ) : (
            <>
              <div><label className="label">Họ và tên</label><input className="input" value={f.full_name} onChange={set('full_name')} required /></div>
              <div><label className="label">Số điện thoại (tuỳ chọn)</label><input className="input" type="tel" inputMode="tel" value={f.phone} onChange={set('phone')} /></div>
              <div><label className="label">Mật khẩu (≥ 6 ký tự)</label><input className="input" type="password" autoComplete="new-password" value={f.password} onChange={set('password')} required /></div>
            </>
          )}
          <button className="btn-primary w-full" disabled={busy || existing?.role === 'admin'}>
            {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <ShieldCheck className="h-4 w-4" />}
            {existing ? 'Nâng quyền lên Admin' : 'Tạo tài khoản Admin'}
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
              <span className={`badge ${u.role === 'admin' ? 'bg-sky-500/20 text-sky-300' : 'bg-slate-700 text-slate-300'}`}>
                {u.email === ROOT_ADMIN ? 'Admin gốc' : u.role === 'admin' ? 'Admin' : 'Khách hàng'}
              </span>
              {u.id !== me.id && u.email !== ROOT_ADMIN && (
                <div className="flex gap-1.5">
                  {u.role === 'admin'
                    ? <button className="btn-ghost btn-sm" onClick={() => setRole(u, 'customer')}><ShieldOff className="h-3.5 w-3.5" /> Hạ quyền</button>
                    : <button className="btn-ghost btn-sm" onClick={() => setRole(u, 'admin')}><ShieldCheck className="h-3.5 w-3.5" /> Lên Admin</button>}
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
          <div className="mt-1 text-xs text-slate-500">{user.role === 'admin' ? 'Admin' : 'Khách hàng'} · tạo {fmtTime(user.created_at)}</div>
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
