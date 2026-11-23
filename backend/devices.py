"""Trạng thái thiết bị trong bộ nhớ: heartbeat ESP32 / Webcam ALPR, hàng đợi lệnh mở cổng + LCD 16x2,
ảnh biển số gần nhất, lần cuối nhận webhook SePay. (Mất khi server khởi động lại — thiết bị tự gửi lại sau vài giây.)"""
import time
import unicodedata
from collections import deque

from database import now_iso

ESP32_OFFLINE_SECONDS = 15
ALPR_OFFLINE_SECONDS = 20
OPEN_DURATION_MS = 5000
LCD_HOLD_SECONDS = 8


def lcd_text(s: str) -> str:
    """LCD 16x2 chỉ hiện ASCII: bỏ dấu tiếng Việt, IN HOA, tối đa 16 ký tự."""
    s = unicodedata.normalize("NFD", s or "").replace("đ", "d").replace("Đ", "D")
    s = "".join(c for c in s if unicodedata.category(c) != "Mn").encode("ascii", "ignore").decode()
    return " ".join(s.upper().split())[:16]


class DeviceHub:
    def __init__(self) -> None:
        self.esp32: dict[str, dict] = {}
        self.cameras: dict[str, dict] = {}
        self.queue: deque = deque(maxlen=10)      # lệnh mở cổng chờ ESP32 lấy
        self.lcd: dict | None = None              # dòng chữ LCD tạm thời (hết hạn sau LCD_HOLD_SECONDS)
        self.scans: deque = deque(maxlen=20)      # lần quét ALPR gần nhất (kèm ảnh cắt biển số)
        self.sensor_state: dict[str, bool] = {}   # IR_x -> có xe?
        self.last_webhook: dict | None = None
        self._scan_id = 0

    # -------- Lệnh cổng / LCD
    def open_gate(self, gate: str, line1: str = "", line2: str = "") -> None:
        action = "OPEN_IN" if gate == "entry" else "OPEN_OUT"
        # gộp lệnh trùng (cùng cổng) còn trong hàng đợi
        self.queue = deque((q for q in self.queue if q["action"] != action), maxlen=10)
        self.queue.append({"action": action, "at": time.monotonic()})
        if line1 or line2:
            self.show(line1, line2)

    def show(self, line1: str, line2: str = "") -> None:
        self.lcd = {"line1": lcd_text(line1), "line2": lcd_text(line2), "until": time.monotonic() + LCD_HOLD_SECONDS}

    def pop_command(self, available: int) -> dict:
        cutoff = time.monotonic() - 30  # lệnh quá 30 giây coi như hết hiệu lực
        while self.queue and self.queue[0]["at"] < cutoff:
            self.queue.popleft()
        action = self.queue.popleft()["action"] if self.queue else "NONE"
        if self.lcd and self.lcd["until"] > time.monotonic():
            l1, l2 = self.lcd["line1"], self.lcd["line2"]
        else:
            self.lcd = None
            l1, l2 = "SMART PARKING", lcd_text(f"CON TRONG: {available}" if available else "BAI DA DAY")
        return {"gate_action": action, "open_duration_ms": OPEN_DURATION_MS, "lcd_line1": l1, "lcd_line2": l2}

    # -------- Heartbeat
    def esp32_seen(self, device_id: str, uptime: int, sensors: dict, ip: str) -> None:
        self.esp32[device_id] = {"device_id": device_id, "uptime_sec": uptime, "sensors": sensors, "ip": ip,
                                 "last_seen": time.monotonic(), "at": now_iso()}

    def camera_seen(self, camera_id: str, ip: str, fps=None, gate=None) -> None:
        old = self.cameras.get(camera_id, {})
        self.cameras[camera_id] = {**old, "camera_id": camera_id, "ip": ip, "fps": fps if fps is not None else old.get("fps"),
                                   "gate": gate or old.get("gate"), "last_seen": time.monotonic(), "at": now_iso()}

    def add_scan(self, scan: dict) -> dict:
        self._scan_id += 1
        scan = {"id": self._scan_id, "at": now_iso(), **scan}
        self.scans.appendleft(scan)
        return scan

    @staticmethod
    def _age(rec: dict | None) -> float | None:
        return round(time.monotonic() - rec["last_seen"], 1) if rec else None

    def esp32_status(self) -> dict:
        rec = max(self.esp32.values(), key=lambda r: r["last_seen"], default=None)
        age = self._age(rec)
        return {"online": age is not None and age <= ESP32_OFFLINE_SECONDS, "age_seconds": age,
                "device": {k: v for k, v in rec.items() if k != "last_seen"} if rec else None}

    def camera_status(self) -> dict:
        rec = max(self.cameras.values(), key=lambda r: r["last_seen"], default=None)
        age = self._age(rec)
        return {"online": age is not None and age <= ALPR_OFFLINE_SECONDS, "age_seconds": age,
                "camera": {k: v for k, v in rec.items() if k != "last_seen"} if rec else None}

    def clear(self) -> None:
        self.queue.clear()
        self.lcd = None


hub = DeviceHub()
