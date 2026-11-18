"""Đặt chỗ CÓ ĐẶT CỌC qua VietQR MB Bank (hình thức duy nhất, yêu cầu đăng nhập)."""
from fastapi import APIRouter, Depends

import auth
import services as svc
from models import ReservationCreate
from realtime import manager

router = APIRouter(prefix="/api/reservations", tags=["reservations"])


@router.get("/new-code")
def new_code(user: dict = Depends(auth.current_user)):
    """Mã vé dự kiến để ghi vào nội dung chuyển khoản `COC <MÃ_VÉ> <BIỂN_SỐ>` trước khi xác nhận."""
    return {"ticket_code": svc.new_code_for_client()}


@router.post("")
async def create(body: ReservationCreate, user: dict = Depends(auth.current_user)):
    """Khách hàng: tạo vé `pending_payment` chờ chuyển khoản cọc (SePay xác nhận).
    Admin: miễn phí — vé `active` / ô `reserved` ngay, cọc 0đ, cấp vé QR luôn."""
    res = svc.create_reservation(body.slot_code, body.license_plate, body.customer_name, body.phone,
                                 user_id=user["id"], ticket_code=body.ticket_code, free=user["role"] == "admin")
    await manager.broadcast("reservation_new", res)
    return res


@router.get("/{rid}")
def get(rid: int, user: dict = Depends(auth.current_user)):
    res = svc.get_reservation(rid)
    if user["role"] != "admin" and res.get("user_id") != user["id"]:
        svc.fail("Không tìm thấy đặt chỗ", 404)
    return res


@router.post("/{rid}/cancel")
async def cancel(rid: int, user: dict = Depends(auth.current_user)):
    res = svc.cancel_reservation(rid, user)
    await manager.broadcast("reservation_cancelled", res)
    return res
