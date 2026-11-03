# Third-Party Software Notices and Licenses

This project, **FloodOS**, is licensed under the [Apache License 2.0](LICENSE).

This document lists the third-party open-source components, libraries, and runtime dependencies utilized or integrated within FloodOS, along with their respective licensing terms. All integrated components use OSI-approved permissive or copyleft licences (MIT, Apache-2.0, BSD, ISC, EPL, GPL-family, PostgreSQL, PSF-2.0).

---

## 1. Summary of Direct and Infrastructure Dependencies

| Component | Upstream Project & Version | Role in Architecture | License | Permissive & Commercial Friendly |
| :--- | :--- | :--- | :--- | :---: |
| **OpenJDK 21 LTS** | Eclipse Temurin 21 (Adoptium) | Java Runtime Environment & Virtual Threads | **GPL v2 with Classpath Exception** / **EPL-2.0** | Yes |
| **Keycloak** | Red Hat Keycloak 24.0 | Identity & Access Management, OpenID Connect (OIDC), RBAC | **Apache-2.0** | Yes |
| **Apache APISIX** | Apache Software Foundation 3.9 | Cloud-Native Zero-Trust API Gateway | **Apache-2.0** | Yes |
| **Flowable Engine** | Flowable BPMN 2.0 Engine | Business Process Workflow Orchestration | **Apache-2.0** | Yes |
| **PostgreSQL** | PostgreSQL Global Development Group 16 | Relational Storage, Row-Level Security (RLS), GiST Exclusion Constraints | **PostgreSQL License** *(BSD/MIT-style)* | Yes |
| **SeaweedFS** | SeaweedFS (Chris Lu) | Scalable S3-Compatible Object Storage for Unstructured Evidence | **Apache-2.0** | Yes |
| **FIWARE NGSI-LD** | ETSI ISG CIM / FIWARE Foundation | Smart Data Models & Digital Twin Entity Representation | **Apache-2.0** | Yes |
| **Apache Kafka** | Apache Software Foundation 3.7 (KRaft) | Event bus cho luồng dữ liệu nóng | **Apache-2.0** | Yes |
| **Karapace** | Aiven 4.1 | Kafka REST Proxy (HTTP produce/consume cho lõi Java) | **Apache-2.0** | Yes |
| **Eclipse Mosquitto** | Eclipse Foundation 2.0 | MQTT broker cho dữ liệu cảm biến OT | **EPL-2.0 / EDL-1.0 (BSD-3-Clause)** | Yes |
| **Eclipse Paho (Python)** | Eclipse Foundation 2.1 | MQTT client của `telemetry-ingestor` và `device-simulator` | **EPL-2.0 / EDL-1.0 (BSD-3-Clause)** | Yes |
| **segno** | Michael Peterson 1.6 | Sinh mã QR (SVG) cho trang truy xuất nguồn gốc (Tầng 3) | **BSD-3-Clause** | Yes |
| **ClamAV** | Cisco Talos 1.4 (image `clamav/clamav`) | Quét mã độc cho tệp client tải lên (cổng chặn fail-closed) | **GPL-2.0** | Yes |
| **DuckDB** | DuckDB Foundation 1.1 | Truy vấn phân tích trên Parquet (kho lạnh) | **MIT** | Yes |
| **MapLibre GL JS** | MapLibre contributors 6.x | Bản đồ tương tác trên giao diện tác chiến (`apps/web`) | **BSD-3-Clause** | Yes |
| **pmtiles** | Protomaps (Brandon Liu) 4.5 | Đọc và giải mã lưu trữ bản đồ vector PMTiles ngoại tuyến tự phục vụ | **BSD-3-Clause** | Yes |
| **OpenStreetMap tiles via EOX (data)** | © OpenStreetMap contributors (ODbL); tiles © EOX IT Services GmbH, https://tiles.maps.eox.at | Nền bản đồ tải lúc chạy từ trình duyệt (không đóng gói trong repo) | **ODbL (dữ liệu)** | Yes (cần ghi nguồn) |
| **Python** | PSF 3.12 (image `python:3.12-slim`) | Runtime của dịch vụ `lake-archiver` | **PSF-2.0** | Yes |

---

## 2. License Texts & Upstream Attributions

### Apache License 2.0
Used by: Keycloak, Apache APISIX, Flowable Engine, SeaweedFS, FIWARE Smart Data Models.
- Upstream: https://www.apache.org/licenses/LICENSE-2.0
- SPDX Identifier: `Apache-2.0`

### PostgreSQL License
Used by: PostgreSQL 16
- Upstream: https://www.postgresql.org/about/licence/
- SPDX Identifier: `PostgreSQL`
- Copyright (c) 1996-2024, PostgreSQL Global Development Group. All rights reserved.

### Eclipse Public License 2.0 & Classpath Exception
Used by: Eclipse Temurin OpenJDK 21
- Upstream: https://www.eclipse.org/legal/epl-2.0/
- SPDX Identifier: `EPL-2.0` / `GPL-2.0-with-classpath-exception`

---

## 3. Compliance and Copyleft Hygiene

FloodOS enforces strict Open-Core licensing hygiene:
- No viral copyleft licenses (e.g. AGPL-3.0) are incorporated into the core application runtime or mandatory distribution bundles.
- MinIO (AGPL-3.0) was deliberately replaced by SeaweedFS (Apache-2.0) to maintain 100% Apache-2.0 compatibility for downstream integrators and enterprise deployments.
- All database migrations, declarative schemas, and workflow definitions are licensed under Apache-2.0.
