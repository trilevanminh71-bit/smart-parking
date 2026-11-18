import { useEffect, useState } from 'react'
import { Scale, FileSpreadsheet, BadgeCheck, Undo2, Download, ImageIcon, Loader2, Search, X, Landmark, AlertTriangle, Receipt } from 'lucide-react'
import { Empty, Modal, Stat } from './ui.jsx'
import { api, downloadAuthed, fetchBlobUrl, fmtTime, RES_STATUS, vnd } from '../api.js'

const STATUS_CLS = {
  matched: 'bg-emerald-500/20 text-emerald-300',
  underpaid: 'bg-amber-500/20 text-amber-300',
  wrong_content: 'bg-rose-500/20 text-rose-300',
  expired_late: 'bg-orange-500/20 text-orange-300',
  already_paid: 'bg-violet-500/20 text-violet-300',
}
const RESOLUTION = { approved: ['Đã duyệt bù', 'bg-emerald-500/20 text-emerald-300'], refunded: ['Đã hoàn tiền', 'bg-sky-500/20 text-sky-300'] }
const FILTERS = [['unresolved', 'Cần xử lý'], ['problem', 'Tất cả lỗi'], ['', 'Tất cả'], ['matched', 'Khớp tự động']]

/** Tab Đối soát: giao dịch SePay (payment_logs) + ảnh biên lai khách gửi; Duyệt bù / Đánh dấu hoàn tiền / Xuất CSV. */
export default function ReconcilePanel({ tick, toast }) {
  const [status, setStatus] = useState('unresolved')
  const [q, setQ] = useState('')
  const [data, setData] = useState(null)
  const [loading, setLoading] = useState(false)
  const [dialog, setDialog] = useState(null) // { kind: 'approve'|'refund', log }
  const [viewer, setViewer] = useState(null) // receipt

  useEffect(() => {
    const t = setTimeout(() => {
      setLoading(true)
      api(`/api/admin/payments?${new URLSearchParams({ status, q })}`)
        .then(setData).catch((err) => toast(err.message, 'error')).finally(() => setLoading(false))
    }, 250)
    return () => clearTimeout(t)
  }, [status, q, tick, toast])

  const exportCsv = async () => {
    try { await downloadAuthed('/api/admin/payments/export.csv', `doi-soat-${new Date().toISOString().slice(0, 10)}.csv`) }
    catch (err) { toast(err.message, 'error') }
  }
  const downloadReceipt = async (r) => {
    try { await downloadAuthed(`/api/admin/receipts/${r.id}/file?download=1`, r.file_name) } catch (err) { toast(err.message, 'error') }
  }
  const receiptAction = async (r, kind) => {
    const text = kind === 'approve'
      ? `Duyệt bù vé ${r.ticket_code} (${r.license_plate}) theo ảnh biên lai? Vé chờ CK / đã hết hạn sẽ được khóa ô lại nếu ô còn trống.`
      : `Đánh dấu đã hoàn ${vnd(r.amount)} cho khách ${r.email} (vé ${r.ticket_code})?`
    if (!confirm(text)) return
    try {
      await api(`/api/admin/receipts/${r.id}/${kind}`, { method: 'POST' })
      toast(kind === 'approve' ? `Đã duyệt bù vé ${r.ticket_code}` : 'Đã đánh dấu hoàn tiền', 'success')
      setViewer(null)
    } catch (err) { toast(err.message, 'error') }
  }

  const s = data?.summary
  const newReceipts = (data?.receipts || []).filter((r) => r.status === 'new')
  const doneReceipts = (data?.receipts || []).filter((r) => r.status !== 'new')

  return (
    <div className="space-y-4 sm:space-y-5">
      {s && (
        <div className="grid grid-cols-2 gap-2 sm:gap-3 lg:grid-cols-4">
          <Stat icon={Landmark} label="Giao dịch SePay" value={s.total} sub={`Khớp tự động: ${s.matched}`} tone="sky" />
          <Stat icon={BadgeCheck} label="Tiền đã khớp" value={vnd(s.matched_amount)} sub="cọc + phí gửi xe" tone="emerald" />
          <Stat icon={AlertTriangle} label="Lỗi cần xử lý" value={s.problems_open} sub={vnd(s.problems_amount)} tone={s.problems_open ? 'rose' : 'emerald'} />
          <Stat icon={Receipt} label="Biên lai chờ xử lý" value={s.receipts_new} sub={`Đã hoàn: ${vnd(s.refunded_amount)}`} tone={s.receipts_new ? 'amber' : 'emerald'} />
        </div>
      )}

      {/* Biên lai khách gửi */}
      <div className="card">
        <div className="card-title"><ImageIcon className="h-4 w-4" /> Ảnh biên lai khách gửi ({newReceipts.length} chờ xử lý)</div>
        {!data ? <div className="text-sm text-slate-500">Đang tải…</div> : data.receipts.length === 0 ? <Empty>Chưa có khách nào gửi biên lai</Empty> : (
          <div className="space-y-2">
            {[...newReceipts, ...doneReceipts.slice(0, 20)].map((r) => (
              <div key={r.id} className={`flex flex-wrap items-center gap-3 rounded-xl border p-3 text-sm ${r.status === 'new' ? 'border-sky-500/40 bg-sky-500/5' : 'border-slate-800 bg-slate-950/50 opacity-80'}`}>
                <div className="min-w-0 flex-1">
                  <div className="font-medium">Vé <span className="font-mono text-sky-300">{r.ticket_code}</span> · <span className="font-mono">{r.license_plate}</span> · ô {r.slot_code} · {vnd(r.amount)}</div>
                  <div className="break-all text-xs text-slate-400">{r.email} · {fmtTime(r.created_at)} · vé hiện: {(RES_STATUS[r.reservation_status] || { label: r.reservation_status || '—' }).label}</div>
                  {r.note && <div className="mt-1 rounded bg-slate-900/80 px-2 py-1 text-xs text-slate-300">“{r.note}”</div>}
                </div>
                {r.status !== 'new' && <span className={`badge ${RESOLUTION[r.status]?.[1]}`}>{RESOLUTION[r.status]?.[0]} · {r.resolved_by}</span>}
                <div className="flex flex-wrap gap-1.5">
                  <button className="btn-ghost btn-sm" onClick={() => setViewer(r)}><ImageIcon className="h-3.5 w-3.5" /> Xem</button>
                  <button className="btn-ghost btn-sm" onClick={() => downloadReceipt(r)}><Download className="h-3.5 w-3.5" /> Tải ảnh</button>
                  {r.status === 'new' && <>
                    <button className="btn-success btn-sm" onClick={() => receiptAction(r, 'approve')}><BadgeCheck className="h-3.5 w-3.5" /> Duyệt bù</button>
                    <button className="btn-warning btn-sm" onClick={() => receiptAction(r, 'refund')}><Undo2 className="h-3.5 w-3.5" /> Đã hoàn tiền</button>
                  </>}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Giao dịch SePay */}
      <div className="card">
        <div className="mb-3 flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
          <div className="card-title !mb-0"><Scale className="h-4 w-4" /> Giao dịch ngân hàng (SePay)</div>
          <button className="btn-primary btn-sm" onClick={exportCsv}><FileSpreadsheet className="h-4 w-4" /> Xuất báo cáo đối soát (.csv)</button>
        </div>
        <div className="mb-3 grid gap-2 sm:grid-cols-[1fr_auto]">
          <div className="relative">
            <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-500" />
            <input className="input px-9" placeholder="Tìm nội dung CK, mã vé, biển số, mã GD…" value={q} onChange={(e) => setQ(e.target.value)} aria-label="Tìm giao dịch" />
            {q && <button className="absolute right-2 top-1/2 -translate-y-1/2 p-1.5 text-slate-500 hover:text-white" onClick={() => setQ('')} aria-label="Xóa tìm kiếm"><X className="h-4 w-4" /></button>}
          </div>
          <div className="grid grid-cols-4 rounded-xl bg-slate-950/70 p-1 text-xs">
            {FILTERS.map(([id, label]) => (
              <button key={id} onClick={() => setStatus(id)} className={`min-h-[36px] rounded-lg px-2 ${status === id ? 'bg-sky-500 text-white' : 'text-slate-400'}`}>{label}</button>
            ))}
          </div>
        </div>
        <div className="mb-2 flex items-center gap-2 text-xs text-slate-500">
          {loading && <Loader2 className="h-3.5 w-3.5 animate-spin" />}{data ? `${data.logs.length} giao dịch` : 'Đang tải…'}
        </div>
        {data && (data.logs.length === 0 ? <Empty>{status === 'unresolved' ? 'Không có giao dịch lỗi nào cần xử lý 🎉' : 'Không có giao dịch'}</Empty> : (
          <div className="space-y-2">
            {data.logs.map((l) => (
              <div key={l.id} className="rounded-xl border border-slate-800 bg-slate-950/50 p-3 text-sm">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="text-lg font-bold tabular-nums text-sky-300">{vnd(l.amount)}</span>
                  {l.expected_amount != null && l.amount < l.expected_amount && <span className="text-xs text-amber-300">cần {vnd(l.expected_amount)}</span>}
                  <span className={`badge ${STATUS_CLS[l.status] || 'bg-slate-700 text-slate-300'}`}>{l.status_label}</span>
                  {l.resolution && <span className={`badge ${RESOLUTION[l.resolution][1]}`}>{RESOLUTION[l.resolution][0]} · {l.resolved_by}</span>}
                  <span className="ml-auto text-xs text-slate-500">{fmtTime(l.created_at)}</span>
                </div>
                <div className="mt-1 break-all font-mono text-xs text-amber-200/90">“{l.content || '(không có nội dung)'}”</div>
                <div className="mt-1 text-xs text-slate-400">
                  Mã GD {l.bank_tx_id || '—'}{l.gateway ? ` · ${l.gateway}` : ''}
                  {l.matched_ticket && <> · {l.kind === 'parking' ? 'Phí gửi xe' : 'Vé'} <span className="font-mono text-sky-300">{l.matched_ticket}</span></>}
                  {l.resolved_note && <> · Ghi chú: {l.resolved_note}</>}
                </div>
                {l.status !== 'matched' && !l.resolution && (
                  <div className="mt-2 flex flex-wrap gap-1.5">
                    <button className="btn-success btn-sm" onClick={() => setDialog({ kind: 'approve', log: l })}><BadgeCheck className="h-3.5 w-3.5" /> Duyệt bù</button>
                    <button className="btn-warning btn-sm" onClick={() => setDialog({ kind: 'refund', log: l })}><Undo2 className="h-3.5 w-3.5" /> Đánh dấu đã hoàn tiền</button>
                  </div>
                )}
              </div>
            ))}
          </div>
        ))}
      </div>

      <ResolveDialog dialog={dialog} onClose={() => setDialog(null)} toast={toast} />
      <ReceiptViewer receipt={viewer} onClose={() => setViewer(null)} onDownload={downloadReceipt} onAction={receiptAction} />
    </div>
  )
}

function ResolveDialog({ dialog, onClose, toast }) {
  const [ticket, setTicket] = useState('')
  const [note, setNote] = useState('')
  const [busy, setBusy] = useState(false)
  useEffect(() => { setTicket(''); setNote('') }, [dialog?.log?.id, dialog?.kind])
  if (!dialog) return null
  const { kind, log } = dialog
  const needTicket = kind === 'approve' && !log.reservation_id && !log.session_id

  const submit = async (e) => {
    e.preventDefault()
    setBusy(true)
    try {
      const r = await api(`/api/admin/payments/${log.id}/${kind}`, { method: 'POST', body: { ticket_code: ticket || null, note: note || null } })
      toast(kind === 'approve'
        ? (r.reservation ? `Đã duyệt bù vé ${r.reservation.ticket_code} — ô ${r.reservation.slot_code}` : 'Đã duyệt bù giao dịch')
        : `Đã đánh dấu hoàn ${vnd(log.amount)}`, 'success')
      onClose()
    } catch (err) { toast(err.message, 'error') } finally { setBusy(false) }
  }

  return (
    <Modal open onClose={busy ? undefined : onClose} title={kind === 'approve' ? 'Duyệt bù giao dịch' : 'Đánh dấu đã hoàn tiền'} icon={kind === 'approve' ? BadgeCheck : Undo2}>
      <form onSubmit={submit} className="space-y-3 text-sm">
        <div className="rounded-xl bg-slate-950/60 p-3">
          <div className="text-lg font-bold text-sky-300">{vnd(log.amount)}</div>
          <div className="break-all font-mono text-xs text-amber-200">“{log.content}”</div>
          <div className="mt-1 text-xs text-slate-400">{log.status_label}{log.matched_ticket ? ` · ${log.matched_ticket}` : ''}{log.expected_amount != null ? ` · cần ${vnd(log.expected_amount)}` : ''}</div>
        </div>
        {kind === 'approve' && (
          <div>
            <label className="label" htmlFor="rs-ticket">Mã vé cần duyệt {needTicket ? '*' : '(để trống = vé đã khớp)'}</label>
            <input id="rs-ticket" className="input font-mono uppercase tracking-widest" maxLength={12} value={ticket} onChange={(e) => setTicket(e.target.value)}
              required={needTicket} placeholder={log.matched_ticket || 'VD: 7K3QX9'} />
            <p className="mt-1 text-xs text-slate-500">Vé chờ CK → khóa ô ngay. Vé đã hết hạn/hủy → mở lại nếu ô vẫn trống (nếu ô đã có khách khác, hãy hoàn tiền).</p>
          </div>
        )}
        <div>
          <label className="label" htmlFor="rs-note">Ghi chú</label>
          <input id="rs-note" className="input" maxLength={300} value={note} onChange={(e) => setNote(e.target.value)}
            placeholder={kind === 'refund' ? 'VD: Đã CK hoàn lúc 10:30, mã GD …' : 'VD: Khách chuyển thiếu 1.000đ, chấp nhận'} />
        </div>
        <div className="flex flex-col-reverse gap-2 sm:flex-row">
          <button type="button" className="btn-ghost sm:flex-1" onClick={onClose} disabled={busy}>Hủy</button>
          <button className={`${kind === 'approve' ? 'btn-success' : 'btn-warning'} sm:flex-[2]`} disabled={busy}>
            {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : kind === 'approve' ? <BadgeCheck className="h-4 w-4" /> : <Undo2 className="h-4 w-4" />}
            {kind === 'approve' ? 'Xác nhận duyệt bù' : 'Xác nhận đã hoàn tiền'}
          </button>
        </div>
      </form>
    </Modal>
  )
}

function ReceiptViewer({ receipt, onClose, onDownload, onAction }) {
  const [url, setUrl] = useState('')
  const [err, setErr] = useState('')
  useEffect(() => {
    if (!receipt) return
    let u = ''
    setUrl(''); setErr('')
    fetchBlobUrl(`/api/admin/receipts/${receipt.id}/file`).then((x) => { u = x; setUrl(x) }).catch((e) => setErr(e.message))
    return () => u && URL.revokeObjectURL(u)
  }, [receipt])
  if (!receipt) return null
  return (
    <Modal open onClose={onClose} title={`Biên lai vé ${receipt.ticket_code}`} icon={ImageIcon}>
      <div className="space-y-3 text-sm">
        <div className="flex min-h-[200px] items-center justify-center rounded-xl bg-slate-950/60 p-2">
          {url ? <img src={url} alt={`Ảnh biên lai vé ${receipt.ticket_code}`} className="max-h-[60vh] rounded-lg object-contain" />
            : err ? <span className="text-rose-300">{err}</span> : <Loader2 className="h-6 w-6 animate-spin text-slate-500" />}
        </div>
        {receipt.file_name.endsWith('.heic') && <p className="text-xs text-slate-500">Ảnh HEIC (iPhone) có thể không xem được trên trình duyệt — hãy bấm Tải ảnh.</p>}
        {receipt.note && <div className="rounded-lg bg-slate-900/80 px-3 py-2 text-slate-300">“{receipt.note}”</div>}
        <div className="grid gap-2 sm:grid-cols-3">
          <button className="btn-ghost" onClick={() => onDownload(receipt)}><Download className="h-4 w-4" /> Tải ảnh</button>
          {receipt.status === 'new' && <>
            <button className="btn-success" onClick={() => onAction(receipt, 'approve')}><BadgeCheck className="h-4 w-4" /> Duyệt bù</button>
            <button className="btn-warning" onClick={() => onAction(receipt, 'refund')}><Undo2 className="h-4 w-4" /> Đã hoàn tiền</button>
          </>}
        </div>
      </div>
    </Modal>
  )
}
