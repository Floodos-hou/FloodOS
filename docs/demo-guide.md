# OpenAgriOS — Hướng Dẫn Chạy Demo & Kiểm Thử Tự Động

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
java -Dfile.encoding=UTF-8 -cp target/classes org.openagrios.apps.agriops.OpenAgriOsServer
```
Server sẽ lắng nghe tại cổng `8000` (truy cập `http://localhost:8000/api/v1/health` trên trình duyệt để kiểm tra trạng thái hoạt động).

---

<p align="center">
  <img src="assets/incident_recovery_flow.svg" alt="Kịch bản Điều phối & Phục hồi Sự cố Tự động" width="100%">
</p>

## 3. Chạy Bộ Kiểm Thử Tự Động (Acceptance Test Suite)

Trong một cửa sổ dòng lệnh khác, thực thi:
```bash
java -Dfile.encoding=UTF-8 -cp target/classes org.openagrios.tests.AcceptanceTestRunner
```

### Kết quả mong đợi:
```text
============================================================================
RUNNING OPENAGRIOS INTEGRATION TEST SUITE (JAVA 21)
============================================================================
[PASS] Core Platform Health & BPMN 2.0 XML Definitions verified.
[PASS] OIDC Authentication verified across roles (FARMER, COORDINATOR, OPERATOR) and tenants.
[PASS] Zero-Trust Token Guard: Rejected tampered signature, forged RS256, expired token, wrong audience, and verified Keycloak production failure without mock fallback (HTTP 401).
[PASS] Multi-Tenant RLS & Field-Level Visibility verified: [F01, F03, F07] unmasked, 7 masked.
[PASS] Zero-Trust RBAC Guard verified (HTTP 403 Forbidden on unauthorized dispatch).
[PASS] Time-Window Conflict Engine verified (HTTP 409: MACHINE_TIME_OVERLAP).
[PASS] Unfeasible replacement fallback state verified.
[PASS] Incident reported + S3 ETag (befbecf3) -> Rescue candidate M02 (93.8 pts, 1.37 km).
[PASS] BPMN Replan approved -> Shift ASG-102 superseded by ASG-102-R1.
[PASS] Immutable SHA-256 Audit Chain & Data Lineage verified (5 linked records).
============================================================================
ALL INTEGRATION TESTS PASSED SUCCESSFULLY!
============================================================================
```

---

## 4. Kiểm thử với Postman Collection

1. Mở Postman, chọn **Import**.
2. Chọn tệp: `tests/postman/OpenAgriOS_Tier1_Core.postman_collection.json`.
3. Bộ sưu tập bao gồm 6 thư mục nghiệp vụ đã được thiết lập sẵn các kịch bản test tự động (Pre-request Script & Tests Tab) để tự động lưu Token Bearer vào biến môi trường:
   - `01. Headless Core Discovery & Health`: Kiểm tra các dịch vụ Core.
   - `02. Keycloak OIDC SSO Login`: Đăng nhập thử nghiệm các vai trò Nông hộ, Điều phối viên, Người vận hành, Đội kỹ thuật.
   - `03. Kiểm tra Phân quyền RBAC & RLS`: Kiểm tra mã lỗi 403 khi vượt quyền và cách ly dữ liệu giữa các HTX.
   - `04. Đặt lịch & Xung đột Khung giờ`: Kiểm tra mã lỗi 409 khi xếp máy trùng giờ.
   - `05. Báo cáo Sự cố & Phê duyệt Điều động`: Đăng tải ảnh S3 và duyệt máy cứu hộ trên BPMN.
   - `06. Nghiệm thu & Kiểm chứng Sổ cái SHA-256`: Đóng băng sổ cái và xác thực chuỗi băm mật mã.
