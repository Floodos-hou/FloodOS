# DANH MỤC GIẤY PHÉP PHẦN MỀM NGUỒN MỞ SỬ DỤNG TRONG DỰ ÁN (THIRD-PARTY LICENSES)

Dự án **OpenAgriOS (DX-OS Open-Core)** được cấp phép theo **Apache License 2.0**.
Mọi thành phần phụ thuộc đều sử dụng các giấy phép nguồn mở chuẩn OSI (**Apache-2.0**, **EPL-2.0**, **BSD-2-Clause / PostgreSQL License**) hoàn toàn tương thích để đóng gói và phân phối.

| STT | Thành phần đang sử dụng thực tế trong Repo | Vai trò trong kiến trúc hệ thống | Giấy phép Nguồn mở | Mức độ phù hợp với OpenAgriOS |
| :-: | :--- | :--- | :--- | :--- |
| 1 | **OpenAgriOS Backend (`org.openagrios.*`)** | Tầng 1 Core PaaS (`core`), Tầng 2 (`hpdi`) & Tầng 3 (`modules.agriops`) | **Apache-2.0** | Rất phù hợp (Giấy phép chính của dự án) |
| 2 | **Eclipse Temurin OpenJDK 21 LTS** | Môi trường thực thi Java 21 LTS (Virtual Threads, Crypto, W3C DOM XML, HTTP Server) | **EPL-2.0 / GPL-2.0-with-Classpath-Exception** | Rất phù hợp |
| 3 | **Keycloak (`openagrios-realm.json`)** | Quản trị định danh tập trung (OIDC SSO), RBAC & Multi-tenancy | **Apache-2.0** | Rất phù hợp |
| 4 | **Apache APISIX (`apisix.yaml`)** | Cổng API biên mạng Zero-Trust, kiểm tra JWT & Rate Limit | **Apache-2.0** | Rất phù hợp |
| 5 | **Flowable BPMN 2.0 (`*.bpmn20.xml`)** | Động cơ thực thi quy trình nghiệp vụ chuẩn BPMN 2.0 | **Apache-2.0** | Rất phù hợp |
| 6 | **SeaweedFS S3 Object Storage** | Lưu trữ tệp phi cấu trúc chuẩn S3 (Ảnh sự cố, biên bản nghiệm thu) | **Apache-2.0** | Rất phù hợp |
| 7 | **PostgreSQL 16 (`schema.sql` + `btree_gist`)** | Cơ sở dữ liệu giao dịch OLTP, chống trùng lịch GiST & phân quyền RLS | **PostgreSQL License** *(Tương đương BSD-2-Clause / MIT)* | Rất phù hợp |
