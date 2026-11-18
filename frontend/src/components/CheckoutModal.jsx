import { useState } from 'react'
import { Receipt, Banknote, QrCode, Loader2 } from 'lucide-react'
import { Modal } from './ui.jsx'
import PaymentQRModal from './PaymentQRModal.jsx'
import { api, fmtTime, vnd } from '../api.js'

/** Hóa đơn xe ra: chọn thu tiền mặt hoặc QR online. `session` đã được chốt check-out. */
export default function CheckoutModal({ session, onClose, toast }) {
  const [qr, setQr] = useState(false)
  const [busy, setBusy] = useState(false)
  if (!session) return null

  const pay = async (kind) => {
    setBusy(true)
    try {
      const s = await api(`/api/admin/${kind === 'cash' ? 'pay-cash' : 'pay-online'}`, { method: 'POST', body: { session_id: session.id } })
      toast(`Xe ${s.license_plate} đã thanh toán ${vnd(s.amount_due)} (${kind === 'cash' ? 'tiền mặt' : 'online'}). Mở barrier cổng ra.`, 'success')
      onClose()
    } catch (err) { toast(err.message, 'error') } finally { setBusy(false) }
  }

  if (qr) {
    return (
      <PaymentQRModal open onClose={() => setQr(false)} title="Thanh toán Online tại cổng ra" amount={session.amount_due}
        content={`PHI ${session.license_plate.replace(/[^A-Z0-9]/g, '')}`} confirmLabel="Xác nhận thanh toán Online" onConfirm={() => pay('online')} />
    )
  }

  const rows = [
    ['Biển số', <span className="font-mono">{session.license_plate}</span>],
    ['Ô đỗ', session.slot_code],
    ['Loại', session.entry_type === 'reservation' ? 'Đặt trước' : 'Vãng lai'],
    ['Giờ vào', fmtTime(session.check_in_time)],
    ['Giờ ra', fmtTime(session.check_out_time)],
    ['Số giờ tính phí', `${session.hours_billed} giờ`],
    ['Tổng phí', vnd(session.total_fee)],
    ['Trừ tiền cọc', `- ${vnd(session.deposit_deducted)}`],
    ...(session.prepaid_amount > 0 ? [['Đã trả trước', `- ${vnd(session.prepaid_amount)}`]] : []),
  ]
  const late = session.prepaid_amount > 0 && session.exit_deadline
  return (
    <Modal open onClose={onClose} title={late ? 'Ra quá hạn — thu phí phát sinh' : 'Hóa đơn xe ra'} icon={Receipt}>
      {late && (
        <div className="mb-3 rounded-xl border border-amber-500/40 bg-amber-500/10 px-3 py-2 text-sm text-amber-100">
          Xe đã thanh toán trước nhưng ra sau hạn {fmtTime(session.exit_deadline)} — thu phần phí phát sinh thêm rồi mở barrier.
        </div>
      )}
      <div className="space-y-1.5 rounded-xl bg-slate-950/60 p-3 text-sm">
        {rows.map(([k, v]) => <div key={k} className="flex justify-between"><span className="text-slate-400">{k}</span><span>{v}</span></div>)}
        <div className="mt-2 flex items-center justify-between border-t border-slate-700 pt-2">
          <span className="font-semibold">{late ? 'Phí phát sinh thêm' : 'Còn phải trả'}</span>
          <span className="text-2xl font-bold text-sky-300">{vnd(session.amount_due)}</span>
        </div>
      </div>
      <div className="mt-4 grid grid-cols-2 gap-2">
        <button className="btn-warning" disabled={busy} onClick={() => pay('cash')}>
          {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Banknote className="h-4 w-4" />} Xác nhận thu tiền mặt
        </button>
        <button className="btn-primary" disabled={busy} onClick={() => setQr(true)}><QrCode className="h-4 w-4" /> Thanh toán QR</button>
      </div>
      <p className="mt-2 text-center text-xs text-slate-500">Barrier cổng ra chỉ mở sau khi xác nhận thanh toán.</p>
    </Modal>
  )
}
