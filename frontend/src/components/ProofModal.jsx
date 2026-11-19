import { useEffect, useState } from 'react'
import { Download, FileCheck2, Loader2, Printer } from 'lucide-react'
import { Modal } from './ui.jsx'
import { renderProof } from '../proof.js'
import { useLang } from '../i18n/index.jsx'

// Trình duyệt nhúng trong app (Zalo, Facebook, Messenger, Instagram, TikTok, Line…) thường chặn tải file
const IN_APP = /Zalo|FBAN|FBAV|FB_IAB|Instagram|Messenger|Line\/|TikTok|musical_ly|; wv\)/i

/**
 * Phiếu minh chứng hiển thị dạng ẢNH ngay trong hộp thoại.
 * - Lưu ảnh: điện thoại dùng bảng Chia sẻ của hệ thống (Safari/Chrome → "Lưu hình ảnh"); máy tính tải file .png.
 * - Trong Zalo/Facebook (chặn tải file): nhấn giữ vào ảnh → Lưu ảnh.
 * - In phiếu: chỉ in vùng phiếu.
 */
export default function ProofModal({ res, parkingName, onClose, toast }) {
  const { lang, t } = useLang()
  const [img, setImg] = useState('')
  const inApp = typeof navigator !== 'undefined' && IN_APP.test(navigator.userAgent)
  const name = res ? `minh-chung-${res.ticket_code || res.id}.png` : ''

  useEffect(() => {
    if (!res) { setImg(''); return }
    setImg('')
    const id = setTimeout(() => setImg(renderProof(res, parkingName).toDataURL('image/png')), 30) // để hộp thoại hiện trước
    return () => clearTimeout(id)
  }, [res, parkingName, lang])

  const save = async () => {
    if (!img) return
    try {
      const blob = await (await fetch(img)).blob()
      const file = new File([blob], name, { type: 'image/png' })
      if (navigator.canShare?.({ files: [file] })) {
        await navigator.share({ files: [file], title: t('Phiếu minh chứng chuyển khoản') })
        return
      }
    } catch (err) {
      if (err?.name === 'AbortError') return // người dùng đóng bảng chia sẻ
    }
    if (inApp) { toast?.(t('Ứng dụng này chặn tải file — hãy nhấn giữ vào ảnh phiếu rồi chọn Lưu ảnh.'), 'info'); return }
    const a = Object.assign(document.createElement('a'), { href: img, download: name })
    document.body.appendChild(a)
    a.click()
    a.remove()
    toast?.(t('Đã lưu ảnh phiếu'), 'success')
  }

  const print = () => {
    try { window.print() } catch { toast?.(t('Ứng dụng này chặn tải file — hãy nhấn giữ vào ảnh phiếu rồi chọn Lưu ảnh.'), 'info') }
  }

  return (
    <Modal open={!!res} onClose={onClose} title="Phiếu minh chứng chuyển khoản" icon={FileCheck2} width="max-w-lg">
      <div className="print-area overflow-hidden rounded-xl border border-slate-700 bg-white">
        {img
          ? <img src={img} alt="Phiếu minh chứng chuyển khoản" className="block h-auto w-full select-auto" style={{ WebkitTouchCallout: 'default' }} />
          : <div className="flex aspect-[720/980] items-center justify-center gap-2 text-sm text-slate-500"><Loader2 className="h-4 w-4 animate-spin" /> Đang tạo phiếu…</div>}
      </div>
      <p className="mt-2 text-center text-xs text-slate-400">Nhấn giữ vào ảnh phiếu để lưu vào máy (Zalo, Facebook…), hoặc bấm Lưu ảnh.</p>
      <div className="mt-3 grid grid-cols-2 gap-2">
        <button className="btn-primary" onClick={save} disabled={!img}><Download className="h-4 w-4" /> Lưu ảnh</button>
        <button className="btn-ghost" onClick={print} disabled={!img}><Printer className="h-4 w-4" /> In phiếu</button>
      </div>
    </Modal>
  )
}
