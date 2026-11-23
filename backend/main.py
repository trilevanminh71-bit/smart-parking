"""Smart Parking 3 tầng — FastAPI backend.

Chạy: uvicorn main:app --host 0.0.0.0 --port 8000 --reload
"""
import asyncio
import json
import logging
import time
from contextlib import asynccontextmanager
from pathlib import Path

from fastapi import FastAPI, Request, WebSocket, WebSocketDisconnect
from fastapi.middleware.cors import CORSMiddleware
from fastapi.middleware.gzip import GZipMiddleware
from fastapi.responses import FileResponse, JSONResponse

import auth
import mapcfg
import services as svc
from database import db_kind, init_db, now_iso, query_one
from realtime import barriers, manager
from routers import admin, hardware, parking, payment, reservations, v3
from routers import auth as auth_router

log = logging.getLogger("smart-parking")
SCHEDULER_INTERVAL_SECONDS = 10  # quét đơn quá hạn (chờ CK quá `pending_minutes`, giữ chỗ quá `hold_minutes`)


async def scheduler_loop():
    """Mỗi 10 giây: hủy đơn `pending_payment` quá hạn chờ SePay, giải phóng ô của đơn đã cọc quá giờ giữ chỗ."""
    while True:
        try:
            expired = svc.expire_reservations()
            if expired:
                log.info("Hết hạn giữ chỗ: %s", expired)
                await manager.broadcast("reservation_expired", {"slots": expired})
        except Exception:
            log.exception("Lỗi khi quét đặt chỗ hết hạn")
        await asyncio.sleep(SCHEDULER_INTERVAL_SECONDS)


@asynccontextmanager
async def lifespan(app: FastAPI):
    init_db()
    auth.seed_admin()
    mapcfg.get_config()  # tạo sơ đồ mặc định (30 ô, neo GPS) nếu chưa có
    freed = svc.cleanup_legacy_soft_holds()  # đã bỏ đặt chỗ không cọc: trả ô soft_reserved về trống
    if freed:
        log.info("Đã trả ô giữ tạm (không cọc) về trống: %s", freed)
    # Ô "occupied"/"reserved" không còn lượt gửi / đặt chỗ hợp lệ -> trả về trống.
    # Cảm biến IR: trạng thái lấy từ lần đồng bộ ESP32 gần nhất (lúc vừa khởi động thường chưa có; ESP32 gửi lại sau vài giây).
    from devices import hub
    ir_on = {code for sid, code in mapcfg.sensor_map().items() if hub.sensor_state.get(sid)}
    fixed = svc.reconcile_slots(ir_on)
    print("[Khởi động] Đối soát ô: " + (", ".join(f"{c['code']} {c['old']}→{c['new']}" for c in fixed) if fixed
                                       else "mọi ô đã khớp dữ liệu, không cần sửa"), flush=True)
    import payments as pay
    keys = pay.valid_api_keys()
    print("[SePay] API Key: " + (", ".join(f"{len(k)} ký tự #{pay.key_fingerprint(k)}" for k in keys) if keys
                                  else "CHƯA cấu hình — webhook sẽ trả 401"), flush=True)
    hw = hardware.hardware_keys()
    print("[Thiết bị] X-API-Key: " + (", ".join(f"#{pay.key_fingerprint(k)}" for k in hw) if hw
                                       else "CHƯA cấu hình — ESP32/ALPR mới sẽ nhận 503"), flush=True)
    task = asyncio.create_task(scheduler_loop())
    yield
    task.cancel()


app = FastAPI(title="Bãi đỗ xe thông minh 3 tầng", version="3.0.0", lifespan=lifespan)
app.add_middleware(CORSMiddleware, allow_origins=["*"], allow_methods=["*"], allow_headers=["*"])
# Nén gzip phản hồi API & file tĩnh (JS/CSS/HTML) >= 500 byte — tải trang nhanh hơn trên 4G
app.add_middleware(GZipMiddleware, minimum_size=500)

for r in (auth_router.router, parking.router, reservations.router, hardware.router, admin.router,
          payment.router, payment.admin_router, payment.alias_router, v3.router):
    app.include_router(r)


@app.api_route("/api/health", methods=["GET", "HEAD"], include_in_schema=False)
def health():
    """UptimeRobot ping chống ngủ đông Render: kiểm tra luôn kết nối CSDL (Neon PostgreSQL)."""
    t0 = time.perf_counter()
    try:
        query_one("SELECT 1 AS ok")
        return {"status": "ok", "database": "connected", "engine": db_kind(),
                "latency_ms": round((time.perf_counter() - t0) * 1000, 1), "timestamp": now_iso()}
    except Exception as e:
        log.exception("Healthcheck: lỗi kết nối CSDL")
        return JSONResponse({"status": "degraded", "database": "error", "error": type(e).__name__, "timestamp": now_iso()},
                            status_code=503)


@app.get("/api/health/details")
def health_details():
    return {"status": "ok", "database": db_kind(), "frontend": DIST.exists(), "ws_clients": len(manager.clients)}


@app.websocket("/ws")
async def ws_endpoint(ws: WebSocket):
    """Gửi `ping` để giữ kết nối; gửi `{"type":"auth","token":"..."}` để nhận thêm sự kiện riêng tư (vị trí, ảnh ALPR)."""
    await manager.connect(ws)
    try:
        await ws.send_json({"event": "hello", "data": {"barriers": barriers.snapshot()}})
        while True:
            msg = await ws.receive_text()
            if msg == "ping":
                await ws.send_text('{"event":"pong"}')
                continue
            try:
                data = json.loads(msg)
            except ValueError:
                continue
            if isinstance(data, dict) and data.get("type") == "auth":
                user = auth.decode_token(str(data.get("token") or ""))
                manager.identify(ws, user)
                await ws.send_json({"event": "auth", "data": {"ok": bool(user), "role": user["role"] if user else None}})
    except WebSocketDisconnect:
        pass
    finally:
        manager.disconnect(ws)


@app.api_route("/api/{path:path}", methods=["POST", "PUT", "PATCH", "DELETE"], include_in_schema=False)
async def api_not_found(path: str, request: Request):
    """API không tồn tại -> 404 rõ ràng (trước đây rơi vào route SPA chỉ nhận GET nên báo 405)."""
    print(f"[API] 404 {request.method} /api/{path}", flush=True)
    return JSONResponse({"detail": f"Không tìm thấy API {request.method} /api/{path}"}, status_code=404)


# Nếu đã build frontend (npm run build) thì phục vụ luôn tại cổng 8000
DIST = Path(__file__).parent.parent / "frontend" / "dist"
if DIST.exists():
    @app.get("/{path:path}", include_in_schema=False)
    def spa(path: str):
        if path.startswith("api/"):
            svc.fail("Không tìm thấy API", 404)
        file = (DIST / path).resolve()
        if path and file.is_file() and DIST.resolve() in file.parents:
            # File trong assets/ có mã hash trong tên -> cache lâu dài; file khác luôn kiểm tra bản mới
            cache = "public, max-age=31536000, immutable" if path.startswith("assets/") else "no-cache"
            return FileResponse(file, headers={"Cache-Control": cache})
        return FileResponse(DIST / "index.html", headers={"Cache-Control": "no-cache"})
