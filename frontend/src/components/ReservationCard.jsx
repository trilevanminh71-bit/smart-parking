import { Timer, XCircle, CheckCircle2, AlertTriangle, Ticket, Maximize2, Hourglass, ImageUp, FileDown } from 'lucide-react'
import TicketQR from './TicketQR.jsx'
import NavMiniMap from './NavMiniMap.jsx'
import VietQRBox, { WaitingBank } from './VietQRBox.jsx'
import { fmtDuration, useNow, vnd } from '../api.js'

const WARN_SECONDS = 180 // dưới 3 phút -> cảnh báo đỏ

/** Thẻ đặt chỗ: đồng hồ đếm ngược + vé QR + chỉ dẫn đường đi. `res._receivedAt` = thời điểm nhận dữ liệu.
 *  Vé "Chờ chuyển khoản": hiện VietQR + trạng thái chờ tiền về + gửi biên lai / tải phiếu minh chứng. */
export default function ReservationCard({ res, holdMinutes, pendingMinutes = 5, onCancel, onDismiss, onShowMap, onReceipt, onProof, slots, gateOpen = false }) {
  const now = useNow(1000)
  const holding = res.status === 'active' || res.status === 'pending_payment'
  const pending = res.status === 'pending_payment'
  const remaining = holding ? Math.max(0, res.remaining_seconds - (now - res._receivedAt) / 1000) : 0
  const total = (pending ? pendingMinutes : holdMinutes) * 60
  const pct = total ? Math.min(100, (remaining / total) * 100) : 0
  const urgent = remaining < (pending ? 60 : WARN_SECONDS)

  if (pending) {
    return (
      <div className="rounded-xl border border-orange-500/50 bg-orange-500/5 p-3 sm:p-4" data-res-id={res.id}>
        <div className="flex flex-wrap items-start justify-between gap-2">
          <div className="min-w-0">
            <div className="text-xs text-slate-400">Đặt chỗ #{res.id} · {res.customer_name}</div>
            <div className="text-lg font-semibold">
              Ô <span className="text-orange-300">{res.slot_code}</span> · <span className="font-mono">{res.license_plate}</span>
            </div>
            <span className="badge mt-1 bg-orange-500/20 text-orange-200"><Hourglass className="h-3 w-3" /> Chờ chuyển khoản cọc</span>
          </div>
          <div className="text-right">
            <div className="text-[11px] text-slate-400">Tự hủy sau</div>
            <div className={`font-mono text-3xl font-bold tabular-nums ${urgent ? 'animate-pulse text-rose-400' : 'text-orange-300'}`}>{fmtDuration(remaining)}</div>
          </div>
        </div>
        <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-slate-800">
          <div className={`h-full transition-all duration-1000 ${urgent ? 'bg-rose-500' : 'bg-orange-400'}`} style={{ width: `${pct}%` }} />
        </div>

        <div className="mx-auto mt-3 max-w-sm space-y-3">
          <VietQRBox small amount={res.deposit_amount} content={`COC ${res.ticket_code} ${res.license_plate}`}
            lines={[['Mã vé', <span className="font-mono font-semibold tracking-wider text-sky-300">{res.ticket_code}</span>]]} />
          <WaitingBank />
          <p className="text-center text-xs text-slate-400">
            Ghi đúng nội dung <b>COC {res.ticket_code}</b>. Khi tiền vào, vé QR và bản đồ chỉ đường sẽ tự hiện. Quá {pendingMinutes} phút
            chưa nhận được tiền, ô tự trả về trống.
          </p>
          {res.receipt_status === 'new' && (
            <div className="rounded-lg bg-sky-500/10 px-3 py-2 text-center text-xs text-sky-200">Đã gửi ảnh biên lai — Bảo vệ đang đối soát.</div>
          )}
        </div>
        <div className="mt-3 grid gap-2 sm:grid-cols-3">
          {onReceipt && <button className="btn-ghost text-sm" onClick={onReceipt}><ImageUp className="h-4 w-4" /> Đã chuyển nhưng chưa duyệt? Gửi ảnh biên lai</button>}
          {onProof && <button className="btn-ghost text-sm" onClick={onProof}><FileDown className="h-4 w-4" /> Tải phiếu minh chứng</button>}
          {onCancel && <button className="btn-ghost text-sm" onClick={onCancel}><XCircle className="h-4 w-4" /> Hủy đặt chỗ</button>}
        </div>
      </div>
    )
  }

  if (!holding) {
    const map = {
      checked_in: { icon: CheckCircle2, cls: 'text-emerald-300 border-emerald-500/40 bg-emerald-500/10', text: `Xe ${res.license_plate} đã vào bãi tại ô ${res.slot_code}.` + (res.deposit_amount ? ` Tiền cọc ${vnd(res.deposit_amount)} được trừ vào phí gửi.` : '') },
      expired: { icon: XCircle, cls: 'text-rose-300 border-rose-500/40 bg-rose-500/10', text: `Đặt chỗ ${res.slot_code} (${res.license_plate}) đã hết hạn giữ chỗ và bị hủy tự động.` },
      cancelled: { icon: XCircle, cls: 'text-slate-300 border-slate-600 bg-slate-800/60', text: `Đặt chỗ ${res.slot_code} (${res.license_plate}) đã được hủy.` },
    }
    const m = map[res.status] || map.cancelled
    return (
      <div className={`flex items-start gap-3 rounded-xl border p-3 text-sm ${m.cls}`}>
        <m.icon className="mt-0.5 h-5 w-5 shrink-0" />
        <div className="flex-1">{m.text}</div>
        {onDismiss && <button className="text-xs text-slate-400 hover:text-white" onClick={onDismiss}>Ẩn</button>}
      </div>
    )
  }

  return (
    <div data-res-id={res.id} className={`rounded-xl border p-3 transition-colors sm:p-4 ${urgent ? 'border-rose-500/70 bg-rose-500/10' : 'border-amber-500/40 bg-amber-500/5'}`}>
      <div className="flex flex-col gap-4 sm:flex-row sm:items-start">
        <div className="min-w-0 flex-1">
          <div className="text-xs text-slate-400">Đặt chỗ #{res.id} · {res.customer_name}</div>
          <div className="text-lg font-semibold">
            Ô <span className={urgent ? 'text-rose-300' : 'text-amber-300'}>{res.slot_code}</span> · <span className="font-mono">{res.license_plate}</span>
          </div>
          <div className="mt-1 flex flex-wrap gap-1.5">
            {res.deposit_mode === 'admin_free'
              ? <span className="badge bg-emerald-500/20 text-emerald-200"><CheckCircle2 className="h-3 w-3" /> Miễn phí (Admin)</span>
              : <span className="badge bg-emerald-500/20 text-emerald-200"><CheckCircle2 className="h-3 w-3" /> Đã nhận cọc {vnd(res.deposit_amount)}</span>}
          </div>

          <div className={`mt-2 rounded-xl p-3 ${urgent ? 'bg-rose-500/20' : 'bg-slate-950/50'}`}>
            <div className="flex items-center gap-1 text-xs text-slate-300">
              {urgent ? <AlertTriangle className="h-3.5 w-3.5 text-rose-400" /> : <Timer className="h-3.5 w-3.5" />}
              {urgent ? 'Sắp hết thời gian giữ chỗ!' : 'Thời gian giữ chỗ còn lại'}
            </div>
            <div className={`font-mono text-4xl font-bold tabular-nums ${urgent ? 'animate-pulse text-rose-400' : 'text-amber-300'}`}>{fmtDuration(remaining)}</div>
            <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-slate-800">
              <div className={`h-full transition-all duration-1000 ${urgent ? 'bg-rose-500' : 'bg-amber-400'}`} style={{ width: `${pct}%` }} />
            </div>
          </div>
        </div>

        {res.ticket_code && (
          <div className="flex items-center gap-3 self-center rounded-xl bg-slate-950/50 p-3 sm:flex-col sm:gap-2">
            <TicketQR content={res.qr_content} size={128} />
            <div className="text-center">
              <div className="flex items-center justify-center gap-1 text-[11px] uppercase tracking-wide text-slate-400"><Ticket className="h-3 w-3" /> Mã vé</div>
              <div className="font-mono text-2xl font-bold tracking-[0.2em] text-sky-300">{res.ticket_code}</div>
              <div className="text-[11px] text-slate-500">Đưa mã này cho bảo vệ tại cổng</div>
            </div>
          </div>
        )}
      </div>

      {/* Bản đồ chỉ đường nhúng trực tiếp (kiểu Google Maps Navigation) */}
      <div className="-mx-1 mt-3 scroll-mt-20 sm:mx-auto sm:max-w-xl" data-nav-map={res.slot_code}>
        <NavMiniMap slotCode={res.slot_code} slots={slots} plate={res.license_plate} gateOpen={gateOpen} inline />
      </div>
      {(onCancel || onShowMap) && (
        <div className="mt-3 flex flex-col gap-2 sm:flex-row sm:justify-end">
          {onShowMap && (
            <button className="btn-ghost" onClick={onShowMap}><Maximize2 className="h-4 w-4" /> Phóng to bản đồ</button>
          )}
          {onCancel && <button className="btn-ghost" onClick={onCancel}><XCircle className="h-4 w-4" /> Hủy đặt chỗ</button>}
        </div>
      )}
    </div>
  )
}
