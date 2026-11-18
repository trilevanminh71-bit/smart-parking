import { useMemo } from 'react'
import qrcode from 'qrcode-generator'

/** Mã QR thật (quét được) dạng SVG nhẹ cho vé điện tử. */
export default function TicketQR({ content, size = 140 }) {
  const path = useMemo(() => {
    const qr = qrcode(0, 'M')
    qr.addData(content)
    qr.make()
    const n = qr.getModuleCount()
    let d = ''
    for (let y = 0; y < n; y++) for (let x = 0; x < n; x++) if (qr.isDark(y, x)) d += `M${x} ${y}h1v1h-1z`
    return { d, n }
  }, [content])
  return (
    <svg viewBox={`-2 -2 ${path.n + 4} ${path.n + 4}`} width={size} height={size} className="rounded-lg bg-white" shapeRendering="crispEdges" role="img" aria-label="Mã QR vé">
      <path d={path.d} fill="#0f172a" />
    </svg>
  )
}
