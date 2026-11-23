import { useCallback, useEffect, useRef, useState } from 'react'
import { ParkingSquare, Users, ShieldCheck, Wifi, WifiOff, HelpCircle, LocateFixed, LocateOff, Locate } from 'lucide-react'
import AccountMenu from './components/AccountMenu.jsx'
import { GeoProvider, useGeo } from './gps.jsx'
import OnboardingGuide, { guideSeen, markGuideSeen } from './components/OnboardingGuide.jsx'
import CustomerView from './pages/CustomerView.jsx'
import AdminView from './pages/AdminView.jsx'
import AuthScreen from './pages/AuthScreen.jsx'
import { AccountModal } from './components/AccountPanels.jsx'
import { ToastProvider } from './components/ui.jsx'
import PrefsControls from './components/PrefsControls.jsx'
import { useBackHome } from './nav.js'
import { useLang } from './i18n/index.jsx'
import {
  api, emitEvent, expireAccount, forgetAccount, loadAccounts, loadAuth, rememberAccount, saveAuth, tokenValid, useNow, useRealtime,
} from './api.js'

const MODE_KEY = 'sp_mode'

export default function App() {
  const [auth, setAuth] = useState(() => {
    const a = loadAuth()
    return a && tokenValid(a.token) ? a : null
  })
  const [accounts, setAccounts] = useState(loadAccounts)
  const [switching, setSwitching] = useState(false)
  const [switchEmail, setSwitchEmail] = useState('')
  const [notice, setNotice] = useState('')
  const authRef = useRef(auth)
  authRef.current = auth

  const login = useCallback((a) => {
    saveAuth(a)
    rememberAccount(a)
    setAccounts(loadAccounts())
    setAuth(a)
    setSwitching(false)
    setSwitchEmail('')
    setNotice('')
  }, [])

  // Token hết hạn / bị vô hiệu -> về màn hình chọn tài khoản
  useEffect(() => {
    const onExpired = () => {
      const email = authRef.current?.user?.email
      if (email) expireAccount(email)
      saveAuth(null)
      setAccounts(loadAccounts())
      setAuth(null)
      setNotice(email ? `Phiên đăng nhập của ${email} đã hết hạn, vui lòng đăng nhập lại.` : '')
    }
    window.addEventListener('sp-logout', onExpired)
    return () => window.removeEventListener('sp-logout', onExpired)
  }, [])

  // Làm mới thông tin tài khoản (tên/SĐT/biển số vừa lưu, quyền mới…)
  const refreshUser = useCallback(() => {
    if (!authRef.current?.token) return
    api('/api/auth/me').then((user) => {
      const a = authRef.current
      if (!a) return
      const next = { ...a, user }
      saveAuth(next)
      rememberAccount(next)
      setAccounts(loadAccounts())
      if (JSON.stringify(a.user) !== JSON.stringify(user)) setAuth(next)
    }).catch(() => {})
  }, [])
  useEffect(() => { refreshUser() }, [auth?.token, refreshUser])

  // Đăng xuất: bỏ token (tài khoản vẫn nằm trong danh sách chọn nhanh nhưng phải nhập lại mật khẩu), về màn hình đăng nhập
  const logout = useCallback(() => {
    const email = authRef.current?.user?.email
    const token = authRef.current?.token
    if (token) fetch('/api/auth/logout', { method: 'POST', headers: { Authorization: `Bearer ${token}` } }).catch(() => {})
    if (email) expireAccount(email)
    saveAuth(null)
    try { ['sp_mode', 'sp_admin_tab', 'sp_customer_tab'].forEach((k) => localStorage.removeItem(k)) } catch { /* ignore */ }
    try { window.speechSynthesis?.cancel() } catch { /* ignore */ }
    if (history.state?.spNav) history.replaceState(null, '', location.pathname)
    setAccounts(loadAccounts())
    setSwitching(false)
    setAuth(null)
    setNotice(email ? `Đã đăng xuất ${email}.` : 'Đã đăng xuất.')
  }, [])

  // Menu tài khoản: "Chuyển sang Bảo vệ / Khách hàng / Quản trị viên"
  const ROLE_EMAIL = { guard: 'guard@smartparking.vn', admin: 'trilevanminh71@gmail.com' }
  const switchRole = useCallback((role, saved) => {
    if (saved?.token && tokenValid(saved.token)) return login({ token: saved.token, user: saved.user })
    setSwitchEmail(saved?.email || ROLE_EMAIL[role] || '')
    setSwitching(true)
  }, [login]) // eslint-disable-line react-hooks/exhaustive-deps

  const showAuth = !auth || switching

  return (
    <ToastProvider>
      {showAuth ? (
        <AuthScreen
          key={switching ? `switch:${switchEmail}` : 'login'}
          initialEmail={switchEmail}
          accounts={accounts}
          currentEmail={auth?.user?.email}
          notice={notice}
          onAuth={login}
          onPick={(a) => login({ token: a.token, user: a.user })}
          onForget={(email) => { forgetAccount(email); setAccounts(loadAccounts()) }}
          onCancel={auth ? () => { setSwitching(false); setSwitchEmail('') } : undefined}
        />
      ) : (
        // key = tài khoản: đổi tài khoản -> kết nối realtime mới (xác thực lại WebSocket), GPS theo tài khoản mới
        <GeoProvider user={auth.user} key={auth.user.id}>
          <Main auth={auth} accounts={accounts} onSwitch={() => { setSwitchEmail(''); setSwitching(true) }} onSwitchRole={switchRole} onLogout={logout} refreshUser={refreshUser}
            onToken={(token) => login({ ...auth, token })} />
        </GeoProvider>
      )}
    </ToastProvider>
  )
}


/** Nút trạng thái GPS trên thanh tiêu đề: bật/tắt chia sẻ vị trí thủ công. */
function GpsChip() {
  const geo = useGeo()
  if (!geo) return null
  const { status, enabled, toggle, error, sim } = geo
  const on = status === 'on'
  const label = sim ? 'GPS giả lập' : !enabled ? 'GPS tắt' : on ? 'GPS bật' : status === 'denied' ? 'GPS bị chặn' : status === 'unsupported' ? 'Không hỗ trợ GPS' : 'Đang định vị…'
  const tone = on ? 'border-emerald-500/50 text-emerald-300' : status === 'denied' || status === 'error' ? 'border-rose-500/50 text-rose-300' : 'border-slate-800 text-slate-400'
  return (
    <button onClick={() => toggle()} title={error || `${label} — bấm để ${enabled ? 'tắt' : 'bật'} định vị`} aria-pressed={enabled}
      className={`flex min-h-[44px] min-w-[44px] shrink-0 items-center justify-center gap-1 rounded-xl border bg-slate-900 px-2 text-sm ${tone}`}>
      {on ? <LocateFixed className="h-4 w-4" /> : enabled ? <Locate className="h-4 w-4 animate-pulse" /> : <LocateOff className="h-4 w-4" />}
      <span className="hidden xl:inline">{label}</span>
    </button>
  )
}

function Main({ auth, accounts, onSwitch, onSwitchRole, onLogout, onToken, refreshUser }) {
  const user = auth.user
  const isStaff = user.role === 'admin' || user.role === 'guard'
  const [mode, setMode] = useState(() => {
    try { return localStorage.getItem(MODE_KEY) || (user.role === 'guard' ? 'admin' : 'customer') } catch { return 'customer' }
  })
  const [state, setState] = useState(null)
  const [tick, setTick] = useState(0)
  const [lastEvent, setLastEvent] = useState(null)
  const [error, setError] = useState('')
  const [account, setAccount] = useState(false)
  const [guide, setGuide] = useState(false)
  const timer = useRef()
  const now = useNow(1000)
  const view = isStaff ? mode : 'customer' // khách hàng không thể vào trang Bảo vệ / Admin

  const load = useCallback(async () => {
    try {
      setState(await api('/api/parking/state'))
      setError('')
    } catch (err) { setError(err.message) }
  }, [])

  // Mỗi sự kiện WebSocket -> tải lại (gộp các sự kiện dồn dập trong 150ms)
  const connected = useRealtime((msg) => {
    if (msg.event === 'barrier') setState((s) => (s ? { ...s, barriers: msg.data } : s))
    emitEvent(msg) // giao từng sự kiện cho các trang (không bị gộp mất khi nhiều sự kiện tới liền nhau)
    setLastEvent(msg)
    clearTimeout(timer.current)
    timer.current = setTimeout(() => { load(); setTick((t) => t + 1) }, 150)
  })

  useEffect(() => { load() }, [load])
  useEffect(() => { if (connected) load() }, [connected, load])
  useEffect(() => { try { localStorage.setItem(MODE_KEY, mode) } catch { /* ignore */ } }, [mode])

  // Trang Bảo vệ/Admin là "trang phụ": nút Back (<) của trình duyệt / vuốt cạnh trái đưa về Trang chủ (Đặt chỗ)
  useBackHome(view !== 'customer', () => {
    try { localStorage.setItem('sp_customer_tab', 'book') } catch { /* ignore */ }
    setMode('customer')
  })

  const { t, lang } = useLang()
  const parkingName = state?.settings?.parking_name || 'Bãi Đỗ Xe Thông Minh'
  useEffect(() => { document.title = t(parkingName) }, [parkingName, t])

  // Lần đầu vào Trang Khách hàng (chưa từng bấm "Đã hiểu") -> tự mở hướng dẫn
  useEffect(() => { if (view === 'customer' && !guideSeen()) setGuide(true) }, [view])

  return (
    <div className="min-h-screen bg-[radial-gradient(ellipse_at_top,rgba(14,165,233,0.12),transparent_60%)]">
      <header className="sticky top-0 z-40 border-b border-slate-800 bg-slate-950/90 pt-[env(safe-area-inset-top)] backdrop-blur">
        <div className="mx-auto flex max-w-7xl items-center justify-between gap-2 px-3 py-2 sm:px-4 sm:py-3">
          <div className="flex min-w-0 items-center gap-2">
            <div className="shrink-0 rounded-xl bg-sky-500 p-1.5" title={parkingName}><ParkingSquare className="h-5 w-5 text-white sm:h-6 sm:w-6" /></div>
            <div className="hidden min-w-0 xl:block">
              <h1 className="truncate text-lg font-bold leading-tight">{parkingName}</h1>
              <p className="truncate text-xs text-slate-300">
                {view === 'customer' ? `Tìm & đặt chỗ đỗ xe nhanh chóng · ${state?.floors?.length || 3} tầng` : `${state?.floors?.length || 3} tầng · ${state?.slots?.length || 30} ô · ESP32 + Webcam ALPR`}
              </p>
            </div>
          </div>

          <div className="flex shrink-0 items-center gap-1.5 sm:gap-2 lg:gap-3">
            <span className="hidden font-mono text-sm text-slate-400 xl:inline">{new Date(now).toLocaleTimeString(lang === 'en' ? 'en-GB' : 'vi-VN')}</span>
            <span className={`badge shrink-0 !p-1.5 max-[400px]:!hidden sm:!px-2 sm:!py-0.5 ${connected ? 'bg-emerald-500/15 text-emerald-300' : 'bg-rose-500/15 text-rose-300'}`} title={connected ? 'Đang kết nối realtime' : 'Mất kết nối realtime'}>
              {connected ? <Wifi className="h-3.5 w-3.5" /> : <WifiOff className="h-3.5 w-3.5" />}
              <span className="hidden lg:inline">{connected ? 'Realtime' : 'Mất kết nối'}</span>
            </span>
            {state?.db_engine === 'sqlite' && (
              <span data-no-tr className="badge shrink-0 border border-amber-500/50 bg-amber-500/15 font-mono !text-[10px] font-bold tracking-wide text-amber-300 max-[400px]:!hidden"
                title="Đang chạy CSDL SQLite trên máy (backend/.env chưa có DATABASE_URL) — dữ liệu KHÁC bản Cloud Neon">
                [LOCAL SQLITE]
              </span>
            )}

            {isStaff && (
              <div className="flex shrink-0 rounded-xl border border-slate-800 bg-slate-900 p-1">
                {[['customer', 'Khách hàng', Users], ['admin', 'Bảo vệ', ShieldCheck]].map(([id, label, I]) => (
                  <button key={id} onClick={() => setMode(id)} title={label}
                    className={`flex min-h-[36px] items-center gap-1.5 rounded-lg px-2.5 text-sm font-medium transition sm:px-3 ${mode === id ? 'bg-sky-500 text-white' : 'text-slate-400 hover:text-white'}`}>
                    <I className="h-4 w-4" /> <span className="hidden lg:inline">{label}</span>
                  </button>
                ))}
              </div>
            )}

            <GpsChip />
            <PrefsControls />

            <button onClick={() => setGuide(true)} title="Hướng dẫn sử dụng" aria-label="Hướng dẫn sử dụng"
              className="hidden min-h-[44px] min-w-[44px] shrink-0 items-center justify-center gap-1 rounded-xl border border-slate-800 bg-slate-900 px-2 text-sm text-slate-200 hover:border-sky-500 hover:text-sky-300 md:flex xl:px-3">
              <HelpCircle className="h-4 w-4" /> <span className="hidden xl:inline">Hướng dẫn</span>
            </button>

            {/* Tài khoản hiện tại: 1 khối duy nhất, bấm mở menu Chuyển tài khoản / Đổi mật khẩu / Đăng xuất */}
            <AccountMenu user={user} accounts={accounts} dbEngine={state?.db_engine} onSwitchRole={onSwitchRole} onSwitch={onSwitch} onPassword={() => setAccount(true)} onGuide={() => setGuide(true)} onLogout={onLogout} />
          </div>
        </div>
      </header>

      <main className="mx-auto max-w-7xl px-3 py-4 sm:px-4 sm:py-5">
        {error && (
          <div className="mb-4 rounded-xl border border-rose-500/40 bg-rose-500/10 px-4 py-3 text-sm text-rose-200">
            {error}
          </div>
        )}
        {view === 'customer'
          ? <CustomerView state={state} tick={tick} user={user} onProfileSaved={refreshUser} lastEvent={lastEvent} />
          : <AdminView state={state} tick={tick} user={user} lastEvent={lastEvent} onToken={onToken} />}
      </main>

      {view === 'customer'
        ? <footer className="pb-[calc(6rem+env(safe-area-inset-bottom))] text-center text-xs text-slate-400 sm:pb-6">{parkingName} · Đặt chỗ trực tuyến</footer>
        : <footer className="pb-[calc(1.5rem+env(safe-area-inset-bottom))] text-center text-xs text-slate-500">Smart Parking v3 · FastAPI + PostgreSQL + React · ESP32 + Webcam ALPR</footer>}

      <AccountModal open={account} onClose={() => setAccount(false)} user={user} onToken={onToken} />
      <OnboardingGuide open={guide} settings={state?.settings} onClose={() => setGuide(false)}
        onDone={() => { markGuideSeen(); setGuide(false) }} />
    </div>
  )
}
