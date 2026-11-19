import colors from 'tailwindcss/colors'
import plugin from 'tailwindcss/plugin'

/* Giao diện Sáng / Tối: các bảng màu dùng biến CSS.
 * - `html.dark` (mặc định của dự án): giữ nguyên màu Tailwind gốc.
 * - Không có `.dark` (giao diện Sáng): đảo thang màu — slate-950 (nền) thành gần trắng, slate-100 (chữ) thành gần đen;
 *   màu nhấn 200–400 (chữ trên nền tối) đổi sang 800–600 để đủ tương phản trên nền sáng.
 * Nhờ vậy toàn bộ class sẵn có (bg-slate-900, text-slate-400, text-emerald-300…) tự đổi theo giao diện. */
const SHADES = [50, 100, 200, 300, 400, 500, 600, 700, 800, 900, 950]
const PALETTES = ['slate', 'sky', 'emerald', 'amber', 'rose', 'orange', 'violet']
const LIGHT_SLATE = { 950: '#f1f5f9', 900: '#ffffff', 800: '#e2e8f0', 700: '#cbd5e1', 600: '#94a3b8', 500: '#64748b', 400: '#475569', 300: '#334155', 200: '#1e293b', 100: '#0f172a', 50: '#020617' }
const ACCENT_MAP = { 50: 950, 100: 900, 200: 800, 300: 700, 400: 600, 500: 500, 600: 600, 700: 700, 800: 800, 900: 100, 950: 50 }

const rgb = (hex) => {
  const h = hex.replace('#', '')
  return [0, 2, 4].map((i) => parseInt(h.slice(i, i + 2), 16)).join(' ')
}
const vars = (light) => Object.fromEntries(PALETTES.flatMap((p) => SHADES.map((s) => {
  const hex = !light ? colors[p][s] : p === 'slate' ? LIGHT_SLATE[s] : colors[p][ACCENT_MAP[s]]
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
