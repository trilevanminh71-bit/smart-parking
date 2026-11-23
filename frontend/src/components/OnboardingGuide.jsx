import { useEffect } from 'react'
import { CalendarCheck, QrCode, Navigation, Wallet, Banknote, Timer, Rocket, BookOpen, X } from 'lucide-react'
import { vnd } from '../api.js'

export const GUIDE_KEY = 'sp_onboarding_seen_v1'

export function guideSeen() {
  try { return localStorage.getItem(GUIDE_KEY) === '1' } catch { return true }
}
export function markGuideSeen() {
  try { localStorage.setItem(GUIDE_KEY, '1') } catch { /* ignore */ }
}

const LEGEND = [
  ['Trống', 'bg-emerald-400 dot-available', 'slot-available border-emerald-500/60 bg-emerald-500/15 text-emerald-300'],
  ['Đã đặt cọc', 'bg-amber-400 dot-reserved', 'slot-reserved border-amber-500/60 bg-amber-500/15 text-amber-300'],
  ['Chờ chuyển khoản', 'bg-orange-400 dot-pending', 'slot-pending border-orange-500/60 bg-orange-500/15 text-orange-300'],
  ['Có xe', 'bg-[#64748b] dot-occupied', 'slot-occupied border-[#64748b] bg-[#475569] text-white'],
]

function Step({ n, icon: Icon, tone, title, children }) {
  const tones = {
    emerald: 'bg-emerald-500/15 text-emerald-300 ring-emerald-500/40',
    sky: 'bg-sky-500/15 text-sky-300 ring-sky-500/40',
    violet: 'bg-violet-500/15 text-violet-300 ring-violet-500/40',
  }
  return (
    <li className="flex gap-3 rounded-xl border border-slate-800 bg-slate-950/50 p-3">
      <div className="flex shrink-0 flex-col items-center gap-1">
        <span className={`flex h-10 w-10 items-center justify-center rounded-xl ring-1 ${tones[tone]}`}><Icon className="h-5 w-5" /></span>
        <span className="text-[10px] font-semibold uppercase tracking-wide text-slate-500">Bước {n}</span>
      </div>
      <div className="min-w-0 flex-1">
        <h4 className="font-semibold leading-snug text-slate-100">{title}</h4>
        <div className="mt-1 space-y-1.5 text-sm leading-relaxed text-slate-300">{children}</div>
      </div>
    </li>
  )
}

const Chip = ({ icon: Icon, children }) => (
  <span className="inline-flex items-center gap-1 rounded-md bg-slate-800 px-1.5 py-0.5 text-xs text-slate-200">
    {Icon && <Icon className="h-3 w-3" />}{children}
  </span>
)

/** Hướng dẫn nhanh cho người dùng mới. `onDone` = bấm "Đã hiểu" (lưu localStorage), `onClose` = đóng tạm. */
export default function OnboardingGuide({ open, onClose, onDone, settings }) {
  useEffect(() => {
    if (!open) return
    const onKey = (e) => e.key === 'Escape' && onClose()
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [open, onClose])
  if (!open) return null

  const hold = settings?.hold_minutes ?? 15
  const deposit = settings?.deposit_amount ?? 10000
  const rate = settings?.hourly_rate ?? 10000
  const pending = settings?.pending_minutes ?? 10
  const freeMin = settings?.free_minutes ?? 15

  return (
    <div className="fixed inset-0 z-[55] flex items-end justify-center bg-black/70 backdrop-blur-sm sm:items-center sm:p-4" onMouseDown={onClose}>
      <div role="dialog" aria-modal="true" aria-labelledby="guide-title"
        className="flex max-h-[94dvh] w-full max-w-lg flex-col overflow-hidden rounded-t-2xl border border-slate-700 bg-slate-900 shadow-2xl sm:rounded-2xl"
        onMouseDown={(e) => e.stopPropagation()}>
        {/* Đầu bảng */}
        <div className="relative shrink-0 bg-gradient-to-br from-sky-500/25 via-slate-900 to-slate-900 px-4 pb-3 pt-4 sm:px-5">
          <button onClick={onClose} aria-label="Đóng hướng dẫn"
            className="absolute right-2 top-2 flex h-10 w-10 items-center justify-center rounded-full text-slate-400 hover:bg-slate-800 hover:text-white">
            <X className="h-5 w-5" />
          </button>
          <div className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wide text-sky-300"><BookOpen className="h-4 w-4" /> Hướng dẫn nhanh</div>
          <h3 id="guide-title" className="mt-1 pr-10 text-lg font-bold leading-snug sm:text-xl">Cách sử dụng Bãi Đỗ Xe Thông Minh</h3>
          <p className="mt-0.5 text-sm text-slate-400">Chỉ 3 bước: đặt chỗ, vào cổng, thanh toán khi ra.</p>
        </div>

        {/* Nội dung (cuộn được nếu màn hình thấp) */}
        <div className="min-h-0 flex-1 overflow-y-auto px-4 pb-2 sm:px-5">
          <ol className="space-y-2.5">
            <Step n={1} icon={CalendarCheck} tone="emerald" title="Chọn ô & Đặt cọc">
              <p>
                Chọn <b>Tầng 1–3</b>, bấm vào ô màu <b className="text-emerald-300">xanh lá</b> để đặt chỗ trước, rồi quét
                {' '}<Chip icon={QrCode}>VietQR MB Bank</Chip> đóng cọc <b>{vnd(deposit)}</b>.
              </p>
              <div className="flex items-start gap-1.5 text-xs text-slate-400">
                <Timer className="mt-0.5 h-3.5 w-3.5 shrink-0 text-amber-400" />
                <span>
                  Ghi đúng nội dung <b className="text-slate-200">COC &lt;mã vé&gt;</b>. Ô được giữ tạm <b className="text-slate-200">{pending} phút</b> chờ tiền về;
                  khi tiền vào, hệ thống <b className="text-slate-200">tự xác nhận</b> và giữ chỗ <b className="text-slate-200">{hold} phút</b>
                  (quá giờ chưa tới, chỗ tự hủy, không hoàn cọc).
                </span>
              </div>
            </Step>

            <Step n={2} icon={Navigation} tone="sky" title="Quét mã vào cổng & Chỉ đường">
              <p>
                Đưa <Chip icon={QrCode}>mã vé QR</Chip> hoặc <Chip>mã 6 ký tự</Chip> cho bảo vệ tại cổng.
              </p>
              <p>Khi barrier mở, xem <b>bản đồ mũi tên kiểu Google Maps</b> ngay trên vé để đi tới đúng ô đã đặt.</p>
            </Step>

            <Step n={3} icon={Wallet} tone="violet" title="Thanh toán khi ra">
              <p>
                Miễn phí <b>{freeMin} phút đầu</b>, sau đó tính theo giờ (<b>{vnd(rate)}/giờ</b>, làm tròn lên), <b>tự động trừ tiền cọc</b> đã đóng.
              </p>
              <div className="flex flex-wrap items-center gap-1.5">
                <Chip icon={QrCode}>Quét VietQR trên web</Chip>
                <span className="text-xs text-slate-500">hoặc</span>
                <Chip icon={Banknote}>Tiền mặt tại cổng</Chip>
              </div>
            </Step>
          </ol>

          {/* Chú thích màu ô đỗ */}
          <div className="mt-3 rounded-xl border border-slate-800 bg-slate-950/50 p-3">
            <div className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-400">Chú thích màu ô đỗ</div>
            <div className="grid grid-cols-3 gap-2">
              {LEGEND.map(([label, dot, cls]) => (
                <div key={label} className={`flex flex-col items-center gap-1 rounded-lg border-2 border-dashed px-1 py-2 text-center ${cls}`}>
                  <span className={`h-3 w-3 rounded-full ${dot}`} />
                  <span className="text-xs font-semibold leading-tight">{label}</span>
                </div>
              ))}
            </div>
          </div>
        </div>

        {/* Chân bảng */}
        <div className="shrink-0 border-t border-slate-800 px-4 pb-[calc(0.75rem+env(safe-area-inset-bottom))] pt-3 sm:px-5 sm:pb-4">
          <button className="btn-primary w-full !min-h-[48px] text-base" onClick={onDone} autoFocus>
            <Rocket className="h-5 w-5" /> Đã hiểu, bắt đầu ngay
          </button>
          <p className="mt-2 text-center text-xs text-slate-500">Xem lại bất cứ lúc nào bằng nút <b className="text-slate-300">? Hướng dẫn</b> trên thanh tiêu đề.</p>
        </div>
      </div>
    </div>
  )
}
