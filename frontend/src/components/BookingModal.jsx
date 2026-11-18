import { useEffect, useState } from 'react'
import { CalendarClock, Loader2, ArrowRight, ShieldCheck, BadgeCheck } from 'lucide-react'
import { Modal } from './ui.jsx'
import { api, vnd } from '../api.js'

/**
 * Đặt chỗ CÓ ĐẶT CỌC qua VietQR MB Bank (hình thức duy nhất):
 * nhập thông tin -> tạo vé "Chờ chuyển khoản" (giữ ô tối đa `pending_minutes` phút) -> thẻ vé hiện VietQR
 * `COC <MÃ_VÉ> <BIỂN_SỐ>` và tự nhảy sang Vé QR khi tiền vào (webhook SePay) hoặc Bảo vệ duyệt.
 */
export default function BookingModal({ slot, settings, user, onClose, onBooked, toast }) {
  // Điền sẵn Tên, SĐT, Biển số đã lưu từ lần đặt chỗ trước
  const blank = () => ({ license_plate: user?.default_plate || '', customer_name: user?.full_name || '', phone: user?.phone || '' })
  const [form, setForm] = useState(blank)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const pendingMin = settings.pending_minutes || 5
  const isAdmin = user?.role === 'admin'

  useEffect(() => {
    setError(''); setForm(blank())
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [slot?.code])

  if (!slot) return null
  const set = (k) => (e) => setForm((f) => ({ ...f, [k]: e.target.value }))

  const submit = async (e) => {
    e.preventDefault()
    setError('')
    if (!/^[\d+ ]{8,15}$/.test(form.phone.trim())) return setError('Số điện thoại không hợp lệ')
    setBusy(true)
    try {
      const res = await api('/api/reservations', { method: 'POST', body: { ...form, slot_code: slot.code } })
      if (res.deposit_mode === 'admin_free') toast(`Đã đặt ô ${res.slot_code} miễn phí (Admin) — vé ${res.ticket_code}, giữ chỗ ${settings.hold_minutes} phút.`, 'success')
      else toast(`Đã giữ ô ${res.slot_code} trong ${pendingMin} phút — hãy quét VietQR để chuyển ${vnd(res.deposit_amount)} tiền cọc.`, 'info')
      onBooked(res)
    } catch (err) {
      setError(err.message)
    } finally {
      setBusy(false)
    }
  }

  return (
    <Modal open onClose={onClose} title={`Đặt chỗ ô ${slot.code}`} icon={CalendarClock}>
      <form onSubmit={submit} className="space-y-3">
        <div className="grid grid-cols-3 gap-2 rounded-xl bg-slate-950/60 p-3 text-center text-xs">
          <div><div className="text-slate-400">Tầng</div><div className="text-base font-semibold">{slot.floor}</div></div>
          <div><div className="text-slate-400">Tiền cọc</div>
            {isAdmin
              ? <div className="text-base font-semibold text-emerald-300">Miễn phí</div>
              : <div className="text-base font-semibold text-amber-300">{vnd(settings.deposit_amount)}</div>}
          </div>
          <div><div className="text-slate-400">Giữ chỗ</div><div className="text-base font-semibold">{settings.hold_minutes} phút</div></div>
        </div>

        <div>
          <label className="label">Biển số xe *</label>
          <input className="input font-mono uppercase" placeholder="VD: 65A-123.45" value={form.license_plate} onChange={set('license_plate')} required autoFocus={!form.license_plate} />
        </div>
        <div className="grid gap-3 sm:grid-cols-2">
          <div>
            <label className="label">Họ và tên *</label>
            <input className="input" placeholder="Nguyễn Văn A" value={form.customer_name} onChange={set('customer_name')} required />
          </div>
          <div>
            <label className="label">Số điện thoại *</label>
            <input className="input" type="tel" placeholder="09xx xxx xxx" inputMode="tel" value={form.phone} onChange={set('phone')} required />
          </div>
        </div>
        {user?.default_plate && (
          <p className="text-xs text-sky-300/80">Thông tin được điền sẵn từ lần đặt chỗ trước — sửa nếu cần, hệ thống sẽ tự lưu lại.</p>
        )}
        {isAdmin ? (
          <div className="flex items-start gap-1.5 rounded-xl border border-emerald-500/40 bg-emerald-500/10 p-2.5 text-xs text-emerald-100">
            <BadgeCheck className="mt-0.5 h-3.5 w-3.5 shrink-0 text-emerald-300" />
            <span>
              <b>Tài khoản Admin — Miễn phí.</b> Không cần chuyển khoản: bấm đặt chỗ là khóa ô, cấp vé QR và bản đồ chỉ đường ngay
              (giữ chỗ {settings.hold_minutes} phút). Phí gửi xe khi ra cổng cũng được miễn.
            </span>
          </div>
        ) : (
        <div className="flex items-start gap-1.5 rounded-xl border border-amber-500/30 bg-amber-500/5 p-2.5 text-xs text-slate-300">
          <ShieldCheck className="mt-0.5 h-3.5 w-3.5 shrink-0 text-amber-300" />
          <span>
            Ô được giữ tạm <b>{pendingMin} phút</b> để bạn chuyển khoản cọc qua <b>VietQR MB Bank</b>. Khi tiền vào tài khoản,
            hệ thống <b>tự xác nhận</b>, cấp vé QR và giữ chỗ {settings.hold_minutes} phút. Quá {pendingMin} phút chưa nhận được tiền,
            ô tự trả về trống. Tiền cọc được trừ vào phí gửi xe; hủy hoặc quá giờ không hoàn cọc.
          </span>
        </div>
        )}
        {error && <div className="rounded-lg bg-rose-500/10 px-3 py-2 text-sm text-rose-300">{error}</div>}
        <button className={`${isAdmin ? 'btn-success' : 'btn-primary'} w-full`} disabled={busy}>
          {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <ArrowRight className="h-4 w-4" />}
          {isAdmin ? 'Đặt chỗ miễn phí (Admin)' : 'Đặt chỗ & hiện mã VietQR'}
        </button>
      </form>
    </Modal>
  )
}
