"""Thanh toán: Webhook SePay (tự duyệt cọc / phí gửi xe), biên lai khách gửi, đối soát cho Admin."""
from fastapi import APIRouter, Depends, Request
from fastapi.responses import JSONResponse, Response

import auth
import payments as pay
from database import now
from models import ReceiptUpload, ResolveInput
from realtime import barriers, manager

router = APIRouter(prefix="/api/payment", tags=["payment"])
admin_router = APIRouter(prefix="/api/admin", tags=["admin"], dependencies=[Depends(auth.require_admin)])


@router.post("/webhook")
async def sepay_webhook(request: Request):
    """Webhook SePay. Header bắt buộc: `Authorization: Apikey <sepay_api_key>` (sai -> 401).
    Luôn trả 200 {"success": true} cho request hợp lệ (kể cả giao dịch lỗi — đã lưu vào payment_logs để đối soát)."""
    if not pay.check_api_key(request.headers.get("authorization", "")):
        return JSONResponse({"success": False, "message": "API Key không hợp lệ hoặc chưa cấu hình"}, status_code=401)
    try:
        body = await request.json()
    except Exception:
        body = None
    if not isinstance(body, dict):
        return {"success": True, "note": "Bỏ qua: dữ liệu không phải JSON object"}
    result = pay.process_webhook(body)
    for event, data in result.get("events", []):
        await manager.broadcast(event, data)
    if result.get("open_exit"):
        await barriers.open("exit", f"Xe {result['open_exit']} đã thanh toán (SePay)")
    if result.get("log") or result.get("open_exit"):
        await manager.broadcast("log")
    return {"success": True}


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
