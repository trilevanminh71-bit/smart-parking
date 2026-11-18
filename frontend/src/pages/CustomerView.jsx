import { useEffect, useRef, useState } from 'react'
import {
  Layers, Search, Ticket, CreditCard, Loader2, MapPinned, History, Receipt, XCircle, Map as MapIcon, ImageUp, FileDown,
  Megaphone, ChevronRight, Hand, LifeBuoy, CheckCircle2, AlertTriangle,
} from 'lucide-react'
import ReceiptUploadModal from '../components/ReceiptUploadModal.jsx'
import { downloadProof } from '../proof.js'
import ParkingMap2D, { ParkingMap3D } from '../components/ParkingMap.jsx'
import BookingModal from '../components/BookingModal.jsx'
import PaymentQRModal from '../components/PaymentQRModal.jsx'
import ReservationCard from '../components/ReservationCard.jsx'
import { Empty, useToast } from '../components/ui.jsx'

const TAB_KEY = 'sp_customer_tab'
const TABS = [
  { id: 'book', label: 'Đặt chỗ', icon: MapPinned },
  { id: 'tickets', label: 'Vé của tôi', icon: Ticket },
  { id: 'history', label: 'Lịch sử & Hỗ trợ', short: 'Lịch sử', icon: LifeBuoy },
]
const readTab = () => { try { return TABS.some((t) => t.id === localStorage.getItem(TAB_KEY)) ? localStorage.getItem(TAB_KEY) : 'book' } catch { return 'book' } }

/** Thanh tab: máy tính hiện ở đầu trang; điện thoại là thanh điều hướng cố định ở đáy (dễ bấm bằng ngón cái). */
function TabBar({ tab, onTab, badge, dot }) {
  const item = (t, mobile) => {
    const on = tab === t.id
    const showBadge = t.id === 'tickets' && (badge > 0 || dot)
    return (
      <button key={t.id} role="tab" aria-selected={on} onClick={() => onTab(t.id)}
        className={mobile
          ? `relative flex min-h-[60px] flex-1 flex-col items-center justify-center gap-0.5 rounded-xl text-xs font-semibold transition ${on ? 'bg-sky-500/15 text-sky-300' : 'text-slate-300'}`
          : `relative flex min-h-[48px] flex-1 items-center justify-center gap-2 rounded-xl px-4 text-base font-semibold transition ${on ? 'bg-sky-500 text-white shadow-lg shadow-sky-500/25' : 'text-slate-200 hover:bg-slate-800'}`}>
        <span className="relative">
          <t.icon className={mobile ? 'h-6 w-6' : 'h-5 w-5'} />
          {showBadge && (
            <span className={`absolute -right-2.5 -top-2 flex h-[18px] min-w-[18px] items-center justify-center rounded-full px-1 text-[11px] font-bold text-white ring-2 ring-slate-950 ${dot ? 'animate-pulse bg-rose-500' : 'bg-orange-500'}`}>
              {badge || '!'}
            </span>
          )}
        </span>
        {mobile ? (t.short || t.label) : t.label}
      </button>
    )
  }
  return (
    <>
      <div role="tablist" aria-label="Trang khách hàng" className="hidden gap-1.5 rounded-2xl border border-slate-800 bg-slate-900/80 p-1.5 sm:flex">
        {TABS.map((t) => item(t, false))}
      </div>
      <nav role="tablist" aria-label="Trang khách hàng"
        className="fixed inset-x-0 bottom-0 z-30 flex gap-1 border-t border-slate-800 bg-slate-950/95 px-2 pb-[calc(0.375rem+env(safe-area-inset-bottom))] pt-1.5 backdrop-blur sm:hidden">
        {TABS.map((t) => item(t, true))}
      </nav>
    </>
  )
}
import { NavMapModal } from '../components/NavMiniMap.jsx'
import ContactCard from '../components/ContactCard.jsx'
import ActivityList from '../components/ActivityList.jsx'
import { api, beep, fmtDuration, fmtTime, payMethod, RES_STATUS, useEvent, useNow, vnd } from '../api.js'

export default function CustomerView({ state, tick, user, onProfileSaved, lastEvent }) {
  const toast = useToast()
  const [floor, setFloor] = useState(1)
  const [booking, setBooking] = useState(null)
  const [history, setHistory] = useState({ reservations: [], sessions: [] })
  const [plate, setPlate] = useState('')
  const [ticket, setTicket] = useState(null)
  const [searching, setSearching] = useState(false)
  const [paySession, setPaySession] = useState(null)
  const [nav, setNav] = useState(null) // { slotCode, plate, gateOpen, title }
  const [receiptRes, setReceiptRes] = useState(null)
  const [tab, setTab] = useState(readTab)
  const [unseen, setUnseen] = useState(false) // có cập nhật mới cho "Vé của tôi" khi đang ở tab khác
  const tabRef = useRef(tab)
  tabRef.current = tab
  const goTab = (t) => {
    setTab(t)
    if (t === 'tickets') setUnseen(false)
    try { localStorage.setItem(TAB_KEY, t) } catch { /* ignore */ }
    window.scrollTo({ top: 0 })
  }
  // Có tin mới về vé của tôi -> tự chuyển sang tab "Vé của tôi"
  const focusTickets = (scrollSel) => {
    if (tabRef.current !== 'tickets') { setTab('tickets'); try { localStorage.setItem(TAB_KEY, 'tickets') } catch { /* ignore */ } }
    setUnseen(false)
    if (scrollSel) setTimeout(() => document.querySelector(scrollSel)?.scrollIntoView({ behavior: 'smooth', block: 'start' }), 700)
  }
  const prevStatus = useRef({})
  const myPlates = useRef(new Set())

  // Biển số "của tôi": biển quen dùng + các biển trong lịch sử đặt chỗ / gửi xe
  useEffect(() => {
    myPlates.current = new Set([
      user?.default_plate,
      ...history.reservations.map((r) => r.license_plate),
      ...history.sessions.map((s) => s.license_plate),
    ].filter(Boolean))
  }, [user?.default_plate, history])

  const paySessionRef = useRef(null)
  paySessionRef.current = paySession
  // Chống báo trùng: cùng 1 lần xác nhận tiền có thể tới từ WebSocket lẫn polling
  const handled = useRef(new Set())
  const once = (key) => (handled.current.has(key) ? false : (handled.current.add(key), true))
  const isMine = (d) => !!d && (d.user_id === user?.id || myPlates.current.has(d.license_plate) || paySessionRef.current?.id === d.id)

  // Tiền cọc đã vào (SePay / Bảo vệ duyệt) -> thẻ chuyển ngay sang Vé QR + bản đồ, báo thành công
  const onDepositOk = (r) => {
    if (!once(`res:${r.id}:active`)) return
    prevStatus.current[r.id] = 'active'
    setHistory((h) => ({ ...h, reservations: h.reservations.map((x) => (x.id === r.id ? { ...x, ...r, _receivedAt: Date.now() } : x)) }))
    const how = r.via === 'sepay' ? 'Đã nhận tiền cọc' : 'Tiền cọc đã được xác nhận'
    toast(`${how} — vé ${r.ticket_code}: ô ${r.slot_code} đã được khóa cho bạn trong ${settingsRef.current.hold_minutes} phút.`, 'success')
    beep('success')
    reloadHistory()
    focusTickets(`[data-res-id="${r.id}"]`)
  }
  // Đã thanh toán trước -> đóng QR, đếm ngược thời gian ra cổng
  const onPrepaidOk = (s) => {
    if (!once(`ses:${s.id}:ready:${s.prepaid_at}`)) return
    if (paySessionRef.current?.id === s.id) setPaySession(null)
    const mins = Math.round((s.exit_remaining_seconds || 0) / 60)
    toast(`Xe ${s.license_plate} đã thanh toán — vui lòng ra cổng trong ${mins} phút. Camera cổng ra sẽ tự mở barrier.`, 'success')
    beep('success')
    reloadHistory()
    focusTickets()
  }
  // Đã thanh toán tại cổng / xe đã ra -> đóng QR
  const onExitPaid = (s) => {
    if (!once(`ses:${s.id}:done`)) return
    const hadModal = paySessionRef.current?.id === s.id
    if (hadModal) { setPaySession(null); setTicket(null); setPlate('') }
    toast(hadModal || s.amount_due
      ? `Đã nhận ${vnd(s.amount_due)} — barrier cổng ra đang mở. Chúc quý khách thượng lộ bình an!`
      : `Xe ${s.license_plate} đã ra cổng — barrier đã mở. Hẹn gặp lại!`, 'success')
    beep('success')
    reloadHistory()
  }

  useEvent((ev) => {
    const d = ev.data
    if (!d) return
    if (ev.event === 'deposit_approved' && d.user_id === user?.id) onDepositOk(d)
    else if (ev.event === 'prepaid' && isMine(d)) onPrepaidOk(d)
    else if (ev.event === 'payment' && isMine(d)) onExitPaid(d)
    else if (ev.event === 'check_in' && d.session && isMine(d.session)) {
      // Xe của tôi vừa check-in (barrier cổng vào mở) -> phóng to bản đồ dẫn đường (popup)
      const s = d.session
      setNav({ slotCode: s.slot_code, plate: s.license_plate, gateOpen: true, title: `Barrier đã mở — mời xe ${s.license_plate} vào` })
      beep('success')
      focusTickets()
    } else if (ev.event === 'barrier' && d.entry?.state === 'OPEN') {
      // Barrier cổng vào mở -> cuộn tới bản đồ chỉ đường trên vé đang giữ và làm nổi bật
      setTimeout(() => {
        const el = document.querySelector('[data-nav-map]')
        if (!el) return
        el.scrollIntoView({ behavior: 'smooth', block: 'center' })
        el.classList.add('nav-focus')
        setTimeout(() => {
          if (!el.isConnected) return
          const r = el.getBoundingClientRect()
          if (r.top < 0 || r.bottom > window.innerHeight) el.scrollIntoView({ block: 'center' })
        }, 700)
        setTimeout(() => el.classList.remove('nav-focus'), 2400)
      }, 200)
    }
  })

  // Bấm "Thanh toán để chuẩn bị ra cổng" (hoặc trả nốt tại cổng nếu xe đang đứng ở cổng ra)
  const startPay = async (s) => {
    if (s.at_gate) return setPaySession({ ...s, _amount: s.quote.amount_due, _mode: 'gate' })
    try {
      const r = await api('/api/parking/prepay', { method: 'POST', body: { session_id: s.id } })
      // phí 0đ -> backend chuyển ngay sang "Sẵn sàng ra cổng" (sự kiện 'prepaid' sẽ báo); còn phí -> hiện VietQR
      if (r.payment_status !== 'paid_ready') setPaySession({ ...r, _amount: r.prepay_due ?? r.quote.amount_due, _mode: 'prepay' })
    } catch (err) { toast(err.message, 'error') }
  }

  const slots = state?.slots || []
  const summary = state?.summary || {}
  const settings = state?.settings || { hold_minutes: 15, deposit_amount: 10000, hourly_rate: 10000, pending_minutes: 5 }
  const settingsRef = useRef(settings)
  settingsRef.current = settings
  const totalFree = Object.values(summary).reduce((a, s) => a + s.available, 0)
  const notice = state?.settings?.notice_text?.trim()

  // Lịch sử của tài khoản — tải lại mỗi khi có sự kiện realtime (và khi polling phát hiện thay đổi)
  const reloadHistory = () => {
    api('/api/auth/history').then((h) => {
      const at = Date.now()
      h.reservations = h.reservations.map((r) => ({ ...r, _receivedAt: at }))
      h.sessions = h.sessions.map((s) => ({ ...s, _receivedAt: at }))
      // Báo cho khách khi đặt chỗ của họ đổi trạng thái (hết hạn / đã vào bãi)
      h.reservations.forEach((r) => {
        const before = prevStatus.current[r.id]
        if (before === 'active' && r.status === 'expired') toast(`Đặt chỗ ${r.slot_code} đã hết hạn giữ chỗ và bị hủy tự động`, 'error')
        if (before === 'pending_payment' && r.status === 'expired') {
          toast(`Vé ${r.ticket_code}: quá ${settingsRef.current.pending_minutes || 5} phút chưa nhận được tiền cọc — ô ${r.slot_code} đã trả về trống. Nếu bạn đã chuyển tiền, hãy gửi ảnh biên lai trong tab Lịch sử & Hỗ trợ.`, 'error')
        }
        // Vé của tôi đổi trạng thái khi đang ở tab khác -> chấm đỏ trên tab "Vé của tôi"
        if (before && before !== r.status && tabRef.current !== 'tickets') setUnseen(true)
        if (before === 'active' && r.status === 'checked_in') toast(`Xe ${r.license_plate} đã vào bãi tại ô ${r.slot_code}`, 'success')
        if (before === 'pending_payment' && r.status === 'active') onDepositOk(r) // phòng khi lỡ sự kiện WebSocket
        prevStatus.current[r.id] = r.status
      })
      setHistory(h)
    }).catch(() => {})
  }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => { reloadHistory() }, [tick])

  // Polling dự phòng mỗi 3 giây khi đang chờ tiền (vé chờ chuyển khoản / hộp thoại VietQR đang mở):
  // mạng di động, ngrok hoặc màn hình khóa có thể làm rớt WebSocket.
  const pendingIds = history.reservations.filter((r) => r.status === 'pending_payment').map((r) => r.id).join(',')
  useEffect(() => {
    if (!pendingIds && !paySession) return
    const poll = async () => {
      for (const id of pendingIds.split(',').filter(Boolean)) {
        try {
          const r = await api(`/api/reservations/${id}`)
          if (r.status === 'active') onDepositOk(r)
          else if (r.status !== 'pending_payment') reloadHistory()
        } catch { /* bỏ qua, thử lại lần sau */ }
      }
      const ps = paySessionRef.current
      if (ps) {
        try {
          const s = await api(`/api/parking/session/${ps.id}`)
          if (s.status === 'completed') onExitPaid(s)
          else if (s.payment_status === 'paid_ready' && s.prepaid_at !== ps.prepaid_at) onPrepaidOk(s)
        } catch { /* bỏ qua */ }
      }
    }
    const t = setInterval(poll, 3000)
    return () => clearInterval(t)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pendingIds, paySession?.id])

  useEffect(() => {
    if (ticket?.plate) lookup(ticket.plate, true)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tick])

  const lookup = async (p = plate, silent = false) => {
    if (!p.trim()) return
    if (!silent) setSearching(true)
    try {
      const data = await api('/api/parking/ticket', { method: 'POST', body: { plate: p } })
      setTicket({ ...data, _receivedAt: Date.now() })
    } catch (err) {
      if (!silent) toast(err.message, 'error')
      setTicket((t) => (silent && err.status !== 404 ? t : null))
    } finally {
      setSearching(false)
    }
  }

  const cancel = async (r) => {
    const msg = r.status === 'pending_payment'
      ? `Hủy đặt chỗ ô ${r.slot_code}? Ô sẽ được trả về trống ngay. Nếu bạn ĐÃ chuyển tiền, đừng hủy — hãy chờ hoặc gửi ảnh biên lai.`
      : `Hủy đặt chỗ ô ${r.slot_code}? Ô sẽ được trả về trống ngay và tiền cọc không được hoàn lại.`
    if (!confirm(msg)) return
    try {
      await api(`/api/reservations/${r.id}/cancel`, { method: 'POST' })
      toast(`Đã hủy đặt chỗ ${r.slot_code}`, 'info')
    } catch (err) { toast(err.message, 'error') }
  }

  const proof = (r) => downloadProof(r, settings.parking_name)

  const active = history.reservations.filter((r) => r.status === 'active' || r.status === 'pending_payment')
  const highlight = active[0]?.slot_code
  const session = ticket?.session
  const parkedMine = history.sessions.filter((s) => s.status === 'parked')

  const myCount = active.length + parkedMine.length
  const floorSlots = slots.filter((s) => s.floor === floor)

  return (
    <div className="customer-ui space-y-5 sm:space-y-6">
      {/* Thanh tab — máy tính: ở trên; điện thoại: thanh điều hướng cố định ở đáy màn hình như app */}
      <TabBar tab={tab} onTab={goTab} badge={myCount} dot={unseen} />

      {notice && tab !== 'history' && (
        <button onClick={() => goTab('history')} className="flex w-full items-start gap-2 rounded-2xl border border-amber-500/40 bg-amber-500/10 p-3 text-left text-sm text-amber-100">
          <Megaphone className="mt-0.5 h-4 w-4 shrink-0 text-amber-300" />
          <span className="min-w-0 flex-1 whitespace-pre-line break-words">{notice}</span>
        </button>
      )}

      {/* ===================== TAB 1: ĐẶT CHỖ ===================== */}
      {tab === 'book' && (
        <>
          <section className="space-y-1">
            <h2 className="text-xl font-bold sm:text-2xl">Chọn chỗ đỗ xe</h2>
            <p className="text-sm text-slate-300">
              Còn <b className="text-emerald-300">{totalFree}/{slots.length}</b> chỗ trống · {vnd(settings.hourly_rate)}/giờ · đặt cọc {vnd(settings.deposit_amount)}
            </p>
          </section>

          {myCount > 0 && (
            <button onClick={() => goTab('tickets')}
              className="flex w-full items-center gap-3 rounded-2xl border border-sky-500/50 bg-sky-500/10 p-3 text-left transition hover:bg-sky-500/20">
              <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-sky-500 text-white"><Ticket className="h-5 w-5" /></span>
              <span className="min-w-0 flex-1">
                <span className="block font-semibold">Bạn có {myCount} vé / xe đang hoạt động</span>
                <span className="block text-sm text-slate-300">{active.some((r) => r.status === 'pending_payment') ? 'Có vé đang chờ chuyển khoản cọc — ' : ''}Xem vé QR, bản đồ chỉ đường, thanh toán</span>
              </span>
              <ChevronRight className="h-5 w-5 shrink-0 text-sky-300" />
            </button>
          )}

          <div className="grid gap-5 lg:grid-cols-[1fr_280px]">
            <div className="card !p-3 sm:!p-5">
              {/* Chọn tầng kèm số chỗ trống */}
              <div className="mb-4 grid grid-cols-3 gap-2 sm:gap-3" role="tablist" aria-label="Chọn tầng">
                {[1, 2, 3].map((f) => {
                  const free = summary[f]?.available ?? 0
                  const on = floor === f
                  return (
                    <button key={f} role="tab" aria-selected={on} onClick={() => setFloor(f)}
                      className={`flex min-h-[64px] flex-col items-center justify-center rounded-2xl border-2 px-2 py-2 transition ${on
                        ? 'border-sky-400 bg-sky-500 text-white shadow-lg shadow-sky-500/25'
                        : 'border-slate-700 bg-slate-950/60 text-slate-100 hover:border-slate-500'}`}>
                      <span className="text-base font-bold">Tầng {f}</span>
                      <span className={`text-xs font-medium ${on ? 'text-sky-50' : free ? 'text-emerald-300' : 'text-rose-300'}`}>
                        {free ? `${free} chỗ trống` : 'Hết chỗ'}
                      </span>
                    </button>
                  )
                })}
              </div>
              <p className="mb-3 flex items-center gap-2 text-sm text-slate-200">
                <Hand className="h-4 w-4 shrink-0 text-emerald-300" /> Chạm vào ô <b className="text-emerald-300">màu xanh (P)</b> để đặt chỗ
              </p>
              <ParkingMap2D slots={floorSlots} floor={floor} selectable onSelect={setBooking} highlightCode={highlight} large />
            </div>

            {/* Tổng quan 3D: chỉ hiện trên màn hình lớn để điện thoại ưu tiên lưới chọn ô */}
            <div className="card hidden lg:block">
              <div className="card-title"><Layers className="h-4 w-4" /> Tổng quan 3 tầng</div>
              <ParkingMap3D summary={summary} floor={floor} onFloor={setFloor} />
            </div>
          </div>
        </>
      )}

      {/* ===================== TAB 2: VÉ CỦA TÔI ===================== */}
      {tab === 'tickets' && (
        <>
          <section className="space-y-1">
            <h2 className="text-xl font-bold sm:text-2xl">Vé của tôi</h2>
            <p className="text-sm text-slate-300">Vé đang chờ chuyển khoản, vé QR giữ chỗ, bản đồ chỉ đường và thanh toán phí gửi xe.</p>
          </section>

          {myCount === 0 && (
            <div className="card flex flex-col items-center gap-3 py-8 text-center">
              <span className="flex h-14 w-14 items-center justify-center rounded-2xl bg-slate-800 text-sky-300"><Ticket className="h-7 w-7" /></span>
              <div>
                <div className="font-semibold">Bạn chưa có vé nào đang hoạt động</div>
                <div className="mt-1 text-sm text-slate-300">Chọn một ô trống để đặt chỗ trước — chỉ mất chưa tới 1 phút.</div>
              </div>
              <button className="btn-primary px-6" onClick={() => goTab('book')}><MapPinned className="h-4 w-4" /> Chọn chỗ đỗ ngay</button>
            </div>
          )}

          {active.length > 0 && (
            <div className="space-y-4">
              {active.map((r) => (
                <ReservationCard key={r.id} res={r} holdMinutes={settings.hold_minutes} pendingMinutes={settings.pending_minutes} onCancel={() => cancel(r)}
                  onReceipt={() => setReceiptRes(r)} onProof={() => proof(r)}
                  slots={slots} gateOpen={state?.barriers?.entry?.state === 'OPEN'}
                  onShowMap={() => setNav({ slotCode: r.slot_code, plate: r.license_plate, gateOpen: false })} />
              ))}
            </div>
          )}

          {parkedMine.length > 0 && (
            <div className="card">
              <div className="card-title"><CreditCard className="h-4 w-4" /> Xe của tôi đang đỗ</div>
              <div className="space-y-3">
                {parkedMine.map((s) => (
                  <ParkedCard key={s.id} s={s} onPay={() => startPay(s)} grace={settings.exit_grace_minutes}
                    onShowMap={() => setNav({ slotCode: s.slot_code, plate: s.license_plate, gateOpen: false })} />
                ))}
              </div>
            </div>
          )}

          {/* Tra cứu vé theo biển số */}
          <div className="card">
            <div className="card-title"><Search className="h-4 w-4" /> Tra cứu vé theo biển số</div>
            <form className="flex flex-col gap-2 sm:flex-row" onSubmit={(e) => { e.preventDefault(); lookup() }}>
              <input className="input font-mono uppercase sm:max-w-xs" placeholder="Nhập biển số, VD: 65A-123.45" aria-label="Biển số xe"
                value={plate} onChange={(e) => setPlate(e.target.value)} />
              <button className="btn-primary sm:px-6" disabled={searching}>
                {searching ? <Loader2 className="h-4 w-4 animate-spin" /> : <Search className="h-4 w-4" />} Tra cứu
              </button>
            </form>
            <p className="mt-2 text-xs text-slate-300">Dùng khi bạn gửi xe không qua đặt chỗ (xe vãng lai) và muốn thanh toán online bằng VietQR.</p>
            {ticket && (
              <div className="mt-4 space-y-3">
                {ticket.reservation && (
                  <ReservationCard res={{ ...ticket.reservation, _receivedAt: ticket._receivedAt }} holdMinutes={settings.hold_minutes}
                    pendingMinutes={settings.pending_minutes} slots={slots}
                    onShowMap={() => setNav({ slotCode: ticket.reservation.slot_code, plate: ticket.reservation.license_plate, gateOpen: false })} />
                )}
                {session && (
                  <ParkedCard s={{ ...session, _receivedAt: ticket._receivedAt }} onPay={() => startPay(session)} detailed grace={settings.exit_grace_minutes}
                    onShowMap={() => setNav({ slotCode: session.slot_code, plate: session.license_plate, gateOpen: false })} />
                )}
              </div>
            )}
          </div>
        </>
      )}

      {/* ===================== TAB 3: LỊCH SỬ & HỖ TRỢ ===================== */}
      {tab === 'history' && (
        <>
          <section className="space-y-1">
            <h2 className="text-xl font-bold sm:text-2xl">Lịch sử & Hỗ trợ</h2>
            <p className="text-sm text-slate-300">Hóa đơn, các lần đặt chỗ, phiếu minh chứng và thông tin liên hệ khi cần giúp đỡ.</p>
          </section>
          <ContactCard settings={state?.settings} />
          <HistoryPanel history={history} onCancel={cancel} tick={tick} onReceipt={setReceiptRes} onProof={proof} />
        </>
      )}

      <ReceiptUploadModal res={receiptRes} toast={toast} onClose={() => setReceiptRes(null)} />

      <BookingModal
        slot={booking}
        settings={settings}
        user={user}
        toast={toast}
        onClose={() => setBooking(null)}
        onBooked={(res) => {
          setBooking(null)
          onProfileSaved?.() // backend đã lưu Tên/SĐT/Biển số -> cập nhật để lần sau điền sẵn
          prevStatus.current[res.id] = res.status
          setHistory((h) => ({ ...h, reservations: [{ ...res, _receivedAt: Date.now() }, ...h.reservations] }))
          setFloor(res.floor)
          // chuyển sang "Vé của tôi" — thẻ vé đang hiện mã VietQR chờ chuyển khoản
          setTab('tickets'); setUnseen(false)
          try { localStorage.setItem(TAB_KEY, 'tickets') } catch { /* ignore */ }
          setTimeout(() => document.querySelector(`[data-res-id="${res.id}"]`)?.scrollIntoView({ behavior: 'smooth', block: 'start' }), 150)
        }}
      />

      <NavMapModal nav={nav} slots={slots} onClose={() => setNav(null)} />

      {paySession && (
        <PaymentQRModal
          open
          onClose={() => setPaySession(null)}
          title={paySession._mode === 'prepay' ? 'Thanh toán trước khi ra cổng' : 'Thanh toán phí gửi xe tại cổng'}
          amount={paySession._amount}
          content={`PHI ${paySession.license_plate.replace(/[^A-Z0-9]/g, '')}`}
          lines={[
            ['Số giờ', `${paySession.quote.hours_billed} giờ × ${vnd(settings.hourly_rate)}`],
            ['Đã trừ cọc', vnd(paySession.deposit_deducted)],
            ...(paySession.prepaid_amount ? [['Đã trả trước', vnd(paySession.prepaid_amount)]] : []),
          ]}
          waiting
          note={paySession._mode === 'prepay'
            ? <>Sau khi tiền vào, bạn có <b>{settings.exit_grace_minutes || 15} phút</b> để ra cổng — camera quét biển số sẽ <b>tự mở barrier</b>. Ra quá hạn sẽ tính thêm phí phát sinh.</>
            : <>Xe đang ở cổng ra. Barrier tự mở ngay khi tiền vào tài khoản (hoặc trả tiền mặt cho bảo vệ).</>}
        />
      )}
    </div>
  )
}

function ParkedCard({ s, onPay, onShowMap, detailed, grace }) {
  const q = s.quote
  if (s.fee_waived) {
    return (
      <div className="grid gap-3 rounded-xl border border-emerald-500/40 bg-emerald-500/5 p-3 sm:p-4 md:grid-cols-[1fr_auto]">
        <div className="grid grid-cols-2 gap-x-4 gap-y-2 text-sm sm:grid-cols-3">
          <Info k="Biển số" v={<span className="font-mono">{s.license_plate}</span>} />
          <Info k="Ô đỗ" v={s.slot_code} />
          <Info k="Giờ vào" v={fmtTime(s.check_in_time)} />
          <Info k="Đã đỗ" v={fmtDuration(q.parked_seconds)} />
          <Info k="Phí gửi xe" v={<span className="text-lg font-bold text-emerald-300">Miễn phí (Admin)</span>} />
        </div>
        <div className="flex flex-col justify-center gap-1.5">
          {onShowMap && <button className="btn-ghost" onClick={onShowMap}><MapIcon className="h-4 w-4" /> Xem bản đồ chỉ đường</button>}
          <p className="text-center text-xs text-slate-400 md:max-w-[200px]">Không cần thanh toán — barrier cổng ra tự mở khi xe ra.</p>
        </div>
      </div>
    )
  }
  return <PayableCard s={s} q={q} onPay={onPay} onShowMap={onShowMap} detailed={detailed} grace={grace} />
}

/** Thẻ xe đang đỗ có tính phí: chưa trả → "Thanh toán để chuẩn bị ra cổng"; đã trả → đếm ngược thời gian ra cổng. */
function PayableCard({ s, q, onPay, onShowMap, detailed, grace = 15 }) {
  const now = useNow(1000)
  const ready = s.payment_status === 'paid_ready'
  const left = ready ? Math.max(0, (s.exit_remaining_seconds || 0) - (now - (s._receivedAt || now)) / 1000) : 0
  const late = ready && left <= 0
  const box = s.at_gate ? 'border-rose-500/50 bg-rose-500/5' : ready && !late ? 'border-emerald-500/50 bg-emerald-500/5' : late ? 'border-amber-500/50 bg-amber-500/5' : 'border-sky-500/30 bg-sky-500/5'
  return (
    <div className={`space-y-3 rounded-xl border p-3 sm:p-4 ${box}`}>
      {ready && !late && (
        <div className="rounded-xl bg-emerald-500/15 p-3 text-center" role="status">
          <div className="flex items-center justify-center gap-1.5 text-sm font-semibold text-emerald-200"><CheckCircle2 className="h-4 w-4" /> Đã thanh toán — Vui lòng ra cổng trong</div>
          <div className={`font-mono text-4xl font-bold tabular-nums ${left < 120 ? 'animate-pulse text-amber-300' : 'text-emerald-300'}`}>{fmtDuration(left)}</div>
          <div className="mt-1 text-xs text-emerald-100/80">Camera cổng ra quét đúng biển số <b className="font-mono">{s.license_plate}</b> sẽ tự mở barrier.</div>
        </div>
      )}
      {late && (
        <div className="flex items-start gap-2 rounded-xl bg-amber-500/15 p-3 text-sm text-amber-100">
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-amber-300" />
          <span>Đã quá thời gian ra cổng sau thanh toán. Phí phát sinh thêm (nếu có) sẽ tính khi xe ra — bạn có thể thanh toán bù ngay bên dưới.</span>
        </div>
      )}
      {s.at_gate && (
        <div className="flex items-start gap-2 rounded-xl bg-rose-500/15 p-3 text-sm text-rose-100">
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-rose-300" />
          <span>Xe đang ở cổng ra, barrier đang chặn — thanh toán <b>{vnd(q.amount_due)}</b> để mở barrier.</span>
        </div>
      )}
      <div className="grid gap-3 md:grid-cols-[1fr_auto]">
        <div className="grid grid-cols-2 gap-x-4 gap-y-2 text-sm sm:grid-cols-3">
          <Info k="Biển số" v={<span className="font-mono">{s.license_plate}</span>} />
          <Info k="Ô đỗ" v={s.slot_code} />
          <Info k="Giờ vào" v={fmtTime(s.check_in_time)} />
          {detailed && <Info k="Loại" v={s.entry_type === 'reservation' ? 'Đặt trước' : 'Vãng lai'} />}
          <Info k="Đã đỗ" v={fmtDuration(q.parked_seconds)} />
          <Info k="Phí gửi xe" v={`${q.hours_billed}h · ${vnd(q.total_fee)}`} />
          <Info k="Trừ tiền cọc" v={`- ${vnd(s.deposit_deducted)}`} />
          {s.prepaid_amount > 0 && <Info k="Đã trả trước" v={`- ${vnd(s.prepaid_amount)}`} />}
          {!(ready && !late) && <Info k="Còn phải trả" v={<span className="text-lg font-bold text-sky-300">{vnd(q.amount_due)}</span>} />}
        </div>
        <div className="flex flex-col justify-center gap-1.5">
          {!(ready && !late) && (
            <button className="btn-success min-h-[48px] text-base" onClick={onPay}>
              <CreditCard className="h-5 w-5" /> {s.at_gate ? 'Thanh toán để mở barrier' : late ? 'Thanh toán bù để ra cổng' : 'Thanh toán để chuẩn bị ra cổng'}
            </button>
          )}
          {onShowMap && <button className="btn-ghost" onClick={onShowMap}><MapIcon className="h-4 w-4" /> Xem bản đồ chỉ đường</button>}
          {!ready && !s.at_gate && (
            <p className="text-center text-xs text-slate-400 md:max-w-[220px]">
              Trả trước trên web rồi ra cổng trong {grace} phút — barrier tự mở, không phải chờ. Hoặc trả tiền mặt cho bảo vệ tại cổng.
            </p>
          )}
        </div>
      </div>
    </div>
  )
}

const RECEIPT_BADGE = {
  new: ['Đã gửi biên lai · chờ đối soát', 'bg-sky-500/20 text-sky-300'],
  approved: ['Biên lai: đã duyệt bù', 'bg-emerald-500/20 text-emerald-300'],
  refunded: ['Biên lai: đã hoàn tiền', 'bg-amber-500/20 text-amber-300'],
}

function HistoryPanel({ history, onCancel, tick, onReceipt, onProof }) {
  const [tab, setTab] = useState('sessions')
  const [activity, setActivity] = useState(null)
  const done = history.sessions.filter((s) => s.status === 'completed')

  // Lịch sử đăng nhập & hoạt động của riêng tài khoản này
  useEffect(() => {
    if (tab !== 'activity') return
    api('/api/auth/activity?limit=100').then(setActivity).catch(() => setActivity([]))
  }, [tab, tick])

  return (
    <div className="card">
      <div className="mb-3 flex flex-col gap-2 lg:flex-row lg:items-center lg:justify-between">
        <div className="card-title !mb-0"><History className="h-4 w-4" /> Lịch sử gửi xe, Hóa đơn & Hoạt động</div>
        <div className="grid grid-cols-3 rounded-xl bg-slate-950/70 p-1 text-xs sm:text-sm">
          {[['sessions', `Hóa đơn (${done.length})`], ['reservations', `Đặt chỗ (${history.reservations.length})`], ['activity', 'Hoạt động']].map(([id, label]) => (
            <button key={id} onClick={() => setTab(id)} className={`min-h-[40px] rounded-lg px-2 sm:px-3 ${tab === id ? 'bg-sky-500 text-white' : 'text-slate-400'}`}>{label}</button>
          ))}
        </div>
      </div>

      {tab === 'activity' && (activity === null
        ? <div className="py-6 text-center text-sm text-slate-500">Đang tải…</div>
        : <ActivityList items={activity} empty="Chưa có hoạt động nào" />)}

      {tab === 'sessions' && (done.length === 0 ? <Empty>Chưa có hóa đơn gửi xe nào</Empty> : (
        <div className="grid gap-2 md:grid-cols-2">
          {done.map((s) => (
            <div key={s.id} className="rounded-xl border border-slate-800 bg-slate-950/50 p-3 text-sm">
              <div className="flex items-center justify-between gap-2">
                <div className="flex items-center gap-1.5 font-semibold"><Receipt className="h-4 w-4 text-sky-400" /> Hóa đơn #{s.id}</div>
                <span className={`badge ${payMethod(s.payment_method).cls}`}>{payMethod(s.payment_method).label}</span>
              </div>
              <div className="mt-2 grid grid-cols-2 gap-x-3 gap-y-1 text-xs">
                <span className="text-slate-400">Biển số</span><span className="text-right font-mono">{s.license_plate}</span>
                <span className="text-slate-400">Ô đỗ</span><span className="text-right">{s.slot_code}</span>
                <span className="text-slate-400">Vào</span><span className="text-right">{fmtTime(s.check_in_time)}</span>
                <span className="text-slate-400">Ra</span><span className="text-right">{fmtTime(s.check_out_time)}</span>
                <span className="text-slate-400">Phí ({s.hours_billed}h)</span><span className="text-right">{vnd(s.total_fee)}</span>
                <span className="text-slate-400">Trừ cọc</span><span className="text-right">- {vnd(s.deposit_deducted)}</span>
                {s.prepaid_amount > 0 && <><span className="text-slate-400">Trả trước trên web</span><span className="text-right">{vnd(s.prepaid_amount)}</span></>}
                {s.prepaid_amount > 0 && s.amount_due > 0 && <><span className="text-slate-400">Trả bù tại cổng</span><span className="text-right">{vnd(s.amount_due)}</span></>}
              </div>
              <div className="mt-2 flex justify-between border-t border-slate-800 pt-2 font-semibold">
                <span>Đã thanh toán</span><span className="text-sky-300">{vnd((s.amount_due || 0) + (s.prepaid_amount || 0))}</span>
              </div>
            </div>
          ))}
        </div>
      ))}

      {tab === 'reservations' && (history.reservations.length === 0 ? <Empty>Bạn chưa đặt chỗ lần nào</Empty> : (
        <div className="space-y-2">
          {history.reservations.map((r) => (
            <div key={r.id} className="flex flex-wrap items-center gap-2 rounded-xl border border-slate-800 bg-slate-950/50 p-3 text-sm">
              <div className="min-w-0 flex-1">
                <div className="font-medium">Ô {r.slot_code} · <span className="font-mono">{r.license_plate}</span></div>
                <div className="text-xs text-slate-400">
                  Vé {r.ticket_code || '—'} · {fmtTime(r.created_at)} · {r.deposit_mode === 'admin_free' ? 'Miễn phí (Admin)' : `cọc ${vnd(r.deposit_amount)}`}
                </div>
              </div>
              <span className={`badge ${(RES_STATUS[r.status] || RES_STATUS.cancelled).cls}`}>{(RES_STATUS[r.status] || { label: r.status }).label}</span>
              {RECEIPT_BADGE[r.receipt_status] && <span className={`badge ${RECEIPT_BADGE[r.receipt_status][1]}`}>{RECEIPT_BADGE[r.receipt_status][0]}</span>}
              <div className="flex w-full flex-wrap gap-1.5 sm:w-auto">
                {['pending_payment', 'expired', 'cancelled'].includes(r.status) && r.ticket_code && (
                  <button className="btn-ghost btn-sm" onClick={() => onReceipt(r)}><ImageUp className="h-3.5 w-3.5" /> Đã chuyển nhưng chưa duyệt? Gửi ảnh biên lai</button>
                )}
                {r.ticket_code && <button className="btn-ghost btn-sm" onClick={() => onProof(r)}><FileDown className="h-3.5 w-3.5" /> Tải phiếu minh chứng</button>}
                {(r.status === 'active' || r.status === 'pending_payment') && (
                  <button className="btn-danger btn-sm" onClick={() => onCancel(r)}><XCircle className="h-3.5 w-3.5" /> Hủy đặt chỗ</button>
                )}
              </div>
            </div>
          ))}
        </div>
      ))}
    </div>
  )
}

function Info({ k, v }) {
  return (
    <div className="min-w-0">
      <div className="text-xs text-slate-400">{k}</div>
      <div className="truncate font-medium">{v}</div>
    </div>
  )
}
