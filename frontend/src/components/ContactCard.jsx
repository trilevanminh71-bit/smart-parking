import { Building2, MapPin, Megaphone, Phone, Mail, UserRound, Headset } from 'lucide-react'

/** Thẻ "Thông tin Quản trị viên / Liên hệ hỗ trợ" — ẩn các dòng chưa điền. */
export default function ContactCard({ settings }) {
  if (!settings) return null
  const { parking_name, parking_address, admin_name, admin_phone, admin_email, notice_text } = settings
  const rows = [
    parking_address && { icon: MapPin, label: 'Địa chỉ', value: parking_address,
      href: `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(parking_address)}` },
    admin_name && { icon: UserRound, label: 'Quản trị viên', value: admin_name },
    admin_phone && { icon: Phone, label: 'Điện thoại', value: admin_phone, href: `tel:${admin_phone.replace(/[^\d+]/g, '')}` },
    admin_email && { icon: Mail, label: 'Email', value: admin_email, href: `mailto:${admin_email}` },
  ].filter(Boolean)
  if (!rows.length && !notice_text) return null

  return (
    <section className="card border-sky-500/40 bg-gradient-to-br from-sky-500/10 via-slate-900/70 to-slate-900/70" aria-label="Thông tin Quản trị viên / Liên hệ hỗ trợ">
      <div className="card-title !text-sky-300"><Headset className="h-4 w-4" /> Thông tin Quản trị viên / Liên hệ hỗ trợ</div>
      {notice_text && (
        <div className="mb-3 flex items-start gap-2 rounded-xl border border-amber-500/40 bg-amber-500/10 p-3 text-sm text-amber-100">
          <Megaphone className="mt-0.5 h-4 w-4 shrink-0 text-amber-300" />
          <p className="min-w-0 whitespace-pre-line break-words">{notice_text}</p>
        </div>
      )}
      {parking_name && (
        <div className="mb-2 flex items-center gap-2 font-semibold"><Building2 className="h-4 w-4 text-sky-400" /> {parking_name}</div>
      )}
      <div className="grid gap-2 sm:grid-cols-2 xl:grid-cols-4">
        {rows.map(({ icon: Icon, label, value, href }) => {
          const inner = (
            <>
              <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-slate-800 text-sky-300"><Icon className="h-4 w-4" /></span>
              <span className="min-w-0">
                <span className="block text-xs text-slate-400">{label}</span>
                <span className="block break-words font-medium">{value}</span>
              </span>
            </>
          )
          return href ? (
            <a key={label} href={href} target={href.startsWith('http') ? '_blank' : undefined} rel="noreferrer"
              className="flex min-h-[52px] items-center gap-3 rounded-xl border border-slate-800 bg-slate-950/50 p-2 hover:border-sky-500/60">{inner}</a>
          ) : (
            <div key={label} className="flex min-h-[52px] items-center gap-3 rounded-xl border border-slate-800 bg-slate-950/50 p-2">{inner}</div>
          )
        })}
      </div>
    </section>
  )
}
