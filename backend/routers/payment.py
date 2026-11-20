"""Thanh toán: Webhook SePay (tự duyệt cọc / phí gửi xe), biên lai khách gửi, đối soát cho Admin."""
import json
from urllib.parse import parse_qs

from fastapi import APIRouter, Depends, Request
from fastapi.responses import JSONResponse, Response

import auth
import payments as pay
from database import now
from models import ReceiptUpload, ResolveInput
from realtime import barriers, manager

router = APIRouter(prefix="/api/payment", tags=["payment"])
admin_router = APIRouter(prefix="/api/admin", tags=["admin"], dependencies=[Depends(auth.require_admin)])


WEBHOOK_METHODS = ["GET", "HEAD", "POST", "OPTIONS"]


def _parse_body(raw: bytes, ctype: str):
    """JSON (chuẩn SePay) hoặc form-urlencoded (dự phòng)."""
    if not raw:
        return None
    try:
        return json.loads(raw)
    except Exception:
        pass
    if "form" in ctype:
        return {k: v[-1] for k, v in parse_qs(raw.decode("utf-8", "replace")).items()}
    return None


async def sepay_webhook(request: Request):
    """Webhook SePay — chính thức: `POST /api/payment/webhook` (nhận cả `/webhook/`, `/api/sepay/webhook`).
    Header: `Authorization: Apikey <KEY>` (hoặc `Bearer <KEY>` / `X-Api-Key`), sai -> 401 kèm lý do.
    GET/HEAD/OPTIONS (SePay / trình duyệt kiểm tra kết nối) -> 200, không xử lý giao dịch.
    POST hợp lệ luôn trả 200 {"success": true} (giao dịch lỗi vẫn lưu payment_logs để đối soát)."""
    raw = await request.body()
    client = request.headers.get("x-forwarded-for") or (request.client.host if request.client else "?")
    # Log chi tiết NGAY ĐẦU HÀM (trước khi kiểm tra khóa) -> xem trong Render → Logs; giá trị khóa luôn được che
    print(f"[SePay webhook] {request.method} {request.url.path}{'?' + request.url.query if request.url.query else ''} "
          f"từ {client}\n  headers = {json.dumps(pay.mask_headers(request.headers), ensure_ascii=False)}\n"
          f"  body ({len(raw)} byte) = {raw[:4000].decode('utf-8', 'replace')}", flush=True)

    if request.method != "POST":
        if request.method == "HEAD":
            return Response(status_code=200)
        return {"success": True, "message": "Webhook SePay đang hoạt động — SePay cần gửi POST kèm JSON giao dịch",
                "api_key_configured": bool(pay.valid_api_keys())}

    problem = pay.api_key_problem(request.headers)
    if problem:
        fps = ", ".join("#" + pay.key_fingerprint(k) for k in pay.valid_api_keys()) or "không có"
        print(f"[SePay webhook] 401 — {problem} (khóa trên server: {fps})", flush=True)
        return JSONResponse({"success": False, "message": problem}, status_code=401)

    body = _parse_body(raw, request.headers.get("content-type", ""))
    if not isinstance(body, dict):
        print("[SePay webhook] Bỏ qua: body không phải JSON object", flush=True)
        return {"success": True, "note": "Bỏ qua: dữ liệu không phải JSON object"}
    result = pay.process_webhook(body)
    for event, data in result.get("events", []):
        await manager.broadcast(event, data)
    if result.get("open_exit"):
        await barriers.open("exit", f"Xe {result['open_exit']} đã thanh toán (SePay)")
    if result.get("log") or result.get("open_exit"):
        await manager.broadcast("log")
    log = result.get("log")
    print(f"[SePay webhook] OK — {log.get('status') if isinstance(log, dict) else 'đã xử lý'}", flush=True)
    return {"success": True}


for _p in ("/webhook", "/webhook/"):
    router.add_api_route(_p, sepay_webhook, methods=WEBHOOK_METHODS, include_in_schema=_p == "/webhook")
# Đường dẫn phụ phòng khi nhập nhầm URL trong SePay
alias_router = APIRouter(tags=["payment"])
for _p in ("/api/sepay/webhook", "/api/sepay/webhook/", "/api/webhook", "/webhook"):
    alias_router.add_api_route(_p, sepay_webhook, methods=WEBHOOK_METHODS, include_in_schema=False)


@router.post("/receipts")
async def upload_receipt(body: ReceiptUpload, user: dict = Depends(auth.current_user)):
    """Khách gửi ảnh biên lai chuyển khoản khi đã chuyển nhưng chưa được duyệt.
    Ảnh được trình duyệt nén (JPEG/WebP < 300KB) và gửi dạng base64; lưu thẳng vào CSDL (không mất khi server Cloud khởi động lại)."""
    row = pay.save_receipt(user, body.reservation_id, body.image, body.note)
    await manager.broadcast("receipt_new", row)
    return row


# ---------------------------------------------------------------- Đối soát (Admin)
@admin_router.get("/payments")
def reconcile(status: str = "", q: str = "", limit: int = 300):
    return pay.list_reconcile(status, q, limit)


@admin_router.get("/payments/export.csv")
def export_csv():
    name = f"doi-soat-{now().strftime('%Y%m%d-%H%M')}.csv"
    return Response(pay.export_csv(), media_type="text/csv; charset=utf-8",
                    headers={"Content-Disposition": f'attachment; filename="{name}"'})


async def _after_resolve(result: dict):
    if result.get("reservation") and result["reservation"].get("via") == "reconcile":
        await manager.broadcast("deposit_approved", result["reservation"])
    if result.get("session"):
        await barriers.open("exit", f"Xe {result['session']['license_plate']} — duyệt bù thanh toán")
        await manager.broadcast("payment", result["session"])
    if result.get("prepaid"):
        await manager.broadcast("prepaid", result["prepaid"])
    await manager.broadcast("payment_resolved", {k: v for k, v in result.items() if k in ("log", "receipt")})
    return result


@admin_router.post("/payments/{log_id}/approve")
async def approve_payment(log_id: int, body: ResolveInput, admin: dict = Depends(auth.require_admin)):
    return await _after_resolve(pay.approve_log(log_id, admin, body.ticket_code, body.note))


@admin_router.post("/payments/{log_id}/refund")
async def refund_payment(log_id: int, body: ResolveInput, admin: dict = Depends(auth.require_admin)):
    return await _after_resolve(pay.refund_log(log_id, admin, body.note))


@admin_router.post("/receipts/{rcid}/approve")
async def approve_receipt(rcid: int, admin: dict = Depends(auth.require_admin)):
    return await _after_resolve(pay.approve_receipt(rcid, admin))


@admin_router.post("/receipts/{rcid}/refund")
async def refund_receipt(rcid: int, admin: dict = Depends(auth.require_admin)):
    return await _after_resolve(pay.refund_receipt(rcid, admin))


@admin_router.get("/receipts/{rcid}/file")
def receipt_file(rcid: int, download: bool = False):
    """Ảnh biên lai (đọc từ CSDL) để Admin xem / tải lại."""
    data, mime, name = pay.receipt_image(rcid)
    disp = "attachment" if download else "inline"
    return Response(data, media_type=mime, headers={"Content-Disposition": f'{disp}; filename="{name}"', "Cache-Control": "private, max-age=3600"})
