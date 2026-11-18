"""Smart Parking 3 tầng — FastAPI backend.

Chạy: uvicorn main:app --host 0.0.0.0 --port 8000 --reload
"""
import asyncio
import logging
from contextlib import asynccontextmanager
from pathlib import Path

from fastapi import FastAPI, WebSocket, WebSocketDisconnect
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse

import services as svc
from database import db_kind, init_db
from realtime import barriers, manager
from auth import seed_admin
from routers import admin, hardware, parking, payment, reservations
from routers import auth as auth_router

log = logging.getLogger("smart-parking")
EXPIRE_INTERVAL_SECONDS = 10


async def expire_loop():
    """Mỗi 10 giây: hủy các đặt chỗ quá giờ và broadcast cập nhật."""
    while True:
        try:
            expired = svc.expire_reservations()
            if expired:
                log.info("Hết hạn giữ chỗ: %s", expired)
                await manager.broadcast("reservation_expired", {"slots": expired})
        except Exception:
            log.exception("Lỗi khi quét đặt chỗ hết hạn")
        await asyncio.sleep(EXPIRE_INTERVAL_SECONDS)


@asynccontextmanager
async def lifespan(app: FastAPI):
    init_db()
    seed_admin()
    freed = svc.cleanup_legacy_soft_holds()  # đã bỏ đặt chỗ không cọc: trả ô soft_reserved về trống
    if freed:
        log.info("Đã trả ô giữ tạm (không cọc) về trống: %s", freed)
    task = asyncio.create_task(expire_loop())
    yield
    task.cancel()


app = FastAPI(title="Bãi đỗ xe thông minh 3 tầng", version="1.0.0", lifespan=lifespan)
app.add_middleware(CORSMiddleware, allow_origins=["*"], allow_methods=["*"], allow_headers=["*"])

for r in (auth_router.router, parking.router, reservations.router, hardware.router, admin.router,
          payment.router, payment.admin_router):
    app.include_router(r)


@app.api_route("/api/health", methods=["GET", "HEAD"], include_in_schema=False)
def health():
    """Rất nhẹ (không đụng CSDL) để UptimeRobot ping giữ server Render free không ngủ."""
    return {"status": "ok"}


@app.get("/api/health/details")
def health_details():
    return {"status": "ok", "database": db_kind(), "frontend": DIST.exists(), "ws_clients": len(manager.clients)}


@app.websocket("/ws")
async def ws_endpoint(ws: WebSocket):
    await manager.connect(ws)
    try:
        await ws.send_json({"event": "hello", "data": {"barriers": barriers.snapshot()}})
        while True:
            msg = await ws.receive_text()
            if msg == "ping":
                await ws.send_text('{"event":"pong"}')
    except WebSocketDisconnect:
        pass
    finally:
        manager.disconnect(ws)


# Nếu đã build frontend (npm run build) thì phục vụ luôn tại cổng 8000
DIST = Path(__file__).parent.parent / "frontend" / "dist"
if DIST.exists():
    @app.get("/{path:path}", include_in_schema=False)
    def spa(path: str):
        if path.startswith("api/"):
            svc.fail("Không tìm thấy API", 404)
        file = (DIST / path).resolve()
        if path and file.is_file() and DIST.resolve() in file.parents:
            return FileResponse(file)
        return FileResponse(DIST / "index.html")
