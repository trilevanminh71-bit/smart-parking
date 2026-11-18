import { BANK, RES_STATUS, saveBlob, transferNote, vnd } from './api.js'

/**
 * Phiếu minh chứng chuyển khoản tiền cọc — vẽ bằng HTML Canvas ngay trên trình duyệt rồi tải về (.png).
 * Dùng khi đối soát với Bảo vệ: Mã vé, Biển số, Ô đỗ, Số tiền, Nội dung, Thời gian, Trạng thái.
 */
export function downloadProof(res, parkingName = 'Bãi Đỗ Xe Thông Minh') {
  const W = 720, H = 980, S = 2 // vẽ 2x cho nét trên điện thoại
  const c = document.createElement('canvas')
  c.width = W * S
  c.height = H * S
  const g = c.getContext('2d')
  g.scale(S, S)
  const font = (w, px) => `${w} ${px}px "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif`

  g.fillStyle = '#ffffff'
  g.fillRect(0, 0, W, H)
  g.fillStyle = '#0f172a'
  g.fillRect(0, 0, W, 130)
  g.fillStyle = '#38bdf8'
  g.font = font(700, 30)
  g.fillText('PHIẾU MINH CHỨNG CHUYỂN KHOẢN', 40, 62)
  g.fillStyle = '#cbd5e1'
  g.font = font(400, 18)
  g.fillText(`${parkingName} · Tiền đặt cọc giữ chỗ`, 40, 98)

  const status = (RES_STATUS[res.status] || { label: res.status }).label
  const content = transferNote(`COC ${res.ticket_code} ${res.license_plate}`)
  const rows = [
    ['Mã vé', res.ticket_code || '—'],
    ['Biển số xe', res.license_plate],
    ['Ô đỗ', `${res.slot_code}${res.floor ? ` (Tầng ${res.floor})` : ''}`],
    ['Khách hàng', `${res.customer_name || ''}${res.phone ? ` · ${res.phone}` : ''}`],
    ['Số tiền cọc', vnd(res.deposit_amount)],
    ['Nội dung CK', content],
    ['Ngân hàng nhận', `${BANK.name} · ${BANK.account}`],
    ['Chủ tài khoản', BANK.holder],
    ['Thời gian đặt', fmt(res.created_at)],
    ['Trạng thái vé', status],
    ['Ảnh biên lai', res.receipt_status ? { new: 'Đã gửi — chờ đối soát', approved: 'Đã duyệt bù', refunded: 'Đã hoàn tiền' }[res.receipt_status] : 'Chưa gửi'],
  ]
  let y = 190
  rows.forEach(([k, v], i) => {
    if (i % 2 === 0) { g.fillStyle = '#f1f5f9'; g.fillRect(30, y - 34, W - 60, 56) }
    g.fillStyle = '#64748b'
    g.font = font(500, 19)
    g.fillText(k, 50, y)
    g.fillStyle = k === 'Số tiền cọc' ? '#0369a1' : k === 'Trạng thái vé' ? statusColor(res.status) : '#0f172a'
    g.font = font(k === 'Mã vé' || k === 'Nội dung CK' ? 700 : 600, k === 'Số tiền cọc' ? 24 : 20)
    wrap(g, String(v ?? '—'), 260, y, W - 300, 24)
    y += 60
  })

  g.strokeStyle = '#cbd5e1'
  g.setLineDash([8, 6])
  g.beginPath(); g.moveTo(30, y - 10); g.lineTo(W - 30, y - 10); g.stroke()
  g.setLineDash([])
  g.fillStyle = '#475569'
  g.font = font(400, 16)
  const notes = [
    `Phiếu tạo lúc ${fmt(new Date().toISOString())} trên trình duyệt của khách.`,
    'Phiếu này là thông tin đối chiếu, KHÔNG thay thế biên lai của ngân hàng.',
    'Nếu đã chuyển tiền nhưng vé chưa được duyệt: gửi kèm ảnh chụp giao dịch',
    'trong app ngân hàng cho Bảo vệ / Quản trị viên để được duyệt bù hoặc hoàn tiền.',
  ]
  notes.forEach((t, i) => g.fillText(t, 40, y + 22 + i * 26))

  c.toBlob((blob) => blob && saveBlob(blob, `minh-chung-${res.ticket_code || res.id}.png`), 'image/png')
}

function fmt(iso) {
  return iso ? new Date(iso).toLocaleString('vi-VN', { hour: '2-digit', minute: '2-digit', second: '2-digit', day: '2-digit', month: '2-digit', year: 'numeric' }) : '—'
}
function statusColor(s) {
  return { active: '#b45309', checked_in: '#047857', pending_payment: '#c2410c', expired: '#be123c', cancelled: '#475569' }[s] || '#0f172a'
}
function wrap(g, text, x, y, maxW, lh) {
  let line = ''
  for (const ch of text.split(' ')) {
    const test = line ? `${line} ${ch}` : ch
    if (g.measureText(test).width > maxW && line) { g.fillText(line, x, y); line = ch; y += lh } else line = test
  }
  g.fillText(line, x, y)
}
