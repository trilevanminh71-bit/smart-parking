/* Màu ô đỗ trên Sơ đồ 2D chi tiết (SVG) — khớp bảng màu Sáng / Tối của trang. */
const LIGHT = {
  available: { fill: '#ecfdf5', stroke: '#10b981', text: '#065f46' },
  reserved: { fill: '#fffbeb', stroke: '#f59e0b', text: '#92400e' },
  pending_payment: { fill: '#fffbeb', stroke: '#f59e0b', text: '#92400e' },
  occupied: { fill: '#fef2f2', stroke: '#ef4444', text: '#991b1b' },
  flash: { fill: '#fecaca', stroke: '#dc2626', text: '#7f1d1d' },
}
const DARK = {
  available: { fill: 'rgba(16,185,129,.18)', stroke: '#10b981', text: '#6ee7b7' },
  reserved: { fill: 'rgba(245,158,11,.2)', stroke: '#f59e0b', text: '#fcd34d' },
  pending_payment: { fill: 'rgba(249,115,22,.2)', stroke: '#f97316', text: '#fdba74' },
  occupied: { fill: '#475569', stroke: '#64748b', text: '#f8fafc' },
  flash: { fill: 'rgba(239,68,68,.45)', stroke: '#ef4444', text: '#fff' },
}
export const slotColorFor = (status, dark) => (dark ? DARK : LIGHT)[status] || (dark ? DARK : LIGHT).available
