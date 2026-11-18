import { useEffect } from 'react'
import { ArrowUp, CornerUpLeft, CornerUpRight, MoveUpRight, Navigation, X } from 'lucide-react'

/*
 * Bản đồ dẫn đường thu nhỏ kiểu Google Maps — vẽ bằng SVG thuần + animation SMIL (không cần thư viện bản đồ).
 * Mặt bằng mỗi tầng: dãy trên ô 01–05, làn xe chạy ở giữa (chiều từ trái sang phải), dãy dưới ô 06–10.
 * Tầng 1 vào từ Cổng/Barrier bên trái; Tầng 2–3 vào từ ram dốc bên trái.
 */

const W = 380
const H = 300
const COL_X = (i) => 62 + i * 62 // mép trái cột i (0..4)
const SLOT_W = 54
const SLOT_H = 72
const TOP_Y = 22
const LANE_Y = 150 // tâm làn xe
const BOT_Y = 206
// Có xe = xám xanh đậm (#475569, viền #64748b) — dịu mắt, tách biệt rõ với Trống (xanh lá) / Đã cọc (vàng) / Chờ tiền (cam)
const STATUS_FILL = { available: '#10b98122', reserved: '#f59e0b33', occupied: '#475569', pending_payment: '#f9731633' }
const STATUS_STROKE = { available: '#10b98166', reserved: '#f59e0b88', occupied: '#64748b', pending_payment: '#f9731688' }
const STATUS_CAR = { reserved: '#f59e0b', pending_payment: '#f97316' }

/** Xe hơi nhìn từ trên xuống (rõ nét trên nền xám xanh). */
function TopCar({ x, y }) {
  return (
    <g>
      <rect x={x - 2} y={y + 4} width={4} height={7} rx={1.5} fill="#0f172a" />
      <rect x={x + 22} y={y + 4} width={4} height={7} rx={1.5} fill="#0f172a" />
      <rect x={x - 2} y={y + 20} width={4} height={7} rx={1.5} fill="#0f172a" />
      <rect x={x + 22} y={y + 20} width={4} height={7} rx={1.5} fill="#0f172a" />
      <rect x={x} y={y} width={24} height={31} rx={7} fill="#e2e8f0" stroke="#f8fafc" strokeWidth={1} />
      <rect x={x + 3.5} y={y + 5} width={17} height={7} rx={2.5} fill="#334155" />
      <rect x={x + 3.5} y={y + 21} width={17} height={5} rx={2} fill="#334155" />
    </g>
  )
}

export function parseSlot(code) {
  const floor = Number(code[1])
  const num = Number(code.slice(-2))
  const top = num <= 5
  const col = top ? num - 1 : num - 6
  return { floor, num, top, col }
}

/** Các bước chỉ dẫn ngắn gọn kiểu Google Maps. */
export function navSteps(code) {
  const { floor, top, col } = parseSlot(code)
  const steps = ['Đi thẳng qua cổng']
  for (let f = 2; f <= floor; f++) steps.push(`Lên ram Tầng ${f}`)
  if (col > 0) steps.push(`Đi thẳng ${col} ô`)
  steps.push(top ? 'Rẽ trái' : 'Rẽ phải')
  steps.push(`Ô ${code}`)
  return steps
}

/** Ước lượng quãng đường (m) và thời gian (giây) chạy chậm ~8 km/h trong bãi. */
function estimate(code) {
  const { floor, col } = parseSlot(code)
  const meters = 12 + (floor - 1) * 45 + col * 6 + 6
  return { meters, seconds: Math.max(20, Math.round(meters / 2.2)) }
}

export function MiniMapSvg({ slotCode, slots = [], gateOpen = true }) {
  const { floor, top, col } = parseSlot(slotCode)
  const cx = COL_X(col) + SLOT_W / 2
  const slotCenterY = top ? TOP_Y + SLOT_H / 2 : BOT_Y + SLOT_H / 2
  const stopY = top ? TOP_Y + SLOT_H + 7 : BOT_Y - 7 // dừng ngay trước mép ô đích
  const dir = top ? -1 : 1
  // Đường đi: từ lối vào bên trái -> chạy dọc làn -> rẽ về phía ô đích (bo góc) -> dừng trước ô
  const route = `M 10 ${LANE_Y} L ${cx - 16} ${LANE_Y} Q ${cx} ${LANE_Y} ${cx} ${LANE_Y + dir * 16} L ${cx} ${stopY}`
  const byNum = Object.fromEntries(slots.filter((s) => s.floor === floor).map((s) => [Number(s.code.slice(-2)), s.status]))
  const letter = slotCode[3]

  const slotRect = (num) => {
    const isTop = num <= 5
    const c = isTop ? num - 1 : num - 6
    const x = COL_X(c)
    const y = isTop ? TOP_Y : BOT_Y
    const code = `T${floor}-${letter}${String(num).padStart(2, '0')}`
    const target = code === slotCode
    const st = byNum[num] || 'available'
    return (
      <g key={num}>
        <rect x={x} y={y} width={SLOT_W} height={SLOT_H} rx={7}
          fill={target ? '#1d4ed8' : STATUS_FILL[st]} stroke={target ? '#93c5fd' : STATUS_STROKE[st]}
          strokeWidth={target ? 3 : 1.5} strokeDasharray={target || st === 'occupied' ? undefined : '4 3'}>
          {target && <animate attributeName="fill-opacity" values="1;0.35;1" dur="1s" repeatCount="indefinite" />}
        </rect>
        {target && (
          <rect x={x - 5} y={y - 5} width={SLOT_W + 10} height={SLOT_H + 10} rx={10} fill="none" stroke="#60a5fa" strokeWidth={2}>
            <animate attributeName="stroke-opacity" values="0.9;0;0.9" dur="1.2s" repeatCount="indefinite" />
          </rect>
        )}
        <text x={x + SLOT_W / 2} y={y + (isTop ? 16 : SLOT_H - 8)} textAnchor="middle" fontSize="11" fontWeight="700"
          fill={target ? '#fff' : st === 'occupied' ? '#e2e8f0' : '#94a3b8'} fontFamily="ui-monospace, monospace">{letter}{String(num).padStart(2, '0')}</text>
        {!target && st === 'occupied' && <TopCar x={x + 15} y={y + 22} />}
        {!target && st !== 'available' && st !== 'occupied' && (
          <rect x={x + 15} y={y + 24} width={24} height={30} rx={6} fill={STATUS_CAR[st] || '#f59e0b'} opacity={0.55} />
        )}
      </g>
    )
  }

  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="block h-auto w-full" role="img" aria-label={`Bản đồ đường đi tới ô ${slotCode}`}>
      <defs>
        <pattern id="nm-ramp" width="10" height="10" patternUnits="userSpaceOnUse" patternTransform="rotate(45)">
          <rect width="10" height="10" fill="#1e293b" /><rect width="5" height="10" fill="#334155" />
        </pattern>
        <filter id="nm-glow" x="-20%" y="-20%" width="140%" height="140%">
          <feGaussianBlur stdDeviation="5" />
        </filter>
        <filter id="nm-shadow" x="-50%" y="-50%" width="200%" height="200%">
          <feDropShadow dx="0" dy="1" stdDeviation="1.5" floodColor="#000" floodOpacity="0.6" />
        </filter>
      </defs>

      {/* Nền mặt bằng */}
      <rect x="0" y="0" width={W} height={H} rx="14" fill="#0b1220" />
      <rect x="54" y="10" width={W - 64} height={H - 20} rx="10" fill="#111a2e" stroke="#1e293b" />

      {/* Làn xe chạy */}
      <rect x="0" y={LANE_Y - 26} width={W - 10} height="52" fill="#1f2937" />
      <line x1="60" y1={LANE_Y} x2={W - 20} y2={LANE_Y} stroke="#475569" strokeWidth="2" strokeDasharray="10 9" />
      {[120, 210, 300].map((x) => (
        <path key={x} d={`M ${x} ${LANE_Y - 18} l 8 4 l -8 4`} fill="none" stroke="#475569" strokeWidth="2" />
      ))}

      {/* Lối vào bên trái: Cổng + Barrier (T1) hoặc ram dốc (T2–T3) */}
      {floor === 1 ? (
        <g>
          <rect x="0" y={LANE_Y - 26} width="22" height="52" fill="#0ea5e922" />
          <rect x="30" y={LANE_Y - 34} width="8" height="10" rx="2" fill="#94a3b8" />
          <g transform={`rotate(${gateOpen ? -70 : 0} 34 ${LANE_Y - 29})`} style={{ transition: 'transform .6s' }}>
            <rect x="34" y={LANE_Y - 31} width="48" height="5" rx="2.5" fill="#f43f5e" />
            {[0, 1, 2].map((i) => <rect key={i} x={40 + i * 14} y={LANE_Y - 31} width="7" height="5" fill="#f8fafc" />)}
          </g>
          <text x="4" y={LANE_Y + 44} fontSize="10" fontWeight="700" fill="#38bdf8">CỔNG VÀO</text>
        </g>
      ) : (
        <g>
          <rect x="0" y={LANE_Y - 26} width="52" height="52" fill="url(#nm-ramp)" />
          <text x="4" y={LANE_Y + 44} fontSize="10" fontWeight="700" fill="#38bdf8">DỐC TỪ T{floor - 1}</text>
          <text x="4" y={LANE_Y - 32} fontSize="9" fill="#64748b">Cổng vào ở T1</text>
        </g>
      )}

      {/* Lối ra cuối làn */}
      <text x={W - 14} y={LANE_Y + 44} textAnchor="end" fontSize="9" fill="#64748b">{floor < 3 ? `Dốc lên T${floor + 1} ›` : 'Cuối tầng'}</text>

      {/* 10 ô đỗ */}
      {[1, 2, 3, 4, 5, 6, 7, 8, 9, 10].map(slotRect)}

      {/* Tuyến đường kiểu Google Maps Navigation: lõi xanh dương đậm, viền sáng, quầng sáng nhẹ */}
      <path d={route} fill="none" stroke="#4285f4" strokeWidth="18" strokeLinecap="round" strokeLinejoin="round" filter="url(#nm-glow)" opacity="0.55" />
      <path d={route} fill="none" stroke="#aecbfa" strokeWidth="14" strokeLinecap="round" strokeLinejoin="round" />
      <path d={route} fill="none" stroke="#1a56db" strokeWidth="10" strokeLinecap="round" strokeLinejoin="round" />

      {/* Mũi tên trắng chạy dọc bên trong đường dẫn */}
      {[0, 1, 2, 3, 4].map((i) => (
        <g key={i} opacity="0">
          <path d="M -3 -3.6 L 2 0 L -3 3.6" fill="none" stroke="#fff" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" />
          <animateMotion dur="3s" begin={`${-i * 0.6}s`} repeatCount="indefinite" rotate="auto" path={route} />
          <animate attributeName="opacity" values="0;1;1;0" keyTimes="0;0.06;0.9;1" dur="3s" begin={`${-i * 0.6}s`} repeatCount="indefinite" />
        </g>
      ))}

      {/* Điểm xuất phát: mũi tên tam giác trong vòng tròn trắng (icon vị trí của Google Maps) */}
      <g transform={`translate(14 ${LANE_Y})`}>
        <circle r="13" fill="#4285f4" opacity="0.25">
          <animate attributeName="r" values="11;17;11" dur="2s" repeatCount="indefinite" />
          <animate attributeName="opacity" values="0.35;0;0.35" dur="2s" repeatCount="indefinite" />
        </circle>
        <circle r="10.5" fill="#fff" filter="url(#nm-shadow)" />
        <path d="M -5 -6 L 7 0 L -5 6 L -2.2 0 Z" fill="#1a73e8" stroke="#1a73e8" strokeWidth="1" strokeLinejoin="round" />
      </g>

      {/* Ghim đích kiểu Google Maps cắm giữa ô đích */}
      <g transform={`translate(${cx} ${slotCenterY + 19})`}>
        <path d="M 0 0 C -9 -12 -11 -16 -11 -21 A 11 11 0 1 1 11 -21 C 11 -16 9 -12 0 0 Z" fill="#ea4335" stroke="#fff" strokeWidth="1.5" filter="url(#nm-shadow)">
          <animateTransform attributeName="transform" type="translate" values="0 0;0 -3;0 0" dur="1s" repeatCount="indefinite" />
        </path>
        <circle cx="0" cy="-21" r="4" fill="#7f1d1d" />
      </g>
    </svg>
  )
}

/** Popup bản đồ: bottom-sheet trên điện thoại, hộp giữa màn hình trên máy tính. */
export function NavMapModal({ nav, slots, onClose }) {
  useEffect(() => {
    if (!nav) return
    const onKey = (e) => e.key === 'Escape' && onClose()
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [nav, onClose])
  if (!nav) return null
  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/70 backdrop-blur-sm sm:items-center sm:p-4" onMouseDown={onClose}>
      <div className="max-h-[94dvh] w-full max-w-lg overflow-y-auto pb-[env(safe-area-inset-bottom)] sm:pb-0" onMouseDown={(e) => e.stopPropagation()}>
        <NavMiniMap slotCode={nav.slotCode} slots={slots} plate={nav.plate} gateOpen={nav.gateOpen} onClose={onClose} title={nav.title} sheet />
      </div>
    </div>
  )
}

/** Thẻ dẫn đường đầy đủ: thanh chỉ dẫn trên cùng + bản đồ + thanh thông tin dưới. */
/** Câu chỉ dẫn 1 dòng, VD: 'Đi thẳng 2 ô rồi rẽ trái vào Ô T1-A02'. */
export function navHeadline(code) {
  const { floor, top, col } = parseSlot(code)
  const turn = top ? 'rẽ trái' : 'rẽ phải'
  const ramp = floor > 1 ? `Lên ram Tầng ${floor}, ` : ''
  const body = col > 0 ? `đi thẳng ${col} ô rồi ${turn}` : `${turn} ngay`
  const text = `${ramp}${body} vào Ô ${code}`
  return text[0].toUpperCase() + text.slice(1)
}

export default function NavMiniMap({ slotCode, slots, plate, gateOpen = true, onClose, compact = false, title, sheet = false, inline = false }) {
  const { floor, top, col } = parseSlot(slotCode)
  const { meters, seconds } = estimate(slotCode)
  const TurnIcon = top ? CornerUpLeft : CornerUpRight
  const straightFirst = floor > 1 || col > 0
  const MainIcon = straightFirst ? ArrowUp : TurnIcon

  return (
    <div className={`overflow-hidden bg-slate-900 ${inline ? 'rounded-xl border border-slate-700/70' : `border border-slate-700 shadow-2xl ${sheet ? 'rounded-t-2xl sm:rounded-2xl' : 'rounded-2xl'}`}`}>
      {title && <div className="bg-emerald-500 px-4 py-1.5 text-center text-sm font-semibold text-white">{title}</div>}
      {/* Thanh chỉ dẫn kiểu Google Maps Navigation: nền xanh đậm, mũi tên rẽ lớn, 1 dòng hướng dẫn */}
      <div className="flex items-center gap-3 bg-[#0b5d3b] px-3 py-2.5 text-white sm:px-4 sm:py-3">
        <MainIcon className="h-9 w-9 shrink-0 sm:h-10 sm:w-10" strokeWidth={2.8} />
        <div className="min-w-0 flex-1 text-[15px] font-bold leading-snug sm:text-lg">{navHeadline(slotCode)}</div>
        {onClose && (
          <button onClick={onClose} aria-label="Đóng bản đồ" className="-mr-1 flex h-10 w-10 shrink-0 items-center justify-center rounded-full hover:bg-white/15">
            <X className="h-5 w-5" />
          </button>
        )}
      </div>
      {straightFirst && (
        <div className="flex items-center gap-1.5 bg-[#08472d] px-3 py-1 text-xs font-medium text-emerald-50 sm:px-4 sm:text-sm">
          Sau đó {floor > 1 && <><MoveUpRight className="h-4 w-4" strokeWidth={2.5} /> lên ram ·</>}
          <TurnIcon className="h-4 w-4" strokeWidth={2.5} /> {top ? 'rẽ trái' : 'rẽ phải'}
        </div>
      )}

      <div className={compact || inline ? 'p-1.5 sm:p-2' : 'p-2 sm:p-3'}>
        <MiniMapSvg slotCode={slotCode} slots={slots} gateOpen={gateOpen} />
      </div>

      {/* Thanh thông tin dưới */}
      <div className="flex items-center gap-3 border-t border-slate-800 px-3 py-2.5 sm:px-4">
        <div className="min-w-0 flex-1">
          <div className="flex items-baseline gap-2">
            <span className="text-lg font-bold text-emerald-400">{Math.ceil(seconds / 60)} phút</span>
            <span className="text-sm text-slate-400">· ~{meters} m</span>
          </div>
          <div className="truncate text-xs text-slate-400">
            Tới ô <b className="text-sky-300">{slotCode}</b> · Tầng {floor}{plate ? <> · <span className="font-mono">{plate}</span></> : null}
          </div>
        </div>
        <span className="flex items-center gap-1 rounded-full bg-sky-500/15 px-2.5 py-1 text-xs font-medium text-sky-300">
          {gateOpen ? <><ArrowUp className="h-3.5 w-3.5" /> Barrier mở</> : <><Navigation className="h-3.5 w-3.5" /> Chỉ đường</>}
        </span>
      </div>
    </div>
  )
}
