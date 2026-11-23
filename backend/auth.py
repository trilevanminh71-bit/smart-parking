"""Tài khoản & phân quyền: mật khẩu PBKDF2 (hashlib) + token ký HMAC (không cần thư viện ngoài)."""
import base64
import hashlib
import hmac
import json
import os
import re
import secrets
import time

from fastapi import Header, HTTPException

from database import Tx, now_iso, query_one

DEFAULT_ADMIN_EMAIL = "trilevanminh71@gmail.com"
DEFAULT_ADMIN_PASSWORD = "Admin@123"
DEFAULT_GUARD_EMAIL = "guard@smartparking.vn"
DEFAULT_GUARD_PASSWORD = "guard123"  # chỉ dùng khi chưa đặt biến môi trường GUARD_PASSWORD
ROLES = ("customer", "guard", "admin")
STAFF_ROLES = ("guard", "admin")
TOKEN_TTL_SECONDS = 30 * 24 * 3600  # 30 ngày
PBKDF2_ROUNDS = 200_000
EMAIL_RE = re.compile(r"^[^@\s]+@[^@\s]+\.[^@\s]+$")

_secret: bytes | None = None


def _get_secret() -> bytes:
    """Khóa ký token, sinh ngẫu nhiên 1 lần và lưu trong bảng settings."""
    global _secret
    if _secret is None:
        row = query_one("SELECT value FROM settings WHERE key = 'secret_key'")
        if not row:
            with Tx() as db:
                db.execute("INSERT OR IGNORE INTO settings (key, value) VALUES ('secret_key', ?)", (secrets.token_hex(32),))
            row = query_one("SELECT value FROM settings WHERE key = 'secret_key'")
        _secret = bytes.fromhex(row["value"])
    return _secret


# ---------------------------------------------------------------- Mật khẩu
def hash_password(password: str) -> str:
    salt = secrets.token_bytes(16)
    dk = hashlib.pbkdf2_hmac("sha256", password.encode(), salt, PBKDF2_ROUNDS)
    return f"pbkdf2_sha256${PBKDF2_ROUNDS}${salt.hex()}${dk.hex()}"


def verify_password(password: str, stored: str) -> bool:
    try:
        _, rounds, salt, digest = stored.split("$")
        dk = hashlib.pbkdf2_hmac("sha256", password.encode(), bytes.fromhex(salt), int(rounds))
        return hmac.compare_digest(dk.hex(), digest)
    except (ValueError, TypeError):
        return False


def validate_password(password: str) -> None:
    if len(password) < 6:
        raise HTTPException(400, "Mật khẩu phải có ít nhất 6 ký tự")


def normalize_email(email: str) -> str:
    email = (email or "").strip().lower()
    if not EMAIL_RE.match(email):
        raise HTTPException(400, "Email không hợp lệ")
    return email


# ---------------------------------------------------------------- Token
def _b64(data: bytes) -> str:
    return base64.urlsafe_b64encode(data).rstrip(b"=").decode()


def _unb64(s: str) -> bytes:
    return base64.urlsafe_b64decode(s + "=" * (-len(s) % 4))


def create_token(user: dict) -> str:
    payload = _b64(json.dumps({"uid": user["id"], "exp": int(time.time()) + TOKEN_TTL_SECONDS,
                               "pv": user["password_hash"][-8:]}).encode())
    sig = _b64(hmac.new(_get_secret(), payload.encode(), hashlib.sha256).digest())
    return f"{payload}.{sig}"


def decode_token(token: str) -> dict | None:
    try:
        payload, sig = token.split(".")
        expected = _b64(hmac.new(_get_secret(), payload.encode(), hashlib.sha256).digest())
        if not hmac.compare_digest(sig, expected):
            return None
        data = json.loads(_unb64(payload))
        if data["exp"] < time.time():
            return None
        user = query_one("SELECT * FROM users WHERE id = ?", (data["uid"],))
        # Đổi mật khẩu sẽ vô hiệu các token cũ
        if not user or user["password_hash"][-8:] != data.get("pv"):
            return None
        return user
    except Exception:
        return None


def public_user(user: dict) -> dict:
    return {k: user.get(k) or "" for k in ("id", "email", "full_name", "phone", "role", "created_at", "default_plate")}


# ---------------------------------------------------------------- Dependencies
def _token_from_header(authorization: str) -> str:
    if authorization.lower().startswith("bearer "):
        return authorization[7:].strip()
    return ""


def current_user(authorization: str = Header(default="")) -> dict:
    user = decode_token(_token_from_header(authorization))
    if not user:
        raise HTTPException(401, "Vui lòng đăng nhập")
    return user


def optional_user(authorization: str = Header(default="")) -> dict | None:
    return decode_token(_token_from_header(authorization))


def require_admin(authorization: str = Header(default="")) -> dict:
    user = current_user(authorization)
    if user["role"] != "admin":
        raise HTTPException(403, "Chỉ tài khoản Admin mới được truy cập")
    return user


def require_staff(authorization: str = Header(default="")) -> dict:
    """Bảo vệ trực cổng hoặc Admin."""
    user = current_user(authorization)
    if user["role"] not in STAFF_ROLES:
        raise HTTPException(403, "Chỉ tài khoản Bảo vệ hoặc Admin mới được truy cập")
    return user


def is_staff(user: dict | None) -> bool:
    return bool(user and user.get("role") in STAFF_ROLES)


# ---------------------------------------------------------------- Seed
def _seed_user(email: str, env_name: str, default_password: str, full_name: str, role: str) -> None:
    if query_one("SELECT 1 FROM users WHERE email = ?", (email,)):
        return
    # Trên Cloud nên đặt biến môi trường (chỉ dùng khi tạo tài khoản lần đầu) thay cho mật khẩu mặc định
    password = os.environ.get(env_name, "").strip()
    if not password:
        password = default_password
        print(f"[CẢNH BÁO] Tạo tài khoản {email} với mật khẩu mặc định — hãy đặt biến môi trường {env_name} "
              "hoặc đổi mật khẩu ngay sau khi đăng nhập.", flush=True)
    with Tx() as db:
        db.execute(
            "INSERT INTO users (email, password_hash, full_name, phone, role, created_at) VALUES (?, ?, ?, ?, ?, ?)",
            (email, hash_password(password), full_name, "", role, now_iso()),
        )


def seed_admin() -> None:
    """Tài khoản Admin gốc + Bảo vệ trực cổng mặc định (nếu chưa có)."""
    _get_secret()
    _seed_user(DEFAULT_ADMIN_EMAIL, "ADMIN_PASSWORD", DEFAULT_ADMIN_PASSWORD, "Quản trị viên", "admin")
    _seed_user(DEFAULT_GUARD_EMAIL, "GUARD_PASSWORD", DEFAULT_GUARD_PASSWORD, "Bảo vệ trực cổng", "guard")
