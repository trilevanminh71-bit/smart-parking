# CLAUDE.md — Dự án Web Bãi Đỗ Xe Thông Minh (3 Tầng)

## 1. Mục tiêu dự án

Xây dựng ứng dụng web hoàn chỉnh chạy **Local** cho hệ thống **Bãi đỗ xe thông minh 3 tầng**, hỗ trợ cả **chế độ giả lập trên web** (để demo/test không cần mạch) và **API HTTP sẵn sàng cho phần cứng ESP32 thật** trong mạng Wi-Fi nội bộ. Toàn bộ giao diện hiển thị bằng **tiếng Việt**, phong cách dark-mode hiện đại, gọn nhẹ và tối ưu dung lượng.

## 2. Công nghệ & Ràng buộc tối ưu dung lượng

* **Frontend (`frontend/`):** React + Vite + Tailwind CSS + Lucide Icons + WebSocket client.

* **Backend (`backend/`):** Python 3 + FastAPI + Uvicorn + SQLite (`sqlite3` / `aiosqlite`) + WebSocket (`/ws`).

* **Ràng buộc nhẹ máy (BẮT BUỘC):**

  * **KHÔNG** cài đặt các thư viện AI/ML nặng (không dùng PyTorch, TensorFlow, EasyOCR, PaddleOCR, YOLO, OpenCV nặng). Phần nhận diện biển số (ALPR) viết bằng logic giả lập nhẹ (cho phép chọn ảnh mẫu / upload ảnh hoặc nhập biển số, backend chuẩn hóa định dạng biển số Việt Nam bằng regex).

  * **KHÔNG** dùng MQTT Broker (không cài Mosquitto). Toàn bộ giao tiếp với ESP32 sử dụng **HTTP REST API** + **WebSocket** cho cập nhật real-time trên web.

## 3. Cấu trúc thư mục mục tiêu

```
smart-parking-app/
├── CLAUDE.md
├── README.md               # Hướng dẫn cài đặt và chạy backend + frontend
├── backend/
│   ├── main.py             # FastAPI app, WebSocket, background task tự hủy đặt chỗ
│   ├── database.py         # Khởi tạo SQLite (parking.db) và seed dữ liệu 3 tầng
│   ├── models.py           # Pydantic schemas
│   ├── routers/            # parking.py, reservations.py, hardware.py, admin.py
│   └── requirements.txt    # fastapi, uvicorn, aiosqlite, pydantic, python-multipart
└── frontend/
    ├── package.json
    └── src/
        ├── App.jsx
        ├── pages/
        │   ├── CustomerView.jsx   # Giao diện Khách hàng
        │   └── AdminView.jsx      # Giao diện Bảo vệ / Admin
        └── components/            # ParkingMap3D/2D, BookingModal, PaymentQRModal, SimulationPanel, SettingsPanel

```

## 4. Thiết kế Cơ sở dữ liệu (SQLite — `parking.db`)

Tạo tự động khi khởi động backend nếu chưa tồn tại:

1. `settings`: Lưu cấu hình có thể chỉnh sửa từ Admin (`hold_minutes` mặc định `15`, `deposit_amount` mặc định `10000`, `hourly_rate` mặc định `10000`).

2. `slots`: Danh sách ô đỗ 3 tầng (mỗi tầng 10 ô: `T1-A01`..`T1-A10`, `T2-B01`..`T2-B10`, `T3-C01`..`T3-C10`), gồm `id`, `code`, `floor` (1, 2, 3), `status` (`available`, `reserved`, `occupied`).

3. `reservations`: Đặt chỗ trước (`id`, `slot_id`, `license_plate`, `customer_name`, `phone`, `deposit_amount`, `deposit_paid`, `status` [`active`, `checked_in`, `expired`, `cancelled`], `created_at`, `expires_at`).

4. `parking_sessions`: Lượt gửi xe (`id`, `slot_id`, `license_plate`, `entry_type` [`reservation`, `walk_in`], `reservation_id`, `check_in_time`, `check_out_time`, `hours_billed`, `total_fee`, `deposit_deducted`, `amount_due`, `payment_method` [`online_qr`, `cash`, null], `payment_status` [`pending`, `paid`], `status` [`parked`, `completed`]).

5. `hardware_logs`: Nhật ký tín hiệu ESP32 / Barrier / ALPR giả lập (`id`, `source`, `event_type`, `message`, `created_at`).

## 5. Nghiệp vụ cốt lõi cần cài đặt chính xác

### A. Đặt chỗ & Đặt cọc (Có tự động hủy khi quá giờ)

1. Khách chọn ô trống (`available`) trên sơ đồ 3 tầng -> nhập Biển số xe, Tên, SĐT.

2. Hiển thị modal **Thanh toán tiền cọc** (mã QR giả lập với số tiền lấy từ `settings.deposit_amount`, mặc định 10.000đ).

3. Khi bấm **"Xác nhận đã đóng cọc"**:

   * Ô đỗ chuyển sang `reserved`.

   * Tạo bản ghi `reservations` với `expires_at = now + settings.hold_minutes` (mặc định 15 phút).

   * Giao diện Khách hàng hiển thị **đồng hồ đếm ngược** thời gian giữ chỗ còn lại và **chỉ dẫn đường đi** tới ô đỗ đó (ví dụ: Cổng vào -> Thang lên Tầng 2 -> Rẽ phải -> Ô T2-B03).

4. **Background Task (chạy mỗi 10 giây):** Quét các `reservations` đang `active` có `expires_at < now`. Tự động chuyển trạng thái thành `expired`, trả ô đỗ về `available`, và phát sự kiện WebSocket cập nhật giao diện ngay lập tức.

### B. Xe vào cổng (Check-in & ALPR)

* Hỗ trợ 2 luồng:

  * **Xe đã đặt trước:** Quét/nhập biển số trùng với `reservations` đang `active` -> tự động khớp ô đã đặt, chuyển reservation sang `checked_in`, ô đỗ sang `occupied`, tạo `parking_sessions` (`deposit_deducted = deposit_amount`).

  * **Xe vãng lai:** Quét/nhập biển số chưa đặt trước -> tự động chọn ô `available` gần nhất (ưu tiên tầng thấp trước), chuyển ô sang `occupied`, tạo `parking_sessions` (`deposit_deducted = 0`).

* Mở barrier cổng vào (hiển thị trạng thái `OPEN` trong vài giây rồi tự đóng `CLOSED` hoặc cho phép điều khiển tay).

### C. Xe ra cổng, Tính tiền theo giờ & 2 Hình thức thanh toán

1. Khi xe ra (quét biển số hoặc chọn xe đang đỗ để Check-out):

   * Tính thời gian đỗ: `hours_billed = max(1, ceil((now - check_in_time) / 3600))` (làm tròn lên theo giờ, tối thiểu 1 giờ; có thêm nút giả lập cộng thêm giờ ở chế độ demo để dễ test tính tiền).

   * `total_fee = hours_billed * settings.hourly_rate`.

   * `amount_due = max(0, total_fee - deposit_deducted)`.

2. Hỗ trợ **2 cách thanh toán**:

   * **Thanh toán trực tuyến trên web:** Hiện mã QR giả lập kèm số tiền `amount_due`. Khách (hoặc Admin) bấm **"Xác nhận thanh toán Online"** -> `payment_status = 'paid'`, `payment_method = 'online_qr'`, mở barrier cổng ra, trả ô đỗ về `available`.

   * **Trả tiền mặt tại cổng:** Bảo vệ bấm **"Xác nhận thu tiền mặt"** trên trang Admin -> `payment_status = 'paid'`, `payment_method = 'cash'`, mở barrier cổng ra, trả ô đỗ về `available`.

### D. Kết nối ESP32 (HTTP API) & Bảng Giả lập

* `POST /api/hardware/sensor`: Nhận `{"slot_code": "T1-A01", "occupied": true}` từ ESP32 -> cập nhật trạng thái ô đỗ trong SQLite và broadcast qua WebSocket.

* `POST /api/hardware/gate`: Nhận `{"gate": "entry"|"exit", "plate": "65A-123.45"}` -> chạy luồng check-in/check-out.

* `GET /api/hardware/barrier`: Trả về trạng thái barrier vào/ra hiện tại để ESP32 đọc lệnh mở cổng.

* Tất cả thay đổi từ API phần cứng hoặc từ UI đều đồng bộ real-time qua **WebSocket (`/ws`)**.

## 6. Yêu cầu 2 Giao diện tách biệt

Trên thanh header có nút chuyển nhanh giữa 2 chế độ (thuận tiện khi demo) và tùy chọn khóa bảo vệ cho Admin:

1. **Trang Khách hàng (`CustomerView`):**

   * Thống kê nhanh số chỗ trống từng tầng.

   * Bản đồ 3 tầng trực quan (tab Tầng 1 / Tầng 2 / Tầng 3), phân màu rõ ràng: Trống (xanh), Đã đặt cọc (vàng), Có xe (đỏ).

   * Đặt chỗ + đóng cọc QR + đồng hồ đếm ngược giữ chỗ + chỉ dẫn đường đi tới ô đỗ.

   * Tra cứu vé gửi xe theo biển số để thanh toán phí gửi xe Online bằng QR ngay trên web.

2. **Trang Bảo vệ / Admin (`AdminView`):**

   * Khung mô phỏng Camera ALPR vào/ra (upload ảnh biển số mẫu hoặc nhập nhanh biển số test).

   * Điều khiển Barrier vào/ra thủ công + xem log phần cứng ESP32.

   * Danh sách xe đang đỗ & đặt chỗ đang giữ (có nút Check-out, thu tiền mặt tại cổng, hoặc giả lập trôi thời gian để test tính phí theo giờ & quá hạn giữ chỗ).

   * Thống kê doanh thu (Online vs Tiền mặt, Tiền cọc) và lượt xe.

   * **Mục Cài đặt:** Cho phép Admin sửa trực tiếp **Thời gian giữ chỗ (phút)**, **Tiền đặt cọc (VNĐ)**, và **Đơn giá theo giờ (VNĐ/giờ)** lưu xuống SQLite.

## 7. Hướng dẫn chạy Local

- Tạo môi trường ảo Python tối giản (`python -m venv backend/venv`) và chỉ cài các thư viện trong `backend/requirements.txt`.
- Chạy Backend ở `uvicorn main:app --host 0.0.0.0 --port 8000 --reload` để các mạch ESP32 trong cùng mạng Wi-Fi có thể gọi API trực tiếp qua IP LAN của máy tính.
- Cài đặt và chạy Frontend bằng `npm install` và `npm run dev` (cổng `5173`).
- Kiểm tra đảm bảo không có lỗi cú pháp hoặc lỗi kết nối API/WebSocket.