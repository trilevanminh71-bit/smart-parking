"""API cho ESP32 / Barrier / ALPR giả lập (không cần xác thực — dùng trong LAN)."""
import random
import re
import time
import uuid
from pathlib import Path

from fastapi import APIRouter, File, Form, HTTPException, UploadFile

import services as svc
from database import get_settings
from models import GateEvent, GateResolve, GateTrigger, SensorEvent
from realtime import barriers, manager

router = APIRouter(prefix="/api/hardware", tags=["hardware"])

SAMPLE_PLATES = ["65A-123.45", "51G-678.90", "30H-246.81", "43A-135.79", "59X1-234.56", "29C-112.23", "92A-456.78"]


async def handle_gate(gate: str, plate: str, source: str) -> dict:
    """Luồng xử lý xe tại cổng — dùng chung cho ESP32 và Bảng giả lập trên web."""
    if gate == "entry":
        result = svc.check_in(plate, source=source)
        await barriers.open("entry", result["message"])
        await manager.broadcast("check_in", result)
        return {"ok": True, "action": "check_in", "barrier": "OPEN", **result}

    session = svc.find_parked_by_plate(plate)
    if not session:
        svc.add_log(source, "gate_denied", f"Cổng ra: không tìm thấy xe {svc.normalize_plate(plate)} trong bãi")
        await manager.broadcast("log")
        svc.fail(f"Không tìm thấy xe {svc.normalize_plate(plate)} đang đỗ", 404)
    free = svc.free_exit(session["id"], source=source)
    if free:  # Admin miễn phí: không cần thanh toán, mở barrier ra luôn
        await barriers.open("exit", f"Xe {free['license_plate']} — miễn phí (Admin)")
        await manager.broadcast("payment", free)
        return {"ok": True, "action": "free_exit", "barrier": "OPEN", "session": free,
                "message": f"Xe {free['license_plate']} ra cổng — Miễn phí (Admin)"}
    return await exit_flow(session["id"], source)


async def exit_flow(sid: int, source: str) -> dict:
    """Cổng ra: đã trả trước & còn hạn -> tự mở barrier; quá hạn -> chặn, trả bù; chưa trả -> chặn, hóa đơn tại cổng."""
    r = svc.exit_gate(sid, source=source)
    s = r["session"]
    if r["action"] == "auto_open":
        await barriers.open("exit", f"Xe {s['license_plate']} đã thanh toán trước — tự mở barrier")
        await manager.broadcast("payment", {**s, "via": "prepaid"})
        return {"ok": True, "action": "auto_open", "barrier": "OPEN", "session": s,
                "message": f"Xe {s['license_plate']} đã thanh toán trước — mở barrier cổng ra"}
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
