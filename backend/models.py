"""Pydantic schemas."""
from typing import Literal, Optional

from pydantic import BaseModel, Field


class ReservationCreate(BaseModel):
    slot_code: str
    ticket_code: Optional[str] = Field(default=None, max_length=12)  # mã vé đã hiện trong nội dung CK
    license_plate: str = Field(min_length=4, max_length=20)
    customer_name: str = Field(min_length=1, max_length=80)
    phone: str = Field(min_length=8, max_length=15)


class SensorEvent(BaseModel):
    slot_code: str
    occupied: bool


class GateEvent(BaseModel):
    gate: Literal["entry", "exit"]
    plate: str


class GateTrigger(BaseModel):
    """ESP32 (cảm biến xe tới / vòng từ) báo có xe đứng trước barrier. `plate` nếu thiết bị tự đọc được biển số."""
    gate: Literal["entry", "exit"]
    plate: Optional[str] = Field(default=None, max_length=20)


class GateResolve(BaseModel):
    """Trang Bảo vệ (camera) trả biển số cho 1 tín hiệu xe tới đang chờ."""
    trigger_id: str = Field(max_length=40)
    plate: str = Field(min_length=4, max_length=20)


class PlateInput(BaseModel):
    plate: str


class BarrierCommand(BaseModel):
    gate: Literal["entry", "exit"]
    action: Literal["open", "close"]
    auto_close: bool = True


class SessionAction(BaseModel):
    session_id: int


class SimulateHours(BaseModel):
    session_id: int
    hours: float = 1


class PrepayConfirm(BaseModel):
    """Bảo vệ xác nhận đã thu hộ phí (thanh toán trước khi ra cổng)."""
    session_id: int
    method: Literal["cash", "online_qr"] = "cash"


class SimulateExit(BaseModel):
    """Giả lập trôi thời gian sau khi thanh toán trước: kéo hạn ra cổng sớm hơn `minutes` phút."""
    session_id: int
    minutes: float = 15


class SimulateReservation(BaseModel):
    reservation_id: int
    minutes: float = 5


class SettingsUpdate(BaseModel):
    hold_minutes: Optional[int] = Field(default=None, ge=1, le=1440)
    deposit_amount: Optional[int] = Field(default=None, ge=0, le=10_000_000)
    hourly_rate: Optional[int] = Field(default=None, ge=0, le=10_000_000)
    exit_grace_minutes: Optional[int] = Field(default=None, ge=1, le=240)
    free_minutes: Optional[int] = Field(default=None, ge=0, le=1440)
    pending_minutes: Optional[int] = Field(default=None, ge=1, le=120)
    auto_gate: Optional[bool] = None
    sepay_api_key: Optional[str] = Field(default=None, max_length=200)
    parking_name: Optional[str] = Field(default=None, max_length=80)
    admin_name: Optional[str] = Field(default=None, max_length=80)
    admin_phone: Optional[str] = Field(default=None, max_length=20)
    admin_email: Optional[str] = Field(default=None, max_length=120)
    parking_address: Optional[str] = Field(default=None, max_length=200)
    notice_text: Optional[str] = Field(default=None, max_length=500)


class TicketInput(BaseModel):
    code: str = Field(min_length=3, max_length=200)  # mã vé ngắn hoặc nội dung QR vé


class RegisterInput(BaseModel):
    email: str = Field(max_length=120)
    password: str = Field(max_length=128)
    full_name: str = Field(min_length=1, max_length=80)
    phone: str = Field(min_length=8, max_length=15)


class LoginInput(BaseModel):
    email: str = Field(max_length=120)
    password: str = Field(max_length=128)


class ChangePasswordInput(BaseModel):
    old_password: str = Field(max_length=128)
    new_password: str = Field(max_length=128)


class AdminUserCreate(BaseModel):
    """Tạo tài khoản Admin / Bảo vệ mới; nếu email đã tồn tại thì đổi quyền tài khoản đó."""
    email: str = Field(max_length=120)
    role: Literal["guard", "admin"] = "admin"
    full_name: Optional[str] = Field(default=None, max_length=80)
    phone: Optional[str] = Field(default=None, max_length=15)
    password: Optional[str] = Field(default=None, max_length=128)


class ReceiptUpload(BaseModel):
    """Ảnh biên lai đã nén phía trình duyệt, dạng data URL base64 (JPEG/WebP/PNG, < 300KB)."""
    reservation_id: int
    note: str = Field(default="", max_length=500)
    image: str = Field(min_length=30, max_length=450_000)


class ResolveInput(BaseModel):
    """Đối soát: Duyệt bù (có thể chỉ định mã vé khi nội dung CK sai) / Đánh dấu đã hoàn tiền."""
    ticket_code: Optional[str] = Field(default=None, max_length=12)
    note: Optional[str] = Field(default=None, max_length=300)


class RoleUpdate(BaseModel):
    role: Literal["customer", "guard", "admin"]


# ---------------------------------------------------------------- v3: bản đồ, phần cứng, GPS
class SwitchSlotInput(BaseModel):
    new_slot_code: str = Field(min_length=4, max_length=12)
    floor: Optional[int] = Field(default=None, ge=1, le=9)


class Esp32Sync(BaseModel):
    device_id: str = Field(default="ESP32_MAIN", max_length=40)
    sensors: dict[str, bool] = Field(default_factory=dict)
    uptime_sec: int = Field(default=0, ge=0)


class AlprScan(BaseModel):
    license_plate: str = Field(min_length=4, max_length=20)
    gate: Literal["IN", "OUT", "in", "out", "entry", "exit"] = "IN"
    confidence: float = Field(default=0.0, ge=0, le=100)
    plate_image_base64: Optional[str] = Field(default=None, max_length=700_000)
    camera_id: str = Field(default="CAM_GATE", max_length=40)


class AlprHeartbeat(BaseModel):
    camera_id: str = Field(default="CAM_GATE", max_length=40)
    fps: Optional[float] = Field(default=None, ge=0, le=240)
    gate: Optional[str] = Field(default=None, max_length=8)


class LocationInput(BaseModel):
    lat: float = Field(ge=-90, le=90)
    lng: float = Field(ge=-180, le=180)
    accuracy: Optional[float] = Field(default=None, ge=0, le=100_000)
    speed: Optional[float] = Field(default=None, ge=0, le=200)
    heading: Optional[float] = Field(default=None, ge=0, le=360)


class DemoAlpr(BaseModel):
    plate: str = Field(min_length=4, max_length=20)
    gate: Literal["IN", "OUT"] = "IN"


class DemoSepay(BaseModel):
    reservation_id: Optional[int] = None
    session_id: Optional[int] = None


class ConfirmText(BaseModel):
    confirm: str = Field(max_length=20)
