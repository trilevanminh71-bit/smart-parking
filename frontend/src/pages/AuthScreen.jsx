import { useState } from 'react'
import { ParkingSquare, LogIn, UserPlus, Loader2, Mail, Lock, User, Phone, Eye, EyeOff, ArrowLeft } from 'lucide-react'
import AccountSwitcher, { SwitcherHeader } from '../components/AccountSwitcher.jsx'
import { api } from '../api.js'

/**
 * Màn hình Đăng nhập / Tạo tài khoản (bắt buộc khi chưa đăng nhập).
 * Nếu trình duyệt đã lưu tài khoản -> hiện danh sách chọn nhanh trước.
 * Dùng lại cho "Đổi tài khoản": truyền `onCancel` để quay lại tài khoản đang dùng.
 */
export default function AuthScreen({ onAuth, accounts = [], currentEmail, onPick, onForget, initialEmail = '', onCancel, notice }) {
  const [view, setView] = useState(accounts.length && !initialEmail ? 'pick' : 'form')
  const [tab, setTab] = useState('login')
  const [form, setForm] = useState({ email: initialEmail, password: '', confirm: '', full_name: '', phone: '' })
  const [show, setShow] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const set = (k) => (e) => setForm((f) => ({ ...f, [k]: e.target.value }))

  const submit = async (e) => {
    e.preventDefault()
    setError('')
    if (tab === 'register') {
      if (form.password.length < 6) return setError('Mật khẩu phải có ít nhất 6 ký tự')
      if (form.password !== form.confirm) return setError('Mật khẩu nhập lại không khớp')
    }
    setBusy(true)
    try {
      const body = tab === 'login'
        ? { email: form.email, password: form.password }
        : { email: form.email, password: form.password, full_name: form.full_name, phone: form.phone }
      onAuth(await api(`/api/auth/${tab}`, { method: 'POST', body }))
    } catch (err) {
      setError(err.message)
    } finally {
      setBusy(false)
    }
  }

  const field = (k, label, Icon, props = {}) => (
    <div>
      <label className="label">{label}</label>
      <div className="relative">
        <Icon className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-500" />
        <input className="input pl-9" value={form[k]} onChange={set(k)} required {...props} />
      </div>
    </div>
  )

  return (
    <div className="flex min-h-screen items-center justify-center bg-[radial-gradient(ellipse_at_top,rgba(14,165,233,0.18),transparent_60%)] px-4 py-8">
      <div className="w-full max-w-md">
        <div className="mb-6 flex flex-col items-center text-center">
          <div className="mb-3 rounded-2xl bg-sky-500 p-3 shadow-lg shadow-sky-500/30"><ParkingSquare className="h-9 w-9 text-white" /></div>
          <h1 className="text-2xl font-bold">Bãi Đỗ Xe Thông Minh</h1>
          <p className="text-sm text-slate-400">Đặt chỗ, đóng cọc và thanh toán ngay trên điện thoại</p>
        </div>

        {notice && <div className="mb-3 rounded-xl border border-amber-500/40 bg-amber-500/10 px-3 py-2 text-sm text-amber-200">{notice}</div>}

        {view === 'pick' ? (
          <div className="card !p-4">
            <SwitcherHeader />
            <AccountSwitcher
              accounts={accounts}
              currentEmail={currentEmail}
              onForget={(email) => { onForget(email); if (accounts.length <= 1) setView('form') }}
              onAdd={() => { setForm((f) => ({ ...f, email: '' })); setTab('login'); setView('form') }}
              onPick={(a) => {
                if (a.token) return onPick(a)
                setForm((f) => ({ ...f, email: a.email, password: '' })) // phiên hết hạn -> nhập lại mật khẩu
                setTab('login'); setView('form'); setError('')
              }}
            />
            {onCancel && <button type="button" className="btn-ghost mt-2 w-full" onClick={onCancel}><ArrowLeft className="h-4 w-4" /> Quay lại</button>}
          </div>
        ) : (
        <div className="card !p-5">
          {(accounts.length > 0 || onCancel) && (
            <button type="button" onClick={() => (accounts.length ? setView('pick') : onCancel())}
              className="mb-3 flex items-center gap-1.5 text-sm text-slate-400 hover:text-white">
              <ArrowLeft className="h-4 w-4" /> {accounts.length ? 'Chọn tài khoản đã lưu' : 'Quay lại'}
            </button>
          )}
          <div className="mb-5 grid grid-cols-2 gap-1 rounded-xl bg-slate-950/70 p-1">
            {[['login', 'Đăng nhập', LogIn], ['register', 'Tạo tài khoản', UserPlus]].map(([id, label, I]) => (
              <button key={id} type="button" onClick={() => { setTab(id); setError('') }}
                className={`flex min-h-[44px] items-center justify-center gap-2 rounded-lg text-sm font-medium transition ${tab === id ? 'bg-sky-500 text-white' : 'text-slate-400 hover:text-white'}`}>
                <I className="h-4 w-4" /> {label}
              </button>
            ))}
          </div>

          <form onSubmit={submit} className="space-y-3">
            {tab === 'register' && field('full_name', 'Họ và tên', User, { placeholder: 'Nguyễn Văn A', autoComplete: 'name' })}
            {field('email', 'Email', Mail, { type: 'email', placeholder: 'ban@email.com', autoComplete: 'email', inputMode: 'email' })}
            {tab === 'register' && field('phone', 'Số điện thoại', Phone, { type: 'tel', placeholder: '09xx xxx xxx', autoComplete: 'tel', inputMode: 'tel' })}
            <div>
              <label className="label">Mật khẩu</label>
              <div className="relative">
                <Lock className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-500" />
                <input className="input px-9" type={show ? 'text' : 'password'} value={form.password} onChange={set('password')} required
                  autoComplete={tab === 'login' ? 'current-password' : 'new-password'} placeholder="••••••" />
                <button type="button" className="absolute right-2 top-1/2 -translate-y-1/2 p-1.5 text-slate-500 hover:text-white" onClick={() => setShow((s) => !s)} aria-label="Hiện/ẩn mật khẩu">
                  {show ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                </button>
              </div>
            </div>
            {tab === 'register' && field('confirm', 'Nhập lại mật khẩu', Lock, { type: show ? 'text' : 'password', autoComplete: 'new-password', placeholder: '••••••' })}

            {error && <div className="rounded-lg bg-rose-500/10 px-3 py-2 text-sm text-rose-300">{error}</div>}

            <button className="btn-primary w-full" disabled={busy}>
              {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : tab === 'login' ? <LogIn className="h-4 w-4" /> : <UserPlus className="h-4 w-4" />}
              {tab === 'login' ? 'Đăng nhập' : 'Tạo tài khoản'}
            </button>
          </form>
        </div>
        )}
        <p className="mt-4 text-center text-xs text-slate-600">Tài khoản tự đăng ký là tài khoản Khách hàng.</p>
      </div>
    </div>
  )
}
