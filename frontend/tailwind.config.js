import colors from 'tailwindcss/colors'
import plugin from 'tailwindcss/plugin'

/* Giao diện Sáng / Tối: các bảng màu dùng biến CSS.
 * - `html.dark` (mặc định của dự án): giữ nguyên màu Tailwind gốc.
 * - Không có `.dark` (giao diện Sáng): đảo thang màu — slate-950 (nền) thành gần trắng, slate-100 (chữ) thành gần đen;
 *   màu nhấn 200–400 (chữ trên nền tối) đổi sang 800–600 để đủ tương phản trên nền sáng.
 * Nhờ vậy toàn bộ class sẵn có (bg-slate-900, text-slate-400, text-emerald-300…) tự đổi theo giao diện. */
const SHADES = [50, 100, 200, 300, 400, 500, 600, 700, 800, 900, 950]
const PALETTES = ['slate', 'sky', 'emerald', 'amber', 'rose', 'orange', 'violet']
// Sáng: nền trang #F1F5F9 (950), thẻ #FFFFFF (900), viền #E2E8F0 (800), chữ chính #0F172A (100), chữ phụ #475569 (400/500)
const LIGHT_SLATE = { 950: '#f1f5f9', 900: '#ffffff', 800: '#e2e8f0', 700: '#cbd5e1', 600: '#64748b', 500: '#475569', 400: '#475569', 300: '#334155', 200: '#1e293b', 100: '#0f172a', 50: '#020617' }
// Chữ màu nhấn (text-*-200…400) -> sắc 700–900 đạt tương phản >= 4.5:1 trên nền trắng;
// 500 -> 600: nền nút đặc (bg-emerald-500 + chữ trắng…) đủ tương phản trên nền sáng
const ACCENT_MAP = { 50: 950, 100: 900, 200: 900, 300: 800, 400: 700, 500: 600, 600: 600, 700: 700, 800: 800, 900: 100, 950: 50 }
// Màu nhấn "sky" ở giao diện Sáng dùng xanh dương #2563EB (nút chính, liên kết, tab đang chọn)
const LIGHT_SRC = { sky: colors.blue }

const rgb = (hex) => {
  const h = hex.replace('#', '')
  return [0, 2, 4].map((i) => parseInt(h.slice(i, i + 2), 16)).join(' ')
}
const vars = (light) => Object.fromEntries(PALETTES.flatMap((p) => SHADES.map((s) => {
  const hex = !light ? colors[p][s] : p === 'slate' ? LIGHT_SLATE[s] : (LIGHT_SRC[p] || colors[p])[ACCENT_MAP[s]]
  return [`--c-${p}-${s}`, rgb(hex)]
})))

/** @type {import('tailwindcss').Config} */
export default {
  darkMode: 'class',
  content: ['./index.html', './src/**/*.{js,jsx}'],
  theme: {
    extend: {
      fontFamily: { sans: ['Inter', 'system-ui', 'Segoe UI', 'Roboto', 'sans-serif'] },
      colors: Object.fromEntries(PALETTES.map((p) => [p, Object.fromEntries(SHADES.map((s) => [s, `rgb(var(--c-${p}-${s}) / <alpha-value>)`]))])),
    },
  },
  plugins: [
    plugin(({ addBase }) => {
      addBase({ ':root': vars(true), ':root.dark': vars(false) })
    }),
  ],
}
