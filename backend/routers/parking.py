"""API công khai cho Khách hàng: trạng thái bãi, tra cứu vé, thanh toán online."""
from fastapi import APIRouter, Depends

import auth
import services as svc
from database import query_one
from models import PlateInput, SessionAction
from realtime import barriers, manager

router = APIRouter(prefix="/api/parking", tags=["parking"])


@router.get("/state")
def state():
    data = svc.public_state()
    data["barriers"] = barriers.snapshot()
    return data


@router.get("/normalize")
def normalize(plate: str):
    return {"plate": svc.normalize_plate(plate)}


@router.post("/ticket")
def ticket(body: PlateInput, user: dict = Depends(auth.current_user)):
    """Tra cứu vé theo biển số: lượt gửi đang đỗ (để thanh toán) và đặt chỗ đang giữ (chỉ của chính mình)."""
    plate = svc.normalize_plate(body.plate)
    session = svc.find_parked_by_plate(plate)
    res = query_one(f"SELECT id, user_id FROM reservations WHERE license_plate = ? AND status IN {svc.HOLD_STATUSES}", (plate,))
    own = res and (auth.is_staff(user) or res["user_id"] == user["id"])
    reservation = svc.get_reservation(res["id"]) if own else None
    if not session and not reservation:
        svc.fail(f"Không tìm thấy xe {plate} đang đỗ hoặc đặt chỗ của bạn", 404)
    return {"plate": plate, "session": session, "reservation": reservation}

@router.get("/session/{sid}")
def session_status(sid: int, user: dict = Depends(auth.current_user)):
    """Trạng thái 1 lượt gửi xe — trang khách hỏi lại mỗi 3 giây khi đang chờ tiền (dự phòng khi rớt WebSocket)."""
    return svc.get_session(sid)


@router.post("/prepay")
async def prepay(body: SessionAction, user: dict = Depends(auth.current_user)):
    """'Thanh toán để chuẩn bị ra cổng'. Phí 0đ -> Sẵn sàng ra cổng ngay; > 0 -> trả về số tiền để hiện VietQR `PHI <BIỂN_SỐ>`
    (SePay báo tiền vào đủ -> 'paid_ready', bắt đầu đếm ngược exit_grace_minutes)."""
    s = svc.request_prepay(body.session_id)
    await manager.broadcast("prepaid" if s["payment_status"] == "paid_ready" else "prepay_request", s)
    return s


# Khách KHÔNG còn tự bấm xác nhận thanh toán: phí gửi xe được xác nhận khi tiền về (webhook SePay
# /api/payment/webhook) hoặc do Bảo vệ xác nhận tại cổng (/api/admin/pay-online, /api/admin/pay-cash).
