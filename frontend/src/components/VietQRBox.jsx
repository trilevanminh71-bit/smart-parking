import { useState } from 'react'
import { Loader2, ImageOff, Copy } from 'lucide-react'
import { BANK, transferNote, vietQrUrl, vnd } from '../api.js'

/** Ảnh VietQR động (MB Bank) + thông tin chuyển khoản. */
export default function VietQRBox({ amount, content, lines = [], small = false }) {
  const [imgState, setImgState] = useState('loading') // loading | ok | error
  const ckNote = transferNote(content)
  const url = vietQrUrl(amount, content)
  const copy = (t) => navigator.clipboard?.writeText(t).catch(() => {})

  return (
    <div className="flex w-full flex-col items-center gap-3">
      <div className={`relative flex w-full items-center justify-center overflow-hidden rounded-2xl bg-white p-2 ${small ? 'min-h-[200px] max-w-[230px]' : 'min-h-[260px] max-w-[300px]'}`}>
        {imgState !== 'error' && (
          <img src={url} alt={`VietQR ${BANK.name} ${vnd(amount)}`} className={`w-full ${imgState === 'loading' ? 'opacity-0' : ''}`}
            onLoad={() => setImgState('ok')} onError={() => setImgState('error')} />
        )}
        {imgState === 'loading' && <Loader2 className="absolute h-8 w-8 animate-spin text-slate-400" />}
        {imgState === 'error' && (
          <div className="flex flex-col items-center gap-2 p-4 text-center text-sm text-slate-600">
            <ImageOff className="h-8 w-8" />
            Không tải được ảnh VietQR (cần Internet). Hãy chuyển khoản thủ công theo thông tin bên dưới.
          </div>
        )}
      </div>
      <div className="text-center">
        <div className="text-xs uppercase tracking-wide text-slate-400">Số tiền cần chuyển</div>
        <div className="text-3xl font-bold tabular-nums text-sky-300">{vnd(amount)}</div>
      </div>
      <div className="w-full space-y-1.5 rounded-xl bg-slate-950/60 p-3 text-sm">
        <Row k="Ngân hàng" v={BANK.name} />
        <Row k="Số tài khoản" v={<button type="button" className="font-mono hover:text-sky-300" onClick={() => copy(BANK.account)}>{BANK.account} <Copy className="inline h-3 w-3" /></button>} />
        <Row k="Chủ tài khoản" v={BANK.holder} />
        <Row k="Nội dung CK" v={<button type="button" className="break-all text-left font-mono font-semibold text-amber-300 hover:text-amber-200" onClick={() => copy(ckNote)}>{ckNote} <Copy className="inline h-3 w-3" /></button>} />
        {lines.map(([k, v]) => <Row key={k} k={k} v={v} />)}
      </div>
    </div>
  )
}

/** Trạng thái chờ tiền về (webhook SePay). */
export function WaitingBank({ text = 'Đang chờ hệ thống xác nhận tiền vào...' }) {
  return (
    <div className="flex w-full items-center gap-2 rounded-xl border border-sky-500/40 bg-sky-500/10 px-3 py-2.5 text-sm text-sky-100" role="status" aria-live="polite">
      <Loader2 className="h-4 w-4 shrink-0 animate-spin text-sky-300" />
      <span>{text}</span>
    </div>
  )
}

function Row({ k, v }) {
  return (
    <div className="flex justify-between gap-3">
      <span className="shrink-0 text-slate-400">{k}</span>
      <span className="min-w-0 text-right">{v}</span>
    </div>
  )
}
