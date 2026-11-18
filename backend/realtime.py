"""WebSocket manager + trạng thái barrier (lưu trong bộ nhớ)."""
import asyncio
import json
from typing import Any

from fastapi import WebSocket

from database import now_iso

BARRIER_AUTO_CLOSE_SECONDS = 5


class ConnectionManager:
    def __init__(self) -> None:
        self.clients: set[WebSocket] = set()

    async def connect(self, ws: WebSocket) -> None:
        await ws.accept()
        self.clients.add(ws)

    def disconnect(self, ws: WebSocket) -> None:
        self.clients.discard(ws)

    async def broadcast(self, event: str, data: Any = None) -> None:
        msg = json.dumps({"event": event, "data": data, "at": now_iso()}, ensure_ascii=False, default=str)
        dead = []
        for ws in list(self.clients):
            try:
                await ws.send_text(msg)
            except Exception:
                dead.append(ws)
        for ws in dead:
            self.disconnect(ws)


manager = ConnectionManager()


class BarrierController:
    """Barrier cổng vào/ra. OPEN tự đóng sau vài giây (trừ khi mở tay không tự đóng)."""

    def __init__(self) -> None:
        self.state = {
            g: {"state": "CLOSED", "updated_at": now_iso(), "auto_close": True, "reason": ""}
            for g in ("entry", "exit")
        }
        self._tasks: dict[str, asyncio.Task] = {}

    def snapshot(self) -> dict:
        return {g: dict(v) for g, v in self.state.items()}

    async def open(self, gate: str, reason: str = "", auto_close: bool = True) -> None:
        self._cancel(gate)
        self.state[gate] = {"state": "OPEN", "updated_at": now_iso(), "auto_close": auto_close, "reason": reason}
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
