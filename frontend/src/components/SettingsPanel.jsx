import { useEffect, useState } from 'react'
import { Settings, Save, Loader2, RotateCcw, Headset, ShieldCheck, Copy, Eye, EyeOff } from 'lucide-react'
import { api } from '../api.js'

const NUM = ['hold_minutes', 'deposit_amount', 'hourly_rate', 'exit_grace_minutes']
const TEXT = ['parking_name', 'admin_name', 'admin_phone', 'admin_email', 'parking_address', 'notice_text']

export default function SettingsPanel({ toast }) {
  const [form, setForm] = useState(null)
  const [busy, setBusy] = useState('')
  const [showKey, setShowKey] = useState(false)
  const webhookUrl = `${location.origin}/api/payment/webhook`

  useEffect(() => {
    api('/api/admin/settings').then(setForm).catch((err) => toast(err.message, 'error'))
  }, [toast])

  if (!form) return <div className="card text-sm text-slate-500">Đang tải cài đặt…</div>
  const set = (k) => (e) => setForm((f) => ({ ...f, [k]: e.target.type === 'checkbox' ? e.target.checked : e.target.value }))

  const save = (keys, label) => async (e) => {
    e.preventDefault()
    setBusy(label)
    try {
      const body = Object.fromEntries(keys.map((k) => [k, NUM.includes(k) ? Number(form[k]) : form[k]]))
      setForm(await api('/api/admin/settings', { method: 'PUT', body }))
      toast(`Đã lưu ${label} xuống SQLite`, 'success')
    } catch (err) { toast(err.message, 'error') } finally { setBusy('') }
  }

  const reset = async () => {
    if (!confirm('Xóa toàn bộ đặt chỗ, lượt gửi xe, log phần cứng và trả tất cả ô về trống? (Giữ nguyên cài đặt, tài khoản và lịch sử hoạt động)')) return
    try { await api('/api/admin/reset', { method: 'POST' }); toast('Đã reset dữ liệu demo', 'success') } catch (err) { toast(err.message, 'error') }
  }

  const field = (k, label, props = {}) => (
    <div>
      <label className="label" htmlFor={`st-${k}`}>{label}</label>
      <input id={`st-${k}`} className="input" value={form[k] ?? ''} onChange={set(k)} {...props} />
    </div>
  )

  return (
    <div className="space-y-4 sm:space-y-5">
      <form className="card" onSubmit={save(NUM, 'cài đặt đặt chỗ')}>
        <div className="card-title"><Settings className="h-4 w-4" /> Cài đặt đặt chỗ & tính phí</div>
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          {field('hold_minutes', 'Thời gian giữ chỗ (phút)', { type: 'number', inputMode: 'numeric', min: 1, max: 1440, required: true })}
          {field('deposit_amount', 'Tiền đặt cọc (VNĐ)', { type: 'number', inputMode: 'numeric', min: 0, step: 1000, required: true })}
          {field('hourly_rate', 'Đơn giá theo giờ (VNĐ/giờ)', { type: 'number', inputMode: 'numeric', min: 0, step: 1000, required: true })}
          {field('exit_grace_minutes', 'Thời gian ra cổng sau thanh toán (phút)', { type: 'number', inputMode: 'numeric', min: 1, max: 240, required: true })}
        </div>
        <p className="mt-2 text-xs text-slate-500">
          Khách thanh toán trước trên web → có tối đa <b>{form.exit_grace_minutes || 15} phút</b> để ra cổng: camera cổng ra quét đúng biển số
          là tự mở barrier. Quá hạn → chặn barrier, tính phí phát sinh thêm để trả bù.
        </p>
        <p className="mt-2 text-xs text-slate-500">
          Khách đặt chỗ → ô "Chờ chuyển khoản" tối đa 5 phút → tiền vào (SePay) hoặc Bảo vệ bấm Duyệt cọc → giữ chỗ theo thời gian trên.
          Thay đổi áp dụng cho các đặt chỗ / lượt tính tiền mới.
        </p>
        <div className="mt-3 flex flex-col-reverse gap-2 sm:flex-row sm:justify-between">
          <button type="button" className="btn-ghost" onClick={reset}><RotateCcw className="h-4 w-4" /> Reset dữ liệu demo</button>
          <button className="btn-primary" disabled={!!busy}>{busy === 'cài đặt đặt chỗ' ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />} Lưu cài đặt</button>
        </div>
      </form>

      <form className="card" onSubmit={save(['sepay_api_key'], 'SePay API Key')}>
        <div className="card-title"><ShieldCheck className="h-4 w-4" /> Tự động xác nhận chuyển khoản (SePay Webhook)</div>
        <div className="grid gap-3">
          <div>
            <label className="label" htmlFor="st-sepay">SePay API Key</label>
            <div className="flex gap-2">
              <input id="st-sepay" className="input font-mono" type={showKey ? 'text' : 'password'} autoComplete="off" spellCheck={false}
                maxLength={200} value={form.sepay_api_key ?? ''} onChange={set('sepay_api_key')} placeholder="Dán API Key tạo trong my.sepay.vn" />
              <button type="button" className="btn-ghost shrink-0" onClick={() => setShowKey((v) => !v)} aria-label={showKey ? 'Ẩn API Key' : 'Hiện API Key'}>
                {showKey ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
              </button>
            </div>
          </div>
          <div>
            <label className="label" htmlFor="st-webhook">Link Webhook (dán vào SePay → Tích hợp Webhooks)</label>
            <div className="flex gap-2">
              <input id="st-webhook" className="input font-mono text-xs" readOnly value={webhookUrl} onFocus={(e) => e.target.select()} />
              <button type="button" className="btn-ghost shrink-0" onClick={() => { navigator.clipboard?.writeText(webhookUrl); toast('Đã sao chép link Webhook', 'success') }}>
                <Copy className="h-4 w-4" /> Sao chép
              </button>
            </div>
          </div>
        </div>
        <ul className="mt-2 list-disc space-y-0.5 pl-5 text-xs text-slate-400">
          <li>Trong SePay chọn kiểu chứng thực <b>API Key</b>: SePay gửi header <span className="font-mono">Authorization: Apikey &lt;key&gt;</span>; sai key → 401.</li>
          <li>Link phải truy cập được từ Internet (VD: link ngrok <span className="font-mono">https://…ngrok-free.dev/api/payment/webhook</span>).</li>
          <li>Tiền vào đúng nội dung <span className="font-mono">COC &lt;MÃ_VÉ&gt;</span> và đủ số tiền → vé tự chuyển sang Đã đặt cọc. Giao dịch thiếu tiền / sai nội dung / về trễ được lưu ở tab <b>Đối soát</b>.</li>
          <li>Trên Cloud (Render) có thể đặt biến môi trường <span className="font-mono">SEPAY_API_KEY</span> thay cho ô trên; SePay gửi <span className="font-mono">Apikey</span> hoặc <span className="font-mono">Bearer</span> đều được.</li>
          <li>Trạng thái: {form.sepay_api_key || form.sepay_env_configured
            ? <b className="text-emerald-300">Đã cấu hình{form.sepay_env_configured ? ' (biến môi trường SEPAY_API_KEY' + (form.sepay_api_key ? ' + ô trên)' : ')') : ''}</b>
            : <b className="text-rose-300">Chưa có API Key — webhook đang từ chối mọi yêu cầu, chỉ duyệt cọc thủ công</b>}</li>
        </ul>
        <div className="mt-3 flex justify-end">
          <button className="btn-primary w-full sm:w-auto" disabled={!!busy}>{busy === 'SePay API Key' ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />} Lưu API Key</button>
        </div>
      </form>

      <form className="card" onSubmit={save(TEXT, 'thông tin liên hệ')}>
        <div className="card-title"><Headset className="h-4 w-4" /> Thông tin Quản trị viên / Liên hệ hỗ trợ</div>
        <p className="-mt-1 mb-3 text-xs text-slate-500">Hiển thị trên Trang Khách hàng. Dòng nào để trống sẽ được ẩn.</p>
        <div className="grid gap-3 sm:grid-cols-2">
          {field('parking_name', 'Tên bãi xe *', { required: true, maxLength: 80 })}
          {field('parking_address', 'Địa chỉ bãi xe', { maxLength: 200, placeholder: 'VD: 123 Đường ABC, Quận 1, TP.HCM' })}
          {field('admin_name', 'Tên quản trị viên', { maxLength: 80 })}
          {field('admin_phone', 'Số điện thoại hỗ trợ', { type: 'tel', inputMode: 'tel', maxLength: 20 })}
          {field('admin_email', 'Email hỗ trợ', { type: 'email', inputMode: 'email', maxLength: 120 })}
        </div>
        <div className="mt-3">
          <label className="label" htmlFor="st-notice">Thông báo cho khách</label>
          <textarea id="st-notice" className="input min-h-[88px] resize-y" maxLength={500} value={form.notice_text ?? ''} onChange={set('notice_text')}
            placeholder="VD: Bãi đóng cửa lúc 23h. Tầng 3 đang bảo trì…" />
        </div>
        <div className="mt-3 flex justify-end">
          <button className="btn-primary w-full sm:w-auto" disabled={!!busy}>{busy === 'thông tin liên hệ' ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />} Lưu thông tin</button>
        </div>
      </form>
    </div>
  )
}
