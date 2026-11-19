import { Monitor, Moon, Sun } from 'lucide-react'
import { useLang } from '../i18n/index.jsx'
import { THEMES, useTheme } from '../theme.jsx'

const THEME_INFO = {
  light: { icon: Sun, vi: 'Sáng', en: 'Light' },
  dark: { icon: Moon, vi: 'Tối', en: 'Dark' },
  system: { icon: Monitor, vi: 'Tự động', en: 'Auto' },
}

/** Nút đổi giao diện (Sáng → Tối → Tự động) và chọn ngôn ngữ VI | EN trên thanh tiêu đề. */
export default function PrefsControls({ compact = false }) {
  const { theme, setTheme } = useTheme()
  const { lang, setLang } = useLang()
  const info = THEME_INFO[theme]
  const next = THEMES[(THEMES.indexOf(theme) + 1) % THEMES.length]
  const label = `${lang === 'en' ? 'Theme' : 'Giao diện'}: ${info[lang]}`
  return (
    <div className="flex shrink-0 items-center gap-1.5" data-no-tr>
      <button onClick={() => setTheme(next)} title={label} aria-label={label}
        className="flex min-h-[44px] min-w-[44px] items-center justify-center gap-1.5 rounded-xl border border-slate-800 bg-slate-900 px-2 text-sm text-slate-200 hover:border-sky-500 hover:text-sky-300">
        <info.icon className="h-4 w-4" />
        {!compact && <span className="hidden xl:inline">{info[lang]}</span>}
      </button>
      <div role="group" aria-label={lang === 'en' ? 'Language' : 'Ngôn ngữ'}
        className="flex min-h-[44px] items-center rounded-xl border border-slate-800 bg-slate-900 p-1 text-xs font-bold">
        {['vi', 'en'].map((l) => (
          <button key={l} onClick={() => setLang(l)} aria-pressed={lang === l}
            className={`min-h-[34px] rounded-lg px-2 transition ${lang === l ? 'bg-sky-500 text-white' : 'text-slate-400 hover:text-sky-300'}`}>
            {l.toUpperCase()}
          </button>
        ))}
      </div>
    </div>
  )
}
