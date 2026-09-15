# FloodOS — Hướng dẫn Trình diễn & Kịch bản Tác chiến Demo

Tài liệu hướng dẫn trình diễn thực tế trung tâm điều hành ứng phó ngập lụt **FloodOS** cho địa bàn thí điểm tại Hà Nội, tích hợp 100% với backend API thật và bảo mật Zero-Trust.

---

## 1. FloodOS là ứng dụng gì và giúp người dùng việc gì?

**FloodOS** là ứng dụng điều hành phối hợp ứng phó ngập lụt cho một địa bàn thí điểm tại Hà Nội. Ứng dụng kết nối người báo tin, người điều phối, đội hiện trường và người quản lý nguồn lực trong cùng một hồ sơ vụ việc.

### Vấn đề ứng dụng giải quyết
Khi nhiều điểm ngập phát sinh cùng lúc, thông tin cứu trợ thường đến qua điện thoại hoặc tin nhắn rời rạc; người điều phối rất khó biết tin nào khẩn cấp, đội hoặc phương tiện nào đang rảnh, điểm trú nào còn chỗ và một lệnh ứng cứu đã được xử lý tới đâu. Việc điều phối lại khi xe/xuồng/máy bơm gặp sự cố kỹ thuật giữa đường cũng dễ bị chậm trễ hoặc mất dấu vết quyết định.

### FloodOS giúp từng nhóm người dùng:
- **Người dân / Người báo tin (`REPORTER`):** Báo vị trí, mức ngập, số người bị ảnh hưởng và nhu cầu hỗ trợ khẩn cấp; theo dõi tiến trình xử lý tin báo của mình, biết tin đang được xác minh hay đã có lực lượng tiếp cận hiện trường.
- **Điều phối viên (`DISPATCHER`):** Xem toàn cảnh bức tranh các vụ việc trên bản đồ số và dòng thời gian (timeline); xác minh thông tin, gán mức ưu tiên; phân công đội và phương tiện; phát hiện ngay xung đột lịch trình; chủ động điều phối lại khi xảy ra sự cố.
- **Đội hiện trường (`FIELD_TEAM`):** Nhận đúng nhiệm vụ được phân công trên thiết bị di động, nắm rõ tọa độ điểm đến và nhu cầu cụ thể tại hiện trường, cập nhật tiến độ xử lý hoặc báo cáo sự cố nhanh chóng chỉ bằng vài thao tác.
- **Quản lý nguồn lực (`RESOURCE_MANAGER`):** Theo dõi mức độ sẵn sàng của phương tiện (xuồng, xe bơm) và các đội ứng cứu, tình trạng sức chứa tại các điểm trú an toàn; xử lý và đóng phiếu sửa chữa kỹ thuật trong đúng phạm vi quyền hạn.
- **Người có quyền kiểm tra / Thanh tra (`AUDITOR` / `PUBLIC`):** Xem lại toàn bộ lịch sử ra quyết định và kiểm chứng chuỗi băm kiểm toán bất biến SHA-256 của từng vụ việc độc lập với cơ sở dữ liệu.

> **Giá trị cốt lõi:** Đưa một vụ việc từ lúc tiếp nhận tin báo đến khi xác nhận hoàn tất qua một quy trình có người chịu trách nhiệm, có nguồn lực được phân công, có trạng thái cập nhật và có lịch sử kiểm toán bất biến. Giao diện luôn trả lời rõ ràng: *“Đang xảy ra việc gì, ở đâu, ai đang xử lý và bước tiếp theo là gì?”*

---

## 2. Kịch bản tiêu biểu 7 bước trình diễn (End-to-End Live Scenario)

Kịch bản sử dụng một tình huống xuyên suốt, vận hành hoàn toàn bằng API backend thật và đăng nhập đúng vai trò:

| Bước | Vai trò & Tài khoản | Thao tác thực tế trên giao diện | Kết quả hiển thị trên hệ thống |
|:---:|---|---|---|
| **1** | **Người dân**<br/>`reporter_lan` | Người dân gửi tin báo điểm ngập tại Hà Nội: nước ngập sâu 60 cm, 5 người cần sơ tán, gửi kèm ảnh hiện trường. | Tin báo `FR-...` xuất hiện ngay trên bản đồ tác chiến và danh sách, trạng thái: *Tiếp nhận, chờ xác minh*. |
| **2** | **Điều phối viên**<br/>`dispatcher_hoa` | Mở danh sách tin mới, xem vị trí trên bản đồ, xác minh tin và đặt mức ưu tiên `URGENT`. | Tin chuyển sang *Đã xác minh*. Quy trình BPMN SOP-01 chuyển bước, sẵn sàng phân công lực lượng. |
| **3** | **Điều phối viên**<br/>`dispatcher_hoa` | Chọn điều động **Xuồng cứu hộ V02 + Đội cơ động T02**. *(Có thể demo thử chọn khung giờ trùng để thấy hệ thống chặn 409 GiST Conflict)*. | Lệnh điều động `ORD-...` được ban hành. Phương tiện V02 chuyển trạng thái sang sẵn sàng xuất phát. |
| **4** | **Đội hiện trường**<br/>`team_cuong` | Đăng nhập trên điện thoại, nhận lệnh, bấm **Bắt đầu xử lý** (`IN_PROGRESS`). Khi gặp sự cố chân vịt vướng rác ngập, bấm **Báo sự cố**. | Xuồng V02 đổi màu đỏ nhấp nháy (`BREAKDOWN`). Ca điều động gián đoạn, kích hoạt quy trình điều phối lại SOP-02. |
| **5** | **Điều phối viên**<br/>`dispatcher_hoa` | Vào tab **Sự cố & Chi viện**, xem danh sách phương án thay thế được chấm điểm minh bạch (khoảng cách Haversine, loại xe, công suất, đánh giá đội). | Bảng phân tích giải thích rõ lý do xếp hạng. Điều phối viên bấm **Phê duyệt chi viện** chọn Xuồng V01 + Đội T01. |
| **6** | **Đội chi viện**<br/>`team_binh` | Đội trưởng V01 tiếp nhận lệnh mới `-R1`, di chuyển tiếp cận mục tiêu, cập nhật tiến độ 100% và bấm **Hoàn tất nhiệm vụ**. | Vụ việc chuyển sang trạng thái hoàn tất cứu hộ, chờ người báo tin nghiệm thu an toàn. |
| **7** | **Người dân & Thanh tra**<br/>`reporter_lan` | Người dân bấm **Xác nhận đã an toàn**. Mở **Proof Inspector** hoặc cổng công khai Tầng 3 tra cứu chuỗi phả hệ SHA-256. | Toàn bộ chuỗi sự kiện được niêm phong mật mã bất biến, xác minh tính toàn vẹn liên tục từ Genesis block. |

> **Cam kết tính trung thực của kịch bản:** Kịch bản cho thấy FloodOS hỗ trợ điều phối và theo dõi; **không** thể hiện như phần mềm dự báo ngập lụt khí tượng, hệ thống cảnh báo cảm biến thật, AI tự động ra quyết định, hay hệ thống dẫn đường giao thông vì các năng lực đó chưa có và chưa được kiểm chứng.

---

## 3. Nguyên tắc thiết kế giao diện theo mục đích sử dụng

- **Bản đồ tình huống + Dòng thời gian + Hành động tiếp theo:** Ưu tiên hiển thị trực quan không gian tác chiến, tuyệt đối không biến giao diện thành bảng quản trị CRUD có các nút thêm/sửa/xóa khô khan.
- **Ngữ cảnh tác chiến tức thời:** Mỗi màn hình phải trả lời ngay: Người dùng đang xem vụ việc nào, trạng thái hiện tại là gì, nguồn dữ liệu và thời điểm cập nhật ra sao, họ có quyền thực hiện bước nào tiếp theo.
- **Trực quan hóa bản đồ 2D/3D:** Bản đồ làm rõ vị trí và tương quan nguồn lực; mọi điểm đánh dấu (marker), trạng thái và chuyển động đều bắt nguồn từ dữ liệu API thật hoặc simulator có gắn nhãn nguồn minh bạch.
- **Minh bạch nhãn nguồn dữ liệu:** Mọi dữ liệu mô phỏng (`SIMULATOR`, `SEED`) được đánh dấu rõ ràng. Tuyệt đối không tạo số liệu, địa danh, trạng thái xe chạy ảo chỉ để làm màn hình sinh động.
- **Thiết kế hướng tới Demo thật:** Người trình diễn có thể đăng nhập đúng từng vai trò (OIDC PKCE Keycloak) và thao tác tuần tự qua toàn bộ luồng nghiệp vụ trên bằng các lệnh gọi API backend thật.

---

## 4. Hướng dẫn Khởi chạy & Trình diễn

### 1. Khởi động môi trường Docker đầy đủ

```bash
# Dựng toàn bộ stack dịch vụ và bộ mô phỏng dữ liệu OT
docker compose --profile demo up -d --build

# Kiểm tra trạng thái sẵn sàng qua APISIX Gateway
curl -i http://localhost:9080/api/v1/health
```

### 2. Mở giao diện và thực hiện Demo
- **Cổng điều hành tác chiến:** Truy cập `http://localhost:3000` (hoặc `http://localhost:5173` khi chạy Vite dev server).
- **Thực hiện kịch bản tuần tự theo 7 bước thật:** Đăng nhập vào từng tài khoản công vụ tương ứng (`reporter_lan`, `dispatcher_hoa`, `team_cuong`, `resource_giang`, `team_binh` với mật khẩu `123456`) để thao tác các quy trình nghiệp vụ thực tế qua backend API và Flowable BPMN.
- **Cổng tra cứu phả hệ công khai (Tầng 3):** Truy cập `http://localhost:9080/trace/CORR-REP-001` để trình diễn tính năng kiểm chứng chuỗi băm độc lập từ kho dữ liệu lạnh Parquet.

### 3. Đặt lại trạng thái ban đầu để demo lại
- Trên thanh điều hướng Header, người dùng có vai trò quản trị hoặc ban chỉ huy có thể bấm nút **Đặt lại** để hệ thống gọi `POST /api/v1/sim/reset`, làm mới toàn bộ kịch bản về thời điểm bắt đầu phục vụ các lượt trình diễn kế tiếp.
