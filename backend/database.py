"""Khởi tạo CSDL và seed dữ liệu 3 tầng.

- Có biến môi trường DATABASE_URL (postgres://...) -> PostgreSQL (Render / Cloud).
- Không có -> SQLite `parking.db` trên máy như cũ.
Toàn bộ code nghiệp vụ viết SQL kiểu SQLite (`?`, INSERT OR IGNORE/REPLACE, lastrowid); lớp `_PgConn` bên dưới
tự chuyển sang cú pháp PostgreSQL nên không phải viết 2 bộ câu lệnh.
"""
import os
import re
import sqlite3
import threading
from datetime import datetime
from pathlib import Path

DB_PATH = Path(os.environ.get("SQLITE_PATH", "").strip() or Path(__file__).parent / "parking.db")
DATABASE_URL = os.environ.get("DATABASE_URL", "").strip()
IS_PG = DATABASE_URL.startswith(("postgres://", "postgresql://"))

# Dùng chung 1 kết nối + khóa để an toàn khi FastAPI chạy nhiều luồng
_lock = threading.RLock()
_conn = None


# ---------------------------------------------------------------- PostgreSQL adapter
_RE_INSERT_IGNORE = re.compile(r"^\s*INSERT\s+OR\s+IGNORE\s+INTO", re.I)
_RE_INSERT_REPLACE_SETTINGS = re.compile(r"^\s*INSERT\s+OR\s+REPLACE\s+INTO\s+settings", re.I)
_RE_INSERT = re.compile(r"^\s*INSERT\s+INTO\s+(\w+)", re.I)
_NO_ID_TABLES = {"settings", "telemetry_locations"}  # bảng không có cột id -> không thêm RETURNING id


def _pg_sql(sql: str, has_params: bool) -> tuple[str, bool]:
    """SQL kiểu SQLite -> PostgreSQL. Trả về (sql, có RETURNING id để lấy lastrowid)."""
    s = sql.strip().rstrip(";")
    if has_params:
        s = s.replace("%", "%%").replace("?", "%s")
    if s.upper() == "BEGIN IMMEDIATE":
        return "BEGIN", False
    if _RE_INSERT_REPLACE_SETTINGS.match(s):
        s = _RE_INSERT_REPLACE_SETTINGS.sub("INSERT INTO settings", s) + " ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value"
        return s, False
    if _RE_INSERT_IGNORE.match(s):
        s = _RE_INSERT_IGNORE.sub("INSERT INTO", s) + " ON CONFLICT DO NOTHING"
    s = re.sub(r"\bLIKE\b", "ILIKE", s)  # SQLite LIKE không phân biệt hoa/thường
    m = _RE_INSERT.match(s)
    if m and m.group(1).lower() not in _NO_ID_TABLES:
        return s + " RETURNING id", True
    return s, False


class _PgCursor:
    def __init__(self, cur, lastrowid=None):
        self._cur, self.lastrowid, self.rowcount = cur, lastrowid, cur.rowcount

    def fetchone(self):
        return self._cur.fetchone() if self._cur.description else None

    def fetchall(self):
        return self._cur.fetchall() if self._cur.description else []


class _PgConn:
    """Bọc psycopg2 cho giống API sqlite3 đang dùng: execute(), executescript(), row['col'], lastrowid."""

    def __init__(self):
        self.in_tx = False
        self._connect()

    def _connect(self):
        import psycopg2
        import psycopg2.extras
        self._errors = (psycopg2.OperationalError, psycopg2.InterfaceError)
        self.raw = psycopg2.connect(DATABASE_URL, cursor_factory=psycopg2.extras.DictCursor, connect_timeout=15)
        self.raw.autocommit = True  # tự quản lý BEGIN/COMMIT giống SQLite isolation_level=None

    def _run(self, sql, params):
        sql2, returning = _pg_sql(sql, bool(params))
        cur = self.raw.cursor()
        cur.execute(sql2, tuple(params) if params else None)
        lastrowid = None
        if returning and cur.description:
            row = cur.fetchone()
            lastrowid = row[0] if row else None
        return _PgCursor(cur, lastrowid)

    def execute(self, sql, params=()):
        try:
            return self._run(sql, params)
        except self._errors:
            # Mất kết nối (DB free tier ngủ / khởi động lại) -> nối lại và thử 1 lần.
            # Không thử lại giữa transaction (các lệnh trước đó đã mất) -> để lỗi đi lên, Tx sẽ rollback.
            if not self.in_tx or sql.strip().upper().startswith("BEGIN"):
                self._connect()
                return self._run(sql, params)
            raise

    def executescript(self, script: str):
        self.raw.cursor().execute(script)


def _pg_schema(schema: str) -> str:
    return schema.replace("INTEGER PRIMARY KEY AUTOINCREMENT", "SERIAL PRIMARY KEY")

FLOORS = {1: "A", 2: "B", 3: "C"}
SLOTS_PER_FLOOR = 10

DEFAULT_SETTINGS = {
    "hold_minutes": "15",
    "deposit_amount": "10000",
    "hourly_rate": "10000",
    # Thời gian tối đa từ lúc thanh toán trước tới lúc xe ra khỏi cổng
    "exit_grace_minutes": "15",
    # Miễn phí N phút đầu (đỗ <= N phút: 0đ); sau đó tính theo block giờ, làm tròn lên
    "free_minutes": "15",
    # Đơn `pending_payment` quá N phút chưa nhận webhook SePay -> tự hủy, trả ô
    "pending_minutes": "10",
    # Auto-Gate: có tín hiệu xe tới cổng (ESP32 / nút giả lập) -> tự đọc biển số, check-in/out và mở barrier
    "auto_gate": "0",
    # API Key SePay: webhook /api/payment/webhook phải gửi header `Authorization: Apikey <key>`
    "sepay_api_key": "",
    # Thông tin bãi / quản trị viên (Admin tự cập nhật, hiển thị cho khách)
    "parking_name": "Bãi Đỗ Xe Thông Minh",
    "admin_name": "Lê Văn Minh Trí",
    "admin_phone": "0939393939",
    "admin_email": "trilevanminh71@gmail.com",
    "parking_address": "",
    "notice_text": "",
}

INT_SETTINGS = ("hold_minutes", "deposit_amount", "hourly_rate", "exit_grace_minutes", "free_minutes", "pending_minutes")
TEXT_SETTINGS = ("parking_name", "admin_name", "admin_phone", "admin_email", "parking_address", "notice_text")
CONTACT_KEYS = TEXT_SETTINGS
SECRET_SETTINGS = ("sepay_api_key",)  # chỉ Admin xem được, không đưa ra trang khách

SCHEMA = """
CREATE TABLE IF NOT EXISTS settings (
    key   TEXT PRIMARY KEY,
    value TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS slots (
    id     INTEGER PRIMARY KEY AUTOINCREMENT,
    code   TEXT UNIQUE NOT NULL,
    floor  INTEGER NOT NULL,
    status TEXT NOT NULL DEFAULT 'available'
);
CREATE TABLE IF NOT EXISTS reservations (
    id             INTEGER PRIMARY KEY AUTOINCREMENT,
    slot_id        INTEGER NOT NULL REFERENCES slots(id),
    license_plate  TEXT NOT NULL,
    customer_name  TEXT NOT NULL,
    phone          TEXT NOT NULL,
    deposit_amount INTEGER NOT NULL,
    deposit_paid   INTEGER NOT NULL DEFAULT 0,
    status         TEXT NOT NULL DEFAULT 'active',
    created_at     TEXT NOT NULL,
    expires_at     TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS parking_sessions (
    id               INTEGER PRIMARY KEY AUTOINCREMENT,
    slot_id          INTEGER NOT NULL REFERENCES slots(id),
    license_plate    TEXT NOT NULL,
    entry_type       TEXT NOT NULL,
    reservation_id   INTEGER REFERENCES reservations(id),
    check_in_time    TEXT NOT NULL,
    check_out_time   TEXT,
    hours_billed     INTEGER,
    total_fee        INTEGER,
    deposit_deducted INTEGER NOT NULL DEFAULT 0,
    amount_due       INTEGER,
    payment_method   TEXT,
    payment_status   TEXT NOT NULL DEFAULT 'pending',
    status           TEXT NOT NULL DEFAULT 'parked'
);
CREATE TABLE IF NOT EXISTS hardware_logs (
    id         INTEGER PRIMARY KEY AUTOINCREMENT,
    source     TEXT NOT NULL,
    event_type TEXT NOT NULL,
    message    TEXT NOT NULL,
    created_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS users (
    id            INTEGER PRIMARY KEY AUTOINCREMENT,
    email         TEXT UNIQUE NOT NULL,
    password_hash TEXT NOT NULL,
    full_name     TEXT NOT NULL,
    phone         TEXT NOT NULL DEFAULT '',
    role          TEXT NOT NULL DEFAULT 'customer',
    created_at    TEXT NOT NULL,
    default_plate TEXT NOT NULL DEFAULT ''
);
CREATE TABLE IF NOT EXISTS activity_logs (
    id         INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id    INTEGER,
    email      TEXT NOT NULL DEFAULT '',
    action     TEXT NOT NULL,
    details    TEXT NOT NULL DEFAULT '',
    created_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS payment_logs (
    id               INTEGER PRIMARY KEY AUTOINCREMENT,
    bank_tx_id       TEXT UNIQUE,
    gateway          TEXT NOT NULL DEFAULT '',
    amount           INTEGER NOT NULL DEFAULT 0,
    content          TEXT NOT NULL DEFAULT '',
    kind             TEXT,
    matched_ticket   TEXT,
    reservation_id   INTEGER,
    session_id       INTEGER,
    status           TEXT NOT NULL,
    expected_amount  INTEGER,
    reference_code   TEXT,
    transaction_date TEXT,
    resolution       TEXT,
    resolved_note    TEXT,
    resolved_by      TEXT,
    resolved_at      TEXT,
    created_at       TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS payment_receipts (
    id             INTEGER PRIMARY KEY AUTOINCREMENT,
    reservation_id INTEGER,
    user_id        INTEGER,
    email          TEXT NOT NULL DEFAULT '',
    ticket_code    TEXT,
    license_plate  TEXT,
    slot_code      TEXT,
    amount         INTEGER,
    file_name      TEXT NOT NULL,
    note           TEXT NOT NULL DEFAULT '',
    status         TEXT NOT NULL DEFAULT 'new',
    resolved_by    TEXT,
    resolved_at    TEXT,
    created_at     TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS parking_maps (
    id         INTEGER PRIMARY KEY AUTOINCREMENT,
    name       TEXT NOT NULL,
    config     TEXT NOT NULL,
    updated_by TEXT NOT NULL DEFAULT '',
    updated_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS telemetry_locations (
    user_id    INTEGER PRIMARY KEY,
    email      TEXT NOT NULL DEFAULT '',
    lat        REAL NOT NULL,
    lng        REAL NOT NULL,
    accuracy   REAL,
    speed      REAL,
    heading    REAL,
    updated_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_pay_created ON payment_logs(created_at);
CREATE INDEX IF NOT EXISTS idx_rcpt_res ON payment_receipts(reservation_id);
CREATE INDEX IF NOT EXISTS idx_act_user ON activity_logs(user_id);
CREATE INDEX IF NOT EXISTS idx_act_created ON activity_logs(created_at);
CREATE INDEX IF NOT EXISTS idx_res_status ON reservations(status);
CREATE INDEX IF NOT EXISTS idx_sess_status ON parking_sessions(status);
CREATE INDEX IF NOT EXISTS idx_logs_created ON hardware_logs(created_at);
"""


def now() -> datetime:
    """Thời gian hiện tại (có múi giờ địa phương)."""
    return datetime.now().astimezone()


def now_iso() -> str:
    return now().isoformat(timespec="seconds")


def parse_dt(value: str) -> datetime:
    return datetime.fromisoformat(value)


def get_conn():
    global _conn
    if _conn is None:
        if IS_PG:
            _conn = _PgConn()
        else:
            _conn = sqlite3.connect(DB_PATH, check_same_thread=False, isolation_level=None)
            _conn.row_factory = sqlite3.Row
            _conn.execute("PRAGMA foreign_keys = ON")
            _conn.execute("PRAGMA journal_mode = WAL")
    return _conn


def db_kind() -> str:
    return "postgresql" if IS_PG else "sqlite"


class Tx:
    """Context manager: khóa + transaction. Dùng: `with Tx() as db: db.execute(...)`."""

    def __enter__(self):
        _lock.acquire()
        try:
            self.db = get_conn()
            self.db.execute("BEGIN IMMEDIATE")
            if IS_PG:
                self.db.in_tx = True
        except BaseException:
            _lock.release()
            raise
        return self.db

    def __exit__(self, exc_type, exc, tb):
        try:
            if exc_type is None:
                self.db.execute("COMMIT")
            else:
                try:
                    self.db.execute("ROLLBACK")
                except Exception:
                    pass  # kết nối đã mất -> transaction tự hủy phía server
        finally:
            if IS_PG:
                self.db.in_tx = False
            _lock.release()
        return False


def query(sql: str, params: tuple = ()) -> list[dict]:
    with _lock:
        return [dict(r) for r in get_conn().execute(sql, params).fetchall()]


def query_one(sql: str, params: tuple = ()) -> dict | None:
    with _lock:
        row = get_conn().execute(sql, params).fetchone()
        return dict(row) if row else None


def seed_slots(db) -> None:
    for floor, letter in FLOORS.items():
        for i in range(1, SLOTS_PER_FLOOR + 1):
            code = f"T{floor}-{letter}{i:02d}"
            db.execute(
                "INSERT OR IGNORE INTO slots (code, floor, status) VALUES (?, ?, 'available')",
                (code, floor),
            )


# Cột bổ sung cho DB cũ (tự thêm nếu thiếu)
MIGRATIONS = {
    "reservations": [("user_id", "INTEGER REFERENCES users(id)"), ("ticket_code", "TEXT"),
                     # 'deposit' | 'admin_free' | 'demo' (cọc giả lập từ Bảng Demo, không tính doanh thu); 'none' chỉ còn ở lịch sử cũ
                     ("deposit_mode", "TEXT NOT NULL DEFAULT 'deposit'"),
                     ("parked_at", "TEXT")],  # khách / Bảo vệ xác nhận xe đã đỗ đúng ô
    "parking_sessions": [("user_id", "INTEGER REFERENCES users(id)"),
                         ("fee_waived", "INTEGER NOT NULL DEFAULT 0"),  # 1 = miễn phí (Admin)
                         # Thanh toán trước khi ra cổng (payment_status = 'paid_ready')
                         ("prepaid_amount", "INTEGER NOT NULL DEFAULT 0"),  # số tiền đã trả trước (cộng dồn)
                         ("prepay_method", "TEXT"),
                         ("prepaid_at", "TEXT"),
                         ("prepaid_hours", "INTEGER"),
                         ("prepaid_total", "INTEGER"),
                         ("exit_deadline", "TEXT"),       # hạn ra cổng = lúc trả + exit_grace_minutes
                         ("prepay_due", "INTEGER"),       # số tiền đã hiện trên VietQR khi khách bấm thanh toán trước
                         ("prepay_requested_at", "TEXT"),
                         ("parked_confirmed_at", "TEXT")],  # đã xác nhận đỗ đúng ô (tắt dẫn đường, không báo đỗ nhầm)
    # active = 0: ô đã bị xóa khỏi sơ đồ (giữ dòng để không mất lịch sử đặt chỗ / lượt gửi)
    "slots": [("active", "INTEGER NOT NULL DEFAULT 1")],
    "users": [("default_plate", "TEXT NOT NULL DEFAULT ''")],
    # Ảnh biên lai lưu thẳng trong CSDL (base64) để không mất khi server Cloud khởi động lại
    "payment_receipts": [("receipt_data", "TEXT"), ("receipt_mime", "TEXT")],
}


def migrate(db) -> None:
    for table, cols in MIGRATIONS.items():
        if IS_PG:
            for name, decl in cols:
                db.execute(f"ALTER TABLE {table} ADD COLUMN IF NOT EXISTS {name} {decl}")
            continue
        existing = {r["name"] for r in db.execute(f"PRAGMA table_info({table})").fetchall()}
        for name, decl in cols:
            if name not in existing:
                db.execute(f"ALTER TABLE {table} ADD COLUMN {name} {decl}")
    db.execute("CREATE UNIQUE INDEX IF NOT EXISTS idx_res_ticket ON reservations(ticket_code)")
    db.execute("CREATE INDEX IF NOT EXISTS idx_res_user ON reservations(user_id)")
    db.execute("CREATE INDEX IF NOT EXISTS idx_sess_user ON parking_sessions(user_id)")


def init_db() -> None:
    db = get_conn()
    with _lock:
        db.executescript(_pg_schema(SCHEMA) if IS_PG else SCHEMA)
        migrate(db)
    with Tx() as db:
        for k, v in DEFAULT_SETTINGS.items():
            db.execute("INSERT OR IGNORE INTO settings (key, value) VALUES (?, ?)", (k, v))
        db.execute("DELETE FROM settings WHERE key = 'admin_pin'")  # thay bằng đăng nhập + phân quyền
        db.execute("DELETE FROM settings WHERE key = 'soft_hold_minutes'")  # đã bỏ đặt chỗ không cọc
        db.execute("DELETE FROM settings WHERE key = 'auto_approve_deposit'")  # cọc chỉ được duyệt khi tiền về (SePay) hoặc Bảo vệ duyệt
        seed_slots(db)


def get_settings() -> dict:
    rows = query("SELECT key, value FROM settings")
    raw = {r["key"]: r["value"] for r in rows}
    cfg = {}
    for k in INT_SETTINGS:
        try:
            cfg[k] = int(raw.get(k, DEFAULT_SETTINGS[k]))
        except ValueError:
            cfg[k] = int(DEFAULT_SETTINGS[k])
    for k in TEXT_SETTINGS:
        cfg[k] = raw.get(k, DEFAULT_SETTINGS[k])
    for k in SECRET_SETTINGS:
        cfg[k] = raw.get(k, DEFAULT_SETTINGS[k])
    cfg["auto_gate"] = raw.get("auto_gate", "0") in ("1", "true", "True")
    return cfg


def log_activity(db, user_id, email: str, action: str, details: str = "") -> None:
    """Ghi lịch sử hoạt động tài khoản (dùng trong transaction đang mở)."""
    db.execute(
        "INSERT INTO activity_logs (user_id, email, action, details, created_at) VALUES (?, ?, ?, ?, ?)",
        (user_id, email or "", action, details, now_iso()),
    )


def ensure_slot(db, code: str, floor: int) -> None:
    """Thêm ô mới (Trình chỉnh sửa bản đồ) hoặc kích hoạt lại ô đã xóa trước đó."""
    if db.execute("SELECT 1 FROM slots WHERE code = ?", (code,)).fetchone():
        db.execute("UPDATE slots SET active = 1, floor = ? WHERE code = ?", (floor, code))
    else:
        db.execute("INSERT INTO slots (code, floor, status, active) VALUES (?, ?, 'available', 1)", (code, floor))
