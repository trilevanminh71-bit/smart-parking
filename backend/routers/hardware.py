"""API phần cứng: ESP32 (5 IR + Servo SG90 + LCD 16x2), Webcam ALPR (script Python), Barrier.

- API cũ (/sensor, /gate, /gate-trigger, /barrier, /alpr): KHÔNG cần khóa — giữ nguyên cho firmware cũ trong LAN.
- API mới (/esp32/sync, /alpr/scan, /alpr/heartbeat): BẮT BUỘC header `X-API-Key` = biến môi trường `HARDWARE_API_KEY`
  (nếu chưa đặt thì dùng chung `SEPAY_API_KEY` / SePay API Key trong Cài đặt Admin).
"""
import base64
import binascii
import hmac
import os
import random
import re
import time
import uuid
from pathlib import Path

from fastapi import APIRouter, Depends, File, Form, HTTPException, Request, UploadFile

import auth
import mapcfg
import payments as pay
import services as svc
from database import get_settings, query_one
from devices import hub
from models import AlprHeartbeat, AlprScan, Esp32Sync, GateEvent, GateResolve, GateTrigger, SensorEvent
from realtime import barriers, manager

router = APIRouter(prefix="/api/hardware", tags=["hardware"])

SAMPLE_PLATES = ["65A-123.45", "51G-678.90", "30H-246.81", "43A-135.79", "59X1-234.56", "29C-112.23", "92A-456.78"]
SCAN_DEBOUNCE_SECONDS = 15   # webcam gửi lặp cùng 1 biển số liên tục -> chỉ xử lý 1 lần
MAX_PLATE_IMAGE_BYTES = 400_000


# ---------------------------------------------------------------- Xác thực thiết bị (X-API-Key)
def hardware_keys() -> list[str]:
    own = pay._clean_key(os.environ.get("HARDWARE_API_KEY", ""))
    return [own] if own else pay.valid_api_keys()


def require_device(request: Request) -> None:
    keys = hardware_keys()
    if not keys:
        raise HTTPException(503, "Server chưa cấu hình HARDWARE_API_KEY (hoặc SEPAY_API_KEY) cho thiết bị")
    got = pay._clean_key(request.headers.get("x-api-key", "")) or pay.extract_api_key(request.headers)
    if not got:
        raise HTTPException(401, "Thiếu header X-API-Key")
    if not any(hmac.compare_digest(got.encode(), k.encode()) for k in keys):
        raise HTTPException(401, "X-API-Key không đúng")


def _client_ip(request: Request) -> str:
    return request.headers.get("x-forwarded-for", "").split(",")[0].strip() or (request.client.host if request.client else "")


# ---------------------------------------------------------------- Luồng cổng dùng chung
_DENY_LCD = [("hết chỗ", "BAI DA DAY"), ("tiền cọc", "CHUA NHAN COC"), ("trong bãi", "XE DA TRONG BAI"),
             ("không hợp lệ", "BIEN SO SAI"), ("không tìm thấy", "KHONG CO XE")]


def _deny_lcd(detail: str) -> str:
    d = (detail or "").lower()
    return next((v for k, v in _DENY_LCD if k in d), "LIEN HE BAO VE")


async def announce_gate(gate: str, plate: str, **extra) -> None:
    """Sự kiện `gate_opened` cho trang khách (tự mở Bản đồ chi tiết) và trang Bảo vệ."""
    await manager.broadcast("gate_opened", {"gate": gate, "action": "OPEN_IN" if gate == "entry" else "OPEN_OUT",
                                            "license_plate": plate, **extra})


async def handle_gate(gate: str, plate: str, source: str) -> dict:
    """Luồng xử lý xe tại cổng — dùng chung cho ESP32, Webcam ALPR, Bảng giả lập và Bảng Demo."""
    if gate == "entry":
        try:
            result = svc.check_in(plate, source=source)
        except HTTPException as e:
            hub.show("XIN LOI", _deny_lcd(str(e.detail)))
            raise
        s = result["session"]
        await barriers.open("entry", result["message"], lcd=("BIEN SO OK", f"MOI VAO {result['slot_code']}"))
        await manager.broadcast("check_in", result)
        await announce_gate("entry", s["license_plate"], slot_code=result["slot_code"], floor=result["floor"],
                            session_id=s["id"], reservation_id=s.get("reservation_id"), user_id=s.get("user_id"),
                            entry_type=result["entry_type"])
        return {"ok": True, "action": "check_in", "barrier": "OPEN", **result}

    session = svc.find_parked_by_plate(plate)
    if not session:
        svc.add_log(source, "gate_denied", f"Cổng ra: không tìm thấy xe {svc.normalize_plate(plate)} trong bãi")
        hub.show("XIN LOI", "KHONG CO XE")
        await manager.broadcast("log")
        svc.fail(f"Không tìm thấy xe {svc.normalize_plate(plate)} đang đỗ", 404)
    free = svc.free_exit(session["id"], source=source)
    if free:  # Admin miễn phí: không cần thanh toán, mở barrier ra luôn
        await barriers.open("exit", f"Xe {free['license_plate']} — miễn phí (Admin)")
        await manager.broadcast("payment", free)
        await announce_gate("exit", free["license_plate"], slot_code=free["slot_code"], session_id=free["id"], user_id=free.get("user_id"))
        return {"ok": True, "action": "free_exit", "barrier": "OPEN", "session": free,
                "message": f"Xe {free['license_plate']} ra cổng — Miễn phí (Admin)"}
    return await exit_flow(session["id"], source)


async def exit_flow(sid: int, source: str) -> dict:
    """Cổng ra: phí <= cọc / đã trả trước còn hạn -> mở barrier; còn phí -> chặn, VietQR `PHI <BIỂN_SỐ>` chờ SePay."""
    r = svc.exit_gate(sid, source=source)
    s = r["session"]
    if r["action"] == "auto_open":
        how = {"deposit": "phí đã trừ đủ bằng tiền cọc", "free_period": "trong thời gian miễn phí"}.get(
            s.get("payment_method"), "đã thanh toán trước")
        await barriers.open("exit", f"Xe {s['license_plate']} {how} — tự mở barrier")
        await manager.broadcast("payment", {**s, "via": "prepaid" if s.get("prepaid_amount") else "auto"})
        await announce_gate("exit", s["license_plate"], slot_code=s["slot_code"], session_id=s["id"], user_id=s.get("user_id"))
        return {"ok": True, "action": "auto_open", "barrier": "OPEN", "session": s,
                "message": f"Xe {s['license_plate']} {how} — mở barrier cổng ra"}
    hub.show(f"PHI {s['amount_due']:,}D".replace(",", "."), "QUET QR THANH TOAN")
    await manager.broadcast("checkout", s)
    msg = (f"Xe {s['license_plate']} ra QUÁ HẠN — cần trả bù {s['amount_due']:,}đ (đã trả trước {s['prepaid_amount']:,}đ)"
           if r["action"] == "late_fee" else f"Xe {s['license_plate']} chưa thanh toán — cần trả {s['amount_due']:,}đ")
    await manager.broadcast("log")
    return {"ok": True, "action": r["action"], "barrier": "CLOSED", "session": s, "message": msg}


# ---------------------------------------------------------------- Auto-Gate: tín hiệu xe tới cổng
TRIGGER_TTL_SECONDS = 30
_pending_triggers: dict[str, dict] = {}  # trigger_id -> {gate, at}


def _gate_label(gate: str) -> str:
    return "VÀO" if gate == "entry" else "RA"


async def _auto_process(gate: str, plate: str, source: str) -> dict:
    """Chạy check-in / check-out tự động. Hợp lệ -> barrier mở 5 giây (+ bản đồ chỉ đường cho xe vào); không hợp lệ -> giữ ĐÓNG."""
    try:
        r = await handle_gate(gate, plate, source=source)
    except HTTPException as e:
        msg = f"Auto-Gate cổng {_gate_label(gate)}: xe {plate} bị từ chối — {e.detail}"
        svc.add_log(source, "auto_gate_denied", msg + " (giữ barrier ĐÓNG)")
        await manager.broadcast("auto_gate", {"gate": gate, "plate": plate, "ok": False, "message": e.detail})
        await manager.broadcast("log")
        return {"ok": False, "auto": True, "action": "denied", "barrier": "CLOSED", "message": e.detail}
    opened = r.get("barrier") == "OPEN"
    await manager.broadcast("auto_gate", {"gate": gate, "plate": r.get("session", {}).get("license_plate", plate),
                                          "ok": opened, "action": r.get("action"), "message": r.get("message")})
    return {**r, "auto": True}


@router.post("/gate-trigger")
async def gate_trigger(body: GateTrigger):
    """ESP32 báo có xe đứng trước barrier.
    - Auto-Gate TẮT: chỉ báo cho Bảo vệ, barrier giữ ĐÓNG.
    - Auto-Gate BẬT + có `plate`: tự check-in/out ngay, hợp lệ thì mở barrier 5 giây.
    - Auto-Gate BẬT, không có `plate`: trang Bảo vệ (webcam / biển số test đang chọn) đọc biển số rồi gọi /gate-trigger/resolve."""
    cfg = get_settings()
    gate, label = body.gate, _gate_label(body.gate)
    if not cfg["auto_gate"]:
        svc.add_log("esp32", "gate_trigger", f"Xe tới cổng {label}{f' ({body.plate})' if body.plate else ''} — Auto-Gate TẮT, chờ Bảo vệ xác nhận")
        await manager.broadcast("gate_trigger", {"gate": gate, "plate": body.plate, "auto": False})
        await manager.broadcast("log")
        return {"ok": True, "action": "manual", "barrier": "CLOSED", "message": "Auto-Gate đang tắt — chờ Bảo vệ xác nhận"}
    if body.plate:
        return await _auto_process(gate, body.plate, source="auto-gate")
    now = time.monotonic()
    for k in [k for k, v in _pending_triggers.items() if now - v["at"] > TRIGGER_TTL_SECONDS]:
        _pending_triggers.pop(k, None)
    tid = uuid.uuid4().hex[:12]
    _pending_triggers[tid] = {"gate": gate, "at": now}
    svc.add_log("esp32", "gate_trigger", f"Xe tới cổng {label} — Auto-Gate: chờ camera trên trang Bảo vệ đọc biển số")
    await manager.broadcast("gate_trigger", {"gate": gate, "trigger_id": tid, "auto": True, "need_plate": True})
    await manager.broadcast("log")
    return {"ok": True, "action": "awaiting_camera", "barrier": "CLOSED", "trigger_id": tid}


@router.post("/gate-trigger/resolve")
async def gate_trigger_resolve(body: GateResolve):
    """Camera trang Bảo vệ trả biển số cho tín hiệu xe tới (chỉ xử lý 1 lần, tab nào trả trước được dùng)."""
    t = _pending_triggers.pop(body.trigger_id, None)
    if not t or time.monotonic() - t["at"] > TRIGGER_TTL_SECONDS:
        svc.fail("Tín hiệu xe tới đã được xử lý hoặc đã hết hạn", 409)
    return await _auto_process(t["gate"], body.plate, source="auto-gate")


@router.post("/sensor")
async def sensor(body: SensorEvent):
    result = svc.apply_sensor(body.slot_code, body.occupied)
    await manager.broadcast("sensor", result)
    return {"ok": True, **result}


@router.post("/gate")
async def gate(body: GateEvent):
    return await handle_gate(body.gate, body.plate, source="esp32")


@router.get("/barrier")
def barrier():
    """ESP32 polling để biết lệnh mở/đóng barrier."""
    snap = barriers.snapshot()
    return {"entry": snap["entry"]["state"], "exit": snap["exit"]["state"], "detail": snap}


@router.post("/alpr")
async def alpr(file: UploadFile | None = File(default=None), hint: str = Form(default="")):
    """ALPR giả lập (không dùng AI): đọc biển số từ tên file ảnh (vd: 65A12345.jpg) hoặc `hint`,
    nếu không đọc được thì trả về một biển số mẫu ngẫu nhiên."""
    candidates = [hint]
    if file is not None and file.filename:
        stem = Path(file.filename).stem
        candidates.append(stem)
        candidates += re.findall(r"\d{2}[A-Za-z]{1,2}\d?[-_. ]?\d{3,5}(?:[._]\d{2})?", stem)
        await file.read()  # bỏ qua nội dung ảnh
    for c in candidates:
        plate = svc.try_normalize_plate(c) if c else None
        if plate:
            conf = round(random.uniform(0.9, 0.99), 2)
            break
    else:
        plate, conf = random.choice(SAMPLE_PLATES), round(random.uniform(0.6, 0.8), 2)
    svc.add_log("alpr", "recognize", f"ALPR nhận diện: {plate} (độ tin cậy {conf:.0%})")
    await manager.broadcast("log")
    return {"plate": plate, "confidence": conf, "simulated": True}


# ---------------------------------------------------------------- ESP32 2 nhân: đồng bộ cảm biến + lấy lệnh cổng/LCD
def available_count() -> int:
    row = query_one("SELECT COUNT(*) AS n FROM slots WHERE status = 'available' AND active = 1")
    return int(row["n"]) if row else 0


async def apply_ir(sensor_id: str, value: bool) -> None:
    """1 cảm biến IR đổi trạng thái -> cập nhật ô được ánh xạ, tự xác nhận đỗ đúng ô / cảnh báo đỗ nhầm ô."""
    code = mapcfg.sensor_map().get(sensor_id)
    if not code:
        return
    ev = svc.sensor_event(code, value)
    result = svc.apply_sensor(code, value)
    await manager.broadcast("sensor", {**result, "sensor_id": sensor_id})
    if ev["kind"] == "confirm":
        s = svc.confirm_parked(ev["session_id"], None, source="sensor")
        await manager.broadcast("slot_confirmed", {**s, "via": "sensor", "session_id": s["id"]})
    elif ev["kind"] == "wrong":
        a = ev["alert"]
        svc.add_log("esp32", "wrong_slot", f"Đỗ nhầm ô: xe {a['license_plate']} được chỉ định {a['assigned_slot_code']} "
                                           f"nhưng cảm biến {sensor_id} báo có xe ở {a['detected_slot_code']}")
        await manager.broadcast("wrong_slot_alert", a)
    await manager.broadcast("log")


@router.post("/esp32/sync", dependencies=[Depends(require_device)])
async def esp32_sync(body: Esp32Sync, request: Request):
    """ESP32 gửi trạng thái 5 cảm biến IR (mỗi 0.5–2 giây). Trả về lệnh mở cổng đang chờ (lấy xong là xóa) + 2 dòng LCD."""
    sensors = {str(k).upper(): bool(v) for k, v in body.sensors.items() if str(k).upper() in mapcfg.SENSOR_IDS}
    first = body.device_id not in hub.esp32
    hub.esp32_seen(body.device_id, body.uptime_sec, sensors, _client_ip(request))
    if first:
        svc.add_log("esp32", "online", f"{body.device_id} kết nối (uptime {body.uptime_sec}s, IP {_client_ip(request)})")
        await manager.broadcast("device", {"kind": "esp32", "device_id": body.device_id, "online": True})
    for sid, val in sensors.items():
        if hub.sensor_state.get(sid) == val:
            continue
        hub.sensor_state[sid] = val
        await apply_ir(sid, val)
    available = available_count()
    return {"ok": True, **hub.pop_command(available), "available_slots": available}


# ---------------------------------------------------------------- Webcam ALPR (script Python)
_last_scan: dict[tuple[str, str], tuple[float, dict]] = {}


def _clean_image(b64: str | None) -> str | None:
    """Ảnh cắt biển số base64 (có hoặc không có tiền tố data:) -> data URL hợp lệ, hoặc None."""
    if not b64:
        return None
    m = re.match(r"^data:(image/(?:jpeg|png|webp));base64,(.+)$", b64.strip(), re.S)
    raw = m.group(2) if m else b64.strip()
    try:
        data = base64.b64decode(raw, validate=False)
    except (binascii.Error, ValueError):
        return None
    if not data or len(data) > MAX_PLATE_IMAGE_BYTES:
        return None
    mime = "image/png" if data[:8] == b"\x89PNG\r\n\x1a\n" else "image/webp" if data[8:12] == b"WEBP" else \
        "image/jpeg" if data[:3] == b"\xff\xd8\xff" else None
    return f"data:{mime};base64,{base64.b64encode(data).decode()}" if mime else None


async def process_scan(plate_raw: str, gate_raw: str, confidence: float, image: str | None, camera_id: str, source: str) -> dict:
    gate = "entry" if gate_raw.lower() in ("in", "entry") else "exit"
    conf = round(confidence * 100 if confidence <= 1 else confidence, 1)
    plate = svc.try_normalize_plate(plate_raw)
    key = (plate or plate_raw.upper(), gate)
    prev = _last_scan.get(key)
    if prev and time.monotonic() - prev[0] < SCAN_DEBOUNCE_SECONDS:
        return {**prev[1], "duplicate": True}
    img = _clean_image(image)
    if not plate:
        result = {"ok": False, "action": "invalid_plate", "barrier": "CLOSED",
                  "message": f"Biển số không hợp lệ: '{plate_raw}'"}
        hub.show("XIN LOI", "BIEN SO SAI")
    else:
        try:
            r = await handle_gate(gate, plate, source=source)
            result = {"ok": True, **{k: r.get(k) for k in ("action", "barrier", "message", "slot_code", "floor", "entry_type")}}
            if r.get("session"):
                result["session_id"] = r["session"]["id"]
                result["slot_code"] = result.get("slot_code") or r["session"].get("slot_code")
                result["amount_due"] = r["session"].get("amount_due")
        except HTTPException as e:
            result = {"ok": False, "action": "denied", "barrier": "CLOSED", "message": str(e.detail)}
    svc.add_log("alpr", "scan", f"{camera_id} cổng {_gate_label(gate)}: {plate or plate_raw} ({conf:g}%) → {result['message']}")
    scan = hub.add_scan({"license_plate": plate or plate_raw.upper(), "gate": "IN" if gate == "entry" else "OUT",
                         "confidence": conf, "camera_id": camera_id, "image": img, "source": source, **result})
    _last_scan[key] = (time.monotonic(), result)
    for k in [k for k, (t, _) in _last_scan.items() if time.monotonic() - t > 120]:
        _last_scan.pop(k, None)
    await manager.broadcast("alpr_event", scan, staff_only=True)
    await manager.broadcast("log")
    return {**result, "scan_id": scan["id"], "license_plate": scan["license_plate"], "confidence": conf}


@router.post("/alpr/scan", dependencies=[Depends(require_device)])
async def alpr_scan(body: AlprScan, request: Request):
    """Script Webcam ALPR gửi biển số đọc được -> xử lý vào/ra, đẩy lệnh Servo/LCD cho ESP32, phát `alpr_event` + `gate_opened`."""
    hub.camera_seen(body.camera_id, _client_ip(request), gate=body.gate.upper())
    return await process_scan(body.license_plate, body.gate, body.confidence, body.plate_image_base64, body.camera_id, "alpr")


@router.post("/alpr/heartbeat", dependencies=[Depends(require_device)])
async def alpr_heartbeat(body: AlprHeartbeat, request: Request):
    first = body.camera_id not in hub.cameras
    hub.camera_seen(body.camera_id, _client_ip(request), fps=body.fps, gate=body.gate)
    if first:
        svc.add_log("alpr", "online", f"Webcam {body.camera_id} kết nối (IP {_client_ip(request)})")
        await manager.broadcast("device", {"kind": "alpr", "camera_id": body.camera_id, "online": True})
    return {"ok": True, "server_time": time.time()}


@router.get("/alpr/latest", dependencies=[Depends(auth.require_staff)])
def alpr_latest(limit: int = 10):
    """Trang Bảo vệ: các lần quét gần nhất (kèm ảnh cắt biển số) + trạng thái webcam."""
    return {"scans": list(hub.scans)[:max(1, min(limit, 20))], "camera": hub.camera_status()}
