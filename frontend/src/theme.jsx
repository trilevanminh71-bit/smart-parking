/* Giao diện Sáng / Tối / Tự động (theo hệ điều hành). Lưu lựa chọn trong localStorage. */
import { createContext, useCallback, useContext, useEffect, useState } from 'react'

const THEME_KEY = 'sp_theme'
export const THEMES = ['light', 'dark', 'system']
const read = () => { try { const v = localStorage.getItem(THEME_KEY); return THEMES.includes(v) ? v : 'dark' } catch { return 'dark' } }
const media = () => window.matchMedia?.('(prefers-color-scheme: dark)')

function apply(mode) {
  const dark = mode === 'dark' || (mode === 'system' && (media()?.matches ?? true))
  const root = document.documentElement
  root.classList.toggle('dark', dark)
  document.querySelector('meta[name="theme-color"]')?.setAttribute('content', dark ? '#020617' : '#f1f5f9')
  return dark
}

const ThemeCtx = createContext({ theme: 'dark', resolved: 'dark', setTheme: () => {} })
export const useTheme = () => useContext(ThemeCtx)

export function ThemeProvider({ children }) {
  const [theme, setThemeState] = useState(read)
  const [resolved, setResolved] = useState(() => (apply(read()) ? 'dark' : 'light'))
  const setTheme = useCallback((t) => {
    try { localStorage.setItem(THEME_KEY, t) } catch { /* ignore */ }
    setThemeState(t)
  }, [])
  useEffect(() => {
    setResolved(apply(theme) ? 'dark' : 'light')
    if (theme !== 'system') return
    const mq = media()
    const on = () => setResolved(apply('system') ? 'dark' : 'light')
    mq?.addEventListener ? mq.addEventListener('change', on) : mq?.addListener?.(on) // Safari < 14
    return () => (mq?.removeEventListener ? mq.removeEventListener('change', on) : mq?.removeListener?.(on))
  }, [theme])
  return <ThemeCtx.Provider value={{ theme, resolved, setTheme }}>{children}</ThemeCtx.Provider>
}
