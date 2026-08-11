# FloodOS Agent Operating Rules & Engineering Standards

Mọi tác vụ kỹ thuật, phát triển phần mềm, tích hợp hạ tầng và cấu hình hệ thống trên môi trường BẮT BUỘC phải tuân thủ nghiêm ngặt các nguyên tắc sau đây. Tuyệt đối KHÔNG LÀM TẮT, KHÔNG LÀM NỬA VỜI, đảm bảo ĐỦ CÁC BƯỚC - ĐỦ Ý - ĐẠT CHẤT LƯỢNG CAO NHẤT.

---

## 1. NGUYÊN TẮC KHÔNG LÀM TẮT (NO SHORTCUTS & NO MOCK DRIFT)
- **Cấm vá lỗi tạm bợ bằng tay:** Tuyệt đối không được chỉ gõ lệnh vá tay trực tiếp vào container đang chạy (ad-hoc queries/hot-patching) rồi dừng lại. Mọi thay đổi về schema, quyền truy cập, cấu hình hay dữ liệu PHẢI được thể hiện thành mã nguồn hoặc script tự động nạp khi container khởi động (Idempotent Migration on Boot).
- **Cấm giả lập (Mocking) tùy tiện:** Khi hệ thống yêu cầu tích hợp dịch vụ thật (PostgreSQL, Keycloak, S3/SeaweedFS, Flowable, APISIX Gateway), phải kiểm thử và đảm bảo chạy trên dịch vụ thật. Không dùng mock để "qua mặt" kiểm thử khi môi trường thật đang sẵn sàng.
- **Tính tự động hóa và bền vững (Reproducibility):** Một giải pháp chỉ được coi là hoàn tất khi: nếu xóa toàn bộ container hoặc khởi động lại máy/volume, hệ thống vẫn tự động phục hồi và hoạt động chính xác 100% mà không cần người dùng phải gõ thêm bất kỳ lệnh can thiệp thủ công nào.

---

## 2. NGUYÊN TẮC HẠ TẦNG & MÔI TRƯỜNG TRIỆT ĐỂ (ENVIRONMENT INTEGRITY)
- **Quản lý Cổng mạng & Xung đột máy chủ:**
  - Môi trường phát triển (`dev`): Phải sử dụng biến môi trường linh hoạt kèm giá trị mặc định an toàn (ví dụ: `${POSTGRES_HOST_PORT:-5434}:5432`) để không bao giờ xung đột với các dịch vụ đang chạy sẵn trên máy chủ (host OS).
  - Môi trường vận hành (`production`): Phải đóng triệt để mọi cổng nội bộ ra máy chủ (`ports: !reset []`), chỉ cho phép duy nhất API Gateway và dịch vụ OIDC công khai để tuân thủ kiến trúc Zero-Trust.
- **Bí mật & Cấu hình tập trung:**
  - Đồng bộ 100% secret/token/credentials giữa tất cả các thành phần (Gateway, OIDC Realm, Application Service).
  - Không hardcode secret khác nhau giữa các file cấu hình.
- **Tính Idempotent trong Database Migration:**
  - Tất cả DDL trong database phải an toàn khi chạy lại nhiều lần (`CREATE TABLE IF NOT EXISTS`, `DROP TRIGGER IF EXISTS`, `DROP POLICY IF EXISTS`).
  - Script entrypoint container phải tự động rà soát và áp dụng lại schema/RLS mỗi khi khởi động, bất kể volume đã tồn tại hay mới tạo.

---

## 3. QUY TRÌNH THỰC HIỆN ĐỦ BƯỚC, ĐỦ Ý (END-TO-END EXECUTION WORKFLOW)
Mọi yêu cầu kỹ thuật phải được triển khai theo chu trình chuẩn 5 bước khép kín:
1. **Bước 1 - Phân tích nguyên nhân gốc rễ (Root Cause Analysis - RCA):** Kiểm tra log, tiến trình hệ thống, file cấu hình và tái hiện chính xác lỗi thay vì phỏng đoán.
2. **Bước 2 - Sửa đổi có tính hệ thống (Systemic Implementation):** Sửa tận gốc ở file cấu hình gốc, file schema, mã nguồn ứng dụng và script khởi chạy.
3. **Bước 3 - Kiểm thử đa tầng (Multi-Layer Verification):**
   - Chạy bộ kiểm thử đơn vị / in-process integration test.
   - Chạy bộ kiểm thử toàn trình Full-Stack (E2E containers) với tất cả các assertions từ Gateway -> Identity -> API -> Workflow -> Database.
4. **Bước 4 - Đồng bộ tài liệu & Kiến trúc:** Cập nhật README, tài liệu kiến trúc, sơ đồ BPMN để phản ánh 100% trung thực hành vi thực tế của mã nguồn (ví dụ: rõ ràng giữa thuật toán trong code và chỉ mục database).
5. **Bước 5 - Đồng bộ mã nguồn (VCS Integration):** Kiểm tra `git status`, `git diff`, commit theo chuẩn Conventional Commits và đồng bộ lên các nhánh liên quan (`main`, `tier-1-core`).

---

## 4. TIÊU CHUẨN CHẤT LƯỢNG CAO NHẤT (PRODUCTION-GRADE STANDARDS)
- **Fail-Fast & Zero Silent Errors:** Khi thiếu cấu hình bắt buộc trên production, hệ thống phải báo lỗi dừng ngay lập tức thay vì âm thầm hoạt động sai lệch.
- **Bảo toàn dữ liệu & Quyền riêng tư:** Kiểm chứng nghiêm ngặt Row Level Security (RLS) để nông hộ, điều phối viên, đối tác chỉ thấy đúng phạm vi dữ liệu được phép.
- **Báo cáo trung thực & Minh chứng rõ ràng:** Sau khi thực thi, luôn cung cấp kết quả lệnh, mã thoát (exit code), logs xác nhận và đường dẫn tệp cụ thể để người dùng có thể đối chứng tức thì.
