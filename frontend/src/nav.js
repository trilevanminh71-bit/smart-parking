/* Đồng bộ tab với lịch sử trình duyệt (history.pushState / popstate).
 * Khi đang ở một "trang phụ" (Vé của tôi, Lịch sử, trang Bảo vệ/Quản trị…), lịch sử có thêm đúng 1 mục `{spNav:'sub'}`.
 * Nút Back (<) của Safari/Chrome hoặc vuốt cạnh trái -> quay về mục gốc -> mọi nơi đang ở trang phụ tự về Trang chủ (Đặt chỗ),
 * thay vì thoát khỏi trang web. Chuyển qua lại giữa các trang phụ không tạo thêm mục (Back luôn về Trang chủ ngay). */
import { useEffect, useRef } from 'react'

const entries = new Map() // id -> { sub, home }
let seq = 0
let timer = null

function sync() {
  timer = null
  const sub = [...entries.values()].some((e) => e.sub)
  const onSub = window.history.state?.spNav === 'sub'
  if (sub && !onSub) window.history.pushState({ ...(window.history.state || {}), spNav: 'sub' }, '')
  else if (!sub && onSub) window.history.back() // về Trang chủ bằng nút trên giao diện -> bỏ mục phụ khỏi lịch sử
}
const schedule = () => { if (!timer) timer = setTimeout(sync, 0) } // gộp các thay đổi trong cùng 1 lần render

if (typeof window !== 'undefined') {
  window.addEventListener('popstate', (e) => {
    if (e.state?.spNav === 'sub') return
    entries.forEach((en) => { if (en.sub) en.home() })
  })
}

/** `sub` = đang ở trang phụ; `goHome()` = đưa phần giao diện này về Trang chủ. */
export function useBackHome(sub, goHome) {
  const id = useRef(0)
  if (!id.current) id.current = ++seq
  const home = useRef(goHome)
  home.current = goHome
  useEffect(() => {
    entries.set(id.current, { sub, home: () => home.current() })
    schedule()
  }, [sub])
  useEffect(() => () => { entries.delete(id.current); schedule() }, [])
}
