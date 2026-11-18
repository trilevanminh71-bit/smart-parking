import { useEffect, useState } from 'react'
import { ImageUp, Loader2, Send } from 'lucide-react'
import { Modal } from './ui.jsx'
import { api, vnd } from '../api.js'

const MAX_INPUT = 20 * 1024 * 1024 // ảnh gốc từ điện thoại
const TARGET = 280 * 1024 // sau khi nén (server nhận tối đa 300KB)

const b64Bytes = (dataUrl) => Math.floor((dataUrl.length - dataUrl.indexOf(',') - 1) * 3 / 4)

async function loadImage(file) {
  if (window.createImageBitmap) {
    try { return await createImageBitmap(file) } catch { /* thử cách khác */ }
  }
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file)
    const img = new Image()
    img.onload = () => { URL.revokeObjectURL(url); resolve(img) }
    img.onerror = () => { URL.revokeObjectURL(url); reject(new Error('Trình duyệt không đọc được ảnh này (VD: HEIC trên máy tính) — hãy chụp màn hình rồi chọn lại.')) }
    img.src = url
  })
}

/** Thu nhỏ & nén ảnh biên lai bằng Canvas thành WebP (hoặc JPEG) dưới ~280KB, trả về data URL base64. */
export async function compressImage(file) {
  const img = await loadImage(file)
  const w0 = img.width, h0 = img.height
  const c = document.createElement('canvas')
  const g = c.getContext('2d')
  // WebP nhỏ hơn JPEG; Safari cũ không xuất được WebP từ canvas -> dùng JPEG
  const webp = document.createElement('canvas').toDataURL('image/webp').startsWith('data:image/webp')
  const type = webp ? 'image/webp' : 'image/jpeg'
  let maxDim = 1600
  for (let round = 0; round < 6; round++) {
    const scale = Math.min(1, maxDim / Math.max(w0, h0))
    c.width = Math.max(1, Math.round(w0 * scale))
    c.height = Math.max(1, Math.round(h0 * scale))
    g.fillStyle = '#fff'
    g.fillRect(0, 0, c.width, c.height)
    g.drawImage(img, 0, 0, c.width, c.height)
    for (const q of [0.82, 0.7, 0.58, 0.46]) {
      const url = c.toDataURL(type, q)
      if (b64Bytes(url) <= TARGET) return { dataUrl: url, bytes: b64Bytes(url), width: c.width, height: c.height }
    }
    maxDim = Math.round(maxDim * 0.75)
  }
  throw new Error('Không nén được ảnh xuống dưới 300KB — hãy cắt bớt ảnh rồi thử lại.')
}

/** Khách gửi ảnh chụp giao dịch ngân hàng kèm ghi chú khi đã chuyển tiền nhưng vé chưa được duyệt.
 *  Ảnh được nén ngay trên trình duyệt (< 300KB) rồi lưu thẳng vào CSDL. */
export default function ReceiptUploadModal({ res, onClose, toast }) {
  const [image, setImage] = useState(null) // { dataUrl, bytes, width, height, original }
  const [note, setNote] = useState('')
  const [busy, setBusy] = useState(false)
  const [compressing, setCompressing] = useState(false)

  useEffect(() => { setImage(null); setNote('') }, [res?.id])
  if (!res) return null
  const preview = image?.dataUrl

  const pick = async (e) => {
    const f = e.target.files?.[0]
    e.target.value = ''
    if (!f) return
    if (f.size > MAX_INPUT) return toast('Ảnh quá lớn (tối đa 20MB)', 'error')
    setCompressing(true)
    try { setImage({ ...(await compressImage(f)), original: f.size }) } catch (err) { toast(err.message, 'error') } finally { setCompressing(false) }
  }

  const submit = async (e) => {
    e.preventDefault()
    if (!image) return toast('Hãy chọn ảnh biên lai', 'error')
    setBusy(true)
    try {
      await api('/api/payment/receipts', { method: 'POST', body: { reservation_id: res.id, note, image: image.dataUrl } })
      toast('Đã gửi ảnh biên lai — Bảo vệ sẽ đối soát và duyệt bù hoặc hoàn tiền cho bạn.', 'success')
      onClose()
    } catch (err) { toast(err.message, 'error') } finally { setBusy(false) }
  }

  return (
    <Modal open onClose={busy ? undefined : onClose} title="Gửi ảnh biên lai chuyển khoản" icon={ImageUp}>
      <form onSubmit={submit} className="space-y-3 text-sm">
        <div className="grid grid-cols-2 gap-x-3 gap-y-1 rounded-xl bg-slate-950/60 p-3 text-xs">
          <span className="text-slate-400">Mã vé</span><span className="text-right font-mono font-semibold text-sky-300">{res.ticket_code}</span>
          <span className="text-slate-400">Biển số · Ô</span><span className="text-right"><span className="font-mono">{res.license_plate}</span> · {res.slot_code}</span>
          <span className="text-slate-400">Tiền cọc</span><span className="text-right">{vnd(res.deposit_amount)}</span>
        </div>
        <label className="flex min-h-[140px] cursor-pointer flex-col items-center justify-center gap-2 rounded-xl border-2 border-dashed border-slate-700 bg-slate-950/40 p-3 text-center hover:border-sky-500/60">
          {compressing
            ? <><Loader2 className="h-7 w-7 animate-spin text-sky-400" /><span className="text-slate-300">Đang nén ảnh…</span></>
            : preview
              ? <img src={preview} alt="Ảnh biên lai đã chọn" className="max-h-64 rounded-lg object-contain" />
              : <><ImageUp className="h-8 w-8 text-slate-500" /><span className="text-slate-300">Chạm để chọn ảnh chụp màn hình giao dịch</span><span className="text-xs text-slate-500">JPG / PNG / WEBP · ảnh tự nén dưới 300KB</span></>}
          <input type="file" accept="image/*" className="sr-only" onChange={pick} />
        </label>
        {image && (
          <p className="-mt-1 text-center text-xs text-slate-400">
            Đã nén: {Math.round(image.original / 1024)}KB → <b className="text-emerald-300">{Math.round(image.bytes / 1024)}KB</b> ({image.width}×{image.height})
          </p>
        )}
        <div>
          <label className="label" htmlFor="rc-note">Ghi chú (tuỳ chọn)</label>
          <textarea id="rc-note" className="input min-h-[72px] resize-y" maxLength={500} value={note} onChange={(e) => setNote(e.target.value)}
            placeholder="VD: Đã chuyển lúc 10:05 nhưng ghi sai nội dung / chuyển thiếu…" />
        </div>
        <div className="flex flex-col-reverse gap-2 sm:flex-row">
          <button type="button" className="btn-ghost sm:flex-1" onClick={onClose} disabled={busy}>Hủy</button>
          <button className="btn-primary sm:flex-[2]" disabled={busy || compressing || !image}>
            {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />} Gửi biên lai
          </button>
        </div>
      </form>
    </Modal>
  )
}
