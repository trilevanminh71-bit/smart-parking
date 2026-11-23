"""Nghiệp vụ cốt lõi: đặt chỗ, check-in, tính tiền, thanh toán, cảm biến."""
import math
import os
import re
import secrets
from datetime import timedelta

from fastapi import HTTPException

import mapcfg
from database import CONTACT_KEYS, Tx, db_kind, get_settings, log_activity, now, now_iso, parse_dt, query, query_one


def fail(message: str, status: int = 400):
    raise HTTPException(status_code=status, detail=message)


# ---------------------------------------------------------------- Biển số VN
_PLATE_PATTERNS = [
    re.compile(r"^(\d{2})([A-Z]{1,2})(\d{4,5})$"),  # Ô tô: 51G12345, 30LD1234
    re.compile(r"^(\d{2})([A-Z]\d)(\d{4,5})$"),      # Xe máy: 59X112345
]


def normalize_plate(raw: str) -> str:
    """Chuẩn hóa biển số Việt Nam: '65a12345' -> '65A-123.45', '51g1234' -> '51G-1234'."""
    s = re.sub(r"[^A-Z0-9]", "", (raw or "").upper())
    for pat in _PLATE_PATTERNS:
        m = pat.match(s)
        if m:
            province, series, digits = m.groups()
            if not 11 <= int(province) <= 99:
                break
            tail = f"{digits[:3]}.{digits[3:]}" if len(digits) == 5 else digits
            return f"{province}{series}-{tail}"
    fail(f"Biển số không hợp lệ: '{raw}'. Ví dụ đúng: 65A-123.45, 51G-1234, 59X1-123.45")


def try_normalize_plate(raw: str) -> str | None:
    try:
        return normalize_plate(raw)
    except HTTPException:
        return None


# ---------------------------------------------------------------- Tiện ích
def log(db, source: str, event_type: str, message: str) -> None:
    db.execute(
        "INSERT INTO hardware_logs (source, event_type, message, created_at) VALUES (?, ?, ?, ?)",
        (source, event_type, message, now_iso()),
    )


def add_log(source: str, event_type: str, message: str) -> None:
    with Tx() as db:
        log(db, source, event_type, message)


def get_slot(db, code: str) -> dict:
    row = db.execute("SELECT * FROM slots WHERE code = ?", (code.strip().upper(),)).fetchone()
    if not row:
        fail(f"Không tìm thấy ô đỗ {code}", 404)
    return dict(row)


def directions(slot_code: str, floor: int) -> list[str]:
    """Chỉ dẫn đường đi từ cổng vào tới ô đỗ."""
    idx = int(slot_code[-2:])
    steps = ["Cổng vào"]
    if floor == 1:
        steps.append("Đi thẳng vào Tầng 1")
    else:
        steps.append(f"Đi theo dốc/thang lên Tầng {floor}")
    side = "Rẽ trái (dãy trên)" if idx <= 5 else "Rẽ phải (dãy dưới)"
    steps.append(side)
    pos = idx if idx <= 5 else idx - 5
    steps.append(f"Đi thẳng qua {pos - 1} ô" if pos > 1 else "Ô đầu tiên ngay đầu dãy")
    steps.append(f"Ô {slot_code}")
    return steps


TICKET_ALPHABET = "23456789ABCDEFGHJKLMNPQRSTUVWXYZ"  # bỏ 0/O/1/I dễ nhầm
TICKET_RE = re.compile(r"(?:VE:|SP-)?([2-9A-HJ-NP-Z]{6})\b")


def new_ticket_code(db) -> str:
    while True:
        code = "".join(secrets.choice(TICKET_ALPHABET) for _ in range(6))
        if not db.execute("SELECT 1 FROM reservations WHERE ticket_code = ?", (code,)).fetchone():
            return code


def ticket_qr_content(r: dict) -> str:
    return f"SMARTPARKING|VE:{r['ticket_code']}|{r['license_plate']}|#{r['id']}"


HOLD_STATUSES = ("active", "pending_payment")              # đặt chỗ đang giữ ô
SLOT_HELD = ("reserved", "pending_payment")                 # trạng thái ô đang bị giữ


def res_slot_status(r) -> str:
    """Trạng thái ô tương ứng với một đặt chỗ đang giữ."""
    return "pending_payment" if r["status"] == "pending_payment" else "reserved"


def _user_email(db, uid) -> str:
    row = db.execute("SELECT email FROM users WHERE id = ?", (uid,)).fetchone() if uid else None
    return row["email"] if row else ""


def owner_of_plate(db, plate: str, user_id=None):
    """(user_id, email) để ghi lịch sử: ưu tiên user_id đã biết, nếu không thì tài khoản có biển số quen dùng."""
    if user_id:
        return user_id, _user_email(db, user_id)
    row = db.execute("SELECT id, email FROM users WHERE default_plate = ? ORDER BY id LIMIT 1", (plate,)).fetchone()
    return (row["id"], row["email"]) if row else (None, "")


def new_code_for_client() -> str:
    """Mã vé dự kiến để hiện trong nội dung chuyển khoản trước khi tạo đặt chỗ."""
    with Tx() as db:
        return new_ticket_code(db)


def _reservation_view(r: dict) -> dict:
    remaining = max(0, int((parse_dt(r["expires_at"]) - now()).total_seconds()))
    r = dict(r)
    r["deposit_mode"] = r.get("deposit_mode") or "deposit"
    r["remaining_seconds"] = remaining if r["status"] in HOLD_STATUSES else 0
    r["qr_content"] = ticket_qr_content(r) if r.get("ticket_code") else None
    if "slot_code" in r and "floor" in r:
        r["directions"] = directions(r["slot_code"], r["floor"])
    return r


# ---------------------------------------------------------------- Đặt chỗ
FREE_MODE = "admin_free"  # đặt chỗ miễn phí của tài khoản Admin
FREE_METHOD = "admin_free"  # payment_method của lượt gửi miễn phí (không tính vào doanh thu)


def _is_admin(db, uid) -> bool:
    row = db.execute("SELECT role FROM users WHERE id = ?", (uid,)).fetchone() if uid else None
    return bool(row and row["role"] == "admin")


def create_reservation(slot_code: str, plate: str, name: str, phone: str, user_id: int | None = None,
                       ticket_code: str | None = None, free: bool = False) -> dict:
    """Tạo đặt chỗ CÓ ĐẶT CỌC qua VietQR MB Bank (hình thức duy nhất).
    Luôn tạo `pending_payment` (ô `pending_payment`) tối đa `pending_minutes` phút (Cài đặt, mặc định 10) để chờ tiền về.
    Tiền vào (webhook SePay) hoặc Bảo vệ duyệt tay -> `active` / ô `reserved`, giữ chỗ `hold_minutes` phút.
    """
    plate = normalize_plate(plate)
    phone = re.sub(r"[^\d+]", "", phone)
    if len(phone) < 8:
        fail("Số điện thoại không hợp lệ")
    cfg = get_settings()
    with Tx() as db:
        slot = get_slot(db, slot_code)
        if slot["status"] != "available" or not slot.get("active", 1):
            fail(f"Ô {slot['code']} không còn trống")
        if db.execute(f"SELECT 1 FROM reservations WHERE license_plate = ? AND status IN {HOLD_STATUSES}", (plate,)).fetchone():
            fail(f"Xe {plate} đã có đặt chỗ đang giữ")
        if db.execute("SELECT 1 FROM parking_sessions WHERE license_plate = ? AND status = 'parked'", (plate,)).fetchone():
            fail(f"Xe {plate} đang đỗ trong bãi")

        # Mã vé: dùng mã đã hiện trong nội dung chuyển khoản nếu hợp lệ & chưa dùng
        code = (ticket_code or "").strip().upper()
        if not (len(code) == 6 and all(c in TICKET_ALPHABET for c in code)
                and not db.execute("SELECT 1 FROM reservations WHERE ticket_code = ?", (code,)).fetchone()):
            code = new_ticket_code(db)

        created = now()
        free = bool(free and _is_admin(db, user_id))
        if free:  # Admin: bỏ qua VietQR/SePay, khóa ô & cấp vé ngay, cọc 0đ
            amount, paid, status, mode = 0, 1, "active", FREE_MODE
            expires = created + timedelta(minutes=cfg["hold_minutes"])
        else:
            amount, paid, status, mode = cfg["deposit_amount"], 0, "pending_payment", "deposit"
            expires = created + timedelta(minutes=cfg["pending_minutes"])
        cur = db.execute(
            """INSERT INTO reservations (slot_id, license_plate, customer_name, phone, deposit_amount,
               deposit_paid, status, created_at, expires_at, user_id, ticket_code, deposit_mode)
               VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)""",
            (slot["id"], plate, name.strip(), phone, amount, paid, status,
             created.isoformat(timespec="seconds"), expires.isoformat(timespec="seconds"), user_id, code, mode),
        )
        rid = cur.lastrowid
        db.execute("UPDATE slots SET status = ? WHERE id = ?", (res_slot_status({"status": status}), slot["id"]))
        if user_id:
            # Tự lưu Tên, SĐT, Biển số gần nhất để lần sau form đặt chỗ điền sẵn
            db.execute("UPDATE users SET full_name = ?, phone = ?, default_plate = ? WHERE id = ?",
                       (name.strip(), phone, plate, user_id))
        if free:
            desc, action = f"miễn phí (Admin) — giữ chỗ {cfg['hold_minutes']} phút", "reservation_free"
        else:
            desc, action = f"cọc {amount:,}đ — chờ chuyển khoản (tối đa {cfg['pending_minutes']} phút)", "reservation_pending"
        log(db, "web", "reservation", f"{plate} đặt ô {slot['code']}, {desc} (vé {code})")
        log_activity(db, user_id, _user_email(db, user_id), action, f"Ô {slot['code']} · {plate} · vé {code} · {desc}")
    return get_reservation(rid)


def cleanup_legacy_soft_holds() -> list[str]:
    """Đã bỏ tính năng đặt chỗ không cọc: khi khởi động, hủy vé không cọc còn đang giữ và trả ô `soft_reserved` về trống."""
    freed = []
    with Tx() as db:
        for r in db.execute(
            """SELECT r.id, r.user_id, r.license_plate, r.ticket_code, s.code FROM reservations r JOIN slots s ON s.id = r.slot_id
               WHERE r.status = 'active' AND r.deposit_mode = 'none'"""
        ).fetchall():
            db.execute("UPDATE reservations SET status = 'cancelled' WHERE id = ?", (r["id"],))
            if r["user_id"]:
                log_activity(db, r["user_id"], _user_email(db, r["user_id"]), "reservation_cancel",
                             f"Ô {r['code']} · {r['license_plate']} · vé {r['ticket_code']} — hủy do bãi ngừng hình thức đặt chỗ không cọc")
        for s in db.execute("SELECT id, code FROM slots WHERE status = 'soft_reserved'").fetchall():
            db.execute("UPDATE slots SET status = 'available' WHERE id = ?", (s["id"],))
            freed.append(s["code"])
        if freed:
            log(db, "system", "legacy_cleanup", f"Trả ô giữ tạm (không cọc) về trống: {', '.join(freed)}")
    return freed


def activate_reservation_tx(db, r, via: str = "manual", admin: dict | None = None, allow_reopen: bool = False) -> None:
    """(Trong transaction đang mở) xác nhận đã nhận tiền cọc -> `active`, khóa cứng ô, giữ chỗ `hold_minutes` phút.
    via = 'sepay' (webhook tự động) | 'manual' (Bảo vệ duyệt) | 'reconcile' (duyệt bù khi đối soát).
    allow_reopen: cho phép mở lại vé đã hết hạn/hủy nếu ô vẫn trống (duyệt bù tiền về trễ)."""
    slot = db.execute("SELECT code, status FROM slots WHERE id = ?", (r["slot_id"],)).fetchone()
    if r["status"] == "pending_payment":
        pass
    elif allow_reopen and r["status"] in ("expired", "cancelled"):
        if slot["status"] != "available":
            fail(f"Ô {slot['code']} đã có khách khác — không thể duyệt bù vé {r['ticket_code']}, hãy hoàn tiền cho khách")
        if db.execute(f"SELECT 1 FROM reservations WHERE license_plate = ? AND status IN {HOLD_STATUSES} AND id != ?",
                      (r["license_plate"], r["id"])).fetchone():
            fail(f"Xe {r['license_plate']} đã có đặt chỗ khác đang giữ")
        if db.execute("SELECT 1 FROM parking_sessions WHERE license_plate = ? AND status = 'parked'", (r["license_plate"],)).fetchone():
            fail(f"Xe {r['license_plate']} đang đỗ trong bãi")
    elif r["status"] in ("active", "checked_in", "parked"):
        fail(f"Vé {r['ticket_code']} đã được xác nhận cọc trước đó")
    else:
        fail("Đặt chỗ này không ở trạng thái chờ chuyển khoản")
    cfg = get_settings()
    expires = (now() + timedelta(minutes=cfg["hold_minutes"])).isoformat(timespec="seconds")
    db.execute("UPDATE reservations SET status = 'active', deposit_paid = 1, expires_at = ? WHERE id = ?", (expires, r["id"]))
    db.execute("UPDATE slots SET status = 'reserved' WHERE id = ?", (r["slot_id"],))
    how = {"sepay": "tự động qua SePay", "manual": "Bảo vệ duyệt tay", "reconcile": "duyệt bù khi đối soát",
           "demo": "giả lập SePay (Bảng Demo — không tính doanh thu)"}.get(via, via)
    log(db, {"sepay": "sepay", "demo": "simulator"}.get(via, "admin"), "deposit_approve",
        f"Xác nhận cọc {r['deposit_amount']:,}đ vé {r['ticket_code']} ({r['license_plate']}) ô {slot['code']} — {how}")
    if admin:
        log_activity(db, admin["id"], admin["email"], "deposit_approve" if via == "manual" else "payment_reconcile",
                     f"{'Duyệt cọc' if via == 'manual' else 'Duyệt bù'} vé {r['ticket_code']} · {r['license_plate']} · ô {slot['code']}")
    if r["user_id"]:
        log_activity(db, r["user_id"], _user_email(db, r["user_id"]), "deposit_approved",
                     f"Tiền cọc {r['deposit_amount']:,}đ đã được xác nhận ({how}) · ô {slot['code']} · vé {r['ticket_code']}")


def approve_deposit(rid: int, admin: dict, via: str = "manual", allow_reopen: bool = False) -> dict:
    """Bảo vệ/Admin xác nhận đã nhận tiền cọc -> khóa cứng ô."""
    with Tx() as db:
        r = db.execute("SELECT * FROM reservations WHERE id = ?", (rid,)).fetchone()
        if not r:
            fail("Không tìm thấy đặt chỗ", 404)
        activate_reservation_tx(db, r, via=via, admin=admin, allow_reopen=allow_reopen)
    return get_reservation(rid)


def get_reservation(rid: int) -> dict:
    r = query_one(
        """SELECT r.*, s.code AS slot_code, s.floor FROM reservations r
           JOIN slots s ON s.id = r.slot_id WHERE r.id = ?""",
        (rid,),
    )
    if not r:
        fail("Không tìm thấy đặt chỗ", 404)
    return _reservation_view(r)


def list_active_reservations() -> list[dict]:
    rows = query(
        """SELECT r.*, s.code AS slot_code, s.floor FROM reservations r
           JOIN slots s ON s.id = r.slot_id WHERE r.status IN {HOLD_STATUSES}
           ORDER BY r.status = 'pending_payment' DESC, r.expires_at""".format(HOLD_STATUSES=HOLD_STATUSES)
    )
    return [_reservation_view(r) for r in rows]


def cancel_reservation(rid: int, user: dict | None = None) -> dict:
    """Hủy đặt chỗ. `user` = người yêu cầu (khách chỉ được hủy đặt chỗ của mình; admin hủy được tất cả)."""
    with Tx() as db:
        r = db.execute("SELECT * FROM reservations WHERE id = ?", (rid,)).fetchone()
        if not r:
            fail("Không tìm thấy đặt chỗ", 404)
        if user and user["role"] not in ("admin", "guard") and r["user_id"] != user["id"]:
            fail("Bạn không có quyền hủy đặt chỗ này", 403)
        if r["status"] not in HOLD_STATUSES:
            fail("Đặt chỗ này không còn hiệu lực")
        db.execute("UPDATE reservations SET status = 'cancelled' WHERE id = ?", (rid,))
        db.execute(f"UPDATE slots SET status = 'available' WHERE id = ? AND status IN {SLOT_HELD}", (r["slot_id"],))
        code = db.execute("SELECT code FROM slots WHERE id = ?", (r["slot_id"],)).fetchone()["code"]
        is_admin = bool(user and user["role"] in ("admin", "guard"))
        log(db, "admin" if is_admin else "web", "reservation_cancel", f"Hủy đặt chỗ #{rid} ({r['license_plate']}), trả ô về trống")
        details = f"Ô {code} · {r['license_plate']} · vé {r['ticket_code']} (cọc {r['deposit_amount']:,}đ, không hoàn)"
        if user:
            log_activity(db, user["id"], user["email"], "reservation_cancel", details)
        if r["user_id"] and (not user or user["id"] != r["user_id"]):
            log_activity(db, r["user_id"], _user_email(db, r["user_id"]), "reservation_cancel", details + " — bị Bảo vệ/Admin hủy")
    return get_reservation(rid)


def expire_reservations() -> list[str]:
    """Chuyển các đặt chỗ quá hạn thành expired, trả ô về available."""
    current = now()
    expired = []
    with Tx() as db:
        rows = db.execute(
            f"""SELECT r.id, r.slot_id, r.license_plate, r.expires_at, r.user_id, r.ticket_code, s.code FROM reservations r
               JOIN slots s ON s.id = r.slot_id WHERE r.status IN {HOLD_STATUSES}"""
        ).fetchall()
        for r in rows:
            if parse_dt(r["expires_at"]) < current:
                db.execute("UPDATE reservations SET status = 'expired' WHERE id = ?", (r["id"],))
                db.execute(f"UPDATE slots SET status = 'available' WHERE id = ? AND status IN {SLOT_HELD}", (r["slot_id"],))
                log(db, "system", "reservation_expired", f"Hết hạn giữ chỗ {r['code']} ({r['license_plate']})")
                if r["user_id"]:
                    log_activity(db, r["user_id"], _user_email(db, r["user_id"]), "reservation_expired",
                                 f"Ô {r['code']} · {r['license_plate']} · vé {r['ticket_code']} — quá giờ giữ chỗ")
                expired.append(r["code"])
    return expired


def shift_reservation(rid: int, minutes: float) -> dict:
    """Giả lập trôi thời gian: kéo expires_at sớm hơn `minutes` phút."""
    with Tx() as db:
        r = db.execute(f"SELECT * FROM reservations WHERE id = ? AND status IN {HOLD_STATUSES}", (rid,)).fetchone()
        if not r:
            fail("Đặt chỗ không còn hiệu lực", 404)
        new_exp = parse_dt(r["expires_at"]) - timedelta(minutes=minutes)
        db.execute("UPDATE reservations SET expires_at = ? WHERE id = ?", (new_exp.isoformat(timespec="seconds"), rid))
        log(db, "simulator", "time_shift", f"Tua nhanh {minutes:g} phút cho đặt chỗ #{rid}")
    return get_reservation(rid)


# ---------------------------------------------------------------- Check-in
def check_in(raw_plate: str, source: str = "web") -> dict:
    plate = normalize_plate(raw_plate)
    gate_dist = mapcfg.route_length_from_gate(mapcfg.get_config())  # đọc trước khi mở transaction
    with Tx() as db:
        if db.execute("SELECT 1 FROM parking_sessions WHERE license_plate = ? AND status = 'parked'", (plate,)).fetchone():
            fail(f"Xe {plate} đã ở trong bãi")
        pending = db.execute(
            "SELECT ticket_code FROM reservations WHERE license_plate = ? AND status = 'pending_payment'", (plate,)
        ).fetchone()
        if pending:
            log(db, source, "gate_denied", f"Xe {plate}: vé {pending['ticket_code']} chưa nhận được tiền cọc")
            fail(f"Xe {plate} (vé {pending['ticket_code']}) chưa nhận được tiền cọc — chưa thể vào cổng. "
                 "Chờ hệ thống xác nhận chuyển khoản, hoặc Bảo vệ kiểm tra app ngân hàng rồi bấm Duyệt cọc", 409)
        res = db.execute(
            """SELECT r.*, s.code FROM reservations r JOIN slots s ON s.id = r.slot_id
               WHERE r.license_plate = ? AND r.status = 'active'""",
            (plate,),
        ).fetchone()
        waived = False
        if res:
            slot_id, slot_code = res["slot_id"], res["code"]
            entry_type, deposit = "reservation", res["deposit_amount"] if res["deposit_paid"] else 0
            db.execute("UPDATE reservations SET status = 'checked_in' WHERE id = ?", (res["id"],))
            reservation_id, user_id = res["id"], res["user_id"]
            waived = res["deposit_mode"] == FREE_MODE
        else:
            # Xe vãng lai: ô trống gần cổng vào nhất theo lối đi, ưu tiên tầng thấp (Tầng 1 trước)
            free = db.execute("SELECT * FROM slots WHERE status = 'available' AND active = 1").fetchall()
            slot = min(free, key=lambda r: (r["floor"], gate_dist.get(r["code"], math.inf), r["code"])) if free else None
            if not slot:
                log(db, source, "gate_denied", f"Bãi đầy — từ chối xe {plate}")
                fail("Bãi xe đã hết chỗ trống", 409)
            slot_id, slot_code = slot["id"], slot["code"]
            entry_type, deposit, reservation_id, user_id = "walk_in", 0, None, None
        db.execute("UPDATE slots SET status = 'occupied' WHERE id = ?", (slot_id,))
        act_uid, act_email = owner_of_plate(db, plate, user_id)
        # Miễn phí nếu là đặt chỗ miễn phí của Admin hoặc xe thuộc tài khoản Admin
        waived = waived or _is_admin(db, user_id or act_uid)
        cur = db.execute(
            """INSERT INTO parking_sessions (slot_id, license_plate, entry_type, reservation_id, check_in_time,
               deposit_deducted, payment_status, status, user_id, fee_waived)
               VALUES (?, ?, ?, ?, ?, ?, 'pending', 'parked', ?, ?)""",
            (slot_id, plate, entry_type, reservation_id, now_iso(), deposit, user_id or act_uid, int(waived)),
        )
        kind = ("đặt trước" if entry_type == "reservation" else "vãng lai") + (" · miễn phí Admin" if waived else "")
        log(db, source, "check_in", f"Xe {plate} ({kind}) vào ô {slot_code}")
        if act_uid:
            log_activity(db, act_uid, act_email, "check_in", f"Xe {plate} vào ô {slot_code} ({kind})")
        sid = cur.lastrowid
    floor = int(slot_code[1])
    return {
        "session": get_session(sid),
        "entry_type": entry_type,
        "slot_code": slot_code,
        "floor": floor,
        "directions": directions(slot_code, floor),
        "message": f"Xe {plate} ({kind}) → ô {slot_code}",
    }


def check_in_by_ticket(raw: str, source: str = "admin") -> dict:
    """Check-in bằng mã vé ngắn (VD: 7K3QX9 / SP-7K3QX9) hoặc toàn bộ nội dung QR vé."""
    m = TICKET_RE.search((raw or "").strip().upper())
    if not m:
        fail("Mã vé không hợp lệ (gồm 6 ký tự, VD: 7K3QX9)")
    code = m.group(1)
    r = query_one("SELECT * FROM reservations WHERE ticket_code = ?", (code,))
    if not r:
        fail(f"Không tìm thấy vé {code}", 404)
    if r["status"] != "active":
        msg = {"checked_in": "đã được dùng để vào bãi", "parked": "đã được dùng để vào bãi", "expired": "đã hết hạn", "cancelled": "đã bị hủy",
               "pending_payment": "chưa nhận được tiền cọc — chờ xác nhận chuyển khoản hoặc kiểm tra app ngân hàng rồi bấm Duyệt cọc"}.get(r["status"], r["status"])
        fail(f"Vé {code} {msg}")
    result = check_in(r["license_plate"], source=source)
    result["ticket_code"] = code
    return result


def user_history(user_id: int) -> dict:
    """Lịch sử đặt chỗ + lượt gửi xe/hóa đơn của một tài khoản."""
    reservations = [
        _reservation_view(r) for r in query(
            """SELECT r.*, s.code AS slot_code, s.floor,
                      (SELECT status FROM payment_receipts pr WHERE pr.reservation_id = r.id ORDER BY pr.id DESC LIMIT 1) AS receipt_status
               FROM reservations r JOIN slots s ON s.id = r.slot_id
               WHERE r.user_id = ? ORDER BY r.id DESC LIMIT 50""", (user_id,))
    ]
    rate = get_settings()["hourly_rate"]
    sessions = [
        _session_view(s, rate) for s in query(
            SESSION_SQL + """ WHERE p.user_id = ? OR p.license_plate IN
               (SELECT license_plate FROM reservations WHERE user_id = ?) ORDER BY p.id DESC LIMIT 50""",
            (user_id, user_id))
    ]
    return {"reservations": reservations, "sessions": sessions}


# ---------------------------------------------------------------- Tính tiền
def _quote(s: dict, rate: int, free_minutes: int | None = None) -> dict:
    """Miễn phí `free_minutes` phút đầu (Cài đặt, mặc định 15); quá thời gian đó tính theo block giờ, làm tròn lên (tối thiểu 1 giờ)."""
    if free_minutes is None:
        free_minutes = get_settings()["free_minutes"]
    seconds = (now() - parse_dt(s["check_in_time"])).total_seconds()
    hours = 0 if seconds <= free_minutes * 60 else max(1, math.ceil(seconds / 3600))
    if s.get("fee_waived"):  # Admin: miễn phí
        return {"parked_seconds": int(max(0, seconds)), "hours_billed": hours, "total_fee": 0, "amount_due": 0, "free": True}
    total = hours * rate
    # còn phải trả = tổng phí tới hiện tại − tiền cọc − số tiền đã thanh toán trước
    due = max(0, total - (s["deposit_deducted"] or 0) - (s.get("prepaid_amount") or 0))
    return {"parked_seconds": int(max(0, seconds)), "hours_billed": hours, "total_fee": total, "amount_due": due}


def _refresh_waiver(db, s):
    """Xe của tài khoản Admin (kể cả lượt vào trước khi có quy tắc miễn phí) -> đánh dấu miễn phí. Trả về row mới."""
    if not s["fee_waived"] and _is_admin(db, s["user_id"]):
        db.execute("UPDATE parking_sessions SET fee_waived = 1 WHERE id = ?", (s["id"],))
        return db.execute("SELECT * FROM parking_sessions WHERE id = ?", (s["id"],)).fetchone()
    return s


def _session_view(s: dict, rate: int) -> dict:
    s = dict(s)
    if s["status"] == "parked":
        s["quote"] = _quote(s, rate)
        s["at_gate"] = bool(s.get("check_out_time")) and s["payment_status"] == "pending"
        if s["payment_status"] == "paid_ready" and s.get("exit_deadline"):
            s["exit_remaining_seconds"] = max(0, int((parse_dt(s["exit_deadline"]) - now()).total_seconds()))
    return s


SESSION_SQL = """SELECT p.*, s.code AS slot_code, s.floor FROM parking_sessions p
                 JOIN slots s ON s.id = p.slot_id"""


def get_session(sid: int) -> dict:
    s = query_one(SESSION_SQL + " WHERE p.id = ?", (sid,))
    if not s:
        fail("Không tìm thấy lượt gửi xe", 404)
    return _session_view(s, get_settings()["hourly_rate"])


def list_parked() -> list[dict]:
    rate = get_settings()["hourly_rate"]
    return [_session_view(s, rate) for s in query(SESSION_SQL + " WHERE p.status = 'parked' ORDER BY p.check_in_time")]


def list_history(limit: int = 30) -> list[dict]:
    return query(SESSION_SQL + " WHERE p.status = 'completed' ORDER BY p.check_out_time DESC LIMIT ?", (limit,))


def find_parked_by_plate(raw_plate: str) -> dict | None:
    plate = normalize_plate(raw_plate)
    s = query_one(SESSION_SQL + " WHERE p.license_plate = ? AND p.status = 'parked'", (plate,))
    return _session_view(s, get_settings()["hourly_rate"]) if s else None


def checkout_quote(sid: int, source: str = "web") -> dict:
    """Bắt đầu check-out: chốt giờ ra + số tiền phải trả (chờ thanh toán)."""
    rate = get_settings()["hourly_rate"]
    with Tx() as db:
        s = db.execute("SELECT * FROM parking_sessions WHERE id = ?", (sid,)).fetchone()
        if not s or s["status"] != "parked":
            fail("Xe không ở trạng thái đang đỗ", 404)
        s = _refresh_waiver(db, s)
        q = _quote(dict(s), rate)
        db.execute(
            """UPDATE parking_sessions SET check_out_time = ?, hours_billed = ?, total_fee = ?, amount_due = ?
               WHERE id = ?""",
            (now_iso(), q["hours_billed"], q["total_fee"], q["amount_due"], sid),
        )
        log(db, source, "checkout_quote",
            f"Xe {s['license_plate']}: {q['hours_billed']} giờ, phí {q['total_fee']:,}đ, còn phải trả {q['amount_due']:,}đ")
    return get_session(sid)


def pay_tx(db, s, method: str, source: str, q: dict | None = None) -> None:
    """(Trong transaction đang mở) hoàn tất lượt gửi đang đỗ `s`, trả ô. `q` = số liệu tính tiền chốt sẵn (nếu có)."""
    if s["status"] != "parked":
        fail("Lượt gửi xe này đã được thanh toán")
    s = _refresh_waiver(db, s)
    if s["fee_waived"]:  # Admin miễn phí: 0đ, không cộng vào doanh thu tiền mặt/online
        method, q = FREE_METHOD, _quote(dict(s), 0)
    q = q or _quote(dict(s), get_settings()["hourly_rate"])
    db.execute(
        """UPDATE parking_sessions SET check_out_time = ?, hours_billed = ?, total_fee = ?, amount_due = ?,
           payment_method = ?, payment_status = 'paid', status = 'completed' WHERE id = ?""",
        (now_iso(), q["hours_billed"], q["total_fee"], q["amount_due"], method, s["id"]),
    )
    db.execute("UPDATE slots SET status = 'available' WHERE id = ?", (s["slot_id"],))
    label = PAY_LABELS.get(method, method)
    if source == "sepay":
        label += " · SePay tự xác nhận"
    slot_code = db.execute("SELECT code FROM slots WHERE id = ?", (s["slot_id"],)).fetchone()["code"]
    log(db, source, "payment", f"Xe {s['license_plate']} thanh toán {q['amount_due']:,}đ ({label}), trả ô {slot_code}")
    act_uid, act_email = owner_of_plate(db, s["license_plate"], s["user_id"])
    if act_uid:
        log_activity(db, act_uid, act_email, "check_out",
                     f"Xe {s['license_plate']} ra khỏi ô {slot_code} · {q['hours_billed']} giờ · trả {q['amount_due']:,}đ ({label})")


PAY_LABELS = {"online_qr": "Online QR", "cash": "Tiền mặt", FREE_METHOD: "Miễn phí (Admin)",
              "deposit": "Đã trừ đủ bằng tiền cọc", "free_period": "Miễn phí thời gian đầu", "demo": "Giả lập SePay (Demo)"}


def free_exit(sid: int, source: str) -> dict | None:
    """Lượt gửi miễn phí (Admin): chốt 0đ, `paid`, hoàn tất luôn. Trả về session đã hoàn tất, hoặc None nếu không miễn phí."""
    with Tx() as db:
        s = db.execute("SELECT * FROM parking_sessions WHERE id = ?", (sid,)).fetchone()
        if not s or s["status"] != "parked":
            return None
        s = _refresh_waiver(db, s)
        if not s["fee_waived"]:
            return None
        pay_tx(db, s, FREE_METHOD, source)
    return get_session(sid)


# ---------------------------------------------------------------- Thanh toán trước khi ra cổng
PREPAY_LOCK_MINUTES = 15  # số tiền trên VietQR được giữ nguyên trong 15 phút kể từ lúc khách bấm thanh toán trước


def _deadline_passed(s) -> bool:
    return not s["exit_deadline"] or parse_dt(s["exit_deadline"]) < now()


def mark_prepaid_tx(db, s, method: str, q: dict, paid: int, source: str) -> None:
    """(Trong transaction) đã trả trước `paid` đồng -> `paid_ready`, hạn ra cổng = now + exit_grace_minutes."""
    grace = get_settings()["exit_grace_minutes"]
    deadline = (now() + timedelta(minutes=grace)).isoformat(timespec="seconds")
    total_paid = (s["prepaid_amount"] or 0) + paid
    db.execute(
        """UPDATE parking_sessions SET payment_status = 'paid_ready', prepaid_amount = ?, prepay_method = ?, prepaid_at = ?,
           exit_deadline = ?, prepaid_hours = ?, prepaid_total = ?, prepay_due = NULL, prepay_requested_at = NULL WHERE id = ?""",
        (total_paid, method, now_iso(), deadline, q["hours_billed"],
         q["total_fee"] if q["amount_due"] <= paid else total_paid + (s["deposit_deducted"] or 0), s["id"]),
    )
    label = {"online_qr": "Online QR", "cash": "Tiền mặt (Bảo vệ thu hộ)", FREE_METHOD: "Miễn phí (Admin)",
             "deposit": "Đã trừ đủ bằng tiền cọc"}.get(method, method)
    slot_code = db.execute("SELECT code FROM slots WHERE id = ?", (s["slot_id"],)).fetchone()["code"]
    log(db, source, "prepay", f"Xe {s['license_plate']} (ô {slot_code}) thanh toán trước {paid:,}đ ({label}) — sẵn sàng ra cổng trong {grace} phút")
    act_uid, act_email = owner_of_plate(db, s["license_plate"], s["user_id"])
    if act_uid:
        log_activity(db, act_uid, act_email, "prepay",
                     f"Xe {s['license_plate']} thanh toán trước {paid:,}đ ({label}) · ra cổng trước {deadline[11:16]}")


def request_prepay(sid: int) -> dict:
    """Khách bấm 'Thanh toán để chuẩn bị ra cổng'. Phí = 0 -> `paid_ready` ngay; > 0 -> ghi số tiền VietQR (`prepay_due`)."""
    with Tx() as db:
        s = db.execute("SELECT * FROM parking_sessions WHERE id = ?", (sid,)).fetchone()
        if not s or s["status"] != "parked":
            fail("Xe không ở trạng thái đang đỗ", 404)
        s = _refresh_waiver(db, s)
        still_valid = s["payment_status"] == "paid_ready" and not _deadline_passed(s)
        if not still_valid:
            q = _quote(dict(s), get_settings()["hourly_rate"])
            if q["amount_due"] == 0:
                method = FREE_METHOD if s["fee_waived"] else (s["prepay_method"] or "deposit")
                mark_prepaid_tx(db, s, method, q, 0, "web")
            else:
                db.execute("UPDATE parking_sessions SET prepay_due = ?, prepay_requested_at = ? WHERE id = ?",
                           (q["amount_due"], now_iso(), sid))
    return get_session(sid)


def confirm_prepay(sid: int, method: str, admin: dict) -> dict:
    """Bảo vệ xác nhận thu hộ phí trước khi xe ra cổng (tiền mặt / đã kiểm tra app ngân hàng)."""
    with Tx() as db:
        s = db.execute("SELECT * FROM parking_sessions WHERE id = ?", (sid,)).fetchone()
        if not s or s["status"] != "parked":
            fail("Xe không ở trạng thái đang đỗ", 404)
        if s["payment_status"] == "paid_ready" and not _deadline_passed(s):
            fail("Xe này đã thanh toán trước và còn trong hạn ra cổng")
        s = _refresh_waiver(db, s)
        q = _quote(dict(s), get_settings()["hourly_rate"])
        mark_prepaid_tx(db, s, FREE_METHOD if s["fee_waived"] else method, q, q["amount_due"], "admin")
        log_activity(db, admin["id"], admin["email"], "prepay", f"Thu hộ {q['amount_due']:,}đ xe {s['license_plate']} ({method})")
    return get_session(sid)


def _complete_prepaid_tx(db, s, q: dict, on_time: bool, source: str) -> None:
    """Xe đã trả trước tới cổng ra -> hoàn tất (không thu thêm), trả ô."""
    hours = s["prepaid_hours"] if on_time and s["prepaid_hours"] else q["hours_billed"]
    total = s["prepaid_total"] if on_time and s["prepaid_total"] is not None else q["total_fee"]
    db.execute(
        """UPDATE parking_sessions SET check_out_time = ?, hours_billed = ?, total_fee = ?, amount_due = 0,
           payment_method = ?, payment_status = 'paid', status = 'completed' WHERE id = ?""",
        (now_iso(), hours, total, s["prepay_method"] or "deposit", s["id"]),
    )
    db.execute("UPDATE slots SET status = 'available' WHERE id = ?", (s["slot_id"],))
    slot_code = db.execute("SELECT code FROM slots WHERE id = ?", (s["slot_id"],)).fetchone()["code"]
    log(db, source, "auto_exit", f"Camera cổng ra: xe {s['license_plate']} đã thanh toán trước {s['prepaid_amount']:,}đ "
                                 f"→ mở barrier, trả ô {slot_code}")
    act_uid, act_email = owner_of_plate(db, s["license_plate"], s["user_id"])
    if act_uid:
        log_activity(db, act_uid, act_email, "check_out",
                     f"Xe {s['license_plate']} ra khỏi ô {slot_code} · {hours} giờ · đã trả trước {s['prepaid_amount']:,}đ")


def exit_gate(sid: int, source: str) -> dict:
    """Xe tới cổng ra (camera ALPR / ESP32 / nút Check-out). Trả về {'action', 'session'}:
    - auto_open: đã trả trước & còn hạn (hoặc quá hạn nhưng không phát sinh thêm) -> hoàn tất, mở barrier.
    - late_fee: quá hạn ra cổng -> chặn, tính phí phát sinh thêm (tổng phí − cọc − đã trả trước).
    - await_payment: chưa thanh toán -> chặn, hóa đơn chờ thanh toán tại cổng."""
    rate = get_settings()["hourly_rate"]
    with Tx() as db:
        s = db.execute("SELECT * FROM parking_sessions WHERE id = ?", (sid,)).fetchone()
        if not s or s["status"] != "parked":
            fail("Xe không ở trạng thái đang đỗ", 404)
        s = _refresh_waiver(db, s)
        q = _quote(dict(s), rate)
        if s["payment_status"] == "paid_ready":
            on_time = not _deadline_passed(s)
            if on_time or q["amount_due"] == 0:
                _complete_prepaid_tx(db, s, q, on_time, source)
                action = "auto_open"
            else:
                action = "late_fee"
                log(db, source, "late_exit", f"Xe {s['license_plate']} ra quá hạn (hạn {s['exit_deadline'][11:16]}): "
                                             f"phí phát sinh thêm {q['amount_due']:,}đ — chặn barrier")
        elif q["amount_due"] == 0:
            # Phí <= tiền cọc (hoặc trong thời gian miễn phí) -> chốt hoàn tất, mở barrier ngay
            pay_tx(db, s, "deposit" if (s["deposit_deducted"] or 0) > 0 else "free_period", source, q)
            action = "auto_open"
        else:
            action = "await_payment"
            log(db, source, "checkout_quote",
                f"Xe {s['license_plate']}: {q['hours_billed']} giờ, phí {q['total_fee']:,}đ, còn phải trả {q['amount_due']:,}đ — chặn barrier")
        if action != "auto_open":
            db.execute(
                """UPDATE parking_sessions SET check_out_time = ?, hours_billed = ?, total_fee = ?, amount_due = ?,
                   payment_status = 'pending' WHERE id = ?""",
                (now_iso(), q["hours_billed"], q["total_fee"], q["amount_due"], sid),
            )
    return {"action": action, "session": get_session(sid), "extra": q["amount_due"] if action == "late_fee" else None}


def shift_exit_deadline(sid: int, minutes: float) -> dict:
    """Giả lập trôi thời gian sau khi thanh toán trước."""
    with Tx() as db:
        s = db.execute("SELECT * FROM parking_sessions WHERE id = ? AND payment_status = 'paid_ready'", (sid,)).fetchone()
        if not s:
            fail("Xe chưa thanh toán trước", 404)
        new_dl = parse_dt(s["exit_deadline"]) - timedelta(minutes=minutes)
        db.execute("UPDATE parking_sessions SET exit_deadline = ? WHERE id = ?", (new_dl.isoformat(timespec="seconds"), sid))
        log(db, "simulator", "time_shift", f"Tua nhanh {minutes:g} phút hạn ra cổng của xe {s['license_plate']}")
    return get_session(sid)


def quote_session(s) -> dict:
    return _quote(dict(s), get_settings()["hourly_rate"])


def pay(sid: int, method: str, source: str = "web") -> dict:
    """Xác nhận thanh toán (online_qr | cash) -> hoàn tất lượt gửi, trả ô."""
    with Tx() as db:
        s = db.execute("SELECT * FROM parking_sessions WHERE id = ?", (sid,)).fetchone()
        if not s:
            fail("Không tìm thấy lượt gửi xe", 404)
        pay_tx(db, s, method, source)
    return get_session(sid)


def shift_session(sid: int, hours: float) -> dict:
    """Giả lập trôi thời gian: lùi giờ vào thêm `hours` giờ."""
    with Tx() as db:
        s = db.execute("SELECT * FROM parking_sessions WHERE id = ? AND status = 'parked'", (sid,)).fetchone()
        if not s:
            fail("Xe không ở trạng thái đang đỗ", 404)
        new_in = parse_dt(s["check_in_time"]) - timedelta(hours=hours)
        db.execute("UPDATE parking_sessions SET check_in_time = ? WHERE id = ?", (new_in.isoformat(timespec="seconds"), sid))
        log(db, "simulator", "time_shift", f"Cộng thêm {hours:g} giờ cho xe {s['license_plate']}")
    return get_session(sid)


# ---------------------------------------------------------------- Cảm biến
def apply_sensor(slot_code: str, occupied: bool) -> dict:
    with Tx() as db:
        slot = get_slot(db, slot_code)
        if occupied:
            new_status = "occupied"
        else:
            parked = db.execute(
                "SELECT 1 FROM parking_sessions WHERE slot_id = ? AND status = 'parked'", (slot["id"],)
            ).fetchone()
            held = db.execute(
                f"SELECT status FROM reservations WHERE slot_id = ? AND status IN {HOLD_STATUSES}", (slot["id"],)
            ).fetchone()
            # Nếu vẫn còn lượt gửi chưa thanh toán thì giữ occupied để không mất vé
            new_status = "occupied" if parked else (res_slot_status(held) if held else "available")
        db.execute("UPDATE slots SET status = ? WHERE id = ?", (new_status, slot["id"]))
        log(db, "esp32", "sensor", f"Cảm biến {slot['code']}: {'CÓ XE' if occupied else 'TRỐNG'} → {new_status}")
    return {"slot_code": slot["code"], "status": new_status}


# ---------------------------------------------------------------- Thống kê
def stats() -> dict:
    def scalar(sql, params=()):
        row = query_one(sql, params)
        return list(row.values())[0] or 0 if row else 0

    today = now().date().isoformat()
    return {
        # Doanh thu = phần trả tại cổng (amount_due theo payment_method) + phần trả trước (prepaid_amount theo prepay_method)
        "revenue_online": scalar("SELECT SUM(amount_due) FROM parking_sessions WHERE payment_status='paid' AND payment_method='online_qr'")
                          + scalar("SELECT SUM(prepaid_amount) FROM parking_sessions WHERE prepay_method='online_qr'"),
        "revenue_cash": scalar("SELECT SUM(amount_due) FROM parking_sessions WHERE payment_status='paid' AND payment_method='cash'")
                        + scalar("SELECT SUM(prepaid_amount) FROM parking_sessions WHERE prepay_method='cash'"),
        "count_prepaid": scalar("SELECT COUNT(*) FROM parking_sessions WHERE prepaid_at IS NOT NULL"),
        # Cọc giả lập từ Bảng Demo (deposit_mode = 'demo') không tính vào doanh thu
        "revenue_deposit": scalar("SELECT SUM(deposit_amount) FROM reservations WHERE deposit_paid=1 AND deposit_mode != 'demo'"),
        "deposit_forfeited": scalar("SELECT SUM(deposit_amount) FROM reservations WHERE deposit_paid=1 AND deposit_mode != 'demo' AND status IN ('expired','cancelled')"),
        "count_paid_online": scalar("SELECT COUNT(*) FROM parking_sessions WHERE payment_method='online_qr'"),
        "count_paid_cash": scalar("SELECT COUNT(*) FROM parking_sessions WHERE payment_method='cash'"),
        "count_free": scalar(f"SELECT COUNT(*) FROM parking_sessions WHERE payment_method='{FREE_METHOD}'"),
        "total_sessions": scalar("SELECT COUNT(*) FROM parking_sessions"),
        "sessions_today": scalar("SELECT COUNT(*) FROM parking_sessions WHERE substr(check_in_time,1,10)=?", (today,)),
        "parked_now": scalar("SELECT COUNT(*) FROM parking_sessions WHERE status='parked'"),
        "walk_in": scalar("SELECT COUNT(*) FROM parking_sessions WHERE entry_type='walk_in'"),
        "reservation_entries": scalar("SELECT COUNT(*) FROM parking_sessions WHERE entry_type='reservation'"),
        "reservations_total": scalar("SELECT COUNT(*) FROM reservations"),
        "reservations_expired": scalar("SELECT COUNT(*) FROM reservations WHERE status='expired'"),
    }


def public_state() -> dict:
    slots = query("SELECT id, code, floor, status FROM slots WHERE active = 1 ORDER BY floor, code")
    cfg = get_settings()
    summary = {}
    for f in sorted({s["floor"] for s in slots}):
        fs = [s for s in slots if s["floor"] == f]
        summary[f] = {
            "total": len(fs),
            "available": sum(s["status"] == "available" for s in fs),
            "reserved": sum(s["status"] in ("reserved", "pending_payment") for s in fs),
            "occupied": sum(s["status"] == "occupied" for s in fs),
        }
    pub_keys = ("hold_minutes", "deposit_amount", "hourly_rate", "exit_grace_minutes", "free_minutes", "pending_minutes") + CONTACT_KEYS
    return {
        "slots": slots,
        "summary": summary,
        "floors": sorted(summary),
        "db_engine": db_kind(),  # 'sqlite' (Local) | 'postgresql' (Neon) — trang web hiện huy hiệu [LOCAL SQLITE]
        "settings": {**{k: cfg[k] for k in pub_keys}, "auto_gate": cfg["auto_gate"],
                     "sepay_enabled": bool(cfg["sepay_api_key"].strip() or os.environ.get("SEPAY_API_KEY", "").strip())},
        "server_time": now_iso(),
    }


# ---------------------------------------------------------------- v3: Xác nhận đã vào ô / Đổi ô 1 chạm
WRONG_SLOT_WINDOW_MINUTES = 20  # xe vừa qua cổng trong khoảng này mà chưa xác nhận đỗ -> theo dõi đỗ nhầm ô


def _can_manage(db, user: dict | None, user_id) -> bool:
    if user is None:  # gọi nội bộ (cảm biến)
        return True
    if user["role"] in ("guard", "admin"):
        return True
    return bool(user_id) and user_id == user["id"]


def session_for_reservation(rid: int) -> dict:
    r = query_one("SELECT * FROM reservations WHERE id = ?", (rid,))
    if not r:
        fail("Không tìm thấy đặt chỗ", 404)
    s = query_one("SELECT id FROM parking_sessions WHERE reservation_id = ? AND status = 'parked'", (rid,))
    return {"reservation": r, "session_id": s["id"] if s else None}


def confirm_parked(sid: int, user: dict | None, source: str = "web") -> dict:
    """Xe đã đỗ đúng ô: lượt gửi `parked_confirmed_at`, đặt chỗ -> `parked` (`parked_at`), ô -> `occupied`."""
    with Tx() as db:
        s = db.execute("SELECT * FROM parking_sessions WHERE id = ?", (sid,)).fetchone()
        if not s or s["status"] != "parked":
            fail("Xe không ở trạng thái đang đỗ trong bãi", 404)
        res = db.execute("SELECT * FROM reservations WHERE id = ?", (s["reservation_id"],)).fetchone() if s["reservation_id"] else None
        owner = s["user_id"] or (res["user_id"] if res else None)
        if not _can_manage(db, user, owner):
            fail("Bạn không có quyền xác nhận lượt gửi xe này", 403)
        stamp = now_iso()
        slot_code = db.execute("SELECT code FROM slots WHERE id = ?", (s["slot_id"],)).fetchone()["code"]
        if not s["parked_confirmed_at"]:
            db.execute("UPDATE parking_sessions SET parked_confirmed_at = ? WHERE id = ?", (stamp, sid))
            db.execute("UPDATE slots SET status = 'occupied' WHERE id = ?", (s["slot_id"],))
            if res and res["status"] in ("checked_in", "parked"):
                db.execute("UPDATE reservations SET status = 'parked', parked_at = ? WHERE id = ?", (stamp, res["id"]))
            who = {"sensor": "cảm biến IR tự xác nhận", "web": "khách xác nhận"}.get(source, "Bảo vệ/Admin xác nhận")
            log(db, "esp32" if source == "sensor" else ("web" if source == "web" else "admin"), "slot_confirmed",
                f"Xe {s['license_plate']} đã đỗ vào ô {slot_code} ({who})")
            act_uid, act_email = owner_of_plate(db, s["license_plate"], owner)
            if act_uid:
                log_activity(db, act_uid, act_email, "slot_confirmed", f"Xe {s['license_plate']} đã đỗ vào ô {slot_code} ({who})")
    out = get_session(sid)
    out["reservation_id"] = s["reservation_id"]
    return out


def _slot_free_for_switch(db, slot) -> bool:
    """Ô nhận xe khi đổi: đang trống, hoặc chỉ bị cảm biến IR báo có xe (chính xe đang đỗ nhầm) mà không có lượt gửi / đặt chỗ nào."""
    if not slot.get("active", 1):
        return False
    if slot["status"] == "available":
        return True
    if slot["status"] != "occupied":
        return False
    busy = db.execute("SELECT 1 FROM parking_sessions WHERE slot_id = ? AND status = 'parked'", (slot["id"],)).fetchone() \
        or db.execute(f"SELECT 1 FROM reservations WHERE slot_id = ? AND status IN {HOLD_STATUSES}", (slot["id"],)).fetchone()
    return not busy


def switch_slot(new_code: str, user: dict | None, *, rid: int | None = None, sid: int | None = None,
                floor: int | None = None, source: str = "web") -> dict:
    """Đổi ô 1 chạm (atomic): ô mới phải trống -> khóa ô mới cho đơn/lượt gửi, trả ô cũ về trống.
    - Đơn chưa qua cổng (pending_payment/active): chuyển giữ chỗ sang ô mới.
    - Xe đã qua cổng (lượt gửi đang đỗ): chuyển lượt gửi + đơn sang ô mới, ô mới `occupied`."""
    new_code = (new_code or "").strip().upper()
    with Tx() as db:
        new = get_slot(db, new_code)
        if floor is not None and new["floor"] != floor:
            fail(f"Ô {new_code} không thuộc Tầng {floor}")
        r = db.execute("SELECT * FROM reservations WHERE id = ?", (rid,)).fetchone() if rid else None
        if rid and not r:
            fail("Không tìm thấy đặt chỗ", 404)
        s = None
        if sid:
            s = db.execute("SELECT * FROM parking_sessions WHERE id = ?", (sid,)).fetchone()
            if not s:
                fail("Không tìm thấy lượt gửi xe", 404)
        elif r and r["status"] in ("checked_in", "parked"):
            s = db.execute("SELECT * FROM parking_sessions WHERE reservation_id = ? AND status = 'parked'", (r["id"],)).fetchone()
        if s is not None and s["status"] != "parked":
            fail("Xe không ở trạng thái đang đỗ trong bãi")
        if s is not None and not r and s["reservation_id"]:
            r = db.execute("SELECT * FROM reservations WHERE id = ?", (s["reservation_id"],)).fetchone()
        if s is None and not (r and r["status"] in HOLD_STATUSES):
            fail("Đặt chỗ này không còn hiệu lực để đổi ô")
        owner = (s["user_id"] if s else None) or (r["user_id"] if r else None)
        if not _can_manage(db, user, owner):
            fail("Bạn không có quyền đổi ô cho xe này", 403)
        old_id = s["slot_id"] if s else r["slot_id"]
        if new["id"] == old_id:
            fail(f"Xe đang ở ô {new_code} rồi")
        if not _slot_free_for_switch(db, new):
            fail(f"Ô {new_code} không còn trống — hãy chọn ô khác")
        old_code = db.execute("SELECT code FROM slots WHERE id = ?", (old_id,)).fetchone()["code"]
        plate = s["license_plate"] if s else r["license_plate"]
        if s is not None:
            db.execute("UPDATE parking_sessions SET slot_id = ?, parked_confirmed_at = NULL WHERE id = ?", (new["id"], s["id"]))
            db.execute("UPDATE slots SET status = 'occupied' WHERE id = ?", (new["id"],))
            if r:
                db.execute("UPDATE reservations SET slot_id = ? WHERE id = ?", (new["id"], r["id"]))
        else:
            db.execute("UPDATE reservations SET slot_id = ? WHERE id = ?", (new["id"], r["id"]))
            db.execute("UPDATE slots SET status = ? WHERE id = ?", (res_slot_status(r), new["id"]))
        db.execute("UPDATE slots SET status = 'available' WHERE id = ?", (old_id,))
        log(db, "web" if source == "web" else "admin", "slot_switched", f"Xe {plate} đổi ô {old_code} → {new_code}")
        act_uid, act_email = owner_of_plate(db, plate, owner)
        if act_uid:
            log_activity(db, act_uid, act_email, "slot_switched", f"Xe {plate} đổi ô {old_code} → {new_code}")
        sid_out, rid_out = (s["id"] if s is not None else None), (r["id"] if r else None)
    out = {"license_plate": plate, "old_slot_code": old_code, "new_slot_code": new_code, "slot_code": new_code,
           "floor": new["floor"], "user_id": owner, "reservation_id": rid_out, "session_id": sid_out}
    if sid_out:
        out["session"] = get_session(sid_out)
    if rid_out:
        out["reservation"] = get_reservation(rid_out)
    return out


def sensor_event(slot_code: str, occupied: bool) -> dict:
    """Cảm biến IR báo CÓ XE: tự xác nhận khi xe vào đúng ô; phát hiện đỗ nhầm khi xe vừa qua cổng lại vào ô trống khác."""
    if not occupied:
        return {"kind": None}
    slot = query_one("SELECT * FROM slots WHERE code = ?", (slot_code,))
    if not slot:
        return {"kind": None}
    own = query_one("SELECT * FROM parking_sessions WHERE slot_id = ? AND status = 'parked'", (slot["id"],))
    if own:
        return {"kind": "confirm", "session_id": own["id"]} if not own["parked_confirmed_at"] else {"kind": None}
    if query_one(f"SELECT 1 FROM reservations WHERE slot_id = ? AND status IN {HOLD_STATUSES}", (slot["id"],)):
        return {"kind": None}
    cutoff = (now() - timedelta(minutes=WRONG_SLOT_WINDOW_MINUTES)).isoformat(timespec="seconds")
    s = query_one(SESSION_SQL + " WHERE p.status = 'parked' AND p.parked_confirmed_at IS NULL AND p.check_in_time >= ? "
                                "AND p.slot_id != ? ORDER BY p.check_in_time DESC LIMIT 1", (cutoff, slot["id"]))
    if not s:
        return {"kind": None}
    owner = s["user_id"]
    if not owner and s["reservation_id"]:
        r = query_one("SELECT user_id FROM reservations WHERE id = ?", (s["reservation_id"],))
        owner = r["user_id"] if r else None
    return {"kind": "wrong", "alert": {
        "detected_slot_code": slot["code"], "detected_floor": slot["floor"], "assigned_slot_code": s["slot_code"],
        "assigned_floor": s["floor"], "license_plate": s["license_plate"], "session_id": s["id"],
        "reservation_id": s["reservation_id"], "user_id": owner}}


# ---------------------------------------------------------------- v3: Bảng điều khiển Demo
def reset_demo(admin: dict) -> dict:
    """Đưa toàn bộ ô về trống và đóng các phiên đang mở (đơn đang giữ -> hủy, xe đang đỗ -> kết thúc 0đ, `payment_method = reset`).
    GIỮ lịch sử doanh thu, nhật ký thanh toán, tài khoản."""
    with Tx() as db:
        holds = db.execute("SELECT id FROM reservations WHERE status IN ('pending_payment', 'active', 'checked_in')").fetchall()
        for r in holds:
            db.execute("UPDATE reservations SET status = 'cancelled' WHERE id = ?", (r["id"],))
        parked = db.execute("SELECT id FROM parking_sessions WHERE status = 'parked'").fetchall()
        stamp = now_iso()
        for s in parked:
            db.execute("""UPDATE parking_sessions SET status = 'completed', payment_status = 'void', payment_method = 'reset',
                          check_out_time = ?, hours_billed = 0, total_fee = 0, amount_due = 0 WHERE id = ?""", (stamp, s["id"]))
        n_slots = db.execute("UPDATE slots SET status = 'available' WHERE active = 1 AND status != 'available'").rowcount
        msg = (f"Reset bãi xe (Demo): hủy {len(holds)} đơn đang giữ, kết thúc {len(parked)} xe đang đỗ, "
               f"trả {n_slots} ô về trống — giữ lịch sử doanh thu")
        log(db, "admin", "reset", msg)
        log_activity(db, admin["id"], admin["email"], "demo_reset", msg)
    return {"cancelled_reservations": len(holds), "closed_sessions": len(parked), "freed_slots": n_slots, "message": msg}


def demo_sepay(admin: dict, rid: int | None = None, sid: int | None = None) -> dict:
    """Giả lập SePay báo tiền vào (không tạo giao dịch ngân hàng, không tính doanh thu):
    ưu tiên đơn chờ cọc cũ nhất -> xe đang chờ trả phí tại cổng ra -> xe vừa bấm thanh toán trước."""
    with Tx() as db:
        r = None
        if rid:
            r = db.execute("SELECT * FROM reservations WHERE id = ?", (rid,)).fetchone()
            if not r:
                fail("Không tìm thấy đặt chỗ", 404)
        elif not sid:
            r = db.execute("SELECT * FROM reservations WHERE status = 'pending_payment' ORDER BY created_at LIMIT 1").fetchone()
        if r:
            if r["status"] != "pending_payment":
                fail(f"Vé {r['ticket_code']} không ở trạng thái chờ chuyển khoản")
            db.execute("UPDATE reservations SET deposit_mode = 'demo' WHERE id = ?", (r["id"],))
            activate_reservation_tx(db, r, via="demo", admin=admin)
            kind, ref = "deposit", r["id"]
        else:
            s = db.execute("SELECT * FROM parking_sessions WHERE id = ?", (sid,)).fetchone() if sid else (
                db.execute("""SELECT * FROM parking_sessions WHERE status = 'parked' AND payment_status = 'pending'
                              AND check_out_time IS NOT NULL ORDER BY check_out_time DESC LIMIT 1""").fetchone()
                or db.execute("""SELECT * FROM parking_sessions WHERE status = 'parked' AND prepay_due IS NOT NULL
                                 ORDER BY prepay_requested_at DESC LIMIT 1""").fetchone())
            if not s or s["status"] != "parked":
                fail("Không có đơn chờ cọc hoặc xe nào đang chờ thanh toán để giả lập SePay")
            s = _refresh_waiver(db, s)
            q = _quote(dict(s), get_settings()["hourly_rate"])
            if s["check_out_time"] and s["payment_status"] == "pending":
                pay_tx(db, s, "demo", "simulator", q)
                kind = "exit_paid"
            else:
                mark_prepaid_tx(db, s, "demo", q, q["amount_due"], "simulator")
                kind = "prepaid"
            ref = s["id"]
        log_activity(db, admin["id"], admin["email"], "demo_sepay", f"Giả lập SePay: {kind} #{ref}")
    if kind == "deposit":
        return {"kind": kind, "reservation": get_reservation(ref)}
    return {"kind": kind, "session": get_session(ref)}


# ---------------------------------------------------------------- v3: Báo cáo CSV
REPORT_HEADER = ["Mã lượt", "Biển số", "Ô đỗ", "Tầng", "Loại xe", "Mã vé", "Giờ vào", "Giờ ra", "Thời gian đỗ (phút)",
                 "Số giờ tính phí", "Tổng phí (đ)", "Tiền cọc SePay đã trừ (đ)", "Đã trả trước (đ)", "Phí thu thêm tại cổng (đ)",
                 "Hình thức", "Trạng thái", "Doanh thu ghi nhận (đ)"]


def report_rows() -> list[list]:
    rows = query("""SELECT p.*, s.code AS slot_code, s.floor, r.ticket_code, r.deposit_mode FROM parking_sessions p
                    JOIN slots s ON s.id = p.slot_id LEFT JOIN reservations r ON r.id = p.reservation_id ORDER BY p.id""")
    out = []
    for p in rows:
        minutes = ""
        if p["check_out_time"]:
            minutes = int((parse_dt(p["check_out_time"]) - parse_dt(p["check_in_time"])).total_seconds() // 60)
        counted = p["payment_status"] == "paid" and p["payment_method"] in ("online_qr", "cash")
        prepaid_counted = (p["prepaid_amount"] or 0) if p["prepay_method"] in ("online_qr", "cash") else 0
        deposit = 0 if p.get("deposit_mode") == "demo" else (p["deposit_deducted"] or 0)
        at_gate = (p["amount_due"] or 0) if counted else 0
        out.append([p["id"], p["license_plate"], p["slot_code"], p["floor"], "Đặt trước" if p["entry_type"] == "reservation" else "Vãng lai",
                    p.get("ticket_code") or "", p["check_in_time"], p["check_out_time"] or "", minutes,
                    p["hours_billed"] if p["hours_billed"] is not None else "", p["total_fee"] or 0, p["deposit_deducted"] or 0,
                    p["prepaid_amount"] or 0, at_gate,
                    PAY_LABELS.get(p["payment_method"] or "", p["payment_method"] or ""),
                    {"parked": "Đang đỗ", "completed": "Đã ra"}.get(p["status"], p["status"]),
                    at_gate + prepaid_counted + deposit])
    return out


# ---------------------------------------------------------------- Đối soát trạng thái ô lúc khởi động
def reconcile_slots(sensor_occupied: set[str] | frozenset = frozenset()) -> list[dict]:
    """Đồng bộ `slots.status` với dữ liệu thật (chạy khi server khởi động):
    - Có lượt gửi xe đang đỗ (`parking_sessions.status = 'parked'`)  -> `occupied`
    - Có đặt chỗ đang giữ (`pending_payment` / `active`)              -> `pending_payment` / `reserved`
    - Cảm biến IR gắn với ô đang báo có xe (`sensor_occupied`)        -> giữ `occupied`
    - Không có gì ở trên                                              -> trả về `available`
    Trả về danh sách thay đổi [{code, old, new}]."""
    changes = []
    with Tx() as db:
        slots = db.execute("SELECT id, code, status FROM slots WHERE active = 1").fetchall()
        for s in slots:
            parked = db.execute("SELECT 1 FROM parking_sessions WHERE slot_id = ? AND status = 'parked'", (s["id"],)).fetchone()
            hold = db.execute(f"SELECT status FROM reservations WHERE slot_id = ? AND status IN {HOLD_STATUSES} ORDER BY id DESC LIMIT 1",
                              (s["id"],)).fetchone()
            if parked:
                want = "occupied"
            elif hold:
                want = res_slot_status(hold)
            elif s["code"] in sensor_occupied:
                want = "occupied"
            else:
                want = "available"
            if s["status"] != want:
                db.execute("UPDATE slots SET status = ? WHERE id = ?", (want, s["id"]))
                changes.append({"code": s["code"], "old": s["status"], "new": want})
        if changes:
            log(db, "system", "slot_reconcile", "Đối soát ô khi khởi động: "
                + ", ".join(f"{c['code']} {c['old']}→{c['new']}" for c in changes))
    return changes
