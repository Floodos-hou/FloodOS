# Contributing to OpenAgriOS

Thank you for your interest in contributing to **OpenAgriOS**! We welcome contributions from developers, researchers, agricultural engineers, and open-source enthusiasts.

---

## 1. Code of Conduct

We are committed to providing a welcoming, inclusive, and harassment-free environment for all participants. Please treat everyone with respect and empathy.

---

## 2. Architecture & Design Principles

OpenAgriOS follows the **DX-OS Open-Core Modular Architecture**:
- **`core/`**: Foundational platform services. Must remain vendor-neutral, modular, and reusable across different smart agriculture applications.
  - `identity/`: IAM, OIDC, JWT, and multi-tenant security.
  - `api-gateway/`: Edge routing, zero-trust policies, and rate limits.
  - `workflow/`: BPMN 2.0 execution and state machines.
  - `data-services/`: Persistence, audit logging, digital twin mappings, and spatial algorithms.
- **`apps/`**: Domain-specific vertical applications (e.g. `apps/agriops` for agricultural mechanization).
- **`infra/`**: Declarative Infrastructure-as-Code (PostgreSQL, Keycloak, APISIX, Flowable).
- **`docs/`**: Technical documentation, architecture diagrams, and API specifications.
- **`tests/`**: Integration tests, Postman collections, and acceptance test runners.

All core components must strictly adhere to permissive open-source licenses (**Apache-2.0**, **PostgreSQL**, **EPL-2.0**). Viral copyleft dependencies (such as AGPL-3.0) are strictly forbidden in core modules.

---

## 3. Development Workflow

### Prerequisites
- Java 21 LTS (OpenJDK 21 or Eclipse Temurin).
- Git.
- Docker & Docker Compose (optional, for running full containerized infrastructure).

### Building and Testing
Compile the codebase using standard Java 21 tools:
```bash
# Compile core, apps, and test suites
mkdir -p target/classes
javac -encoding UTF-8 -d target/classes $(find core apps tests -name "*.java")

# Run the automated acceptance test runner
java -cp target/classes org.openagrios.tests.AcceptanceTestRunner
```

### Git Branching Model
- `main`: Production-ready releases.
- `tier-1-core`: Development branch for Tier 1 Core PaaS capabilities.
- Feature branches: `feat/<feature-name>`, `fix/<bug-fix>`.

---

## 4. Submitting Pull Requests

1. Fork the repository and create your branch from `tier-1-core` or `main`.
2. Ensure that code compiles cleanly without warnings.
3. Run the integration test suite (`AcceptanceTestRunner`) and verify all tests pass (100% pass rate).
4. Write clear, descriptive commit messages adhering to Conventional Commits:
   - `feat: add PostGIS polygon spatial search`
   - `fix: resolve token expiration edge case in KeycloakOidcEngine`
   - `docs: update API specification for digital twin endpoints`
5. Open a Pull Request with a clear description of the problem solved, implementation details, and verification steps.

---

## 5. Reporting Issues

Please use GitHub Issues to report bugs or request features:
- Use the **Bug Report** template for defect reports, including steps to reproduce and system details.
- Use the **Feature Request** template for proposed architectural enhancements or new domain apps.
