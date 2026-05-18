---
name: Bug Report
about: Create a report to help us improve OpenAgriOS
title: '[BUG] '
labels: bug
assignees: ''
---

**Describe the Bug**
A clear and concise description of what the bug is.

**Component Affected**
- [ ] `core/identity` (Keycloak OIDC / JWT)
- [ ] `core/api-gateway` (APISIX Zero-Trust)
- [ ] `core/workflow` (BPMN 2.0 Engine)
- [ ] `core/data-services` (RLS / Audit / S3 / NGSI-LD)
- [ ] `apps/agriops` (AgriOps Service)
- [ ] `infra/` (Docker / Database / Helm)

**To Reproduce**
Steps to reproduce the behavior:
1. Start server with `java -cp target/classes org.openagrios.apps.agriops.OpenAgriOsServer`
2. Send request to endpoint `POST /api/v1/...` with payload `...`
3. See error response.

**Expected Behavior**
A clear and concise description of what you expected to happen.

**Environment**
- OS: [e.g. Linux, Windows, macOS]
- Java Version: [e.g. OpenJDK 21.0.2]
- Docker Version: [e.g. 25.0]

**Additional Context**
Add any other context, logs, or screenshots about the problem here.
