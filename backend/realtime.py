"""WebSocket manager + trạng thái barrier (lưu trong bộ nhớ)."""
import asyncio
import json
from typing import Any

from fastapi import WebSocket

from database import now_iso
from devices import hub

BARRIER_AUTO_CLOSE_SECONDS = 5


class ConnectionManager:
    """Mỗi kết nối có thể gửi `{"type":"auth","token":...}` để nhận cả sự kiện riêng tư
    (vị trí GPS, ảnh biển số chỉ gửi cho Bảo vệ/Admin; vị trí của tôi chỉ gửi cho chính tôi)."""

    def __init__(self) -> None:
        self.clients: dict[WebSocket, dict] = {}

    async def connect(self, ws: WebSocket) -> None:
        await ws.accept()
        self.clients[ws] = {"user_id": None, "role": None}

    def identify(self, ws: WebSocket, user: dict | None) -> None:
        if ws in self.clients:
            self.clients[ws] = {"user_id": user["id"], "role": user["role"]} if user else {"user_id": None, "role": None}

    def disconnect(self, ws: WebSocket) -> None:
        self.clients.pop(ws, None)

    async def broadcast(self, event: str, data: Any = None, *, staff_only: bool = False, user_id: int | None = None) -> None:
        """Gửi cho mọi người; `staff_only` -> chỉ Bảo vệ/Admin (+ `user_id` nếu có)."""
        msg = json.dumps({"event": event, "data": data, "at": now_iso()}, ensure_ascii=False, default=str)
        dead = []
        for ws, who in list(self.clients.items()):
            if staff_only and who["role"] not in ("guard", "admin") and not (user_id and who["user_id"] == user_id):
                continue
            try:
                await ws.send_text(msg)
            except Exception:
                dead.append(ws)
        for ws in dead:
            self.disconnect(ws)


manager = ConnectionManager()


class BarrierController:
    """Barrier cổng vào/ra. OPEN tự đóng sau vài giây (trừ khi mở tay không tự đóng).
    Mỗi lần mở cũng đẩy lệnh OPEN_IN / OPEN_OUT + chữ LCD vào hàng đợi cho ESP32 (POST /api/hardware/esp32/sync)."""

    def __init__(self) -> None:
        self.state = {
            g: {"state": "CLOSED", "updated_at": now_iso(), "auto_close": True, "reason": ""}
            for g in ("entry", "exit")
        }
        self._tasks: dict[str, asyncio.Task] = {}

    def snapshot(self) -> dict:
        return {g: dict(v) for g, v in self.state.items()}

    async def open(self, gate: str, reason: str = "", auto_close: bool = True, lcd: tuple[str, str] | None = None) -> None:
        self._cancel(gate)
        self.state[gate] = {"state": "OPEN", "updated_at": now_iso(), "auto_close": auto_close, "reason": reason}
        line1, line2 = lcd or (("MOI XE VAO", "") if gate == "entry" else ("TAM BIET", "HEN GAP LAI"))
        hub.open_gate(gate, line1, line2)
        await manager.broadcast("barrier", self.snapshot())
        if auto_close:
            self._tasks[gate] = asyncio.create_task(self._auto_close(gate))

    async def close(self, gate: str, reason: str = "") -> None:
        self._cancel(gate)
        self.state[gate] = {"state": "CLOSED", "updated_at": now_iso(), "auto_close": True, "reason": reason}
        await manager.broadcast("barrier", self.snapshot())

    def _cancel(self, gate: str) -> None:
        task = self._tasks.pop(gate, None)
        if task and not task.done() and task is not asyncio.current_task():
            task.cancel()

    async def _auto_close(self, gate: str) -> None:
        try:
            await asyncio.sleep(BARRIER_AUTO_CLOSE_SECONDS)
            self._tasks.pop(gate, None)
            await self.close(gate, "Tự đóng")
        except asyncio.CancelledError:
            pass


barriers = BarrierController()
