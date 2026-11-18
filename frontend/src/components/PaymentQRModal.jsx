import { useState } from 'react'
import { QrCode, ShieldCheck, Loader2 } from 'lucide-react'
import { Modal } from './ui.jsx'
import VietQRBox, { WaitingBank } from './VietQRBox.jsx'

/**
 * Modal thanh toán VietQR (MB Bank).
 * - Khách: `waiting` -> không có nút tự xác nhận, chỉ chờ tiền về (SePay webhook) rồi tự đóng.
 * - Bảo vệ: `onConfirm` -> nút xác nhận thủ công (dự phòng khi webhook chưa về).
 */
export default function PaymentQRModal({ open, onClose, title, amount, content, lines = [], confirmLabel, onConfirm, note, waiting = false, footer }) {
  const [busy, setBusy] = useState(false)

  const confirm = async () => {
    setBusy(true)
    try { await onConfirm() } finally { setBusy(false) }
  }

  return (
    <Modal open={open} onClose={busy ? undefined : onClose} title={title} icon={QrCode}>
      <div className="flex flex-col items-center gap-4">
        <VietQRBox amount={amount} content={content} lines={lines} />
        {note && (
          <div className="w-full rounded-xl border border-amber-500/40 bg-amber-500/10 px-3 py-2 text-sm text-amber-100">{note}</div>
        )}
        {waiting && <WaitingBank />}
        <p className="text-center text-xs text-slate-500">
          Quét mã bằng app ngân hàng bất kỳ, giữ nguyên <b>số tiền</b> và <b>nội dung chuyển khoản</b>.
          {waiting ? ' Hệ thống tự xác nhận khi tiền vào tài khoản (thường vài giây).' : ' Nút xác nhận bên dưới chỉ dùng khi Bảo vệ đã kiểm tra app ngân hàng.'}
        </p>
        {footer}
        <div className="flex w-full flex-col-reverse gap-2 sm:flex-row">
          <button className="btn-ghost sm:flex-1" onClick={onClose} disabled={busy}>{waiting ? 'Đóng' : 'Hủy'}</button>
          {onConfirm && (
            <button className="btn-success sm:flex-[2]" onClick={confirm} disabled={busy}>
              {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <ShieldCheck className="h-4 w-4" />} {confirmLabel}
            </button>
          )}
        </div>
      </div>
    </Modal>
  )
}
