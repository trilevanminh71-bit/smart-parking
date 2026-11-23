"""Cấu hình Bản đồ Kép (Leaflet GPS thực tế <-> Sơ đồ 2D từng tầng) lưu trong bảng `parking_maps`.

Hệ tọa độ nội bộ: đơn vị `unit` (x sang phải, y xuống dưới như SVG), 1 unit = `scale_meters_per_unit` mét.
Neo ra GPS thật bằng `origin_lat/origin_lng` (điểm x=0, y=0) và `rotation_deg` (xoay cả bãi theo chiều kim đồng hồ).
`lat/lng` của ô, cổng, waypoint luôn được tính lại từ (x, y) khi lưu nên 2 bản đồ không bao giờ lệch nhau.
"""
import json
import math
import re
import threading

from database import Tx, ensure_slot, now_iso, query, query_one

SENSOR_IDS = ("NONE", "IR_1", "IR_2", "IR_3", "IR_4", "IR_5")
SLOT_CODE_RE = re.compile(r"^T([1-9])-([A-Z])(\d{2})$")
OBSTACLE_KINDS = ("pillar", "wall", "booth")
WAYPOINT_KINDS = ("node", "ramp", "gate_in", "gate_out")
M_PER_DEG = 111_320.0
MAX_SLOTS, MAX_WAYPOINTS, MAX_EDGES, MAX_OBSTACLES = 300, 1500, 3000, 500

_lock = threading.RLock()
_cache: dict | None = None


# ---------------------------------------------------------------- Phép chiếu nội bộ <-> GPS
def to_latlng(cfg: dict, x: float, y: float) -> tuple[float, float]:
    s = float(cfg.get("scale_meters_per_unit") or 1)
    th = math.radians(float(cfg.get("rotation_deg") or 0))
    e, n = x * s, -y * s
    e2 = e * math.cos(th) + n * math.sin(th)
    n2 = -e * math.sin(th) + n * math.cos(th)
    lat0 = float(cfg["origin_lat"])
    lat = lat0 + n2 / M_PER_DEG
    lng = float(cfg["origin_lng"]) + e2 / (M_PER_DEG * math.cos(math.radians(lat0)))
    return round(lat, 7), round(lng, 7)


def from_latlng(cfg: dict, lat: float, lng: float) -> tuple[float, float]:
    s = float(cfg.get("scale_meters_per_unit") or 1)
    th = math.radians(float(cfg.get("rotation_deg") or 0))
    lat0 = float(cfg["origin_lat"])
    e2 = (lng - float(cfg["origin_lng"])) * M_PER_DEG * math.cos(math.radians(lat0))
    n2 = (lat - lat0) * M_PER_DEG
    e = e2 * math.cos(th) - n2 * math.sin(th)
    n = e2 * math.sin(th) + n2 * math.cos(th)
    return round(e / s, 3), round(-n / s, 3)


# ---------------------------------------------------------------- Sơ đồ mặc định (30 ô, 3 tầng)
SLOT_W, SLOT_H = 3.0, 5.0
LANE_Y = 10.0
COL_X = [8.0, 11.2, 14.4, 17.6, 20.8]
RAMP_X = 26.0


def default_config(slot_rows: list[dict] | None = None) -> dict:
    """Bố cục giống sơ đồ 2D cũ: dãy trên 01–05, làn xe giữa, dãy dưới 06–10, cổng ở đầu trái Tầng 1, dốc lên ở cuối làn."""
    rows = slot_rows if slot_rows is not None else [
        {"code": f"T{f}-{'ABC'[f - 1]}{i:02d}", "floor": f} for f in (1, 2, 3) for i in range(1, 11)]
    floors = sorted({r["floor"] for r in rows}) or [1]
    sensors = iter(SENSOR_IDS[1:])
    slots = []
    for r in sorted(rows, key=lambda r: (r["floor"], r["code"])):
        idx = int(r["code"][-2:])
        top = idx <= 5
        col = (idx - 1) % 5
        x = COL_X[col] + (3.2 * 5 * ((idx - 1) // 10))  # ô 11+ nối dài sang phải
        slots.append({
            "slot_code": r["code"], "floor": r["floor"], "x": x, "y": 4.0 if top else 16.0,
            "w": SLOT_W, "h": SLOT_H, "rotation": 0, "gps_radius_m": 2.5,
            # 5 cảm biến IR của ESP32 gắn sẵn vào 5 ô đầu Tầng 1 (đổi được trên web)
            "hardware_sensor_id": next(sensors, "NONE") if r["floor"] == 1 and top else "NONE",
        })
    waypoints, edges = [], []
    for f in floors:
        chain = [f"F{f}_START"] + [f"F{f}_C{i + 1}" for i in range(5)] + [f"F{f}_RAMP"]
        waypoints.append({"id": f"F{f}_START", "floor": f, "x": 3.0, "y": LANE_Y, "kind": "node"})
        waypoints += [{"id": f"F{f}_C{i + 1}", "floor": f, "x": COL_X[i], "y": LANE_Y, "kind": "node"} for i in range(5)]
        waypoints.append({"id": f"F{f}_RAMP", "floor": f, "x": RAMP_X, "y": LANE_Y, "kind": "ramp"})
        edges += [{"from": a, "to": b, "oneway": False} for a, b in zip(chain, chain[1:])]
    for a, b in zip(floors, floors[1:]):
        edges.append({"from": f"F{a}_RAMP", "to": f"F{b}_RAMP", "oneway": False})
    f1 = floors[0]
    waypoints += [{"id": "GATE_IN", "floor": f1, "x": 0.0, "y": 8.5, "kind": "gate_in"},
                  {"id": "GATE_OUT", "floor": f1, "x": 0.0, "y": 11.5, "kind": "gate_out"}]
    # Cổng vào / ra là đường 1 chiều
    edges += [{"from": "GATE_IN", "to": f"F{f1}_START", "oneway": True},
              {"from": f"F{f1}_START", "to": "GATE_OUT", "oneway": True}]
    obstacles = []
    for f in floors:
        obstacles += [
            {"id": f"F{f}_WALL_N", "floor": f, "kind": "wall", "x": 14.0, "y": 0.6, "w": 28.0, "h": 0.4, "rotation": 0},
            {"id": f"F{f}_WALL_S", "floor": f, "kind": "wall", "x": 14.0, "y": 19.4, "w": 28.0, "h": 0.4, "rotation": 0},
            {"id": f"F{f}_P1", "floor": f, "kind": "pillar", "x": 12.8, "y": 6.9, "w": 0.6, "h": 0.6, "rotation": 0},
            {"id": f"F{f}_P2", "floor": f, "kind": "pillar", "x": 19.2, "y": 6.9, "w": 0.6, "h": 0.6, "rotation": 0},
            {"id": f"F{f}_P3", "floor": f, "kind": "pillar", "x": 12.8, "y": 13.1, "w": 0.6, "h": 0.6, "rotation": 0},
            {"id": f"F{f}_P4", "floor": f, "kind": "pillar", "x": 19.2, "y": 13.1, "w": 0.6, "h": 0.6, "rotation": 0},
        ]
    obstacles.append({"id": "BOOTH", "floor": f1, "kind": "booth", "x": 1.5, "y": 4.0, "w": 2.4, "h": 2.4, "rotation": 0})
    cfg = {
        "version": 1, "name": "Bãi xe 3 tầng (mặc định)",
        "origin_lat": 10.0299, "origin_lng": 105.7706, "rotation_deg": 0, "scale_meters_per_unit": 1.0,
        "gate_in": {"x": 0.0, "y": 8.5}, "gate_out": {"x": 0.0, "y": 11.5},
        "floors": [{"floor": f, "name": f"Tầng {f}"} for f in floors],
        "slots": slots, "waypoints": waypoints, "edges": edges, "obstacles": obstacles,
    }
    return project(cfg)


def project(cfg: dict) -> dict:
    """Tính lại lat/lng cho cổng, ô, waypoint từ tọa độ nội bộ."""
    for key in ("gate_in", "gate_out"):
        g = cfg[key]
        g["lat"], g["lng"] = to_latlng(cfg, g["x"], g["y"])
    for item in cfg["slots"] + cfg["waypoints"]:
        item["lat"], item["lng"] = to_latlng(cfg, item["x"], item["y"])
    return cfg


# ---------------------------------------------------------------- Kiểm tra dữ liệu từ Trình chỉnh sửa
class MapError(ValueError):
    pass


def _num(v, name, lo=-1e6, hi=1e6) -> float:
    try:
        f = float(v)
    except (TypeError, ValueError):
        raise MapError(f"{name} phải là số")
    if not math.isfinite(f) or not lo <= f <= hi:
        raise MapError(f"{name} ngoài phạm vi cho phép ({lo} … {hi})")
    return f


def _text(v, name, maxlen=60) -> str:
    s = str(v if v is not None else "").strip()
    if not s or len(s) > maxlen:
        raise MapError(f"{name} không hợp lệ")
    return s


def validate(raw: dict) -> dict:
    if not isinstance(raw, dict):
        raise MapError("Cấu hình bản đồ phải là JSON object")
    cfg = {
        "version": 1,
        "name": _text(raw.get("name") or "Bãi xe", "Tên sơ đồ", 80),
        "origin_lat": _num(raw.get("origin_lat"), "origin_lat", -90, 90),
        "origin_lng": _num(raw.get("origin_lng"), "origin_lng", -180, 180),
        "rotation_deg": _num(raw.get("rotation_deg", 0), "rotation_deg", 0, 360) % 360,
        "scale_meters_per_unit": _num(raw.get("scale_meters_per_unit", 1), "scale_meters_per_unit", 0.01, 100),
    }
    for key in ("gate_in", "gate_out"):
        g = raw.get(key) or {}
        cfg[key] = {"x": _num(g.get("x"), f"{key}.x"), "y": _num(g.get("y"), f"{key}.y")}

    slots, codes, used_sensors = [], set(), {}
    for i, s in enumerate(raw.get("slots") or []):
        code = _text(s.get("slot_code"), f"Mã ô #{i + 1}", 12).upper()
        m = SLOT_CODE_RE.match(code)
        if not m:
            raise MapError(f"Mã ô {code} sai định dạng (VD: T1-A01 — T<tầng>-<chữ cái><2 số>)")
        floor = int(_num(s.get("floor", m.group(1)), f"Tầng của {code}", 1, 9))
        if floor != int(m.group(1)):
            raise MapError(f"Ô {code}: tầng {floor} không khớp số tầng trong mã ô")
        if code in codes:
            raise MapError(f"Trùng mã ô {code}")
        codes.add(code)
        sensor = str(s.get("hardware_sensor_id") or "NONE").upper()
        if sensor not in SENSOR_IDS:
            raise MapError(f"Ô {code}: cảm biến {sensor} không hợp lệ (NONE, IR_1…IR_5)")
        if sensor != "NONE":
            if sensor in used_sensors:
                raise MapError(f"Cảm biến {sensor} đang gán cho cả {used_sensors[sensor]} và {code}")
            used_sensors[sensor] = code
        slots.append({
            "slot_code": code, "floor": floor,
            "x": _num(s.get("x"), f"{code}.x"), "y": _num(s.get("y"), f"{code}.y"),
            "w": _num(s.get("w", SLOT_W), f"{code}.w", 0.5, 50), "h": _num(s.get("h", SLOT_H), f"{code}.h", 0.5, 50),
            "rotation": _num(s.get("rotation", 0), f"{code}.rotation", 0, 360) % 360,
            "gps_radius_m": _num(s.get("gps_radius_m", 2.5), f"{code}.gps_radius_m", 0.5, 50),
            "hardware_sensor_id": sensor,
        })
    if not slots:
        raise MapError("Sơ đồ phải có ít nhất 1 ô đỗ")
    if len(slots) > MAX_SLOTS:
        raise MapError(f"Tối đa {MAX_SLOTS} ô đỗ")
    floors_used = sorted({s["floor"] for s in slots})
    names = {int(f.get("floor", 0)): str(f.get("name") or "")[:30] for f in (raw.get("floors") or []) if isinstance(f, dict)}
    cfg["floors"] = [{"floor": f, "name": names.get(f) or f"Tầng {f}"} for f in floors_used]

    wps, ids = [], set()
    for i, w in enumerate(raw.get("waypoints") or []):
        wid = _text(w.get("id"), f"Waypoint #{i + 1}", 40)
        if wid in ids:
            raise MapError(f"Trùng waypoint {wid}")
        ids.add(wid)
        kind = str(w.get("kind") or "node")
        if kind not in WAYPOINT_KINDS:
            raise MapError(f"Waypoint {wid}: loại {kind} không hợp lệ")
        wps.append({"id": wid, "floor": int(_num(w.get("floor", 1), f"{wid}.floor", 1, 9)), "kind": kind,
                    "x": _num(w.get("x"), f"{wid}.x"), "y": _num(w.get("y"), f"{wid}.y")})
    if len(wps) > MAX_WAYPOINTS:
        raise MapError(f"Tối đa {MAX_WAYPOINTS} waypoint")
    edges, seen = [], set()
    for e in raw.get("edges") or []:
        a, b = str(e.get("from") or ""), str(e.get("to") or "")
        if a not in ids or b not in ids or a == b:
            raise MapError(f"Lối đi {a} → {b} tham chiếu waypoint không tồn tại")
        key = (a, b)
        if key in seen:
            continue
        seen.add(key)
        edges.append({"from": a, "to": b, "oneway": bool(e.get("oneway"))})
    if len(edges) > MAX_EDGES:
        raise MapError(f"Tối đa {MAX_EDGES} lối đi")
    obs = []
    for i, o in enumerate(raw.get("obstacles") or []):
        kind = str(o.get("kind") or "pillar")
        if kind not in OBSTACLE_KINDS:
            raise MapError(f"Vật cản #{i + 1}: loại {kind} không hợp lệ (pillar, wall, booth)")
        oid = str(o.get("id") or f"OB{i + 1}")[:40]
        obs.append({"id": oid, "floor": int(_num(o.get("floor", 1), f"{oid}.floor", 1, 9)), "kind": kind,
                    "x": _num(o.get("x"), f"{oid}.x"), "y": _num(o.get("y"), f"{oid}.y"),
                    "w": _num(o.get("w", 1), f"{oid}.w", 0.1, 200), "h": _num(o.get("h", 1), f"{oid}.h", 0.1, 200),
                    "rotation": _num(o.get("rotation", 0), f"{oid}.rotation", 0, 360) % 360})
    if len(obs) > MAX_OBSTACLES:
        raise MapError(f"Tối đa {MAX_OBSTACLES} vật cản")
    cfg.update(slots=slots, waypoints=wps, edges=edges, obstacles=obs)
    return project(cfg)


# ---------------------------------------------------------------- Lưu / đọc
def _active_slot_rows() -> list[dict]:
    return query("SELECT code, floor FROM slots WHERE active = 1 ORDER BY floor, code")


def get_config() -> dict:
    global _cache
    with _lock:
        if _cache is None:
            row = query_one("SELECT * FROM parking_maps ORDER BY id LIMIT 1")
            if row:
                cfg = json.loads(row["config"])
                cfg["updated_at"], cfg["updated_by"] = row["updated_at"], row["updated_by"]
            else:
                cfg = default_config(_active_slot_rows())
                cfg["updated_at"], cfg["updated_by"] = now_iso(), "system"
                with Tx() as db:
                    db.execute("INSERT INTO parking_maps (name, config, updated_by, updated_at) VALUES (?, ?, ?, ?)",
                               (cfg["name"], json.dumps(cfg, ensure_ascii=False), "system", cfg["updated_at"]))
            _cache = cfg
        return _cache


def save_config(raw: dict, editor: dict, log_fn) -> tuple[dict, dict]:
    """Kiểm tra + lưu cấu hình; đồng bộ bảng `slots` (thêm ô mới, ẩn ô đã xóa). Trả về (cấu hình, tóm tắt thay đổi)."""
    global _cache
    cfg = validate(raw)
    new_codes = {s["slot_code"]: s["floor"] for s in cfg["slots"]}
    with _lock, Tx() as db:
        current = {r["code"]: dict(r) for r in db.execute("SELECT * FROM slots WHERE active = 1").fetchall()}
        removed = [c for c in current if c not in new_codes]
        for code in removed:
            s = current[code]
            busy = s["status"] != "available" or db.execute(
                "SELECT 1 FROM reservations WHERE slot_id = ? AND status IN ('active', 'pending_payment', 'checked_in')", (s["id"],)
            ).fetchone() or db.execute("SELECT 1 FROM parking_sessions WHERE slot_id = ? AND status = 'parked'", (s["id"],)).fetchone()
            if busy:
                raise MapError(f"Không thể xóa ô {code}: ô đang có xe hoặc đang được đặt chỗ")
            db.execute("UPDATE slots SET active = 0 WHERE id = ?", (s["id"],))
        added = [c for c in new_codes if c not in current]
        for code, floor in new_codes.items():
            if code in added:
                ensure_slot(db, code, floor)
            elif current[code]["floor"] != floor:
                db.execute("UPDATE slots SET floor = ? WHERE code = ?", (floor, code))
        stamp = now_iso()
        cfg["updated_at"], cfg["updated_by"] = stamp, editor["email"]
        body = json.dumps(cfg, ensure_ascii=False)
        if db.execute("SELECT 1 FROM parking_maps").fetchone():
            db.execute("UPDATE parking_maps SET name = ?, config = ?, updated_by = ?, updated_at = ? WHERE id = (SELECT MIN(id) FROM parking_maps)",
                       (cfg["name"], body, editor["email"], stamp))
        else:
            db.execute("INSERT INTO parking_maps (name, config, updated_by, updated_at) VALUES (?, ?, ?, ?)",
                       (cfg["name"], body, editor["email"], stamp))
        summary = {"slots": len(cfg["slots"]), "added": added, "removed": removed,
                   "sensors": {s["hardware_sensor_id"]: s["slot_code"] for s in cfg["slots"] if s["hardware_sensor_id"] != "NONE"}}
        log_fn(db, "admin", "map_update",
               f"{editor['email']} lưu sơ đồ \"{cfg['name']}\": {len(cfg['slots'])} ô"
               + (f", thêm {', '.join(added)}" if added else "") + (f", xóa {', '.join(removed)}" if removed else "")
               + f"; cảm biến: {', '.join(f'{k}→{v}' for k, v in summary['sensors'].items()) or 'không gán'}")
        _cache = cfg
    return cfg, summary


def sensor_map() -> dict[str, str]:
    """IR_1..IR_5 -> mã ô."""
    return {s["hardware_sensor_id"]: s["slot_code"] for s in get_config()["slots"] if s["hardware_sensor_id"] != "NONE"}


# ---------------------------------------------------------------- Tìm đường trên lưới lối đi
def _graph(cfg: dict):
    pos = {w["id"]: w for w in cfg["waypoints"]}
    adj: dict[str, list[tuple[str, float]]] = {k: [] for k in pos}
    for e in cfg["edges"]:
        a, b = pos.get(e["from"]), pos.get(e["to"])
        if not a or not b:
            continue
        d = math.hypot(a["x"] - b["x"], a["y"] - b["y"]) + (8.0 if a["floor"] != b["floor"] else 0.0)  # đi dốc tốn hơn
        adj[a["id"]].append((b["id"], d))
        if not e["oneway"]:
            adj[b["id"]].append((a["id"], d))
    return pos, adj


def _nearest_wp(cfg: dict, floor: int, x: float, y: float) -> str | None:
    best = None
    for w in cfg["waypoints"]:
        if w["floor"] == floor and w["kind"] in ("node", "ramp"):
            d = math.hypot(w["x"] - x, w["y"] - y)
            if best is None or d < best[0]:
                best = (d, w["id"])
    return best[1] if best else None


def route_length_from_gate(cfg: dict) -> dict[str, float]:
    """Khoảng cách đi theo lối đi từ cổng vào tới từng ô (Dijkstra) — dùng chọn ô gần nhất cho xe vãng lai."""
    import heapq
    pos, adj = _graph(cfg)
    start = next((w["id"] for w in cfg["waypoints"] if w["kind"] == "gate_in"), None)
    dist = {start: 0.0} if start else {}
    heap = [(0.0, start)] if start else []
    while heap:
        d, u = heapq.heappop(heap)
        if d > dist.get(u, math.inf):
            continue
        for v, w in adj.get(u, []):
            if d + w < dist.get(v, math.inf):
                dist[v] = d + w
                heapq.heappush(heap, (d + w, v))
    out = {}
    for s in cfg["slots"]:
        wp = _nearest_wp(cfg, s["floor"], s["x"], s["y"])
        base = dist.get(wp, math.inf) if wp else math.inf
        tail = math.hypot(pos[wp]["x"] - s["x"], pos[wp]["y"] - s["y"]) if wp else 0
        out[s["slot_code"]] = base + tail
    return out


def slot_info(code: str) -> dict | None:
    return next((s for s in get_config()["slots"] if s["slot_code"] == code), None)


def reset_cache() -> None:
    global _cache
    with _lock:
        _cache = None
