import { useCallback, useEffect, useState } from 'react'
import {
  Car, CalendarClock, ScrollText, BarChart3, Wallet, Banknote, QrCode, PiggyBank, Clock, LogOut,
  FastForward, XCircle, Activity, Settings, MonitorPlay, History, Layers, UserCog, Ticket, Loader2, LogIn, Map as MapIcon, BadgeCheck, Scale,
} from 'lucide-react'
import ReconcilePanel from '../components/ReconcilePanel.jsx'
import SimulationPanel from '../components/SimulationPanel.jsx'
import SettingsPanel from '../components/SettingsPanel.jsx'
import CheckoutModal from '../components/CheckoutModal.jsx'
import ParkingMap2D from '../components/ParkingMap.jsx'
import { AdminAccountsPanel } from '../components/AccountPanels.jsx'
import NavMiniMap from '../components/NavMiniMap.jsx'
import AdminActivityPanel from '../components/AdminActivityPanel.jsx'
import { Empty, Stat, useToast } from '../components/ui.jsx'
import { api, beep, fmtDuration, fmtTime, payMethod, useEvent, useNow, vnd } from '../api.js'

const TABS = [
  { id: 'ops', label: 'Vận hành', icon: MonitorPlay },
  { id: 'stats', label: 'Thống kê', icon: BarChart3 },
  { id: 'reconcile', label: 'Đối soát', icon: Scale },
  { id: 'settings', label: 'Cài đặt', icon: Settings },
  { id: 'accounts', label: 'Tài khoản', icon: UserCog },
  { id: 'activity', label: 'Nhật ký', icon: ScrollText },
]

/** Ô check-in nhanh bằng mã vé ngắn hoặc nội dung QR vé (dán từ máy quét QR). */
function TicketCheckin({ onResult, toast }) {
  const [code, setCode] = useState('')
  const [busy, setBusy] = useState(false)
  const submit = async (e) => {
    e.preventDefault()
    if (!code.trim()) return
    setBusy(true)
    try {
      const r = await api('/api/admin/checkin-ticket', { method: 'POST', body: { code } })
      onResult('entry', r)
      setCode('')
    } catch (err) { toast(err.message, 'error') } finally { setBusy(false) }
  }
  return (
    <form onSubmit={submit} className="rounded-xl border border-sky-500/30 bg-sky-500/5 p-3">
      <div className="mb-2 flex items-center gap-1.5 text-sm font-semibold text-sky-300"><Ticket className="h-4 w-4" /> Check-in bằng mã vé / QR</div>
      <div className="flex flex-col gap-2 sm:flex-row">
        <input className="input font-mono uppercase tracking-widest" placeholder="Mã vé 6 ký tự hoặc nội dung QR" value={code} onChange={(e) => setCode(e.target.value)} />
        <button className="btn-primary shrink-0" disabled={busy}>
          {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <LogIn className="h-4 w-4" />} Xác nhận xe vào
        </button>
      </div>
      <p className="mt-1.5 text-[11px] text-slate-500">Máy quét QR dạng bàn phím có thể quét thẳng vào ô này rồi tự Enter.</p>
    </form>
  )
}

const ALERTS = {
  reservation_new: (d) => [`Khách đặt chỗ: ${d.license_plate} → ô ${d.slot_code} (vé ${d.ticket_code}) — chờ chuyển khoản cọc`, 'info', 'info'],
  deposit_approved: (d) => [d.via === 'sepay'
    ? `💰 SePay: đã nhận cọc vé ${d.ticket_code} (${d.license_plate}) · ô ${d.slot_code} đã khóa`
    : `Đã duyệt cọc vé ${d.ticket_code} · ô ${d.slot_code}`, 'success', 'success'],
  payment: (d) => d.via === 'sepay' ? [`💰 SePay: xe ${d.license_plate} đã thanh toán ${vnd(d.amount_due)} — mở barrier ra`, 'success', 'success']
    : d.via === 'prepaid' ? [`Camera cổng ra: xe ${d.license_plate} đã trả trước — tự mở barrier`, 'success', 'info'] : null,
  prepaid: (d) => [`Xe ${d.license_plate} đã thanh toán trước ${vnd(d.prepaid_amount)}${d.via === 'sepay' ? ' (SePay)' : ''} — sẵn sàng ra cổng`, 'success', 'success'],
  payment_log: (d) => d.status === 'matched' ? null
    : [`⚠ Giao dịch ${vnd(d.amount)} cần đối soát: ${d.status_label}${d.matched_ticket ? ` (${d.matched_ticket})` : ''}`, 'error', 'warn'],
  receipt_new: (d) => [`Khách ${d.email} gửi ảnh biên lai vé ${d.ticket_code} — xem tab Đối soát`, 'info', 'warn'],
  reservation_cancelled: (d) => [`Khách hủy đặt chỗ: ${d.license_plate} (ô ${d.slot_code})`, 'info', 'warn'],
  reservation_expired: (d) => [`Đặt chỗ hết hạn: ${(d.slots || []).join(', ')}`, 'error', 'warn'],
  auto_gate: (d) => d.ok
    ? [`Auto-Gate cổng ${d.gate === 'entry' ? 'VÀO' : 'RA'}: ${d.message || d.plate} — barrier đã mở`, 'success', 'success']
    : [`Auto-Gate cổng ${d.gate === 'entry' ? 'VÀO' : 'RA'}: ${d.plate} — ${d.message}`, 'error', 'warn'],
  gate_trigger: (d) => d.auto ? null : [`Có xe tới cổng ${d.gate === 'entry' ? 'VÀO' : 'RA'}${d.plate ? ` (${d.plate})` : ''} — Auto-Gate tắt, hãy xác nhận`, 'info', 'warn'],
  sensor: (d) => [`Cảm biến ESP32 ${d.slot_code}: ${d.status === 'occupied' ? 'CÓ XE' : 'trống'}`, 'info', 'info'],
}

export default function AdminView({ state, tick, user, lastEvent, onToken }) {
  const toast = useToast()
  const [data, setData] = useState(null)
  const [tab, setTab] = useState('ops')
  const [floor, setFloor] = useState(1)
  const [checkout, setCheckout] = useState(null)
  const [receivedAt, setReceivedAt] = useState(Date.now())
  const now = useNow(1000)

  const load = useCallback(async () => {
    try {
      setData(await api('/api/admin/dashboard'))
      setReceivedAt(Date.now())
    } catch (err) { toast(err.message, 'error') }
  }, [toast])

  useEffect(() => { load() }, [tick, load])

  // Xe vừa check-in (barrier vào mở) -> xem trước bản đồ dẫn đường mà khách đang thấy
  const [navPreview, setNavPreview] = useState(null)
  // Nhận TỪNG sự kiện realtime (không bỏ sót khi backend gửi nhiều sự kiện liền nhau)
  useEvent((ev) => {
    if (ev.event === 'check_in' && ev.data?.session) {
      const s = ev.data.session
      setNavPreview({ slotCode: s.slot_code, plate: s.license_plate, kind: ev.data.entry_type, at: Date.now() })
    }
    // Thông báo nổi + tiếng bíp cho sự kiện mới (đặt cọc, tiền vào, hủy chỗ, cảm biến)
    const f = ALERTS[ev.event]
    if (!f || !ev.data) return
    const out = f(ev.data)
    if (!out) return
    const [msg, type, sound] = out
    toast(msg, type)
    beep(sound)
  })

  if (!data) return <div className="py-20 text-center text-slate-500">Đang tải dữ liệu…</div>

  const act = async (path, body, okMsg) => {
    try {
      const r = await api(path, { method: 'POST', body })
      if (okMsg) toast(okMsg, 'success')
      return r
    } catch (err) { toast(err.message, 'error') }
  }

  const doCheckout = async (s) => {
    const r = await act('/api/admin/checkout', { session_id: s.id })
    if (r?.payment_method === 'admin_free') toast(`Xe ${r.license_plate} ra cổng — Miễn phí (Admin). Barrier cổng ra đã mở.`, 'success')
    else if (r?.exit_action === 'auto_open') toast(`Xe ${r.license_plate} đã thanh toán trước — barrier cổng ra đã mở.`, 'success')
    else if (r) setCheckout(r)
  }

  const onGateResult = (gate, r, { quiet = false } = {}) => {
    const opened = r.action === 'free_exit' || r.action === 'auto_open'
    if (!quiet) toast(r.message, gate === 'entry' || opened ? 'success' : r.action === 'late_fee' ? 'error' : 'info')
    if (r.ok === false) return // Auto-Gate từ chối: barrier giữ đóng
    if (gate === 'exit' && r.session && !opened) setCheckout(r.session)
    if (gate === 'entry' && r.slot_code) setFloor(+r.slot_code[1])
  }

  const elapsed = (now - receivedAt) / 1000
  const st = data.stats
  const slots = state?.slots || []

  return (
    <div className="space-y-4 sm:space-y-5">
      {navPreview && (
        <div className="card !p-3">
          <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
            <div className="card-title !mb-0"><MapIcon className="h-4 w-4" /> Xem trước bản đồ dẫn đường của khách</div>
            <span className={`badge ${navPreview.kind === 'reservation' ? 'bg-amber-500/20 text-amber-300' : 'bg-slate-700 text-slate-300'}`}>
              {navPreview.kind === 'reservation' ? 'Xe đặt trước' : 'Xe vãng lai'} · {fmtTime(new Date(navPreview.at).toISOString())}
            </span>
          </div>
          <div className="mx-auto max-w-xl">
            <NavMiniMap slotCode={navPreview.slotCode} plate={navPreview.plate} slots={slots}
              gateOpen={data.barriers?.entry?.state === 'OPEN'} onClose={() => setNavPreview(null)} compact />
          </div>
        </div>
      )}
      <div className="grid grid-cols-6 gap-1 rounded-xl bg-slate-900/80 p-1">
        {TABS.map((t) => (
          <button key={t.id} onClick={() => setTab(t.id)}
            className={`flex min-h-[44px] flex-col items-center justify-center gap-0.5 rounded-lg px-1 text-[11px] font-medium transition sm:flex-row sm:gap-2 sm:text-sm ${tab === t.id ? 'bg-sky-500 text-white' : 'text-slate-400 hover:text-white'}`}>
            <t.icon className="h-4 w-4" /> {t.label}
          </button>
        ))}
      </div>

      {tab === 'ops' && (
        <>
          <TicketCheckin onResult={onGateResult} toast={toast} />
          <div className="grid gap-4 sm:gap-5 xl:grid-cols-[1.15fr_1fr]">
            <div className="card !p-3 sm:!p-4">
              <div className="card-title"><MonitorPlay className="h-4 w-4" /> Camera ALPR · Barrier · Cảm biến</div>
              <SimulationPanel slots={slots} barriers={data.barriers} onGateResult={onGateResult} toast={toast} autoGate={!!state?.settings?.auto_gate} />
            </div>
            <div className="card !p-3 sm:!p-4">
              <div className="mb-3 flex items-center justify-between">
                <div className="card-title !mb-0"><Layers className="h-4 w-4" /> Sơ đồ realtime</div>
                <div className="flex rounded-lg bg-slate-950/70 p-0.5">
                  {[1, 2, 3].map((f) => (
                    <button key={f} onClick={() => setFloor(f)} className={`min-h-[36px] rounded-md px-3 text-xs ${floor === f ? 'bg-sky-500 text-white' : 'text-slate-400'}`}>T{f}</button>
                  ))}
                </div>
              </div>
              <ParkingMap2D slots={slots.filter((s) => s.floor === floor)} floor={floor} />
            </div>
          </div>

          <div className="grid gap-4 sm:gap-5 xl:grid-cols-2">
            {/* Xe đang đỗ */}
            <div className="card">
              <div className="card-title"><Car className="h-4 w-4" /> Xe đang đỗ ({data.parked.length})</div>
              {data.parked.length === 0 ? <Empty>Chưa có xe nào trong bãi</Empty> : (
                <div className="max-h-[420px] space-y-2 overflow-y-auto pr-1">
                  {data.parked.map((s) => {
                    const secs = s.quote.parked_seconds + elapsed
                    return (
                      <div key={s.id} className="flex flex-wrap items-center gap-3 rounded-xl border border-slate-800 bg-slate-950/50 p-3">
                        <div className="min-w-[130px] flex-1">
                          <div className="font-mono font-semibold">{s.license_plate}</div>
                          <div className="text-xs text-slate-400">
                            {s.slot_code} · {s.entry_type === 'reservation' ? <span className="text-amber-300">Đặt trước</span> : 'Vãng lai'} · vào {fmtTime(s.check_in_time)}
                          </div>
                        </div>
                        <div className="text-right text-xs">
                          <div className="font-mono text-slate-300"><Clock className="mr-1 inline h-3 w-3" />{fmtDuration(secs)}</div>
                          <div className="text-slate-400">{s.quote.hours_billed}h · {s.fee_waived
                            ? <b className="text-emerald-300">Miễn phí (Admin)</b>
                            : <>phải trả <b className="text-sky-300">{vnd(s.quote.amount_due)}</b></>}</div>
                          {s.payment_status === 'paid_ready' && (() => {
                            const left = Math.max(0, (s.exit_remaining_seconds || 0) - elapsed)
                            return left > 0
                              ? <span className="badge mt-0.5 bg-emerald-500/20 text-emerald-300">Đã trả trước {vnd(s.prepaid_amount)} · ra cổng trong {fmtDuration(left)}</span>
                              : <span className="badge mt-0.5 bg-amber-500/20 text-amber-300">Quá hạn ra cổng — sẽ tính phí phát sinh</span>
                          })()}
                          {s.at_gate && <span className="badge mt-0.5 bg-rose-500/20 text-rose-300">Đang chờ thanh toán tại cổng ra</span>}
                        </div>
                        <div className="flex flex-wrap gap-1.5">
                          {!s.fee_waived && s.payment_status !== 'paid_ready' && !s.at_gate && (
                            <button className="btn-warning btn-sm" title="Khách trả tiền mặt cho bảo vệ trước khi ra cổng"
                              onClick={() => confirm(`Xác nhận đã thu ${vnd(s.quote.amount_due)} tiền mặt của xe ${s.license_plate}? Xe sẽ được ra cổng tự động trong thời gian cho phép.`)
                                && act('/api/admin/prepay-confirm', { session_id: s.id, method: 'cash' }, `Đã thu hộ — xe ${s.license_plate} sẵn sàng ra cổng`)}>
                              <Banknote className="h-3.5 w-3.5" /> Thu hộ
                            </button>
                          )}
                          {s.payment_status === 'paid_ready' && (
                            <button className="btn-ghost btn-sm" title="Giả lập trôi 15 phút sau khi thanh toán trước"
                              onClick={() => act('/api/admin/simulate/exit-time', { session_id: s.id, minutes: 15 })}>
                              <FastForward className="h-3.5 w-3.5" /> -15p hạn ra
                            </button>
                          )}
                          <button className="btn-ghost btn-sm" title="Giả lập trôi thêm 1 giờ" onClick={() => act('/api/admin/simulate/add-hours', { session_id: s.id, hours: 1 })}>
                            <FastForward className="h-3.5 w-3.5" /> +1h
                          </button>
                          <button className="btn-danger btn-sm" onClick={() => doCheckout(s)}><LogOut className="h-3.5 w-3.5" /> Check-out</button>
                        </div>
                      </div>
                    )
                  })}
                </div>
              )}
            </div>

            {/* Đặt chỗ đang giữ */}
            <div className="card">
              <div className="card-title"><CalendarClock className="h-4 w-4" /> Đặt chỗ đang giữ ({data.reservations.length})</div>
              {data.reservations.length === 0 ? <Empty>Không có đặt chỗ nào đang giữ</Empty> : (
                <div className="max-h-[420px] space-y-2 overflow-y-auto pr-1">
                  {data.reservations.map((r) => {
                    const left = Math.max(0, r.remaining_seconds - elapsed)
                    const pending = r.status === 'pending_payment'
                    const box = pending ? 'border-orange-500/50 bg-orange-500/10' : 'border-amber-500/30 bg-amber-500/5'
                    return (
                      <div key={r.id} className={`flex flex-wrap items-center gap-3 rounded-xl border p-3 ${box}`}>
                        <div className="min-w-[130px] flex-1">
                          <div className="font-mono font-semibold">{r.license_plate} <span className="font-sans text-xs text-amber-300">→ {r.slot_code}</span></div>
                          <div className="text-xs text-slate-400">{r.customer_name} · {r.phone} · {r.deposit_mode === 'admin_free'
                            ? <span className="text-emerald-300">Miễn phí (Admin)</span> : `cọc ${vnd(r.deposit_amount)}`}</div>
                          <div className="mt-0.5 flex flex-wrap items-center gap-1.5 text-xs text-slate-400">
                            {r.ticket_code && <span>Vé <span className="font-mono font-semibold tracking-wider text-sky-300">{r.ticket_code}</span></span>}
                            {pending && <span className="badge bg-orange-500/20 text-orange-200">Chờ chuyển khoản · ND: COC {r.ticket_code}</span>}
                          </div>
                        </div>
                        <div className={`font-mono text-lg font-bold ${left < 180 ? 'text-rose-400' : 'text-amber-300'}`}>{fmtDuration(left)}</div>
                        <div className="flex flex-wrap gap-1.5">
                          {pending && (
                            <button className="btn-warning btn-sm" title="Dự phòng khi webhook SePay chưa về: đã kiểm tra app ngân hàng, nhận đủ tiền cọc"
                              onClick={() => confirm(`Xác nhận đã nhận ${vnd(r.deposit_amount)} với nội dung "COC ${r.ticket_code}" trong app MB Bank?`)
                                && act(`/api/admin/reservations/${r.id}/approve`, undefined, `Đã duyệt cọc vé ${r.ticket_code}`)}>
                              <BadgeCheck className="h-3.5 w-3.5" /> Duyệt cọc
                            </button>
                          )}
                          {r.ticket_code && !pending && (
                            <button className="btn-success btn-sm" title="Xác nhận xe vào bằng vé" onClick={async () => {
                              const res = await act('/api/admin/checkin-ticket', { code: r.ticket_code })
                              if (res) onGateResult('entry', res)
                            }}>
                              <LogIn className="h-3.5 w-3.5" /> Xe vào
                            </button>
                          )}
                          <button className="btn-ghost btn-sm" title="Tua nhanh 5 phút" onClick={() => act('/api/admin/simulate/reservation-time', { reservation_id: r.id, minutes: 5 })}>
                            <FastForward className="h-3.5 w-3.5" /> -5p
                          </button>
                          <button className="btn-ghost btn-sm" title="Cho hết hạn ngay" onClick={() => act('/api/admin/simulate/reservation-time', { reservation_id: r.id, minutes: 9999 }, 'Đã cho đặt chỗ hết hạn')}>
                            Hết hạn
                          </button>
                          <button className="btn-danger btn-sm" title="Hủy đặt chỗ" onClick={() => confirm('Hủy đặt chỗ này?') && act(`/api/admin/reservations/${r.id}/cancel`, undefined, 'Đã hủy đặt chỗ')}>
                            <XCircle className="h-3.5 w-3.5" />
                          </button>
                        </div>
                      </div>
                    )
                  })}
                </div>
              )}
            </div>
          </div>

          <div className="card">
            <div className="card-title"><ScrollText className="h-4 w-4" /> Nhật ký phần cứng ESP32 / Barrier / ALPR</div>
            <div className="max-h-72 overflow-y-auto rounded-xl border border-slate-800 bg-slate-950 p-3 font-mono text-xs dark:border-transparent dark:bg-black/40">
              {data.logs.length === 0 ? <div className="text-slate-500">Chưa có log</div> : data.logs.map((l) => (
                <div key={l.id} className="flex flex-wrap gap-x-2 border-b border-white/5 py-1 sm:flex-nowrap sm:border-0 sm:py-0.5">
                  <span className="shrink-0 text-slate-500">{fmtTime(l.created_at)}</span>
                  <span className={`shrink-0 sm:w-20 ${{ esp32: 'text-violet-400', alpr: 'text-sky-400', admin: 'text-amber-400', system: 'text-rose-400', simulator: 'text-emerald-400' }[l.source] || 'text-slate-300'}`}>[{l.source}]</span>
                  <span className="w-full break-words text-slate-200 sm:w-auto">{l.message}</span>
                </div>
              ))}
            </div>
          </div>
        </>
      )}

      {tab === 'stats' && (
        <>
          <div className="grid grid-cols-1 gap-2 min-[400px]:grid-cols-2 sm:gap-3 lg:grid-cols-4">
            <Stat icon={Wallet} label="Tổng doanh thu" value={vnd(st.revenue_online + st.revenue_cash + st.revenue_deposit)} sub="Online + Tiền mặt + Cọc" tone="sky" />
            <Stat icon={QrCode} label="Thanh toán Online" value={vnd(st.revenue_online)} sub={`${st.count_paid_online} lượt`} tone="violet" />
            <Stat icon={Banknote} label="Tiền mặt tại cổng" value={vnd(st.revenue_cash)} sub={`${st.count_paid_cash} lượt`} tone="amber" />
            <Stat icon={PiggyBank} label="Tiền cọc đã thu" value={vnd(st.revenue_deposit)} sub={`Mất cọc (hết hạn/hủy): ${vnd(st.deposit_forfeited)}`} tone="emerald" />
            <Stat icon={Activity} label="Tổng lượt xe" value={st.total_sessions} sub={`Hôm nay: ${st.sessions_today} · Miễn phí Admin: ${st.count_free}`} tone="sky" />
            <Stat icon={Car} label="Đang đỗ" value={st.parked_now} sub={`Vãng lai ${st.walk_in} · Đặt trước ${st.reservation_entries}`} tone="slate" />
            <Stat icon={CalendarClock} label="Tổng đặt chỗ" value={st.reservations_total} sub={`Hết hạn: ${st.reservations_expired}`} tone="amber" />
            <Stat icon={BarChart3} label="Tỉ lệ Online" value={`${st.count_paid_online + st.count_paid_cash ? Math.round((st.count_paid_online / (st.count_paid_online + st.count_paid_cash)) * 100) : 0}%`} sub="trên tổng lượt đã thanh toán" tone="violet" />
          </div>
          <RevenueBar online={st.revenue_online} cash={st.revenue_cash} deposit={st.revenue_deposit} />
          <div className="card">
            <div className="card-title"><History className="h-4 w-4" /> Lịch sử xe ra gần đây</div>
            {data.history.length === 0 ? <Empty>Chưa có lượt xe nào hoàn tất</Empty> : (<>
              {/* Mobile: dạng thẻ */}
              <div className="space-y-2 md:hidden">
                {data.history.map((h) => (
                  <div key={h.id} className="rounded-xl border border-slate-800 bg-slate-950/50 p-3 text-sm">
                    <div className="flex items-center justify-between gap-2">
                      <span className="font-mono font-semibold">{h.license_plate}</span>
                      <span className={`badge ${payMethod(h.payment_method).cls}`}>{payMethod(h.payment_method).label}</span>
                    </div>
                    <div className="mt-1 text-xs text-slate-400">
                      {h.slot_code} · {h.entry_type === 'reservation' ? 'Đặt trước' : 'Vãng lai'} · {fmtTime(h.check_in_time)} → {fmtTime(h.check_out_time)}
                    </div>
                    <div className="mt-1 flex justify-between text-xs">
                      <span>{h.hours_billed}h · {vnd(h.total_fee)} − cọc {vnd(h.deposit_deducted)}{h.prepaid_amount > 0 ? ` · trả trước ${vnd(h.prepaid_amount)}` : ''}</span>
                      <b className="text-sky-300">{vnd((h.amount_due || 0) + (h.prepaid_amount || 0))}</b>
                    </div>
                  </div>
                ))}
              </div>
              <div className="hidden overflow-x-auto md:block">
                <table className="w-full text-left text-sm">
                  <thead className="text-xs text-slate-400">
                    <tr>{['Biển số', 'Ô', 'Loại', 'Vào', 'Ra', 'Giờ', 'Tổng phí', 'Trừ cọc', 'Đã thu', 'Hình thức'].map((h) => <th key={h} className="whitespace-nowrap px-2 py-2 font-medium">{h}</th>)}</tr>
                  </thead>
                  <tbody>
                    {data.history.map((h) => (
                      <tr key={h.id} className="border-t border-slate-800">
                        <td className="px-2 py-2 font-mono">{h.license_plate}</td>
                        <td className="px-2">{h.slot_code}</td>
                        <td className="px-2">{h.entry_type === 'reservation' ? 'Đặt trước' : 'Vãng lai'}</td>
                        <td className="whitespace-nowrap px-2 text-slate-400">{fmtTime(h.check_in_time)}</td>
                        <td className="whitespace-nowrap px-2 text-slate-400">{fmtTime(h.check_out_time)}</td>
                        <td className="px-2">{h.hours_billed}</td>
                        <td className="px-2">{vnd(h.total_fee)}</td>
                        <td className="px-2">{vnd(h.deposit_deducted)}</td>
                        <td className="px-2 font-semibold text-sky-300" title={h.prepaid_amount ? `Trả trước ${vnd(h.prepaid_amount)} + tại cổng ${vnd(h.amount_due)}` : undefined}>
                          {vnd((h.amount_due || 0) + (h.prepaid_amount || 0))}{h.prepaid_amount > 0 && <span className="ml-1 text-[10px] text-emerald-300">trả trước</span>}
                        </td>
                        <td className="px-2">
                          <span className={`badge ${payMethod(h.payment_method).cls}`}>{payMethod(h.payment_method).label}</span>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </>)}
          </div>
        </>
      )}

      {tab === 'reconcile' && <ReconcilePanel tick={tick} toast={toast} />}
      {tab === 'settings' && <SettingsPanel toast={toast} />}
      {tab === 'accounts' && <AdminAccountsPanel me={user} onToken={onToken} />}
      {tab === 'activity' && <AdminActivityPanel tick={tick} toast={toast} />}

      <CheckoutModal session={checkout} onClose={() => setCheckout(null)} toast={toast} />
    </div>
  )
}

function RevenueBar({ online, cash, deposit }) {
  const total = online + cash + deposit || 1
  const parts = [
    { label: 'Online QR', v: online, cls: 'bg-violet-500' },
    { label: 'Tiền mặt', v: cash, cls: 'bg-amber-500' },
    { label: 'Tiền cọc', v: deposit, cls: 'bg-emerald-500' },
  ]
  return (
    <div className="card">
      <div className="card-title"><BarChart3 className="h-4 w-4" /> Cơ cấu doanh thu</div>
      <div className="flex h-4 overflow-hidden rounded-full bg-slate-800">
        {parts.map((p) => <div key={p.label} className={p.cls} style={{ width: `${(p.v / total) * 100}%` }} title={`${p.label}: ${vnd(p.v)}`} />)}
      </div>
      <div className="mt-3 flex flex-wrap gap-4 text-sm">
        {parts.map((p) => (
          <span key={p.label} className="flex items-center gap-2">
            <span className={`h-3 w-3 rounded ${p.cls}`} />{p.label}: <b>{vnd(p.v)}</b>
            <span className="text-slate-500">({Math.round((p.v / total) * 100)}%)</span>
          </span>
        ))}
      </div>
    </div>
  )
}
