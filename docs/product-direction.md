# OpenDXOS — Định hướng sản phẩm và ứng dụng minh họa

## Tên gọi

- **Tên nền tảng/repo trong tài liệu:** OpenDXOS.
- **Tên đề tài OLP:** Xây dựng Hệ điều hành Chuyển đổi số bằng Công nghệ Lõi nguồn mở (DX-OS Open-Core).
- **Tên ứng dụng minh họa:** Hanoi FloodOps.
- **Phạm vi ứng dụng:** điều phối ứng phó ngập lụt cho một địa bàn thí điểm tại Hà Nội (dữ liệu mô phỏng).

OpenDXOS là nền tảng lõi dùng chung. Hanoi FloodOps là ứng dụng nghiệp vụ minh họa sử dụng năng lực của nền tảng; ứng dụng không thay thế hay đổi trọng tâm đề tài dự thi.

## Mô hình ba tầng

1. **Tầng 1 — Headless Core PaaS:** dịch vụ dùng chung chạy không giao diện, gồm định danh/SSO, API Gateway, dữ liệu có cấu trúc và tệp, workflow, truyền sự kiện, kiểm toán và vận hành.
2. **Tầng 2 — Không gian năng lực số H-P-D-I:** trải nghiệm người dùng và các năng lực dùng chung để tiếp nhận công việc, theo dõi quy trình, xem dữ liệu/bản đồ và hỗ trợ quyết định.
3. **Tầng 3 — Ứng dụng nghiệp vụ:** các module chuyên ngành cắm-rút. Hanoi FloodOps là ứng dụng minh họa đầu tiên; các ứng dụng nông nghiệp, thương mại hoặc logistics có thể được bổ sung sau.

Giao diện của Hanoi FloodOps được cung cấp qua không gian năng lực Tầng 2 và tiêu thụ các API/dịch vụ Tầng 1. Ranh giới này cần được thể hiện trong cấu trúc mã và khi trình bày.

## Luồng nghiệp vụ mục tiêu

`Tiếp nhận tin báo → xác minh vị trí và nhu cầu → xếp mức ưu tiên → điều phối đội/phương tiện/vật tư → cập nhật hiện trường → điều phối lại khi nguồn lực gặp sự cố → xác nhận xử lý và lưu dấu kiểm toán`.

Demo giới hạn trong một địa bàn, một tình huống ngập lụt và các nhóm vai trò sau:

- **Người tiếp nhận tin báo:** ghi vị trí, mức nước/ảnh hưởng và nhu cầu trợ giúp.
- **Điều phối viên:** xác minh, ưu tiên và phân bổ nguồn lực.
- **Đội hiện trường:** nhận nhiệm vụ, cập nhật trạng thái và báo sự cố.
- **Quản lý nguồn lực/kho:** theo dõi phương tiện, vật tư và điểm tập kết.
- **Quản trị đơn vị:** quản lý người dùng và phạm vi dữ liệu.

Tên vai trò cuối cùng phải khớp với RBAC, Keycloak, API và BPMN sau khi triển khai; tài liệu này chưa khẳng định các vai trò đó đã có trong code.

## Trải nghiệm người dùng mục tiêu

Đây là yêu cầu thiết kế cho bản demo, chưa phải mô tả chức năng đã có. Giao diện cần có cockpit theo vai trò, không đưa mọi quyền điều hành vào một màn hình:

- **Người báo tin:** gửi vị trí, mức ngập/ảnh hưởng, nhu cầu hỗ trợ và ảnh; theo dõi trạng thái yêu cầu của mình.
- **Điều phối viên:** xác minh tin báo, đặt mức ưu tiên, xem nguồn lực khả dụng, lập lệnh điều phối và xử lý xung đột.
- **Đội hiện trường:** xem nhiệm vụ được giao, cập nhật trạng thái nhanh và báo sự cố bằng lựa chọn ngắn.
- **Quản lý nguồn lực:** theo dõi phương tiện, đội, vật tư và điểm tập kết; không mặc nhiên có quyền duyệt điều động.
- **Quản trị đơn vị:** quản lý tài khoản và phạm vi tổ chức theo quyền được cấp.

Luồng demo nên thể hiện liên tục từ tin báo → xác minh → điều phối → cập nhật hiện trường → điều phối lại khi có sự cố → xác nhận hoàn tất. Trên điện thoại, ưu tiên nút chạm lớn, lựa chọn nhanh, camera và thao tác chính dễ với ngón tay cái. Mỗi màn hình phải có trạng thái đang tải, lỗi, rỗng và dữ liệu cũ/mất kết nối. Chỉ tuyên bố có hàng đợi offline nếu đã triển khai và kiểm chứng việc lưu an toàn, đồng bộ lại và xử lý xung đột.

### Quy ước minh bạch trên bản đồ

- Phân biệt dữ liệu nhập tay, dữ liệu seed, dữ liệu simulator và dữ liệu quan trắc có nguồn xác thực; hiển thị thời điểm cập nhật.
- Nếu simulator tạo vị trí phương tiện, ghi rõ đó là mô phỏng. Nếu vẽ đường bằng Haversine, ghi rõ đó là khoảng cách/đường chim bay, không phải tuyến đường giao thông.
- Áp dụng lọc quyền ở API/RLS trước khi gửi dữ liệu bản đồ cho trình duyệt. Ẩn marker bằng CSS không phải biện pháp phân quyền.
- Trạng thái “địa bàn an toàn” chỉ được hiển thị khi dữ liệu đủ mới và có nguồn phù hợp; nếu dữ liệu cũ hoặc mất kết nối, phải thể hiện là chưa xác định.

Các luồng và màn hình chi tiết cần được chốt thành tiêu chí nghiệm thu cùng với RBAC/RLS, BPMN và API. Xem [yêu cầu UX cho bản demo](floodops-demo-ux.md); đây là đích thiết kế, không phải bằng chứng triển khai.

## Dữ liệu nghiệp vụ dự kiến

- Sự kiện ngập và vùng ảnh hưởng có hình học, mức độ và thời điểm cập nhật.
- Tin báo/yêu cầu hỗ trợ, vị trí, nhu cầu, mức ưu tiên, trạng thái xác minh và lịch sử xử lý.
- Đội ứng cứu, phương tiện, vật tư, điểm tập kết và điểm trú an toàn.
- Lệnh điều phối liên kết yêu cầu, vùng, đội/phương tiện và kết quả hiện trường.
- Telemetry có nguồn, thời điểm, tenant và trạng thái dữ liệu cũ/mới.
- Audit/lineage cho các quyết định và thay đổi trạng thái quan trọng.

Không thay schema bằng cách đổi tên hàng loạt `fields` thành `flood_zones` hoặc `machines` thành `vehicles`. Trước tiên cần chốt mô hình miền và API; sau đó mới thiết kế migration idempotent, RLS và kiểm thử tương ứng.

## Tình trạng mã nguồn hiện tại

Backend đã được chuyển từ nguyên mẫu thu hoạch lúa sang FloodOps (mô hình, API, BPMN, RBAC/RLS, seed, telemetry, kiểm thử, Postman). Chi tiết và trạng thái từng hạng mục: [README, mục 3](../README.md).

**Còn thiếu và được ghi rõ là chưa làm:** giao diện FloodOps (`apps/web` và `apps/twin3d` vẫn là giao diện cũ không khớp API mới), hoàn tất user task Flowable qua REST, giám sát Prometheus/Grafana, GitOps/ArgoCD, triển khai Internet, quản trị đơn vị, hàng đợi ngoại tuyến, thành phần AI, dữ liệu quan trắc thật, định tuyến thật.

## Lộ trình còn lại

1. Làm giao diện FloodOps theo [yêu cầu UX](floodops-demo-ux.md): cockpit theo vai trò, bản đồ có nhãn nguồn dữ liệu, trạng thái tải/lỗi/rỗng/dữ liệu cũ, thao tác một tay trên điện thoại.
2. Hoàn tất user task Flowable qua REST để trạng thái tiến trình do chính Flowable giữ.
3. Giám sát và tự phục hồi có bằng chứng (Prometheus/Grafana, kiểm thử tắt/bật container), GitOps.
4. Triển khai Internet với bí mật thật, đổi realm demo, bật MFA.
5. Nếu có nguồn dữ liệu được phép dùng: nối quan trắc thật thay cho mô phỏng.

## Tiêu chí để demo được xem là hoàn chỉnh

- Một luồng tin báo đến xác nhận xử lý chạy qua UI → Gateway → dịch vụ → PostgreSQL/workflow/audit.
- RLS chặn truy cập chéo giữa các đơn vị và người dùng đúng theo chính sách đã mô tả.
- Điều phối có kiểm tra xung đột và có trạng thái không tìm được nguồn lực phù hợp.
- Dữ liệu bản đồ/telemetry có nhãn nguồn và thời điểm; dữ liệu simulator được nhận diện là mô phỏng.
- Cùng một stack có thể được tái sử dụng bởi ứng dụng khác mà không đưa quy tắc FloodOps vào Headless Core.
- Tài liệu, demo và code mô tả cùng một trạng thái triển khai; các tính năng chưa làm được ghi là lộ trình.
