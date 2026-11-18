// Service worker tối giản: chỉ để trình duyệt cho phép "Cài đặt / Thêm vào Màn hình chính".
// Không cache dữ liệu (bãi xe cần dữ liệu realtime), mọi request đi thẳng ra mạng.
self.addEventListener('install', () => self.skipWaiting())
self.addEventListener('activate', (e) => e.waitUntil(self.clients.claim()))
self.addEventListener('fetch', () => {})
