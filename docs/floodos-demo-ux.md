# FloodOS — yêu cầu UX cho bản demo

> Tài liệu này là đích thiết kế, không xác nhận các chức năng đã có trong mã nguồn. Chỉ đánh dấu hoàn thành sau khi có triển khai và kiểm chứng.

## Luồng demo chính

`Gửi tin báo → Điều phối xác minh → Phân công đội/phương tiện → Đội hiện trường cập nhật → Điều phối lại nếu có sự cố → Xác nhận xử lý và đóng vụ việc`.

| Bước | Người dùng | Trải nghiệm cần có |
|---|---|---|
| Báo tin | Người dân/người báo tin | Chọn vị trí, mức ngập hoặc ảnh hưởng, nhu cầu hỗ trợ; gửi ảnh; nhận mã theo dõi và xem trạng thái. |
| Xác minh | Điều phối viên | Xem hàng đợi tin mới, nguồn và thời điểm dữ liệu; xác minh thông tin; gán mức ưu tiên và ghi lý do. |
| Điều phối | Điều phối viên | Xem đội/phương tiện sẵn sàng, vị trí và thời gian; kiểm tra trùng lịch; xác nhận lệnh hoặc thấy rõ lý do không thể phân công. |
| Tác nghiệp | Đội hiện trường | Xem nhiệm vụ trên điện thoại; bắt đầu, cập nhật tiến độ, ghi nhận kết quả hoặc báo sự cố bằng thao tác ngắn. |
| Điều phối lại | Điều phối viên và đội hiện trường | Ghi nhận sự cố, xem nguồn lực thay thế và căn cứ gợi ý; điều phối viên duyệt thay đổi; lưu lại lịch sử lệnh cũ/mới. |
| Đóng vụ việc | Điều phối viên/người xác nhận phù hợp | Ghi kết quả, xác nhận hoàn tất theo quy trình đã chọn và xem mã vụ việc cùng lịch sử kiểm toán. |

## Màn hình theo vai trò

- **Người báo tin:** trang chủ với nút báo tin dễ thấy, yêu cầu của chính người dùng và tiến trình từng yêu cầu; bản đồ chỉ nhận dữ liệu mà API đã cho phép.
- **Điều phối viên:** tổng quan tin chưa xác minh, mức ưu tiên, nguồn lực, điều phối đang chạy và sự cố; bản đồ tác chiến; màn hình chi tiết quyết định/lịch sử.
- **Đội hiện trường:** nhiệm vụ hiện tại, địa điểm, chỉ dẫn đã được hệ thống hỗ trợ, nút bắt đầu/cập nhật/báo sự cố và trạng thái đồng bộ.
- **Quản lý nguồn lực:** danh mục phương tiện, đội, vật tư, điểm tập kết, trạng thái sẵn sàng và lịch sử sử dụng; quyền duyệt phải được cấp riêng.
- **Quản trị đơn vị:** thành viên, vai trò và phạm vi dữ liệu; không mặc nhiên có quyền vượt chính sách tenant.

Tên vai trò và quyền trên giao diện phải lấy từ hợp đồng RBAC thực tế. Ẩn nút không thay thế kiểm tra quyền tại API và cơ sở dữ liệu.

## Trạng thái và thao tác hiện trường

Mọi trang dữ liệu cần có trạng thái tải, lỗi có thể thử lại, rỗng và dữ liệu cũ. Nếu mất kết nối, giao diện phải báo rõ dữ liệu được cập nhật lần cuối và thao tác nào chưa được gửi. Không hiển thị “địa bàn an toàn” khi dữ liệu cũ hoặc chưa đủ.

Trên điện thoại, mục tiêu là nút chính cao ít nhất 48 px, vùng chạm tách biệt, lựa chọn nhanh thay vì nhập dài, chụp ảnh trực tiếp và hành động chính trong tầm ngón tay cái. Hỗ trợ lưu ngoại tuyến và tự đồng bộ là yêu cầu riêng; chỉ quảng bá sau khi đã triển khai cơ chế hàng đợi bền vững, giải quyết gửi trùng/xung đột và kiểm thử trên thiết bị.

## Bản đồ và độ tin cậy của dữ liệu

- Gắn nhãn rõ dữ liệu quan trắc có nguồn, do người dùng khai báo, dữ liệu seed và dữ liệu mô phỏng; kèm thời điểm cập nhật.
- Nếu tọa độ phương tiện do simulator phát, giao diện phải nói rõ là mô phỏng. Nếu khoảng cách dùng Haversine, ghi “khoảng cách đường chim bay”; không gọi đó là tuyến đường cứu hộ thực tế.
- Lọc dữ liệu theo quyền ở backend trước khi gửi đến trình duyệt. Không gửi tọa độ bị hạn chế rồi che marker bằng CSS.
- Gợi ý cứu viện phải trình bày tiêu chí và đầu vào dùng để xếp hạng. Không tự động điều động; người có quyền xác nhận lệnh.

## Tiêu chí nghiệm thu UX

1. Người báo tin không thể đọc yêu cầu hoặc tọa độ ngoài phạm vi được cấp, kể cả gọi API trực tiếp.
2. Vai trò không có quyền điều phối nhận `403` khi gọi API điều phối trực tiếp.
3. Lỗi xung đột lịch được giải thích rõ và không làm mất dữ liệu biểu mẫu.
4. Đội hiện trường có thể cập nhật/báo sự cố bằng lựa chọn ngắn; giao diện phản ánh chính xác trạng thái lưu và đồng bộ.
5. Dữ liệu cũ, mất mạng và dữ liệu mô phỏng được phân biệt dễ thấy; không suy diễn tình trạng an toàn.
6. Sau khi đóng vụ việc, người có quyền xem được chuỗi sự kiện và kết quả xác minh audit từ API thật.

Các tiêu chí API, RLS, BPMN, lưu tệp và audit cần có kiểm thử tích hợp tương ứng; tài liệu UX không thay thế kiểm thử đó.
