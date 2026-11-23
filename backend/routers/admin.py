"""API Bảo vệ / Admin (header Authorization: Bearer <token>).
- Bảo vệ (`guard`) + Admin: vận hành cổng, barrier khẩn cấp, check-in/out, thu tiền mặt / duyệt cọc dự phòng.
- Chỉ Admin: Cài đặt, tài khoản, nhật ký, giả lập trôi thời gian, reset (Bảo vệ không sửa bản đồ / xóa dữ liệu)."""
import os
import re

from fastapi import APIRouter, Depends

import auth
import services as svc
from database import Tx, get_settings, log_activity, now_iso, query, query_one
from models import (AdminUserCreate, BarrierCommand, GateEvent, PrepayConfirm, RoleUpdate, SessionAction, SettingsUpdate,
                    SimulateExit, SimulateHours, SimulateReservation, TicketInput)
from realtime import barriers, manager
from routers.hardware import exit_flow, handle_gate

router = APIRouter(prefix="/api/admin", tags=["admin"], dependencies=[Depends(auth.require_staff)])
ADMIN = [Depends(auth.require_admin)]


@router.get("/dashboard")
def dashboard():
    return {
        "parked": svc.list_parked(),
        "reservations": svc.list_active_reservations(),
        "history": svc.list_history(),
        "stats": svc.stats(),
        "logs": query("SELECT * FROM hardware_logs ORDER BY id DESC LIMIT 60"),
        "barriers": barriers.snapshot(),
    }


@router.get("/settings", dependencies=ADMIN)
def read_settings():
    # Cho biết có SEPAY_API_KEY trong biến môi trường (Render) hay không — không trả về giá trị
    return {**get_settings(), "sepay_env_configured": bool(os.environ.get("SEPAY_API_KEY", "").strip())}


LEGACY_ACTIONS = ("reservation_soft", "reservation_bumped", "reservation_upgraded")

SETTING_LABELS = {
    "hold_minutes": "Giữ chỗ có cọc (phút)", "deposit_amount": "Tiền cọc", "hourly_rate": "Đơn giá/giờ",
    "free_minutes": "Miễn phí thời gian đầu (phút)", "pending_minutes": "Chờ chuyển khoản cọc (phút)",
    "sepay_api_key": "SePay API Key", "exit_grace_minutes": "Thời gian ra cổng sau thanh toán (phút)",
    "auto_gate": "Tự động mở barrier (Auto-Gate)",
    "parking_name": "Tên bãi", "admin_name": "Tên quản trị viên", "admin_phone": "SĐT hỗ trợ",
    "admin_email": "Email hỗ trợ", "parking_address": "Địa chỉ", "notice_text": "Thông báo",
}


@router.put("/settings")
async def update_settings(body: SettingsUpdate, admin: dict = Depends(auth.require_admin)):
    values = body.model_dump(exclude_none=True)
    if "admin_email" in values and values["admin_email"].strip():
        values["admin_email"] = auth.normalize_email(values["admin_email"])
    if "parking_name" in values and not values["parking_name"].strip():
        svc.fail("Tên bãi xe không được để trống")
    old = get_settings()
    changed = []
    with Tx() as db:
        for k, v in values.items():
            stored = ("1" if v else "0") if isinstance(v, bool) else str(v).strip()
            db.execute("INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)", (k, stored))
            before = old.get(k)
            if (("1" if before else "0") if isinstance(before, bool) else str(before)) != stored:
                shown = ("BẬT" if v else "TẮT") if isinstance(v, bool) else (stored or "(trống)")
                if k == "sepay_api_key":  # không ghi khóa bí mật vào log
                    shown = "đã cập nhật" if stored else "đã xóa"
                changed.append(f"{SETTING_LABELS.get(k, k)}: {shown}")
        if changed:
            svc.log(db, "admin", "settings", "Cập nhật cài đặt: " + "; ".join(changed))
            log_activity(db, admin["id"], admin["email"], "settings_update", "; ".join(changed))
    await manager.broadcast("settings")
    return read_settings()


@router.post("/reservations/{rid}/approve")
async def approve_deposit(rid: int, admin: dict = Depends(auth.require_staff)):
    """Duyệt cọc thủ công (dự phòng khi webhook SePay chưa về) sau khi kiểm tra app ngân hàng."""
    r = svc.approve_deposit(rid, admin)
    r["via"] = "manual"
    await manager.broadcast("deposit_approved", r)
    return r


@router.get("/activity", dependencies=ADMIN)
def activity(q: str = "", action: str = "", limit: int = 200):
    """Toàn bộ lịch sử đăng nhập & hoạt động; lọc theo email/nội dung (`q`) và loại hành động (`action`)."""
    sql = "SELECT * FROM activity_logs WHERE 1=1"
    params: list = []
    if q.strip():
        sql += " AND (email LIKE ? OR details LIKE ?)"
        params += [f"%{q.strip()}%"] * 2
    if action.strip():
        sql += " AND action = ?"
        params.append(action.strip())
    sql += " ORDER BY id DESC LIMIT ?"
    params.append(max(1, min(limit, 1000)))
    # Không đưa các hành động của tính năng "đặt chỗ không cọc" (đã bỏ) vào bộ lọc
    actions = [r["action"] for r in query(
        f"SELECT DISTINCT action FROM activity_logs WHERE action NOT IN {LEGACY_ACTIONS} ORDER BY action")]
    return {"items": query(sql, tuple(params)), "actions": actions}


@router.post("/gate")
async def gate(body: GateEvent):
    """Bảng giả lập camera ALPR cổng vào/ra trên web."""
    return await handle_gate(body.gate, body.plate, source="simulator")


@router.post("/checkin-ticket")
async def checkin_ticket(body: TicketInput):
    """Check-in nhanh bằng mã vé ngắn hoặc nội dung QR vé."""
    result = svc.check_in_by_ticket(body.code, source="admin")
    await barriers.open("entry", result["message"])
    await manager.broadcast("check_in", result)
    return {"ok": True, "barrier": "OPEN", **result}


@router.post("/barrier")
async def barrier(body: BarrierCommand):
    if body.action == "open":
        await barriers.open(body.gate, "Mở tay bởi bảo vệ", auto_close=body.auto_close)
    else:
        await barriers.close(body.gate, "Đóng tay bởi bảo vệ")
    svc.add_log("admin", "barrier", f"Barrier {'VÀO' if body.gate == 'entry' else 'RA'}: {body.action.upper()} (thủ công)")
    await manager.broadcast("log")
    return barriers.snapshot()


@router.post("/checkout")
async def checkout(body: SessionAction):
    free = svc.free_exit(body.session_id, source="admin")
    if free:  # Admin miễn phí: hoàn tất 0đ, mở barrier ra
        await barriers.open("exit", f"Xe {free['license_plate']} — miễn phí (Admin)")
        await manager.broadcast("payment", free)
        return free
    r = await exit_flow(body.session_id, "admin")
    return {**r["session"], "exit_action": r["action"]}


@router.post("/prepay-confirm")
async def prepay_confirm(body: PrepayConfirm, admin: dict = Depends(auth.require_staff)):
    """Bảo vệ xác nhận thu hộ phí trước khi xe ra cổng -> 'Sẵn sàng ra cổng'."""
    s = svc.confirm_prepay(body.session_id, body.method, admin)
    await manager.broadcast("prepaid", s)
    return s


@router.post("/simulate/exit-time", dependencies=ADMIN)
async def exit_time(body: SimulateExit):
    s = svc.shift_exit_deadline(body.session_id, body.minutes)
    await manager.broadcast("simulate", s)
    return s


@router.post("/pay-cash")
async def pay_cash(body: SessionAction):
    s = svc.pay(body.session_id, "cash", source="admin")
    await barriers.open("exit", f"Xe {s['license_plate']} đã trả tiền mặt")
    await manager.broadcast("payment", s)
    return s


@router.post("/pay-online")
async def pay_online(body: SessionAction):
    s = svc.pay(body.session_id, "online_qr", source="admin")
    await barriers.open("exit", f"Xe {s['license_plate']} đã thanh toán online")
    await manager.broadcast("payment", s)
    return s


@router.post("/simulate/add-hours", dependencies=ADMIN)
async def add_hours(body: SimulateHours):
    s = svc.shift_session(body.session_id, body.hours)
    await manager.broadcast("simulate", s)
    return s


@router.post("/simulate/reservation-time", dependencies=ADMIN)
async def reservation_time(body: SimulateReservation):
    r = svc.shift_reservation(body.reservation_id, body.minutes)
    expired = svc.expire_reservations()
    await manager.broadcast("reservation_expired" if expired else "simulate", {"reservation": r, "slots": expired})
    return svc.get_reservation(body.reservation_id)


@router.post("/reservations/{rid}/cancel")
async def cancel_reservation(rid: int, admin: dict = Depends(auth.require_staff)):
    r = svc.cancel_reservation(rid, admin)
    await manager.broadcast("reservation_cancelled", r)
    return r


@router.post("/reset", dependencies=ADMIN)
async def reset(admin: dict = Depends(auth.require_admin)):
    """Reset an toàn: trả ô về trống, đóng phiên đang mở — GIỮ lịch sử doanh thu (giống nút Reset trong Bảng Demo)."""
    from devices import hub
    r = svc.reset_demo(admin)
    hub.clear()
    await barriers.close("entry", "Reset")
    await barriers.close("exit", "Reset")
    await manager.broadcast("reset", r)
    return {"ok": True, **r}


# ---------------------------------------------------------------- Quản lý tài khoản
@router.get("/users", dependencies=ADMIN)
def list_users():
    return query("SELECT id, email, full_name, phone, role, created_at FROM users ORDER BY role, id")


@router.post("/users", dependencies=ADMIN)
def create_admin(body: AdminUserCreate, admin: dict = Depends(auth.require_admin)):
    """Tạo tài khoản Admin / Bảo vệ mới; nếu email đã có thì đổi quyền tài khoản đó."""
    email = auth.normalize_email(body.email)
    existing = query_one("SELECT * FROM users WHERE email = ?", (email,))
    role, role_vi = body.role, ("Admin" if body.role == "admin" else "Bảo vệ")
    with Tx() as db:
        if existing:
            if existing["role"] == role:
                svc.fail(f"{email} đã là {role_vi}")
            if existing["email"] == auth.DEFAULT_ADMIN_EMAIL:
                svc.fail("Không thể đổi quyền tài khoản Admin gốc")
            db.execute("UPDATE users SET role = ? WHERE id = ?", (role, existing["id"]))
            svc.log(db, "admin", "user_promote", f"{admin['email']} đổi quyền {email} thành {role_vi}")
            log_activity(db, admin["id"], admin["email"], "user_role", f"Đổi quyền {email} thành {role_vi}")
            action = "promoted"
        else:
            if not body.password or not body.full_name:
                svc.fail("Tài khoản mới cần Họ tên và Mật khẩu")
            auth.validate_password(body.password)
            phone = re.sub(r"[^\d+]", "", body.phone or "")
            db.execute(
                "INSERT INTO users (email, password_hash, full_name, phone, role, created_at) VALUES (?, ?, ?, ?, ?, ?)",
                (email, auth.hash_password(body.password), body.full_name.strip(), phone, role, now_iso()),
            )
            svc.log(db, "admin", "user_create", f"{admin['email']} tạo tài khoản {role_vi} {email}")
            log_activity(db, admin["id"], admin["email"], "user_create", f"Tạo tài khoản {role_vi} {email}")
            action = "created"
    user = query_one("SELECT * FROM users WHERE email = ?", (email,))
    return {"action": action, "user": auth.public_user(user)}


@router.delete("/users/{uid}", dependencies=ADMIN)
async def delete_user(uid: int, admin: dict = Depends(auth.require_admin)):
    """Xóa tài khoản. Hủy các đặt chỗ đang giữ ô & trả ô về trống; giữ lịch sử doanh thu (user_id -> NULL)."""
    if uid == admin["id"]:
        svc.fail("Không thể xóa chính tài khoản đang đăng nhập")
    user = query_one("SELECT * FROM users WHERE id = ?", (uid,))
    if not user:
        svc.fail("Không tìm thấy tài khoản", 404)
    if user["email"] == auth.DEFAULT_ADMIN_EMAIL:
        svc.fail("Không thể xóa tài khoản Admin gốc")
    freed = []
    with Tx() as db:
        holds = db.execute(
            f"""SELECT r.id, r.slot_id, r.license_plate, r.ticket_code, s.code FROM reservations r
                JOIN slots s ON s.id = r.slot_id WHERE r.user_id = ? AND r.status IN {svc.HOLD_STATUSES}""", (uid,)
        ).fetchall()
        for r in holds:
            db.execute("UPDATE reservations SET status = 'cancelled' WHERE id = ?", (r["id"],))
            db.execute(f"UPDATE slots SET status = 'available' WHERE id = ? AND status IN {svc.SLOT_HELD}", (r["slot_id"],))
            svc.log(db, "admin", "reservation_cancel", f"Hủy đặt chỗ #{r['id']} ({r['license_plate']}) do xóa tài khoản {user['email']}, trả ô {r['code']}")
            freed.append(r["code"])
        # Giữ nguyên lịch sử đặt chỗ / lượt gửi xe / doanh thu: chỉ bỏ liên kết tới tài khoản
        n_res = db.execute("UPDATE reservations SET user_id = NULL WHERE user_id = ?", (uid,)).rowcount
        n_ses = db.execute("UPDATE parking_sessions SET user_id = NULL WHERE user_id = ?", (uid,)).rowcount
        db.execute("UPDATE activity_logs SET user_id = NULL WHERE user_id = ?", (uid,))  # giữ email trong log
        db.execute("DELETE FROM users WHERE id = ?", (uid,))
        role = {"admin": "Admin", "guard": "Bảo vệ"}.get(user["role"], "Khách hàng")
        details = (f"Xóa tài khoản {role} {user['email']} ({user['full_name']})"
                   + (f"; hủy {len(freed)} đặt chỗ, trả ô {', '.join(freed)}" if freed else "")
                   + f"; giữ {n_res} đặt chỗ & {n_ses} lượt gửi xe trong lịch sử")
        svc.log(db, "admin", "user_delete", details)
        log_activity(db, admin["id"], admin["email"], "user_delete", details)
    await manager.broadcast("user_deleted", {"email": user["email"], "slots": freed})
    return {"ok": True, "email": user["email"], "freed_slots": freed, "kept_reservations": n_res, "kept_sessions": n_ses}


@router.put("/users/{uid}/role", dependencies=ADMIN)
def set_role(uid: int, body: RoleUpdate, admin: dict = Depends(auth.require_admin)):
    if uid == admin["id"] and body.role != "admin":
        svc.fail("Không thể tự hạ quyền chính mình")
    user = query_one("SELECT * FROM users WHERE id = ?", (uid,))
    if not user:
        svc.fail("Không tìm thấy tài khoản", 404)
    if user["email"] == auth.DEFAULT_ADMIN_EMAIL and body.role != "admin":
        svc.fail("Không thể hạ quyền tài khoản Admin gốc")
    with Tx() as db:
        db.execute("UPDATE users SET role = ? WHERE id = ?", (body.role, uid))
        svc.log(db, "admin", "user_role", f"{admin['email']} đổi quyền {user['email']} → {body.role}")
        log_activity(db, admin["id"], admin["email"], "user_role", f"Đổi quyền {user['email']} → {body.role}")
    return auth.public_user(query_one("SELECT * FROM users WHERE id = ?", (uid,)))
