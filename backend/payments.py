"""Thanh toán qua SePay Webhook, lưu `payment_logs` & biên lai khách gửi, đối soát (duyệt bù / hoàn tiền)."""
import base64
import binascii
import csv
import hmac
import io
import os
import re
import secrets
import unicodedata
from datetime import timedelta
from pathlib import Path

import services as svc
from database import Tx, get_settings, log_activity, now, now_iso, parse_dt, query, query_one

RECEIPT_DIR = Path(__file__).parent / "uploads" / "receipts"
MAX_RECEIPT_BYTES = 5 * 1024 * 1024
MAX_RECEIPTS_PER_TICKET = 5

COC_RE = re.compile(r"COC([2-9A-HJ-NP-Z]{6})")

STATUS_LABEL = {
    "matched": "Khớp — đã tự xác nhận",
    "underpaid": "Chuyển thiếu tiền",
    "wrong_content": "Sai / thiếu nội dung",
    "expired_late": "Tiền về trễ (vé đã hết hạn/hủy)",
    "already_paid": "Trùng — vé đã được xác nhận trước",
}
RESOLUTION_LABEL = {"approved": "Đã duyệt bù", "refunded": "Đã hoàn tiền"}


def compact_text(s: str) -> str:
    """Bỏ dấu, khoảng trắng, ký tự đặc biệt: 'COC 7K3QX9 65A-123.45' -> 'COC7K3QX965A12345'."""
    s = unicodedata.normalize("NFD", s or "").encode("ascii", "ignore").decode()
    return re.sub(r"[^A-Z0-9]", "", s.upper())


def _clean_key(v: str) -> str:
    """Bỏ khoảng trắng / xuống dòng / dấu nháy thừa khi copy-paste."""
    return (v or "").strip().strip("\"'").strip()


def valid_api_keys() -> list:
    """Khóa hợp lệ: biến môi trường `SEPAY_API_KEY` (Render) và/hoặc khóa nhập trong Cài đặt Admin."""
    keys = [_clean_key(os.environ.get("SEPAY_API_KEY", "")), _clean_key(get_settings()["sepay_api_key"])]
    return [k for k in dict.fromkeys(keys) if k]


def extract_api_key(headers) -> str:
    """Nhận `Authorization: Apikey <KEY>` (chuẩn SePay), `Bearer <KEY>`, hoặc header `x-api-key`."""
    auth = _clean_key(headers.get("authorization", ""))
    m = re.match(r"^(?:apikey|bearer)\s*[:=]?\s*(.+)$", auth, re.I)
    if m:
        return _clean_key(m.group(1))
    return _clean_key(headers.get("x-api-key", "")) or auth


def check_api_key(headers) -> bool:
    if isinstance(headers, str):
        headers = {"authorization": headers}
    got = extract_api_key(headers)
    return bool(got) and any(hmac.compare_digest(got.encode(), k.encode()) for k in valid_api_keys())


def _to_int(v) -> int:
    try:
        return int(round(float(str(v).replace(",", ""))))
    except (TypeError, ValueError):
        return 0


def _find_reservation(db, compact: str):
    """Tìm vé theo nội dung CK: ưu tiên dạng `COC<MÃ_VÉ>`, sau đó mã vé (6 ký tự) xuất hiện trong nội dung (3 ngày gần đây)."""
    for m in COC_RE.finditer(compact):
        r = db.execute("SELECT * FROM reservations WHERE ticket_code = ?", (m.group(1),)).fetchone()
        if r:
            return r
    since = (now() - timedelta(days=3)).isoformat(timespec="seconds")
    for r in db.execute("SELECT * FROM reservations WHERE created_at >= ? AND ticket_code IS NOT NULL ORDER BY id DESC",
                        (since,)).fetchall():
        if r["ticket_code"] in compact:
            return r
    return None


def _find_parked(db, compact: str):
    """Phí gửi xe: nội dung `PHI <BIỂN_SỐ>` (hoặc chứa biển số nếu không phải nội dung đặt cọc)."""
    for s in db.execute("SELECT * FROM parking_sessions WHERE status = 'parked' ORDER BY id DESC").fetchall():
        plate = compact_text(s["license_plate"])
        if "PHI" + plate in compact or ("COC" not in compact and plate in compact):
            return s
    return None


def process_webhook(p: dict) -> dict:
    """Xử lý 1 giao dịch SePay. Trả về {'log': ..., 'events': [(event, data)], 'open_exit': plate|None}."""
    if str(p.get("transferType", "")).lower() != "in":
        return {"ignored": "chỉ xử lý giao dịch tiền vào"}
    tx_id = str(p.get("id") or p.get("referenceCode") or "").strip() or None
    amount = _to_int(p.get("transferAmount"))
    content = str(p.get("content") or p.get("description") or "")[:500]
    compact = compact_text(content)
    rid = sid = ticket = kind = expected = None
    status = "wrong_content"
    approved_rid = paid_sid = prepaid_sid = None
    open_exit = None

    with Tx() as db:
        if tx_id and db.execute("SELECT 1 FROM payment_logs WHERE bank_tx_id = ?", (tx_id,)).fetchone():
            return {"duplicate": True}

        r = _find_reservation(db, compact)
        if r:
            kind, rid, ticket, expected = "deposit", r["id"], r["ticket_code"], r["deposit_amount"]
            if r["status"] == "pending_payment":
                if amount >= r["deposit_amount"]:
                    svc.activate_reservation_tx(db, r, via="sepay")
                    status, approved_rid = "matched", r["id"]
                else:
                    status = "underpaid"
            elif r["status"] in ("expired", "cancelled"):
                status = "expired_late"
            else:
                status = "already_paid"
        else:
            s = _find_parked(db, compact)
            if s:
                kind, sid, ticket = "parking", s["id"], s["license_plate"]
                q = svc.quote_session(s)
                expected = q["amount_due"]
                at_gate = bool(s["check_out_time"]) and s["payment_status"] == "pending"
                if s["payment_status"] == "paid_ready" and not svc._deadline_passed(s):
                    status = "already_paid"
                elif at_gate:
                    # Xe đang đứng ở cổng ra: giá đã chốt lúc tới cổng — chấp nhận nếu đồng hồ đã nhảy sang giờ kế tiếp
                    locked = None
                    if s["amount_due"] is not None:
                        locked = {"hours_billed": s["hours_billed"], "total_fee": s["total_fee"], "amount_due": s["amount_due"]}
                    if amount >= q["amount_due"]:
                        svc.pay_tx(db, s, "online_qr", "sepay", q)
                        status, paid_sid = "matched", s["id"]
                    elif locked and amount >= locked["amount_due"]:
                        svc.pay_tx(db, s, "online_qr", "sepay", locked)
                        status, paid_sid, expected = "matched", s["id"], locked["amount_due"]
                    else:
                        status = "underpaid"
                    if paid_sid:
                        open_exit = s["license_plate"]
                else:
                    # Thanh toán trước khi ra cổng -> 'paid_ready' + đếm ngược thời gian ra cổng
                    lock = s["prepay_due"] if (s["prepay_due"] and s["prepay_requested_at"] and
                                               now() - parse_dt(s["prepay_requested_at"]) <= timedelta(minutes=svc.PREPAY_LOCK_MINUTES)) else None
                    if amount >= q["amount_due"]:
                        svc.mark_prepaid_tx(db, s, "online_qr", q, q["amount_due"], "sepay")
                        status, prepaid_sid = "matched", s["id"]
                    elif lock and amount >= lock:
                        svc.mark_prepaid_tx(db, s, "online_qr", q, lock, "sepay")
                        status, prepaid_sid, expected = "matched", s["id"], lock
                    else:
                        status = "underpaid"

        cur = db.execute(
            """INSERT INTO payment_logs (bank_tx_id, gateway, amount, content, kind, matched_ticket, reservation_id, session_id,
               status, expected_amount, reference_code, transaction_date, created_at)
               VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)""",
            (tx_id, str(p.get("gateway") or "")[:40], amount, content, kind, ticket, rid, sid, status, expected,
             str(p.get("referenceCode") or "")[:60], str(p.get("transactionDate") or "")[:40], now_iso()),
        )
        log_id = cur.lastrowid
        if status != "matched":
            svc.log(db, "sepay", "payment_issue",
                    f"Giao dịch {tx_id or '?'} {amount:,}đ \"{content[:60]}\" → {STATUS_LABEL[status]}"
                    + (f" (vé/biển {ticket}, cần {expected:,}đ)" if ticket and expected is not None else ""))
            owner = db.execute("SELECT user_id FROM reservations WHERE id = ?", (rid,)).fetchone() if rid else None
            if owner and owner["user_id"]:
                log_activity(db, owner["user_id"], svc._user_email(db, owner["user_id"]), "payment_issue",
                             f"Nhận {amount:,}đ cho vé {ticket}: {STATUS_LABEL[status]} — Bảo vệ sẽ đối soát")

    events = []
    # Sự kiện WebSocket luôn kèm reservation_id / session_id / user_id để trang khách nhận ra vé của mình
    if approved_rid:
        res = svc.get_reservation(approved_rid)
        events.append(("deposit_approved", {**res, "via": "sepay", "reservation_id": res["id"], "user_id": res.get("user_id")}))
    if paid_sid:
        sess = svc.get_session(paid_sid)
        events.append(("payment", {**sess, "via": "sepay", "session_id": sess["id"], "user_id": sess.get("user_id")}))
    if prepaid_sid:
        sess = svc.get_session(prepaid_sid)
        events.append(("prepaid", {**sess, "via": "sepay", "session_id": sess["id"], "user_id": sess.get("user_id")}))
    row = log_row(log_id)
    events.append(("payment_log", row))
    return {"log": row, "events": events, "open_exit": open_exit}


def log_row(log_id: int) -> dict:
    row = query_one("SELECT * FROM payment_logs WHERE id = ?", (log_id,))
    if row:
        row["status_label"] = STATUS_LABEL.get(row["status"], row["status"])
    return row


# ---------------------------------------------------------------- Biên lai khách gửi
def sniff_image(data: bytes) -> str | None:
    if data[:3] == b"\xff\xd8\xff":
        return "jpg"
    if data[:8] == b"\x89PNG\r\n\x1a\n":
        return "png"
    if data[:4] == b"RIFF" and data[8:12] == b"WEBP":
        return "webp"
    if data[:6] in (b"GIF87a", b"GIF89a"):
        return "gif"
    if data[4:8] == b"ftyp" and data[8:12] in (b"heic", b"heix", b"mif1", b"msf1", b"heif"):
        return "heic"
    return None


MAX_RECEIPT_DB_BYTES = 300 * 1024  # ảnh đã được trình duyệt nén (JPEG/WebP) trước khi gửi
_DATA_URL_RE = re.compile(r"^data:(image/(?:jpeg|webp|png));base64,([A-Za-z0-9+/=\s]+)$")
# Cột trả về cho danh sách/chi tiết biên lai — KHÔNG kèm receipt_data (ảnh base64) để danh sách nhẹ
RECEIPT_COLS = """pr.id, pr.reservation_id, pr.user_id, pr.email, pr.ticket_code, pr.license_plate, pr.slot_code, pr.amount,
                  pr.file_name, pr.note, pr.status, pr.resolved_by, pr.resolved_at, pr.created_at, pr.receipt_mime"""


def save_receipt(user: dict, reservation_id: int, image: str, note: str) -> dict:
    """Ảnh biên lai (data URL base64, đã nén phía trình duyệt < 300KB) lưu thẳng vào cột receipt_data."""
    m = _DATA_URL_RE.match((image or "").strip())
    if not m:
        svc.fail("Ảnh biên lai không hợp lệ (cần JPEG/WebP/PNG dạng base64)")
    mime, b64 = m.group(1), re.sub(r"\s", "", m.group(2))
    try:
        data = base64.b64decode(b64, validate=True)
    except (binascii.Error, ValueError):
        svc.fail("Ảnh biên lai bị lỗi mã hóa base64")
    if not data:
        svc.fail("Chưa chọn ảnh biên lai")
    if len(data) > MAX_RECEIPT_DB_BYTES:
        svc.fail("Ảnh biên lai sau khi nén vẫn lớn hơn 300KB — hãy chụp lại hoặc cắt bớt ảnh", 413)
    ext = sniff_image(data)
    if ext not in ("jpg", "webp", "png"):
        svc.fail("Chỉ nhận ảnh JPEG, WebP hoặc PNG")
    r = query_one("""SELECT r.*, s.code AS slot_code FROM reservations r JOIN slots s ON s.id = r.slot_id
                     WHERE r.id = ?""", (reservation_id,))
    if not r or (user["role"] != "admin" and r["user_id"] != user["id"]):
        svc.fail("Không tìm thấy đặt chỗ của bạn", 404)
    n = query_one("SELECT COUNT(*) AS n FROM payment_receipts WHERE reservation_id = ?", (reservation_id,))["n"]
    if n >= MAX_RECEIPTS_PER_TICKET:
        svc.fail(f"Mỗi vé chỉ gửi tối đa {MAX_RECEIPTS_PER_TICKET} ảnh biên lai")
    name = f"{r['ticket_code'] or r['id']}_{now().strftime('%Y%m%d%H%M%S')}_{secrets.token_hex(4)}.{ext}"
    with Tx() as db:
        cur = db.execute(
            """INSERT INTO payment_receipts (reservation_id, user_id, email, ticket_code, license_plate, slot_code, amount,
               file_name, note, status, created_at, receipt_data, receipt_mime) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'new', ?, ?, ?)""",
            (r["id"], user["id"], user["email"], r["ticket_code"], r["license_plate"], r["slot_code"], r["deposit_amount"],
             name, (note or "").strip()[:500], now_iso(), base64.b64encode(data).decode(), mime),
        )
        rcid = cur.lastrowid
        svc.log(db, "web", "receipt", f"Khách {user['email']} gửi ảnh biên lai cho vé {r['ticket_code']} ({r['license_plate']})")
        log_activity(db, user["id"], user["email"], "receipt_upload",
                     f"Gửi ảnh biên lai vé {r['ticket_code']} · {r['license_plate']} · ô {r['slot_code']}")
    return receipt_row(rcid)


def receipt_row(rcid: int) -> dict:
    row = query_one(f"""SELECT {RECEIPT_COLS}, r.status AS reservation_status FROM payment_receipts pr
                        LEFT JOIN reservations r ON r.id = pr.reservation_id WHERE pr.id = ?""", (rcid,))
    if not row:
        svc.fail("Không tìm thấy biên lai", 404)
    return row


_EXT_MIME = {"jpg": "image/jpeg", "png": "image/png", "webp": "image/webp", "gif": "image/gif", "heic": "image/heic"}


def receipt_image(rcid: int) -> tuple[bytes, str, str]:
    """(bytes, mime, tên file) — ưu tiên ảnh lưu trong CSDL; biên lai cũ (trước khi lưu DB) đọc từ uploads/receipts/."""
    row = query_one("SELECT file_name, receipt_data, receipt_mime FROM payment_receipts WHERE id = ?", (rcid,))
    if not row:
        svc.fail("Không tìm thấy biên lai", 404)
    if row["receipt_data"]:
        return base64.b64decode(row["receipt_data"]), row["receipt_mime"] or "image/jpeg", row["file_name"]
    path = (RECEIPT_DIR / row["file_name"]).resolve()
    if RECEIPT_DIR.resolve() not in path.parents or not path.is_file():
        svc.fail("Ảnh biên lai không còn trên máy chủ", 404)
    return path.read_bytes(), _EXT_MIME.get(path.suffix.lstrip(".").lower(), "application/octet-stream"), row["file_name"]


# ---------------------------------------------------------------- Đối soát (Admin)
def list_reconcile(status: str = "", q: str = "", limit: int = 300) -> dict:
    sql, params = "SELECT * FROM payment_logs WHERE 1=1", []
    if status == "problem":
        sql += " AND status != 'matched'"
    elif status == "unresolved":
        sql += " AND status != 'matched' AND resolution IS NULL"
    elif status:
        sql += " AND status = ?"
        params.append(status)
    if q.strip():
        sql += " AND (content LIKE ? OR matched_ticket LIKE ? OR bank_tx_id LIKE ?)"
        params += [f"%{q.strip()}%"] * 3
    sql += " ORDER BY id DESC LIMIT ?"
    params.append(max(1, min(limit, 2000)))
    logs = query(sql, tuple(params))
    for row in logs:
        row["status_label"] = STATUS_LABEL.get(row["status"], row["status"])
    receipts = query(f"""SELECT {RECEIPT_COLS}, r.status AS reservation_status FROM payment_receipts pr
                        LEFT JOIN reservations r ON r.id = pr.reservation_id ORDER BY pr.id DESC LIMIT 200""")

    def scalar(sql_):
        return list(query_one(sql_).values())[0] or 0

    summary = {
        "total": scalar("SELECT COUNT(*) FROM payment_logs"),
        "matched": scalar("SELECT COUNT(*) FROM payment_logs WHERE status = 'matched'"),
        "matched_amount": scalar("SELECT SUM(amount) FROM payment_logs WHERE status = 'matched'"),
        "problems_open": scalar("SELECT COUNT(*) FROM payment_logs WHERE status != 'matched' AND resolution IS NULL"),
        "problems_amount": scalar("SELECT SUM(amount) FROM payment_logs WHERE status != 'matched' AND resolution IS NULL"),
        "receipts_new": scalar("SELECT COUNT(*) FROM payment_receipts WHERE status = 'new'"),
        "refunded_amount": scalar("SELECT SUM(amount) FROM payment_logs WHERE resolution = 'refunded'"),
    }
    return {"logs": logs, "receipts": receipts, "summary": summary, "status_labels": STATUS_LABEL}


def _resolve_reservation(rid: int, admin: dict) -> dict:
    """Duyệt bù 1 vé: chờ CK -> active; hết hạn/hủy -> mở lại nếu ô còn trống; đã xác nhận -> giữ nguyên."""
    r = query_one("SELECT status FROM reservations WHERE id = ?", (rid,))
    if not r:
        svc.fail("Không tìm thấy đặt chỗ", 404)
    if r["status"] in ("active", "checked_in"):
        return svc.get_reservation(rid)
    res = svc.approve_deposit(rid, admin, via="reconcile", allow_reopen=True)
    res["via"] = "reconcile"
    return res


def approve_log(log_id: int, admin: dict, ticket_code: str | None, note: str | None) -> dict:
    """Duyệt bù 1 giao dịch lỗi. Trả về {'log', 'reservation'|None, 'session'|None}."""
    row = query_one("SELECT * FROM payment_logs WHERE id = ?", (log_id,))
    if not row:
        svc.fail("Không tìm thấy giao dịch", 404)
    if row["resolution"]:
        svc.fail(f"Giao dịch này đã được xử lý ({RESOLUTION_LABEL.get(row['resolution'])})")
    if row["status"] == "matched":
        svc.fail("Giao dịch đã khớp tự động, không cần duyệt bù")
    reservation = session = prepaid = None
    code = (ticket_code or "").strip().upper()
    if code:
        target = query_one("SELECT id FROM reservations WHERE ticket_code = ?", (code,))
        if not target:
            svc.fail(f"Không tìm thấy vé {code}", 404)
        reservation = _resolve_reservation(target["id"], admin)
    elif row["reservation_id"]:
        reservation = _resolve_reservation(row["reservation_id"], admin)
    elif row["session_id"]:
        s = query_one("SELECT status, payment_status, check_out_time FROM parking_sessions WHERE id = ?", (row["session_id"],))
        if s and s["status"] == "parked":
            if s["check_out_time"] and s["payment_status"] == "pending":  # xe đang ở cổng ra -> hoàn tất, mở barrier
                session = svc.pay(row["session_id"], "online_qr", source="admin")
            elif s["payment_status"] != "paid_ready":  # thanh toán trước -> Sẵn sàng ra cổng
                prepaid = svc.confirm_prepay(row["session_id"], "online_qr", admin)
    else:
        svc.fail("Giao dịch sai nội dung: hãy nhập Mã vé cần duyệt bù")
    _mark(log_id, "payment_logs", "approved", admin, note,
          f"Duyệt bù giao dịch {row['bank_tx_id']} {row['amount']:,}đ"
          + (f" cho vé {reservation['ticket_code']}" if reservation else f" phí gửi xe {row['matched_ticket']}"),
          ticket=reservation["ticket_code"] if reservation else None, rid=reservation["id"] if reservation else None)
    return {"log": log_row(log_id), "reservation": reservation, "session": session, "prepaid": prepaid}


def refund_log(log_id: int, admin: dict, note: str | None) -> dict:
    row = query_one("SELECT * FROM payment_logs WHERE id = ?", (log_id,))
    if not row:
        svc.fail("Không tìm thấy giao dịch", 404)
    if row["resolution"]:
        svc.fail(f"Giao dịch này đã được xử lý ({RESOLUTION_LABEL.get(row['resolution'])})")
    _mark(log_id, "payment_logs", "refunded", admin, note,
          f"Đánh dấu đã hoàn {row['amount']:,}đ giao dịch {row['bank_tx_id']} ({row['matched_ticket'] or row['content'][:40]})")
    return {"log": log_row(log_id)}


def approve_receipt(rcid: int, admin: dict) -> dict:
    row = receipt_row(rcid)
    if row["status"] != "new":
        svc.fail("Biên lai này đã được xử lý")
    reservation = _resolve_reservation(row["reservation_id"], admin) if row["reservation_id"] else None
    _mark(rcid, "payment_receipts", "approved", admin, None,
          f"Duyệt bù theo ảnh biên lai vé {row['ticket_code']} ({row['license_plate']})")
    return {"receipt": receipt_row(rcid), "reservation": reservation}


def refund_receipt(rcid: int, admin: dict) -> dict:
    row = receipt_row(rcid)
    if row["status"] != "new":
        svc.fail("Biên lai này đã được xử lý")
    _mark(rcid, "payment_receipts", "refunded", admin, None,
          f"Đánh dấu đã hoàn tiền theo biên lai vé {row['ticket_code']} ({row['license_plate']})")
    return {"receipt": receipt_row(rcid)}


def _mark(row_id: int, table: str, resolution: str, admin: dict, note: str | None, details: str,
          ticket: str | None = None, rid: int | None = None) -> None:
    with Tx() as db:
        if table == "payment_logs":
            db.execute("""UPDATE payment_logs SET resolution = ?, resolved_note = ?, resolved_by = ?, resolved_at = ?,
                          matched_ticket = COALESCE(?, matched_ticket), reservation_id = COALESCE(?, reservation_id)
                          WHERE id = ?""", (resolution, (note or "").strip()[:300], admin["email"], now_iso(), ticket, rid, row_id))
        else:
            db.execute("UPDATE payment_receipts SET status = ?, resolved_by = ?, resolved_at = ? WHERE id = ?",
                       (resolution, admin["email"], now_iso(), row_id))
        full = details + (f" — ghi chú: {note.strip()}" if note and note.strip() else "")
        svc.log(db, "admin", "reconcile", full)
        log_activity(db, admin["id"], admin["email"], "payment_refund" if resolution == "refunded" else "payment_reconcile", full)


def export_csv() -> bytes:
    """Báo cáo đối soát (.csv, UTF-8 BOM để Excel đọc đúng tiếng Việt)."""
    buf = io.StringIO()
    w = csv.writer(buf)
    w.writerow(["ID", "Mã GD ngân hàng", "Thời gian nhận", "Ngày GD (SePay)", "Ngân hàng", "Số tiền", "Số tiền cần",
                "Nội dung CK", "Loại", "Vé / Biển số", "Trạng thái", "Xử lý", "Người xử lý", "Lúc xử lý", "Ghi chú"])
    for r in query("SELECT * FROM payment_logs ORDER BY id"):
        w.writerow([r["id"], r["bank_tx_id"], r["created_at"], r["transaction_date"], r["gateway"], r["amount"],
                    r["expected_amount"] if r["expected_amount"] is not None else "", r["content"],
                    {"deposit": "Tiền cọc", "parking": "Phí gửi xe"}.get(r["kind"], ""), r["matched_ticket"] or "",
                    STATUS_LABEL.get(r["status"], r["status"]), RESOLUTION_LABEL.get(r["resolution"], ""),
                    r["resolved_by"] or "", r["resolved_at"] or "", r["resolved_note"] or ""])
    w.writerow([])
    w.writerow(["BIÊN LAI KHÁCH GỬI"])
    w.writerow(["ID", "Thời gian", "Email", "Mã vé", "Biển số", "Ô", "Tiền cọc", "Ghi chú khách", "Trạng thái", "Người xử lý", "File ảnh"])
    for r in query(f"SELECT {RECEIPT_COLS} FROM payment_receipts pr ORDER BY pr.id"):
        w.writerow([r["id"], r["created_at"], r["email"], r["ticket_code"], r["license_plate"], r["slot_code"], r["amount"],
                    r["note"], {"new": "Chờ xử lý", **RESOLUTION_LABEL}.get(r["status"], r["status"]), r["resolved_by"] or "",
                    r["file_name"]])
    return ("﻿" + buf.getvalue()).encode("utf-8")
