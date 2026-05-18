# Third-Party Software Notices and Licenses

This project, **OpenAgriOS**, is licensed under the [Apache License 2.0](LICENSE).

This document lists the third-party open-source components, libraries, and runtime dependencies utilized or integrated within OpenAgriOS, along with their respective licensing terms. All integrated components strictly comply with Open Source Initiative (OSI) approved permissive licenses, ensuring unrestricted enterprise adoption, modification, and redistribution.

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

OpenAgriOS enforces strict Open-Core licensing hygiene:
- No viral copyleft licenses (e.g. AGPL-3.0) are incorporated into the core application runtime or mandatory distribution bundles.
- MinIO (AGPL-3.0) was deliberately replaced by SeaweedFS (Apache-2.0) to maintain 100% Apache-2.0 compatibility for downstream integrators and enterprise deployments.
- All database migrations, declarative schemas, and workflow definitions are licensed under Apache-2.0.
