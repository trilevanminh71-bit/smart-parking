/* Song ngữ Việt - Anh.
 * - `tr(s)`: dịch 1 chuỗi theo ngôn ngữ hiện tại (dùng cho Canvas, confirm/alert, tiêu đề…).
 * - Khi chọn EN, bộ dịch DOM (MutationObserver) tự dịch mọi chữ hiển thị + placeholder/title/aria-label
 *   theo từ điển `en.js`, nên không phải sửa từng component. Chuyển về VI thì khôi phục chữ gốc. */
import { createContext, useCallback, useContext, useEffect, useState } from 'react'
import { DICT, TEMPLATES } from './en.js'

const LANG_KEY = 'sp_lang'
const readLang = () => { try { return localStorage.getItem(LANG_KEY) === 'en' ? 'en' : 'vi' } catch { return 'vi' } }
let current = readLang()
export const getLang = () => current

const norm = (s) => s.replace(/\s+/g, ' ').trim()
const esc = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
const DICT_N = new Map(Object.entries(DICT).map(([k, v]) => [norm(k), v]))
const TPL = TEMPLATES.map(([vi, en]) => {
  const parts = norm(vi).split('{}')
  let i = 0
  const out = /\{\d\}/.test(en) ? en : en.replace(/\{\}/g, () => `{${i++}}`)
  return [new RegExp(`^${parts.map(esc).join('([\\s\\S]*?)')}$`), out, parts.join('')]
}).sort((a, b) => b[2].length - a[2].length) // mẫu dài / cụ thể hơn được thử trước
const SEPS = [' · ', ' — ', '; ', ': ']
const VN = /[À-ỹđĐ]/
const cache = new Map()

function lookup(core, depth = 0) {
  if (DICT_N.has(core)) return DICT_N.get(core)
  if (cache.has(core)) return cache.get(core)
  let out = null
  for (const [re, en, lit] of TPL) {
    const m = core.match(re)
    // Bỏ qua nếu phần thay đổi "nuốt" cả một vế câu ghép (VD: 'vé {}' khớp 'vé X — quá giờ…') -> để bước tách câu xử lý
    if (m && lit.length < 12 && m.slice(1).some((g) => SEPS.some((s) => g.includes(s) && !lit.includes(s.trim())))) continue
    if (m) { out = en.replace(/\{(\d)\}/g, (_, n) => { const v = m[+n + 1] ?? ''; return depth < 3 ? (lookup(v.trim(), depth + 1) ?? v) : v }); break }
  }
  if (out == null && depth < 3) {
    // Câu ghép: dịch từng phần ngăn bởi " · " / " — " / "; " / ": "
    for (const sep of SEPS) {
      if (!core.includes(sep)) continue
      const parts = core.split(sep)
      const tr2 = parts.map((p) => (p.trim() ? lookup(p.trim(), depth + 1) ?? p : p))
      if (tr2.some((p, i) => p !== parts[i])) { out = tr2.join(sep); break }
    }
  }
  if (out == null) {
    const m = core.match(/^(.*?)([:?!.…]+)$/) // bỏ dấu câu cuối rồi thử lại
    if (m && m[1] && DICT_N.has(m[1])) out = DICT_N.get(m[1]) + m[2]
  }
  if (cache.size > 3000) cache.clear()
  cache.set(core, out)
  return out
}

/** Dịch 1 chuỗi sang ngôn ngữ đang chọn (giữ khoảng trắng đầu/cuối). */
export function tr(s, lang = current) {
  if (lang !== 'en' || typeof s !== 'string') return s
  if (!VN.test(s)) return /^\s*VD:/.test(s) ? s.replace(/VD:/, 'e.g.') : s // "VD: 65A-123.45" không có dấu
  const m = s.match(/^(\s*)([\s\S]*?)(\s*)$/)
  const out = lookup(norm(m[2]))
  return out == null ? s : m[1] + out + m[3]
}

/* ---------------- Bộ dịch DOM ---------------- */
const ATTRS = ['placeholder', 'title', 'aria-label', 'alt']
const textRec = new WeakMap() // Text -> { src, out }
const attrRec = new WeakMap() // Element -> { [attr]: { src, out } }
const SKIP = new Set(['SCRIPT', 'STYLE', 'TEXTAREA', 'NOSCRIPT'])
const skipped = (el) => !el || SKIP.has(el.nodeName) || el.closest?.('[data-no-tr],[contenteditable="true"]')

function doText(node) {
  const v = node.nodeValue
  const rec = textRec.get(node)
  if (rec && v === rec.out) return
  if (!(VN.test(v) || v.includes('VD:')) || skipped(node.parentElement)) { textRec.delete(node); return }
  const out = tr(v, 'en')
  if (out !== v) { textRec.set(node, { src: v, out }); node.nodeValue = out } else textRec.delete(node)
}
function doAttrs(el) {
  if (!el || el.closest?.('[data-no-tr]')) return // placeholder của <textarea> vẫn được dịch
  for (const a of ATTRS) {
    const v = el.getAttribute(a)
    if (!v) continue
    const recs = attrRec.get(el) || {}
    if (recs[a] && recs[a].out === v) continue
    const out = tr(v, 'en')
    if (out !== v) { recs[a] = { src: v, out }; attrRec.set(el, recs); el.setAttribute(a, out) }
  }
}
function walk(root) {
  if (root.nodeType === 3) return doText(root)
  if (root.nodeType !== 1 || SKIP.has(root.nodeName)) return
  doAttrs(root)
  const it = document.createTreeWalker(root, NodeFilter.SHOW_TEXT | NodeFilter.SHOW_ELEMENT)
  for (let n = it.nextNode(); n; n = it.nextNode()) n.nodeType === 3 ? doText(n) : doAttrs(n)
}
function restore(root) {
  const it = document.createTreeWalker(root, NodeFilter.SHOW_TEXT | NodeFilter.SHOW_ELEMENT)
  for (let n = it.nextNode(); n; n = it.nextNode()) {
    if (n.nodeType === 3) {
      const r = textRec.get(n)
      if (r && n.nodeValue === r.out) n.nodeValue = r.src
      textRec.delete(n)
    } else {
      const recs = attrRec.get(n)
      if (recs) Object.entries(recs).forEach(([a, r]) => { if (n.getAttribute(a) === r.out) n.setAttribute(a, r.src) })
      attrRec.delete(n)
    }
  }
}

let observer = null
function startDom() {
  if (observer) return
  walk(document.body)
  observer = new MutationObserver((list) => {
    for (const m of list) {
      if (m.type === 'characterData') doText(m.target)
      else if (m.type === 'attributes') doAttrs(m.target)
      else m.addedNodes.forEach(walk)
    }
  })
  observer.observe(document.body, { subtree: true, childList: true, characterData: true, attributes: true, attributeFilter: ATTRS })
}
function stopDom() {
  observer?.disconnect()
  observer = null
  restore(document.body)
}

// Hộp thoại confirm/alert/prompt của trình duyệt cũng được dịch
if (typeof window !== 'undefined' && !window.__spDialogsPatched) {
  window.__spDialogsPatched = true
  for (const fn of ['confirm', 'alert', 'prompt']) {
    const orig = window[fn].bind(window)
    window[fn] = (msg, ...rest) => orig(tr(String(msg ?? '')), ...rest)
  }
}

/* ---------------- Context ---------------- */
const LangCtx = createContext({ lang: 'vi', setLang: () => {}, t: (s) => s })
export const useLang = () => useContext(LangCtx)

export function LanguageProvider({ children }) {
  const [lang, setLangState] = useState(current)
  const setLang = useCallback((l) => {
    current = l === 'en' ? 'en' : 'vi'
    try { localStorage.setItem(LANG_KEY, current) } catch { /* ignore */ }
    setLangState(current)
  }, [])
  useEffect(() => {
    document.documentElement.lang = lang
    if (lang === 'en') startDom(); else stopDom()
  }, [lang])
  const t = useCallback((s) => tr(s, lang), [lang])
  return <LangCtx.Provider value={{ lang, setLang, t }}>{children}</LangCtx.Provider>
}
