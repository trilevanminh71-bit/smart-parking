"""API v3: Bản đồ Kép, GPS telemetry, Sức khỏe thiết bị, Báo cáo CSV, Xác nhận / Đổi ô, Bảng điều khiển Demo."""
import csv
import io
import time

from fastapi import APIRouter, Body, Depends
from fastapi.responses import Response

import auth
import mapcfg
import payments as pay
import services as svc
from database import Tx, db_kind, now, now_iso, query, query_one
from devices import hub
from models import ConfirmText, DemoAlpr, DemoSepay, LocationInput, SwitchSlotInput
from realtime import barriers, manager
from routers.hardware import announce_gate, available_count, hardware_keys, process_scan

router = APIRouter(tags=["v3"])

STALE_SECONDS = 10           # mất tín hiệu GPS quá 10 giây -> stale
TELEMETRY_DB_EVERY = 15      # ghi vị trí xuống CSDL tối đa mỗi 15 giây / người (bộ nhớ luôn mới nhất)
_locations: dict[int, dict] = {}


# ---------------------------------------------------------------- Bản đồ
@router.get("/api/map/config")
def map_config():
    return mapcfg.get_config()


@router.put("/api/map/config")
async def put_map_config(body: dict = Body(...), admin: dict = Depends(auth.require_admin)):
    try:
        cfg, summary = mapcfg.save_config(body, admin, svc.log)
    except mapcfg.MapError as e:
        svc.fail(str(e))
    await manager.broadcast("map_updated", {"updated_at": cfg["updated_at"], "updated_by": cfg["updated_by"], **summary})
    await manager.broadcast("log")
    return cfg


@router.post("/api/map/reset-default")
async def reset_map(admin: dict = Depends(auth.require_admin)):
    """Khôi phục sơ đồ mặc định cho các ô đang có (giữ neo GPS hiện tại)."""
    cur = mapcfg.get_config()
    rows = query("SELECT code, floor FROM slots WHERE active = 1 ORDER BY floor, code")
    cfg = mapcfg.default_config(rows)
    for k in ("origin_lat", "origin_lng", "rotation_deg", "scale_meters_per_unit"):
        cfg[k] = cur[k]
    return await put_map_config(mapcfg.project(cfg), admin)


# ---------------------------------------------------------------- Xác nhận đã vào ô / Đổi ô (khách, Bảo vệ, Admin)
async def _after_confirm(s: dict) -> dict:
    await manager.broadcast("slot_confirmed", {**s, "session_id": s["id"]})
    await manager.broadcast("log")
    return s


async def _after_switch(r: dict) -> dict:
    await manager.broadcast("slot_switched", {k: v for k, v in r.items() if k not in ("session", "reservation")})
    await manager.broadcast("log")
    return r


@router.post("/api/reservations/{rid}/confirm-parked")
async def confirm_parked(rid: int, user: dict = Depends(auth.current_user)):
    info = svc.session_for_reservation(rid)
    if not info["session_id"]:
        st = info["reservation"]["status"]
        svc.fail("Xe chưa qua cổng vào — chỉ xác nhận sau khi barrier cổng vào đã mở" if st in svc.HOLD_STATUSES
                 else "Đặt chỗ này không còn xe đang đỗ")
    return await _after_confirm(svc.confirm_parked(info["session_id"], user, source="staff" if auth.is_staff(user) else "web"))


@router.post("/api/reservations/{rid}/switch-slot")
async def switch_reservation_slot(rid: int, body: SwitchSlotInput, user: dict = Depends(auth.current_user)):
    return await _after_switch(svc.switch_slot(body.new_slot_code, user, rid=rid, floor=body.floor,
                                               source="staff" if auth.is_staff(user) else "web"))


@router.post("/api/parking/sessions/{sid}/confirm-parked")
async def confirm_session(sid: int, user: dict = Depends(auth.current_user)):
    """Xe vãng lai (không có đơn đặt trước) cũng xác nhận được."""
    return await _after_confirm(svc.confirm_parked(sid, user, source="staff" if auth.is_staff(user) else "web"))


@router.post("/api/parking/sessions/{sid}/switch-slot")
async def switch_session_slot(sid: int, body: SwitchSlotInput, user: dict = Depends(auth.current_user)):
    return await _after_switch(svc.switch_slot(body.new_slot_code, user, sid=sid, floor=body.floor,
                                               source="staff" if auth.is_staff(user) else "web"))


# ---------------------------------------------------------------- GPS telemetry
def _loc_view(rec: dict) -> dict:
    age = time.time() - rec["ts"]
    return {**{k: v for k, v in rec.items() if k not in ("ts", "db_ts")}, "age_seconds": round(age, 1), "stale": age > STALE_SECONDS}


@router.post("/api/telemetry/location")
async def post_location(body: LocationInput, user: dict = Depends(auth.current_user)):
    ts = time.time()
    prev = _locations.get(user["id"], {})
    rec = {"user_id": user["id"], "email": user["email"], "full_name": user["full_name"], "role": user["role"],
           "plate": user.get("default_plate") or "", "lat": body.lat, "lng": body.lng, "accuracy": body.accuracy,
           "speed": body.speed, "heading": body.heading, "updated_at": now_iso(), "ts": ts, "db_ts": prev.get("db_ts", 0)}
    if ts - rec["db_ts"] >= TELEMETRY_DB_EVERY:
        rec["db_ts"] = ts
        with Tx() as db:
            db.execute("DELETE FROM telemetry_locations WHERE user_id = ?", (user["id"],))
            db.execute("""INSERT INTO telemetry_locations (user_id, email, lat, lng, accuracy, speed, heading, updated_at)
                          VALUES (?, ?, ?, ?, ?, ?, ?, ?)""",
                       (user["id"], user["email"], body.lat, body.lng, body.accuracy, body.speed, body.heading, rec["updated_at"]))
    _locations[user["id"]] = rec
    # Vị trí chỉ gửi cho Bảo vệ/Admin và chính chủ (không phát cho khách khác)
    await manager.broadcast("location", _loc_view(rec), staff_only=True, user_id=user["id"])
    return {"ok": True, "stale_after_seconds": STALE_SECONDS}


@router.get("/api/telemetry/locations", dependencies=[Depends(auth.require_staff)])
def get_locations():
    live = {uid: _loc_view(r) for uid, r in _locations.items()}
    # Bổ sung vị trí cuối cùng đã lưu (VD: sau khi server khởi động lại) — luôn là stale
    for r in query("SELECT * FROM telemetry_locations ORDER BY updated_at DESC LIMIT 200"):
        if r["user_id"] not in live:
            live[r["user_id"]] = {**r, "stale": True, "age_seconds": None}
    return sorted(live.values(), key=lambda r: (r["stale"], r.get("email") or ""))


# ---------------------------------------------------------------- Sức khỏe thiết bị & Báo cáo
@router.get("/api/system/health-devices", dependencies=[Depends(auth.require_staff)])
def health_devices():
    t0 = time.perf_counter()
    try:
        query_one("SELECT 1 AS ok")
        db_ok, db_msg = True, f"{db_kind()} · {round((time.perf_counter() - t0) * 1000)} ms"
    except Exception as e:  # pragma: no cover - chỉ khi mất kết nối CSDL
        db_ok, db_msg = False, f"Lỗi kết nối: {type(e).__name__}"
    sepay_keys = bool(pay.valid_api_keys())
    last = hub.last_webhook
    esp, cam = hub.esp32_status(), hub.camera_status()
    return {
        "checked_at": now_iso(),
        "components": [
            {"id": "database", "name": "Neon PostgreSQL" if db_kind() == "postgresql" else "SQLite", "ok": db_ok, "detail": db_msg},
            {"id": "sepay", "name": "SePay Webhook", "ok": sepay_keys,
             "detail": ("Đã cấu hình API Key" if sepay_keys else "Chưa cấu hình SEPAY_API_KEY")
             + (f" · lần cuối nhận {last['at'][11:19]} ({last['status']})" if last else " · chưa nhận webhook nào từ lúc khởi động")},
            {"id": "esp32", "name": "Mạch ESP32", "ok": esp["online"],
             "detail": (f"{esp['device']['device_id']} · {esp['age_seconds']}s trước · uptime {esp['device']['uptime_sec']}s"
                        if esp["device"] else "Chưa kết nối") + ("" if esp["online"] or not esp["device"] else " (mất kết nối > 15s)")},
            {"id": "alpr", "name": "Webcam ALPR", "ok": cam["online"],
             "detail": (f"{cam['camera']['camera_id']} · {cam['age_seconds']}s trước" if cam["camera"] else "Chưa kết nối")
             + ("" if cam["online"] or not cam["camera"] else " (mất kết nối > 20s)")},
        ],
        "hardware_key_configured": bool(hardware_keys()),
        "available_slots": available_count(),
        "sensors": hub.sensor_state,
    }


@router.get("/api/reports/export", dependencies=[Depends(auth.require_admin)])
def export_report():
    """CSV UTF-8 BOM (Excel mở đúng tiếng Việt): lượt xe, giờ vào/ra, cọc SePay, phí thu thêm, doanh thu + dòng tổng."""
    rows = svc.report_rows()
    buf = io.StringIO()
    w = csv.writer(buf)
    w.writerow(svc.REPORT_HEADER)
    w.writerows(rows)
    total = lambda i: sum(r[i] for r in rows if isinstance(r[i], (int, float)))  # noqa: E731
    w.writerow([])
    w.writerow(["TỔNG", f"{len(rows)} lượt", "", "", "", "", "", "", "", "", total(10), total(11), total(12), total(13), "", "", total(16)])
    st = svc.stats()
    w.writerow(["Tiền cọc mất (đơn hết hạn/hủy)", st["deposit_forfeited"]])
    w.writerow(["Xuất lúc", now_iso()])
    name = f"bao-cao-bai-xe-{now().strftime('%Y%m%d-%H%M')}.csv"
    return Response("﻿" + buf.getvalue(), media_type="text/csv; charset=utf-8",
                    headers={"Content-Disposition": f'attachment; filename="{name}"'})


# ---------------------------------------------------------------- Bảng điều khiển Demo (Admin)
@router.post("/api/admin/demo/alpr")
async def demo_alpr(body: DemoAlpr, admin: dict = Depends(auth.require_admin)):
    """Giả lập Webcam quét biển số: chạy đúng luồng ALPR thật (Servo/LCD, gate_opened, bản đồ chi tiết)."""
    hub.camera_seen("DEMO_CAM", "web", gate=body.gate)
    return await process_scan(body.plate, body.gate, 99.0, None, "DEMO_CAM", "simulator")


@router.post("/api/admin/demo/sepay")
async def demo_sepay(body: DemoSepay, admin: dict = Depends(auth.require_admin)):
    r = svc.demo_sepay(admin, body.reservation_id, body.session_id)
    if r["kind"] == "deposit":
        res = r["reservation"]
        await manager.broadcast("deposit_approved", {**res, "via": "demo", "reservation_id": res["id"], "user_id": res.get("user_id")})
    elif r["kind"] == "exit_paid":
        s = r["session"]
        await barriers.open("exit", f"Xe {s['license_plate']} — giả lập SePay đã thanh toán")
        await manager.broadcast("payment", {**s, "via": "demo", "session_id": s["id"], "user_id": s.get("user_id")})
        await announce_gate("exit", s["license_plate"], slot_code=s["slot_code"], session_id=s["id"], user_id=s.get("user_id"))
    else:
        s = r["session"]
        await manager.broadcast("prepaid", {**s, "via": "demo", "session_id": s["id"], "user_id": s.get("user_id")})
    await manager.broadcast("log")
    return r


@router.post("/api/admin/demo/reset")
async def demo_reset(body: ConfirmText, admin: dict = Depends(auth.require_admin)):
    if body.confirm.strip().upper() != "RESET":
        svc.fail('Gõ chữ "RESET" để xác nhận')
    r = svc.reset_demo(admin)
    hub.clear()
    await barriers.close("entry", "Reset")
    await barriers.close("exit", "Reset")
    await manager.broadcast("reset", r)
    await manager.broadcast("log")
    return r
