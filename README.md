# Bãi Đỗ Xe Thông Minh 3 Tầng (Smart Parking)

Ứng dụng web chạy Local: **FastAPI + SQLite** (backend) và **React + Vite + Tailwind** (frontend).
Có chế độ giả lập hoàn toàn trên web và API HTTP sẵn sàng cho ESP32 thật trong cùng mạng Wi-Fi.
Không dùng thư viện AI/ML nặng, không dùng MQTT.

## 1. Yêu cầu
- Python 3.10 trở lên (khi cài trên Windows nhớ tick **Add python.exe to PATH**)
- Node.js 18 trở lên

## 2. Chạy Backend (cổng 8000)
```bash
cd backend
python -m venv venv
venv\Scripts\activate          # Windows  (Linux/macOS: source venv/bin/activate)
pip install -r requirements.txt
uvicorn main:app --host 0.0.0.0 --port 8000 --reload
```
- `parking.db` được tạo tự động lần chạy đầu, có sẵn 30 ô: `T1-A01..A10`, `T2-B01..B10`, `T3-C01..C10`.
- Tài liệu API: http://localhost:8000/docs

Hoặc trên Windows: chạy file `run-backend.bat` (lần đầu tự tạo venv và cài thư viện).

## 3. Chạy Frontend (cổng 5173)
```bash
cd frontend
npm install
npm run dev
```
Mở http://localhost:5173. Vite tự proxy `/api` và `/ws` sang backend nên điện thoại trong cùng Wi-Fi
có thể mở `http://<IP-LAN-máy-tính>:5173`.

Hoặc trên Windows: chạy file `run-frontend.bat`.

> Muốn chỉ chạy 1 cổng: `npm run build` trong `frontend/`, sau đó backend sẽ tự phục vụ giao diện tại http://localhost:8000.

## 4. Chức năng
**Tài khoản & phân quyền**
- Mở web lần đầu bắt buộc Đăng nhập / Tạo tài khoản. Đăng nhập được lưu (F5 không mất).
- Thanh tiêu đề hiện tên/email người đang dùng và nút **Đổi tài khoản**: trình duyệt nhớ các tài khoản đã đăng nhập
  (`localStorage`: email, tên, token còn hạn) để chuyển nhanh không cần mật khẩu, hoặc đăng nhập thêm tài khoản mới.
  Tài khoản hết hạn phiên sẽ yêu cầu nhập lại mật khẩu; có nút xóa tài khoản khỏi thiết bị.
- Mỗi lần đặt chỗ, hệ thống tự lưu **Tên, SĐT, Biển số gần nhất** (cột `users.default_plate`) để lần sau form điền sẵn.
- Tài khoản tự đăng ký luôn là **Khách hàng**; chỉ tài khoản **Admin** mới vào được trang Bảo vệ.
- Admin mặc định được tạo sẵn: `trilevanminh71@gmail.com` / `Admin@123` — **hãy đổi mật khẩu ngay** (biểu tượng tài khoản trên thanh tiêu đề, hoặc tab Tài khoản).
- Mật khẩu băm PBKDF2-SHA256 (`hashlib`), token ký HMAC hạn 30 ngày; đổi mật khẩu sẽ vô hiệu token cũ.
- API `/api/hardware/*` cho ESP32 không cần đăng nhập.

**Khách hàng**
- **Hướng dẫn nhanh** 3 bước (Đặt cọc → Vào cổng & chỉ đường → Thanh toán) + chú thích màu ô, tự hiện lần đầu vào Trang Khách hàng
  (lưu `localStorage` key `sp_onboarding_seen_v1` sau khi bấm "Đã hiểu"); xem lại bằng nút **? Hướng dẫn** trên thanh tiêu đề.
- Thống kê chỗ trống từng tầng, sơ đồ 3D tổng quan và sơ đồ 2D từng tầng (Xanh = trống, Vàng = đã đặt cọc, Đỏ = có xe).
- Đặt chỗ (Tên/SĐT tự điền từ tài khoản) → đóng cọc bằng **VietQR MB Bank** → **vé điện tử QR + mã vé 6 ký tự**,
  đồng hồ đếm ngược (chuyển đỏ khi còn dưới 3 phút) + chỉ dẫn đường đi tới ô.
- Tự hủy đặt chỗ đang giữ (ô trả về trống ngay).
- **Bản đồ dẫn đường mini kiểu Google Maps** (SVG thuần, không thư viện bản đồ): khi xe của khách check-in và barrier vào mở,
  popup tự bật (nhận diện theo tài khoản hoặc biển số quen dùng) với mặt bằng tầng, cổng/ram dốc, tuyến đường xanh + mũi tên chạy,
  ô đích nhấp nháy và dòng chỉ dẫn ngắn. Nút **Xem bản đồ chỉ đường** luôn có trên vé / xe đang đỗ. Trang Bảo vệ hiện bản xem trước.
- Lịch sử gửi xe & Hóa đơn của tài khoản; thanh toán phí gửi xe Online bằng VietQR.

**Bảo vệ / Admin**
- Check-in nhanh bằng **mã vé / nội dung QR** (máy quét QR dạng bàn phím quét thẳng vào ô), hoặc nút **Xe vào** cạnh mỗi đặt chỗ.
- Camera ALPR giả lập cổng vào/ra: chọn ảnh biển số mẫu, upload ảnh (tên file chứa biển số, vd `65A12345.jpg`) hoặc gõ biển số.
- Điều khiển barrier (mở 5 giây tự đóng / giữ mở / đóng), giả lập cảm biến ESP32, xem log phần cứng.
- Thông báo nổi + tiếng **bíp** (Web Audio API) khi có khách đặt cọc, hủy chỗ, đặt chỗ hết hạn hoặc cảm biến ESP32 thay đổi.
- Danh sách xe đang đỗ (Check-out, thu tiền mặt, QR online, nút **+1h** giả lập trôi thời gian).
- Đặt chỗ đang giữ (tua nhanh 5 phút, cho hết hạn ngay, hủy).
- Thống kê doanh thu Online / Tiền mặt / Tiền cọc, lượt xe, lịch sử.
- Cài đặt: thời gian giữ chỗ, tiền cọc, đơn giá/giờ.
- Tài khoản: tạo Admin mới, nâng/hạ quyền tài khoản có sẵn, đổi mật khẩu.

**Đặt chỗ (chỉ một hình thức: CÓ ĐẶT CỌC qua VietQR MB Bank) + SePay Webhook**
- Khách đặt chỗ → vé `pending_payment` "Chờ chuyển khoản" giữ ô tối đa **5 phút**, thẻ vé hiện VietQR nội dung `COC <MÃ_VÉ> <BIỂN_SỐ>`
  và trạng thái "Đang chờ hệ thống xác nhận tiền vào...". Quá 5 phút chưa có tiền → tự hủy, ô trả về trống. Khách **không** tự xác nhận được.
- Xe chưa có tiền cọc bị từ chối ở cổng (409).
- `POST /api/payment/webhook` (SePay): header `Authorization: Apikey <KEY>` (cũng nhận `Bearer <KEY>` / `x-api-key`; sai → 401). `KEY` = biến môi trường `SEPAY_API_KEY` (khuyên dùng trên Render) hoặc khóa nhập ở Cài đặt Admin. Chỉ xử lý `transferType = "in"`,
  chống trùng theo `bank_tx_id`. Khớp `COC<MÃ_VÉ>` + đủ tiền → vé `active` / ô `reserved` (giữ `hold_minutes`), WebSocket `deposit_approved`
  → màn hình khách tự nhảy sang Vé QR + bản đồ, Admin nghe tiếng bíp. Nội dung `PHI <BIỂN_SỐ>` + đủ `amount_due` → xe đang đỗ được
  thanh toán `online_qr` và mở barrier ra. Luôn trả `{"success": true}`.
- Cấu hình: Admin → Cài đặt → **SePay API Key** (kèm link Webhook để dán vào SePay; cần link Internet như ngrok). Nút **Duyệt cọc** thủ công vẫn giữ để dự phòng.
- Hình thức "đặt chỗ không cọc" và cài đặt `auto_approve_deposit` đã bị gỡ bỏ (lịch sử cũ vẫn giữ).

**Thanh toán trước khi ra cổng (kiểu trung tâm thương mại)**
- Cài đặt `exit_grace_minutes` (mặc định 15 phút): thời gian tối đa từ lúc thanh toán xong tới lúc xe ra cổng.
- Khách: thẻ xe đang đỗ có nút **"Thanh toán để chuẩn bị ra cổng"** (`POST /api/parking/prepay`). Phí còn lại 0đ → `paid_ready` ngay;
  > 0 → VietQR `PHI <BIỂN_SỐ>`, SePay báo đủ tiền (hoặc Bảo vệ bấm **Thu hộ**) → `paid_ready`, `exit_deadline = now + exit_grace_minutes`,
  màn hình khách đếm ngược "Đã thanh toán — Vui lòng ra cổng trong mm:ss".
- Camera ALPR cổng ra / `POST /api/hardware/gate {"gate":"exit"}`:
  - `paid_ready` & còn hạn → hoàn tất, **tự mở barrier**, trả ô, WebSocket `payment` (`action: auto_open`).
  - Quá hạn → chặn barrier, tính phí phát sinh = tổng phí tới lúc ra − cọc − đã trả trước (`action: late_fee`); quá hạn nhưng không phát sinh → vẫn mở.
  - Chưa trả trước → chặn barrier, hóa đơn tại cổng (`action: await_payment`): quét VietQR (SePay tự mở barrier) hoặc Bảo vệ thu tiền mặt.
- Doanh thu tính cả phần trả trước (`prepaid_amount` theo `prepay_method`) và phần trả tại cổng (`amount_due` theo `payment_method`).

**Miễn phí cho tài khoản Admin**
- Admin đặt chỗ → bỏ qua VietQR/SePay: vé `active` / ô `reserved` ngay, `deposit_amount = 0`, `deposit_mode = 'admin_free'`, cấp vé QR + bản đồ.
- Lượt gửi của đặt chỗ miễn phí, hoặc xe thuộc tài khoản Admin (theo tài khoản / biển số quen dùng) có `fee_waived = 1`: khi ra cổng
  (ESP32 / camera giả lập / nút Check-out) tự chốt `total_fee = 0`, `amount_due = 0`, `payment_status = 'paid'`, `payment_method = 'admin_free'`
  — nhãn **Miễn phí (Admin)**, không cộng vào doanh thu Online / Tiền mặt / Cọc (thống kê riêng `count_free`).
- Tài khoản Khách hàng giữ nguyên: bắt buộc chuyển khoản, SePay xác nhận mới được duyệt.

**Đối soát khi chuyển tiền lỗi**
- Bảng `payment_logs` lưu mọi giao dịch SePay: `matched`, `underpaid` (thiếu tiền), `wrong_content` (sai nội dung), `expired_late` (vé đã hết hạn/hủy),
  `already_paid` (trả trùng).
- Khách: nút **"Đã chuyển nhưng chưa duyệt? Gửi ảnh biên lai"** (ảnh < 5MB, lưu `backend/uploads/receipts/`) và **"Tải phiếu minh chứng"**
  (ảnh PNG vẽ bằng Canvas) trên vé chờ CK và trong Lịch sử.
- Admin → tab **Đối soát**: danh sách giao dịch + ảnh biên lai, **Duyệt bù** (mở lại vé nếu ô còn trống; có thể nhập mã vé khi nội dung sai),
  **Đánh dấu đã hoàn tiền**, **Tải ảnh biên lai**, **Xuất báo cáo đối soát (.csv)**.

**Thông tin quản trị viên & Lịch sử hoạt động**
- Cài đặt → "Thông tin Quản trị viên / Liên hệ hỗ trợ" (tên bãi, tên/SĐT/email admin, địa chỉ, thông báo) hiển thị trên Trang Khách hàng (ẩn dòng trống).
- Bảng `activity_logs`: đăng nhập (kèm trình duyệt/hệ điều hành/IP), đăng nhập sai, đổi mật khẩu, đặt chỗ có/không cọc, bị nhường ô,
  hủy, hết hạn, duyệt cọc, xe vào/ra, đổi cài đặt, đổi quyền. Khách xem của mình (Lịch sử → Hoạt động); Admin xem tất cả (tab Nhật ký, lọc email/hành động).

**Thanh toán VietQR**
- Ảnh QR động từ `img.vietqr.io` (MB Bank · 366730042011 · LE VAN MINH TRI) kèm số tiền và nội dung CK (biển số). Cần Internet để tải ảnh.
- Tiền được xác nhận tự động qua SePay Webhook; nếu chưa cấu hình SePay API Key thì Bảo vệ kiểm tra app ngân hàng rồi duyệt tay / thu tiền mặt.

**Mobile & PWA**
- Giao diện tự xếp dọc trên màn hình < 768px, nút/ô nhập cao ≥ 44px.
- Có `manifest.json` + icon: mở web trên điện thoại → "Thêm vào Màn hình chính" (iOS Safari: nút Chia sẻ; Android Chrome: menu ⋮).
  Android cần HTTPS (VD: link `run-tunnel.bat`) để hiện nút cài đặt app.

**Nghiệp vụ**
- Đặt chỗ quá hạn tự hủy (background task quét mỗi 10 giây), ô trả về trống, cập nhật realtime qua WebSocket.
- Xe đặt trước vào cổng: khớp ô đã đặt, trừ cọc. Xe vãng lai: tự chọn ô trống tầng thấp nhất.
- Tính phí (v3): đỗ ≤ `free_minutes` (mặc định 15 phút) → 0đ; quá thời gian đó `giờ = max(1, ceil(phút đỗ / 60))`,
  `tổng = giờ × đơn giá`, `phải trả = max(0, tổng − cọc − đã trả trước)`. Phải trả = 0 → camera cổng ra tự chốt & mở barrier;
  còn phí → VietQR nội dung `PHI <BIỂN_SỐ>`, SePay báo tiền vào đủ thì barrier tự mở.
- Biển số được chuẩn hóa: `65a12345` → `65A-123.45`, `51g1234` → `51G-1234`, `59x112345` → `59X1-123.45`.

## 4b. Đưa lên Cloud miễn phí (Render + PostgreSQL)
- Có biến môi trường `DATABASE_URL` (postgres://…) → backend tự dùng **PostgreSQL**, tự tạo bảng, 30 ô và Admin mặc định.
  Không có → dùng **SQLite** `backend/parking.db` như cũ (Local không cần cài PostgreSQL).
- Ảnh biên lai được trình duyệt **nén < 300KB (WebP/JPEG)** rồi lưu thẳng vào cột `payment_receipts.receipt_data` → không mất khi server Cloud khởi động lại.
- `GET /api/health` → `{"status":"ok","database":"connected","timestamp":...}` (có kiểm tra kết nối CSDL, hỗ trợ cả HEAD; CSDL lỗi → 503)
  để **UptimeRobot** ping 5–10 phút/lần giữ server free không ngủ. Chi tiết: `/api/health/details`.
- 1 link duy nhất: FastAPI phục vụ `frontend/dist` tại `/`, giữ `/api/*` và `/ws`.
- Triển khai: đẩy code lên GitHub → Render → **New + → Blueprint** → chọn repo (dùng `render.yaml` ở thư mục gốc).
  Render hỏi `ADMIN_PASSWORD` = mật khẩu cho Admin gốc ở lần khởi tạo đầu (không dùng `Admin@123` trên Internet).
  Sau đó cập nhật link Webhook SePay thành `https://<tên>.onrender.com/api/payment/webhook`.
- Lưu ý gói free: PostgreSQL free của Render hết hạn sau một thời gian (xem trang Render) — nhớ sao lưu/nâng cấp; server free ngủ sau ~15 phút không có truy cập (UptimeRobot giúp giữ thức).

## 4c. Phiên bản v3 — 3 vai trò, Bản đồ Kép, Dẫn đường GPS, IoT
**Biến môi trường mới (Render → Environment):**
| Biến | Ý nghĩa |
|---|---|
| `HARDWARE_API_KEY` | (Tuỳ chọn) Khóa header `X-API-Key` cho ESP32 / Webcam ALPR. Bỏ trống → dùng chung `SEPAY_API_KEY` |
| `GUARD_PASSWORD` | Mật khẩu tài khoản Bảo vệ mặc định `guard@smartparking.vn` khi tạo lần đầu (bỏ trống → `guard123`, Logs in cảnh báo — đổi ngay) |

**Vai trò (`users.role`):**
- `customer` — đặt ô, VietQR/SePay, vé QR, chia sẻ GPS, dẫn đường 2 chặng có giọng nói, xác nhận đã vào ô / đổi ô 1 chạm.
- `guard` — ALPR Live Feed, trạng thái cổng, mở/đóng barrier khẩn cấp, thu tiền mặt / duyệt cọc dự phòng, Sức khỏe thiết bị, vị trí GPS khách. Không sửa bản đồ, không xóa dữ liệu.
- `admin` — toàn quyền + Trình chỉnh sửa Bản đồ & GPS, Xuất báo cáo CSV, Bảng điều khiển Demo 4 nút, Cài đặt, Tài khoản.

**Cài đặt mới (Admin → Cài đặt):** `free_minutes` (miễn phí N phút đầu, mặc định 15), `pending_minutes` (đơn chờ chuyển khoản tự hủy sau N phút, mặc định 10).
Giá/giờ, tiền cọc, thời gian giữ chỗ giữ nguyên giá trị đang lưu. Scheduler chạy mỗi 10 giây: hủy đơn chờ CK quá hạn, nhả ô đã cọc quá giờ giữ chỗ.

**Bản đồ (`parking_maps`)** — `GET /api/map/config` (công khai), `PUT /api/map/config` (Admin, broadcast `map_updated`), `POST /api/map/reset-default`.
JSON gồm `origin_lat/origin_lng` (mặc định 10.0299, 105.7706), `rotation_deg`, `scale_meters_per_unit`, `gate_in/gate_out`,
`slots[]` (`slot_code, floor, x, y, w, h, rotation, lat, lng, gps_radius_m, hardware_sensor_id` = `NONE`/`IR_1`..`IR_5`),
`waypoints[]`, `edges[]` (`oneway`), `obstacles[]` (`pillar`/`wall`/`booth`). `lat/lng` luôn được tính lại từ `x, y` khi lưu.

**Xác nhận / Đổi ô:** `POST /api/reservations/{id}/confirm-parked`, `POST /api/reservations/{id}/switch-slot` `{"new_slot_code","floor"}`
(và `/api/parking/sessions/{id}/confirm-parked|switch-slot` cho xe vãng lai). Sự kiện WebSocket: `slot_confirmed`, `slot_switched`.

**GPS:** `POST /api/telemetry/location` `{lat,lng,accuracy,speed,heading}` (khách đăng nhập), `GET /api/telemetry/locations` (Bảo vệ/Admin; `stale` khi mất tín hiệu > 10s).
**Giám sát:** `GET /api/system/health-devices` (Neon DB, SePay, ESP32 offline > 15s, Webcam offline > 20s) · `GET /api/reports/export` (CSV UTF-8 BOM, Admin).
**Demo (Admin):** `POST /api/admin/demo/alpr` `{"plate","gate":"IN|OUT"}`, `POST /api/admin/demo/sepay` (không tính doanh thu), `POST /api/admin/demo/reset` `{"confirm":"RESET"}`
(trả ô về trống, đóng phiên đang mở — giữ lịch sử doanh thu).

### ESP32 2 nhân (5 IR + Servo SG90 + LCD 16x2) — `POST /api/hardware/esp32/sync`
Header `X-API-Key: <HARDWARE_API_KEY hoặc SEPAY_API_KEY>`, gửi mỗi 0,5–2 giây:
```json
{"device_id": "ESP32_MAIN", "sensors": {"IR_1": false, "IR_2": true, "IR_3": false, "IR_4": false, "IR_5": false}, "uptime_sec": 1234}
```
Trả về (lệnh cổng lấy xong là xóa khỏi hàng đợi):
```json
{"ok": true, "gate_action": "OPEN_IN", "open_duration_ms": 5000, "lcd_line1": "BIEN SO OK", "lcd_line2": "MOI VAO T1-A01", "available_slots": 27}
```
- `gate_action`: `OPEN_IN` / `OPEN_OUT` / `NONE` → quay Servo SG90 mở `open_duration_ms` rồi đóng.
- `IR_x` được ánh xạ sang ô có `hardware_sensor_id` tương ứng (đổi trên web, không phải nạp lại firmware). IR báo có xe ở đúng ô được chỉ định → tự xác nhận đã đỗ;
  ở ô trống khác trong 20 phút sau khi xe qua cổng → sự kiện `wrong_slot_alert` (`detected_slot_code`, `assigned_slot_code`).
- LCD 16 ký tự, không dấu. Mặc định `SMART PARKING` / `CON TRONG: <n>`.

### Webcam ALPR (script Python) — `POST /api/hardware/alpr/scan`, `POST /api/hardware/alpr/heartbeat`
Header `X-API-Key` như trên.
```json
{"license_plate": "65A12345", "gate": "IN", "confidence": 0.93, "plate_image_base64": "<JPEG/PNG base64, ≤ 400KB>", "camera_id": "CAM_GATE"}
```
- `confidence` nhận 0–1 hoặc 0–100. Cùng biển + cùng cổng lặp lại trong 15 giây chỉ xử lý 1 lần (`"duplicate": true`).
- Xử lý vào/ra cổng như ESP32, đẩy lệnh Servo/LCD, phát `alpr_event` (kèm ảnh, chỉ Bảo vệ/Admin nhận) và `gate_opened` (`slot_code`, `floor`) để trang khách tự mở Bản đồ chi tiết.
- Heartbeat: `{"camera_id": "CAM_GATE", "fps": 15}` mỗi 5–10 giây.

Ví dụ:
```powershell
curl -X POST https://<tên>.onrender.com/api/hardware/esp32/sync -H "X-API-Key: <key>" -H "Content-Type: application/json" -d '{"device_id":"ESP32_MAIN","sensors":{"IR_1":true},"uptime_sec":10}'
```

## 5. API cho ESP32 (bản cũ — không cần khóa, vẫn hoạt động)
| Method | Endpoint | Body / Kết quả |
|---|---|---|
| POST | `/api/hardware/sensor` | `{"slot_code": "T1-A01", "occupied": true}` |
| POST | `/api/hardware/gate` | `{"gate": "entry", "plate": "65A-123.45"}` → check-in, mở barrier vào. `gate: "exit"` → trả số tiền cần thanh toán |
| POST | `/api/hardware/gate-trigger` | `{"gate": "entry"\|"exit", "plate"?: "..."}` — cảm biến báo **xe tới cổng**. Auto-Gate BẬT: có `plate` → tự check-in/out, hợp lệ thì mở barrier 5 giây; không có `plate` → trang Bảo vệ (webcam / biển số test) đọc biển số rồi xử lý. Auto-Gate TẮT → chỉ báo Bảo vệ |
| GET | `/api/hardware/barrier` | `{"entry": "OPEN"/"CLOSED", "exit": "..."}` — ESP32 đọc định kỳ (~500ms) để điều khiển servo |
| POST | `/api/hardware/alpr` | multipart `file` (ảnh) → `{"plate": "...", "confidence": 0.95}` (giả lập) |
| WS | `/ws` | Sự kiện realtime dạng `{"event": "...", "data": {...}}` |

Ví dụ ESP32 (Arduino):
```cpp
#include <WiFi.h>
#include <HTTPClient.h>
const char* SERVER = "http://192.168.1.10:8000"; // IP LAN máy chạy backend

void sendSensor(const char* slot, bool occupied) {
  HTTPClient http;
  http.begin(String(SERVER) + "/api/hardware/sensor");
  http.addHeader("Content-Type", "application/json");
  http.POST(String("{\"slot_code\":\"") + slot + "\",\"occupied\":" + (occupied ? "true" : "false") + "}");
  http.end();
}

bool entryOpen() {
  HTTPClient http;
  http.begin(String(SERVER) + "/api/hardware/barrier");
  bool open = http.GET() == 200 && http.getString().indexOf("\"entry\":\"OPEN\"") >= 0;
  http.end();
  return open;
}
```
Nhớ mở cổng 8000 trong Windows Firewall nếu ESP32 không gọi được.

## 6. Cấu trúc
```
backend/
  main.py          FastAPI app, WebSocket /ws (xác thực tùy chọn), scheduler 10s, /api/health kiểm tra CSDL
  database.py      SQLite / PostgreSQL + seed 3 tầng
  mapcfg.py        Bản đồ Kép: chiếu GPS <-> tọa độ nội bộ, kiểm tra & lưu sơ đồ, tìm đường từ cổng
  devices.py       Heartbeat ESP32 / Webcam, hàng đợi lệnh Servo + LCD, ảnh ALPR gần nhất
  models.py        Pydantic schemas
  services.py      Nghiệp vụ: đặt chỗ, check-in/out, tính tiền, chuẩn hóa biển số
  realtime.py      WebSocket manager + trạng thái barrier
  auth.py          Mật khẩu PBKDF2, token HMAC, phân quyền, seed Admin mặc định
  routers/         auth.py, parking.py, reservations.py, hardware.py, admin.py, payment.py, v3.py
frontend/src/
  App.jsx, api.js
  pages/           AuthScreen.jsx, CustomerView.jsx, AdminView.jsx
  gps.jsx, geo.js, voice.js, mapStore.js   GPS tự bật + chia sẻ, phép chiếu & tìm đường, giọng nói vi-VN, cấu hình bản đồ
  components/      ParkingMap (2D/3D), DualMap (LeafletMap <-> FloorPlan), NavigationPanel (dẫn đường 2 chặng),
                   AdminMapEditor, GuardPanels (ALPR feed, Sức khỏe thiết bị, GPS khách, Demo), SlotPicker,
                   BookingModal, PaymentQRModal (VietQR), ReservationCard, TicketQR, CheckoutModal, SimulationPanel,
                   SettingsPanel, AccountPanels, ui
frontend/public/   manifest.json, sw.js, icons/ (PWA)
```
