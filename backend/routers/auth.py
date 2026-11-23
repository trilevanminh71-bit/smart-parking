"""Đăng ký / Đăng nhập / Đổi mật khẩu / Lịch sử của tài khoản."""
import re

from fastapi import APIRouter, Depends, Request

import auth
import services as svc
from database import Tx, log_activity, now_iso, query, query_one
from models import ChangePasswordInput, LoginInput, RegisterInput

router = APIRouter(prefix="/api/auth", tags=["auth"])


@router.post("/register")
def register(body: RegisterInput):
    """Đăng ký ở màn hình ngoài luôn tạo tài khoản `customer`."""
    email = auth.normalize_email(body.email)
    auth.validate_password(body.password)
    phone = re.sub(r"[^\d+]", "", body.phone)
    if len(phone) < 8:
        svc.fail("Số điện thoại không hợp lệ")
    if query_one("SELECT 1 FROM users WHERE email = ?", (email,)):
        svc.fail("Email này đã được đăng ký", 409)
    with Tx() as db:
        cur = db.execute(
            "INSERT INTO users (email, password_hash, full_name, phone, role, created_at) VALUES (?, ?, ?, ?, 'customer', ?)",
            (email, auth.hash_password(body.password), body.full_name.strip(), phone, now_iso()),
        )
        uid = cur.lastrowid
        log_activity(db, uid, email, "register", "Tạo tài khoản Khách hàng")
    user = query_one("SELECT * FROM users WHERE id = ?", (uid,))
    return {"token": auth.create_token(user), "user": auth.public_user(user)}


def client_info(request: Request) -> str:
    """Mô tả ngắn thiết bị + IP cho lịch sử đăng nhập."""
    ua = request.headers.get("user-agent", "")
    os_ = next((n for k, n in (("Android", "Android"), ("iPhone", "iPhone"), ("iPad", "iPad"), ("Windows", "Windows"),
                               ("Mac OS", "macOS"), ("Linux", "Linux")) if k in ua), "Thiết bị khác")
    br = next((n for k, n in (("Edg/", "Edge"), ("OPR/", "Opera"), ("Chrome/", "Chrome"), ("Firefox/", "Firefox"),
                              ("Safari/", "Safari")) if k in ua), "Ứng dụng" if ua else "không rõ")
    ip = request.headers.get("x-forwarded-for", "").split(",")[0].strip() or (request.client.host if request.client else "")
    return f"{br} · {os_}" + (f" · IP {ip}" if ip else "")


@router.post("/login")
def login(body: LoginInput, request: Request):
    email = (body.email or "").strip().lower()
    user = query_one("SELECT * FROM users WHERE email = ?", (email,))
    if not user or not auth.verify_password(body.password, user["password_hash"]):
        if user:  # ghi lại lần đăng nhập sai mật khẩu của tài khoản có thật
            with Tx() as db:
                log_activity(db, user["id"], email, "login_failed", f"Sai mật khẩu · {client_info(request)}")
        svc.fail("Email hoặc mật khẩu không đúng", 401)
    with Tx() as db:
        log_activity(db, user["id"], email, "login", f"Đăng nhập · {client_info(request)}")
    return {"token": auth.create_token(user), "user": auth.public_user(user)}


@router.post("/logout")
def logout(request: Request, user: dict = Depends(auth.current_user)):
    """Ghi lịch sử đăng xuất (token không lưu phía server — trình duyệt tự xóa token)."""
    with Tx() as db:
        log_activity(db, user["id"], user["email"], "logout", f"Đăng xuất · {client_info(request)}")
    return {"ok": True}


@router.get("/me")
def me(user: dict = Depends(auth.current_user)):
    return auth.public_user(user)


@router.post("/change-password")
def change_password(body: ChangePasswordInput, user: dict = Depends(auth.current_user)):
    if not auth.verify_password(body.old_password, user["password_hash"]):
        svc.fail("Mật khẩu hiện tại không đúng")
    auth.validate_password(body.new_password)
    with Tx() as db:
        db.execute("UPDATE users SET password_hash = ? WHERE id = ?", (auth.hash_password(body.new_password), user["id"]))
        log_activity(db, user["id"], user["email"], "change_password", "Đổi mật khẩu (các phiên đăng nhập cũ bị vô hiệu)")
    fresh = query_one("SELECT * FROM users WHERE id = ?", (user["id"],))
    # Token cũ bị vô hiệu -> trả token mới để không bị đăng xuất
    return {"ok": True, "token": auth.create_token(fresh)}


@router.get("/history")
def history(user: dict = Depends(auth.current_user)):
    return svc.user_history(user["id"])


@router.get("/activity")
def my_activity(limit: int = 100, user: dict = Depends(auth.current_user)):
    """Lịch sử đăng nhập & hoạt động của chính tài khoản đang đăng nhập."""
    return query("SELECT id, action, details, created_at FROM activity_logs WHERE user_id = ? ORDER BY id DESC LIMIT ?",
                 (user["id"], max(1, min(limit, 300))))
