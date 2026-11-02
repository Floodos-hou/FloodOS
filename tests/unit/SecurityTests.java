// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 OpenAgriOS Contributors

package org.openagrios.tests.unit;

import static org.openagrios.tests.unit.TestKit.*;

import java.nio.charset.StandardCharsets;
import java.util.ArrayList;
import java.util.Base64;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.Set;
import java.util.concurrent.ConcurrentHashMap;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.concurrent.TimeUnit;
import org.openagrios.core.dataservices.ImmutableAuditLedger;
import org.openagrios.core.dataservices.ImmutableAuditLedger.AuditRecord;
import org.openagrios.apps.floodops.FloodRoles;
import org.openagrios.core.gateway.ZeroTrustGateway;
import org.openagrios.core.identity.KeycloakOidcEngine;
import org.openagrios.core.identity.KeycloakOidcEngine.AuthContext;
import org.openagrios.core.identity.KeycloakOidcEngine.AuthMode;
import org.openagrios.core.identity.KeycloakOidcEngine.UserAccount;

/** Audit hash chain, RBAC gateway guard, JWT validation attacks, PKCE (RFC 7636) and role resolution. */
final class SecurityTests {

    private SecurityTests() {}

    static void run() throws Exception {
        auditLedger();
        zeroTrustGateway();
        jwt();
        pkce();
        roleResolution();
    }

    private static AuditRecord append(ImmutableAuditLedger l, String org, String corr, String action) {
        return l.appendRecord(org, corr, "FloodReport", "FR-1", action, "alice", "DISPATCHER",
                Map.of("s", "before"), Map.of("s", "after"), 200);
    }

    // ------------------------------------------------------------------ ImmutableAuditLedger
    private static void auditLedger() throws Exception {
        suite("ImmutableAuditLedger");
        test("SHA-256 matches published test vectors", () -> {
            equal("ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad", ImmutableAuditLedger.sha256Hex("abc"), "abc");
            equal("e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855", ImmutableAuditLedger.sha256Hex(""), "empty");
        });
        test("hash formula matches the golden vector shared with the independent Python verifier", () -> {
            // services/traceability/tests/test_traceability.py asserts the very same raw string and digest
            String raw = String.join("|", ImmutableAuditLedger.GENESIS_HASH, "1", "EVT-2026-0001", "ORG_HN_PILOT_01",
                    "CORR-FR-0001", "FloodReport", "FR-0001", "CREATE_FLOOD_REPORT", "usr_reporter_lan", "REPORTER",
                    "2026-11-20T09:15:00Z", "{\"status\":\"NEW\"}", "{\"a\":1,\"b\":\"x\"}");
            equal("80fe676988d4dea1be4b550eef897a5bb4770d10f26dd56c6bd9a9fc57b45ab3", ImmutableAuditLedger.sha256Hex(raw), "golden digest");
        });
        test("empty ledger verifies and reports the genesis hash", () -> {
            Map<String, Object> proof = new ImmutableAuditLedger().verifyChainIntegrity();
            equal(Boolean.TRUE, proof.get("chain_valid"), "valid");
            equal(0, proof.get("total_blocks"), "no blocks");
            equal(ImmutableAuditLedger.GENESIS_HASH, proof.get("latest_hash"), "genesis");
        });
        test("first record links to genesis; later records link to their predecessor", () -> {
            ImmutableAuditLedger l = new ImmutableAuditLedger();
            AuditRecord a = append(l, "ORG", "C1", "A");
            AuditRecord b = append(l, "ORG", "C1", "B");
            equal(1, a.seqNo(), "seq 1");
            equal("EVT-2026-0001", a.eventId(), "event id");
            equal(ImmutableAuditLedger.GENESIS_HASH, a.prevHash(), "genesis link");
            equal(2, b.seqNo(), "seq 2");
            equal(a.recordHash(), b.prevHash(), "chain link");
            equal(64, a.recordHash().length(), "hex sha-256 length");
            isFalse(a.recordHash().equals(b.recordHash()), "distinct hashes");
        });
        test("a valid multi-record chain verifies and exposes the latest hash", () -> {
            ImmutableAuditLedger l = new ImmutableAuditLedger();
            append(l, "ORG", "C1", "A");
            AuditRecord last = append(l, "ORG", "C1", "B");
            Map<String, Object> proof = l.verifyChainIntegrity();
            equal(Boolean.TRUE, proof.get("chain_valid"), "valid");
            equal(2, proof.get("total_blocks"), "blocks");
            equal(last.recordHash(), proof.get("latest_hash"), "latest hash");
        });
        test("tampering with the payload of any record is detected at that sequence number", () -> {
            ImmutableAuditLedger l = new ImmutableAuditLedger();
            AuditRecord a = append(l, "ORG", "C1", "A");
            AuditRecord b = append(l, "ORG", "C1", "B");
            AuditRecord c = append(l, "ORG", "C1", "C");
            AuditRecord forgedB = new AuditRecord(b.seqNo(), b.eventId(), b.organizationId(), b.correlationId(),
                    b.entityType(), b.entityId(), b.action(), b.actorUserId(), b.actorRole(), b.gatewayStatus(),
                    b.beforeState(), Map.of("s", "FORGED"), b.beforeJson(), "{\"s\":\"FORGED\"}",
                    b.prevHash(), b.recordHash(), b.createdAt());
            ImmutableAuditLedger tampered = new ImmutableAuditLedger();
            tampered.rehydrateLedger(List.of(a, forgedB, c));
            Map<String, Object> proof = tampered.verifyChainIntegrity();
            equal(Boolean.FALSE, proof.get("chain_valid"), "invalid");
            equal(2, proof.get("broken_at_seq"), "points at the forged record");
        });
        test("deleting a record from the middle breaks the chain", () -> {
            ImmutableAuditLedger l = new ImmutableAuditLedger();
            AuditRecord a = append(l, "ORG", "C1", "A");
            append(l, "ORG", "C1", "B");
            AuditRecord c = append(l, "ORG", "C1", "C");
            ImmutableAuditLedger gap = new ImmutableAuditLedger();
            gap.rehydrateLedger(List.of(a, c));
            equal(Boolean.FALSE, gap.verifyChainIntegrity().get("chain_valid"), "gap detected");
        });
        test("reordering records breaks the chain", () -> {
            ImmutableAuditLedger l = new ImmutableAuditLedger();
            AuditRecord a = append(l, "ORG", "C1", "A");
            AuditRecord b = append(l, "ORG", "C1", "B");
            ImmutableAuditLedger swapped = new ImmutableAuditLedger();
            swapped.rehydrateLedger(List.of(b, a));
            equal(Boolean.FALSE, swapped.verifyChainIntegrity().get("chain_valid"), "reorder detected");
        });
        test("state maps are canonicalised: key order does not affect the stored JSON", () -> {
            ImmutableAuditLedger l = new ImmutableAuditLedger();
            Map<String, Object> m1 = new LinkedHashMap<>();
            m1.put("b", 1);
            m1.put("a", 2);
            Map<String, Object> m2 = new LinkedHashMap<>();
            m2.put("a", 2);
            m2.put("b", 1);
            AuditRecord r1 = l.appendRecord("O", "C", "E", "1", "X", "u", "r", m1, m1, 200);
            AuditRecord r2 = l.appendRecord("O", "C", "E", "1", "X", "u", "r", m2, m2, 200);
            equal(r1.afterJson(), r2.afterJson(), "identical canonical JSON");
            equal("{\"a\":2,\"b\":1}", r1.afterJson(), "sorted keys");
        });
        test("null states are stored as empty objects", () -> {
            AuditRecord r = new ImmutableAuditLedger().appendRecord("O", "C", "E", "1", "X", "u", "r", null, null, 200);
            equal("{}", r.beforeJson(), "before");
            equal("{}", r.afterJson(), "after");
        });
        test("lineage returns only the caller tenant's records for that correlation id", () -> {
            ImmutableAuditLedger l = new ImmutableAuditLedger();
            append(l, "ORG_A", "CORR-1", "A1");
            append(l, "ORG_B", "CORR-1", "B1");
            append(l, "ORG_A", "CORR-2", "A2");
            append(l, "ORG_A", "CORR-1", "A3");
            Map<String, Object> lineage = l.getLineageByCorrelation("ORG_A", "CORR-1");
            List<?> steps = (List<?>) lineage.get("lineage_steps");
            equal(2, steps.size(), "tenant + correlation filter");
            for (Object s : steps) equal("ORG_A", ((Map<?, ?>) s).get("organization_id"), "no cross-tenant leakage");
            equal(0, ((List<?>) l.getLineageByCorrelation("ORG_C", "CORR-1").get("lineage_steps")).size(), "unknown tenant sees nothing");
            equal(Boolean.TRUE, ((Map<?, ?>) lineage.get("chain_proof")).get("chain_valid"), "proof attached");
        });
        test("recent-by-tenant is newest-first, limited and tenant scoped", () -> {
            ImmutableAuditLedger l = new ImmutableAuditLedger();
            append(l, "ORG_A", "C", "A1");
            append(l, "ORG_B", "C", "B1");
            append(l, "ORG_A", "C", "A2");
            append(l, "ORG_A", "C", "A3");
            List<Map<String, Object>> recent = l.listRecentByTenant("ORG_A", 2);
            equal(2, recent.size(), "limit");
            equal("A3", recent.get(0).get("action"), "newest first");
            equal("A2", recent.get(1).get("action"), "then older");
            equal(1, l.listRecentByTenant("ORG_B", 10).size(), "other tenant");
            equal(0, l.listRecentByTenant("ORG_A", 0).size(), "zero limit");
        });
        test("clear() restarts the sequence from genesis", () -> {
            ImmutableAuditLedger l = new ImmutableAuditLedger();
            append(l, "O", "C", "A");
            l.clear();
            AuditRecord r = append(l, "O", "C", "A");
            equal(1, r.seqNo(), "seq reset");
            equal(ImmutableAuditLedger.GENESIS_HASH, r.prevHash(), "genesis again");
        });
        test("a persisted chain restored with its epoch still verifies and keeps growing in the same epoch", () -> {
            ImmutableAuditLedger original = new ImmutableAuditLedger();
            AuditRecord a = append(original, "ORG", "C1", "A");
            AuditRecord b = append(original, "ORG", "C1", "B");
            String epoch = original.getLedgerEpoch();

            ImmutableAuditLedger restarted = new ImmutableAuditLedger();   // what the core does after a restart
            restarted.rehydrateLedger(List.of(a, b), epoch);
            equal(Boolean.TRUE, restarted.verifyChainIntegrity().get("chain_valid"), "restored chain verifies");
            equal(epoch, restarted.getLedgerEpoch(), "epoch continues");
            AuditRecord c = append(restarted, "ORG", "C1", "C");
            equal(3, c.seqNo(), "sequence continues");
            equal(b.recordHash(), c.prevHash(), "new record links to the last persisted record");
            equal(Boolean.TRUE, restarted.verifyChainIntegrity().get("chain_valid"), "still valid after growing");
        });
        test("clear() starts a new epoch while rehydrate without an epoch also never reuses an old one", () -> {
            ImmutableAuditLedger l = new ImmutableAuditLedger();
            String first = l.getLedgerEpoch();
            l.clear();
            isFalse(first.equals(l.getLedgerEpoch()), "reset = new epoch");
            String second = l.getLedgerEpoch();
            l.rehydrateLedger(List.of());
            isFalse(second.equals(l.getLedgerEpoch()), "rehydrating nothing starts a fresh epoch");
        });
        test("concurrent appends keep a gap-free, valid chain", () -> {
            ImmutableAuditLedger l = new ImmutableAuditLedger();
            ExecutorService pool = Executors.newFixedThreadPool(8);
            Set<Integer> seqs = ConcurrentHashMap.newKeySet();
            for (int t = 0; t < 8; t++) {
                final int tid = t;
                pool.submit(() -> {
                    for (int i = 0; i < 50; i++) seqs.add(append(l, "ORG", "C" + tid, "A" + i).seqNo());
                });
            }
            pool.shutdown();
            isTrue(pool.awaitTermination(30, TimeUnit.SECONDS), "workers finished");
            equal(400, seqs.size(), "every append got a unique sequence number");
            Map<String, Object> proof = l.verifyChainIntegrity();
            equal(Boolean.TRUE, proof.get("chain_valid"), "chain intact under contention");
            equal(400, proof.get("total_blocks"), "no lost records");
        });
    }

    // ------------------------------------------------------------------ ZeroTrustGateway
    private static void zeroTrustGateway() {
        suite("ZeroTrustGateway");
        AuthContext reporter = new AuthContext("usr_reporter_lan", "reporter_lan", "ORG_HN_PILOT_01", "REPORTER");
        AuthContext coord = new AuthContext("usr_dispatcher_hoa", "dispatcher_hoa", "ORG_HN_PILOT_01", "DISPATCHER");

        test("an allowed role passes and leaves no audit trace", () -> {
            ImmutableAuditLedger l = new ImmutableAuditLedger();
            isNull(ZeroTrustGateway.enforceRbacPolicy(l, coord, List.of("DISPATCHER"), "DISPATCH", "DispatchOrder", "V01"), "allowed");
            equal(0, l.verifyChainIntegrity().get("total_blocks"), "nothing appended");
        });
        test("a forbidden role gets a 403 body and an immutable audit record", () -> {
            ImmutableAuditLedger l = new ImmutableAuditLedger();
            Map<String, Object> err = ZeroTrustGateway.enforceRbacPolicy(l, reporter, List.of("DISPATCHER"), "DISPATCH", "DispatchOrder", "V01");
            notNull(err, "blocked");
            equal("RBAC_FORBIDDEN", err.get("error"), "error code");
            equal(403, err.get("status"), "status");
            contains(String.valueOf(err.get("message")), "DISPATCHER", "names the required role");
            Map<?, ?> audit = (Map<?, ?>) err.get("audit_event");
            equal("RBAC_BLOCKED_DISPATCH", audit.get("action"), "audit action");
            equal(403, audit.get("gateway_status"), "audit status");
            equal("ORG_HN_PILOT_01", audit.get("organization_id"), "audit is tenant scoped");
            equal(1, l.verifyChainIntegrity().get("total_blocks"), "exactly one record");
        });
        test("every role outside the allow-list is blocked, matching is exact", () -> {
            for (String role : new String[]{"REPORTER", "FIELD_TEAM", "RESOURCE_MANAGER", "PLATFORM_ADMIN", "dispatcher", ""}) {
                AuthContext a = new AuthContext("u", "u", "O", role);
                notNull(ZeroTrustGateway.enforceRbacPolicy(new ImmutableAuditLedger(), a, List.of("DISPATCHER"), "X", "E", "1"),
                        "role '" + role + "' must be blocked");
            }
        });
        test("zero-trust headers expose identity only when authenticated", () -> {
            Map<String, String> anon = ZeroTrustGateway.buildZeroTrustHeaders(null);
            isFalse(anon.containsKey("X-User-Id") || anon.containsKey("X-Org-Id") || anon.containsKey("X-User-Roles"), "no identity headers");
            Map<String, String> authed = ZeroTrustGateway.buildZeroTrustHeaders(coord);
            equal("ORG_HN_PILOT_01", authed.get("X-Org-Id"), "org");
            equal("DISPATCHER", authed.get("X-User-Roles"), "role");
            notNull(authed.get("X-Gateway"), "gateway marker");
        });
    }

    // ------------------------------------------------------------------ JWT
    private static String b64(String s) {
        return Base64.getUrlEncoder().withoutPadding().encodeToString(s.getBytes(StandardCharsets.UTF_8));
    }

    private static void jwt() {
        suite("JWT validation (DEV_MOCK_STANDALONE)");
        FloodRoles.register();
        KeycloakOidcEngine.setAuthModeForTesting(AuthMode.DEV_MOCK_STANDALONE);
        UserAccount user = new UserAccount("usr_dispatcher_hoa", "dispatcher_hoa", "pw", "Chị Hoa", "hoa@x.vn", "ORG_HN_PILOT_01", "DISPATCHER");
        String good = KeycloakOidcEngine.issueJwt(user);

        test("a freshly issued token authenticates with the right identity", () -> {
            AuthContext a = KeycloakOidcEngine.authenticateBearer("Bearer " + good);
            notNull(a, "accepted");
            equal("ORG_HN_PILOT_01", a.organizationId(), "org claim");
            equal("DISPATCHER", a.role(), "role claim");
            equal("dispatcher_hoa", a.username(), "username");
        });
        test("missing, empty and non-Bearer authorization headers are rejected", () -> {
            isNull(KeycloakOidcEngine.authenticateBearer(null), "null header");
            isNull(KeycloakOidcEngine.authenticateBearer(""), "empty header");
            isNull(KeycloakOidcEngine.authenticateBearer("Basic dXNlcjpwdw=="), "basic scheme");
            isNull(KeycloakOidcEngine.authenticateBearer("Bearer "), "empty token");
            isNull(KeycloakOidcEngine.authenticateBearer("bearer " + good), "scheme is case sensitive");
        });
        test("structurally malformed tokens are rejected, never crash", () -> {
            for (String bad : new String[]{"abc", "a.b", "a.b.c.d", "...", "!!!.@@@.###"}) {
                isNull(KeycloakOidcEngine.authenticateBearer("Bearer " + bad), "token: " + bad);
            }
            throwsA(IllegalArgumentException.class, () -> KeycloakOidcEngine.verifyJwt("only.two"), "verifyJwt format check");
        });
        test("a tampered signature is rejected", () -> {
            String[] p = good.split("\\.");
            char last = p[2].charAt(p[2].length() - 1);
            String forgedSig = p[2].substring(0, p[2].length() - 1) + (last == 'A' ? 'B' : 'A');
            isNull(KeycloakOidcEngine.authenticateBearer("Bearer " + p[0] + "." + p[1] + "." + forgedSig), "signature flip");
        });
        test("privilege escalation by editing the payload is rejected (role swap keeps the old signature)", () -> {
            String[] p = good.split("\\.");
            String payload = new String(Base64.getUrlDecoder().decode(p[1]), StandardCharsets.UTF_8);
            String escalated = b64(payload.replace("DISPATCHER", "PLATFORM_ADMIN"));
            isNull(KeycloakOidcEngine.authenticateBearer("Bearer " + p[0] + "." + escalated + "." + p[2]), "payload tamper");
        });
        test("alg=none tokens are rejected", () -> {
            String header = b64("{\"alg\":\"none\",\"typ\":\"JWT\"}");
            String[] p = good.split("\\.");
            isNull(KeycloakOidcEngine.authenticateBearer("Bearer " + header + "." + p[1] + "."), "unsigned token");
            isNull(KeycloakOidcEngine.authenticateBearer("Bearer " + header + "." + p[1] + "." + p[2]), "none header with a signature");
        });
        test("a forged RS256 token is rejected", () ->
                isNull(KeycloakOidcEngine.authenticateBearer("Bearer " + KeycloakOidcEngine.createForgedRs256Token("usr_dispatcher_hoa", "DISPATCHER", "ORG_HN_PILOT_01")), "forged RS256"));
        test("an expired token is rejected", () ->
                isNull(KeycloakOidcEngine.authenticateBearer("Bearer " + KeycloakOidcEngine.createExpiredToken(user)), "expired"));
        test("a token minted for another audience is rejected", () ->
                isNull(KeycloakOidcEngine.authenticateBearer("Bearer " + KeycloakOidcEngine.createWrongAudienceToken(user)), "wrong audience"));
        test("a token from a different issuer is rejected", () -> {
            String foreign = KeycloakOidcEngine.issueDevMockJwt(user, "http://evil.example/realms/x", KeycloakOidcEngine.DEFAULT_AUDIENCE, 300);
            isNull(KeycloakOidcEngine.authenticateBearer("Bearer " + foreign), "foreign issuer");
        });
        KeycloakOidcEngine.resetAuthModeForTesting();
    }

    // ------------------------------------------------------------------ PKCE
    private static void pkce() {
        suite("PKCE (RFC 7636) and OIDC code flow");
        KeycloakOidcEngine.setAuthModeForTesting(AuthMode.DEV_MOCK_STANDALONE);

        test("S256 challenge matches the RFC 7636 appendix B vector", () ->
                equal("E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM",
                        KeycloakOidcEngine.generateCodeChallenge("dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk"), "RFC vector"));
        test("generated verifiers are 43-char base64url and unique", () -> {
            String v1 = KeycloakOidcEngine.generateCodeVerifier();
            String v2 = KeycloakOidcEngine.generateCodeVerifier();
            isTrue(v1.matches("^[A-Za-z0-9_-]{43}$"), "format: " + v1);
            isFalse(v1.equals(v2), "random");
        });
        test("only well-formed S256 client challenges are accepted", () -> {
            for (String bad : new String[]{"short", "contains+plus/and=pad", "x".repeat(44), "x".repeat(42)}) {
                throwsA(IllegalArgumentException.class, () -> KeycloakOidcEngine.generatePkceSession("http://l/cb", "s", bad), "challenge " + bad);
            }
        });
        test("full code exchange: correct verifier + state succeeds exactly once", () -> {
            String verifier = KeycloakOidcEngine.generateCodeVerifier();
            String challenge = KeycloakOidcEngine.generateCodeChallenge(verifier);
            Map<String, Object> s = KeycloakOidcEngine.generatePkceSession("http://l/cb", "state-1", challenge);
            String code = String.valueOf(s.get("code"));
            isNull(s.get("code_verifier"), "client-owned verifier never leaves the client");
            isTrue(KeycloakOidcEngine.verifyPkceCodeChallenge(code, verifier, "state-1"), "valid exchange");
            isFalse(KeycloakOidcEngine.verifyPkceCodeChallenge(code, verifier, "state-1"), "authorization code is single-use");
        });
        test("wrong verifier, wrong state and unknown code are all refused", () -> {
            String verifier = KeycloakOidcEngine.generateCodeVerifier();
            String challenge = KeycloakOidcEngine.generateCodeChallenge(verifier);
            Map<String, Object> s = KeycloakOidcEngine.generatePkceSession("http://l/cb", "state-2", challenge);
            String code = String.valueOf(s.get("code"));
            isFalse(KeycloakOidcEngine.verifyPkceCodeChallenge(code, KeycloakOidcEngine.generateCodeVerifier(), "state-2"), "attacker verifier");
            isFalse(KeycloakOidcEngine.verifyPkceCodeChallenge(code, verifier, "other-state"), "CSRF state mismatch");
            isFalse(KeycloakOidcEngine.verifyPkceCodeChallenge("code-does-not-exist", verifier, "state-2"), "unknown code");
            isFalse(KeycloakOidcEngine.verifyPkceCodeChallenge(null, verifier, "state-2"), "null code");
        });
        KeycloakOidcEngine.resetAuthModeForTesting();
    }

    // ------------------------------------------------------------------ roles
    private static void roleResolution() {
        suite("Keycloak realm role resolution (roles are registered by the application, no default role)");
        FloodRoles.register();
        test("empty or missing roles resolve to NO role instead of a default", () -> {
            isNull(KeycloakOidcEngine.resolveOpenAgriOsRole(null), "null");
            isNull(KeycloakOidcEngine.resolveOpenAgriOsRole(List.of()), "empty");
        });
        test("Keycloak system roles are ignored", () -> {
            isNull(KeycloakOidcEngine.resolveOpenAgriOsRole(List.of("default-roles-openagrios", "offline_access", "uma_authorization")), "system only");
            equal("DISPATCHER", KeycloakOidcEngine.resolveOpenAgriOsRole(List.of("offline_access", "DISPATCHER")), "business role wins");
        });
        test("highest-priority role wins and matching is case-insensitive", () -> {
            equal("PLATFORM_ADMIN", KeycloakOidcEngine.resolveOpenAgriOsRole(List.of("REPORTER", "PLATFORM_ADMIN", "DISPATCHER")), "hierarchy");
            equal("DISPATCHER", KeycloakOidcEngine.resolveOpenAgriOsRole(List.of("reporter", " dispatcher ")), "normalised");
            equal("FIELD_TEAM", KeycloakOidcEngine.resolveOpenAgriOsRole(List.of("REPORTER", "FIELD_TEAM")), "field team outranks reporter");
        });
        test("a role that the application did not register is NOT resolved (old AgriOps roles are refused)", () -> {
            isNull(KeycloakOidcEngine.resolveOpenAgriOsRole(List.of("default-roles-openagrios", "FARMER")), "FARMER");
            isNull(KeycloakOidcEngine.resolveOpenAgriOsRole(List.of("COORDINATOR", "MACHINE_OWNER", "OPERATOR", "REPAIR_TEAM")), "former roles");
        });
        test("null entries inside the role list do not crash", () -> {
            List<Object> roles = new ArrayList<>();
            roles.add(null);
            roles.add("FIELD_TEAM");
            equal("FIELD_TEAM", KeycloakOidcEngine.resolveOpenAgriOsRole(roles), "null tolerated");
        });
        test("the registry always keeps PLATFORM_ADMIN first and the core alone knows no business role", () -> {
            KeycloakOidcEngine.configureRoleHierarchy(List.of("alpha", "BETA"));
            equal(List.of("PLATFORM_ADMIN", "ALPHA", "BETA"), KeycloakOidcEngine.roleHierarchy(), "registered");
            isNull(KeycloakOidcEngine.resolveOpenAgriOsRole(List.of("DISPATCHER")), "not registered now");
            equal("ALPHA", KeycloakOidcEngine.resolveOpenAgriOsRole(List.of("alpha")), "registered role");
            FloodRoles.register();
        });
        test("a token without a tenant claim or without a registered role never authenticates", () -> {
            KeycloakOidcEngine.setAuthModeForTesting(AuthMode.DEV_MOCK_STANDALONE);
            UserAccount noRole = new UserAccount("usr_x", "x", "pw", "X", "x@x.vn", "ORG_HN_PILOT_01", "FARMER");
            isNull(KeycloakOidcEngine.authenticateBearer("Bearer " + KeycloakOidcEngine.issueJwt(noRole)), "unregistered role");
            UserAccount noOrg = new UserAccount("usr_y", "y", "pw", "Y", "y@x.vn", "", "DISPATCHER");
            isNull(KeycloakOidcEngine.authenticateBearer("Bearer " + KeycloakOidcEngine.issueJwt(noOrg)), "empty organization");
            KeycloakOidcEngine.resetAuthModeForTesting();
        });
        test("database user ids are usr_<username>; a token with no usable identity gets none", () -> {
            equal("usr_dispatcher_hoa", KeycloakOidcEngine.resolveDatabaseUserId("0f3c-uuid", "dispatcher_hoa"), "derived from username");
            equal("usr_reporter_lan", KeycloakOidcEngine.resolveDatabaseUserId("usr_reporter_lan", "whatever"), "kept when already an id");
            isNull(KeycloakOidcEngine.resolveDatabaseUserId("uuid-only", null), "no username");
            isNull(KeycloakOidcEngine.resolveDatabaseUserId(null, "  "), "blank username");
        });
    }
}
