# FloodOS — Hướng Dẫn Chạy Demo & Kiểm Thử Tự Động

Hướng dẫn chi tiết từng bước để biên dịch, khởi động server và chạy trọn vẹn kịch bản kiểm thử tích hợp (End-to-End Acceptance Tests).

---

## 1. Yêu cầu Tiền đề (Prerequisites)

- **Java**: OpenJDK 21 LTS hoặc Eclipse Temurin 21 trở lên (`java -version`, `javac -version`).
- **Postman**: Ứng dụng Postman Desktop hoặc Postman CLI (tùy chọn để test giao diện REST).
- **Hệ điều hành**: Windows 10/11, macOS, hoặc Linux (Ubuntu, Debian, Fedora, CentOS).

---

## 2. Khởi chạy Ứng dụng từ Mã nguồn

### Bước 1: Biên dịch mã nguồn Java
Tại thư mục gốc của dự án:
```powershell
# Trên Windows PowerShell
New-Item -ItemType Directory -Force target/classes
javac -encoding UTF-8 -d target/classes (Get-ChildItem -Recurse core/*.java, apps/*.java, tests/*.java).FullName
```
Hoặc trên Linux / macOS:
```bash
mkdir -p target/classes
find core apps tests -name "*.java" > sources.txt
javac -encoding UTF-8 -d target/classes @sources.txt
```

### Bước 2: Chạy Server Headless Core PaaS
```bash
java -Dfile.encoding=UTF-8 -cp target/classes org.floodos.apps.floodos.FloodOSServer
```
Server sẽ lắng nghe tại cổng `8000` (truy cập `http://localhost:8000/api/v1/health` trên trình duyệt để kiểm tra trạng thái hoạt động).

---

<p align="center">
  <img src="assets/incident_recovery_flow.svg" alt="Kịch bản Điều phối & Phục hồi Sự cố Tự động" width="100%">
</p>

## 3. Chạy Bộ Kiểm Thử Tự Động (Acceptance Test Suite)

Trong một cửa sổ dòng lệnh khác, thực thi:
```bash
java -Dfile.encoding=UTF-8 -cp target/classes org.floodos.tests.AcceptanceTestRunner
```

### Kết quả mong đợi:
```text
HANOI FLOODOS - IN-PROCESS ACCEPTANCE SUITE (JAVA 21)
[1] Platform health, workflow definitions and registered roles ...
[2] Authentication fails closed ...
[3] Row-level scope per role ...
[4] Report -> verify -> dispatch ...
[5] Double booking is blocked ...
[6] Field team works its own order only ...
[7] Incident, ranked replacements and human approval ...
[8] Completion and confirmation ...
[9] The audit chain proves the case ...
[10] Ingestion endpoints and the demo reset are closed to normal users ...
ACCEPTANCE: <n> checks passed
```

Số kiểm tra và kết quả của lần chạy gần nhất được ghi ở [`CHANGELOG.md`](../CHANGELOG.md).

---

## 4. Kiểm thử với Postman Collection

1. Mở Postman, chọn **Import** và nhập `tests/postman/FloodOS.postman_collection.json` cùng một trong hai môi trường `FloodOS_Gateway_Docker.postman_environment.json` (qua APISIX, :9080) hoặc `FloodOS_Core_Direct.postman_environment.json` (trực tiếp lõi, :8000, chỉ dùng khi phát triển).
2. Lấy token PKCE cho từng vai trò (xem [`api-spec.md`](api-spec.md), mục 2) và điền vào các biến `*_token` của môi trường. Với bước "đội thay thế hoàn thành lệnh", điền `replacement_team_token` bằng token của đội được giao lệnh `-R1` (xem trong `GET /api/v1/state`).
3. Bộ sưu tập có 8 thư mục (0 nền tảng, 1 người báo tin, 2 điều phối, 3 hiện trường, 4 điều phối lại và sửa chữa, 5 hoàn tất và xác nhận, 6 kiểm toán và phân tích, 7 bản sao số và điểm trú), mỗi yêu cầu có kịch bản kiểm tra tự động. Mỗi lần chạy dùng một khung giờ ngẫu nhiên trong tương lai nên chạy lặp lại không tự xung đột.
4. Một kiểm thử đơn vị ([`PlatformTests`](../tests/unit/PlatformTests.java)) bảo đảm mọi yêu cầu trong bộ sưu tập trỏ tới route có thật của máy chủ.
