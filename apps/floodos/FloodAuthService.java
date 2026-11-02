// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 FloodOS Contributors

package org.floodos.apps.floodos;

import org.floodos.core.identity.KeycloakOidcEngine;
import org.floodos.core.identity.KeycloakOidcEngine.Organization;
import org.floodos.core.identity.KeycloakOidcEngine.UserAccount;

import java.time.Instant;
import java.util.*;

/**
 * Sign-in endpoints of the FloodOS API: demo account list, password login (deprecated, RFC 9700) and the
 * Authorization-Code + PKCE flow. In KEYCLOAK_PRODUCTION every call goes to the real Keycloak; the local issuer is
 * used only in development and tests. A token without a registered role is refused (no default role).
 */
public final class FloodAuthService {

    private final FloodDataStore store;

    public FloodAuthService(FloodDataStore store) {
        this.store = store;
    }

    public synchronized Map<String, Object> listDemoAccounts() {
        List<UserAccount> sorted = new ArrayList<>(store.usersByUsername.values());
        sorted.sort(Comparator.comparingInt((UserAccount u) -> switch (u.role()) {
            case "DISPATCHER" -> 1;
            case "REPORTER" -> 2;
            case "FIELD_TEAM" -> 3;
            case "RESOURCE_MANAGER" -> 4;
            default -> 5;
        }).thenComparing(UserAccount::username));

        List<Map<String, Object>> accounts = new ArrayList<>();
        for (UserAccount u : sorted) {
            Organization org = store.organizations.get(u.organizationId());
            accounts.add(u.toPublicMap(org != null ? org.name() : u.organizationId()));
        }

        Map<String, Object> res = new LinkedHashMap<>();
        res.put("realm", "floodos");
        res.put("notice", "Tài khoản mẫu cho bản demo mô phỏng; không dùng cho môi trường công khai.");
        res.put("sso_provider", "Keycloak OIDC 24.0");
        res.put("accounts", accounts);
        return res;
    }

    /**
     * @deprecated RFC 9700 Security Best Practice: Resource Owner Password Credentials (ROPC)
     * is deprecated. Web and mobile clients MUST use Authorization Code + PKCE via
     * {@link #exchangePkceToken(Map)}. Maintained only for legacy backwards-compatibility in local mock mode.
     */
    @Deprecated(since = "0.2.0")
    public synchronized FloodOSService.HttpResult loginOidc(Map<String, Object> body) {
        String username = String.valueOf(body.getOrDefault("username", "")).trim();
        String password = String.valueOf(body.getOrDefault("password", "")).trim();

        KeycloakOidcEngine.AuthMode currentMode = KeycloakOidcEngine.getActiveAuthMode();
        if ("true".equalsIgnoreCase(System.getenv("FLOODOS_STRICT_RFC9700"))) {
            Map<String, Object> err = new LinkedHashMap<>();
            err.put("error", "ROPC_DEPRECATED_RFC9700");
            err.put("status", 410);
            err.put("message", "Resource Owner Password Credentials Grant is prohibited under RFC 9700 OAuth 2.0 Security BCP. Please authenticate via Authorization Code Flow with PKCE (/api/v1/auth/pkce/authorize-url).");
            return new FloodOSService.HttpResult(410, err);
        }

        // --------------------------------------------------------------------
        // 1. KEYCLOAK PRODUCTION MODE: Must authenticate against real Keycloak OIDC
        //    NEVER fall back to mock accounts or mock tokens.
        // --------------------------------------------------------------------
        if (currentMode == KeycloakOidcEngine.AuthMode.KEYCLOAK_PRODUCTION) {
            String keycloakIssuer = System.getenv().getOrDefault("KEYCLOAK_ISSUER", "http://localhost:8080/realms/floodos");
            Optional<Map<String, Object>> liveToken = KeycloakOidcEngine.tryLiveKeycloakLogin(
                    keycloakIssuer, "floodos-web", username, password
            );

            if (liveToken.isEmpty()) {
                Map<String, Object> err = new LinkedHashMap<>();
                err.put("error", "KEYCLOAK_LOGIN_FAILED");
                err.put("status", 401);
                err.put("message", "Chế độ KEYCLOAK_PRODUCTION: Đăng nhập OIDC thất bại (Sai username/password hoặc máy chủ Keycloak không phản hồi). Tuyệt đối không fallback sang mock token.");
                return new FloodOSService.HttpResult(401, err);
            }

            String token = String.valueOf(liveToken.get().get("access_token"));
            Map<String, Object> decoded;
            try {
                decoded = KeycloakOidcEngine.verifyJwt(token, keycloakIssuer, KeycloakOidcEngine.DEFAULT_AUDIENCE);
            } catch (Exception ex) {
                Map<String, Object> err = new LinkedHashMap<>();
                err.put("error", "KEYCLOAK_INTROSPECTION_FAILED");
                err.put("status", 401);
                err.put("message", "Chế độ KEYCLOAK_PRODUCTION: Token phát hành từ Keycloak bị từ chối khi thẩm định: " + ex.getMessage());
                return new FloodOSService.HttpResult(401, err);
            }

            Object orgIdObj = decoded.get("organization_id");
            if (orgIdObj == null || String.valueOf(orgIdObj).isBlank()) {
                Map<String, Object> err = new LinkedHashMap<>();
                err.put("error", "MISSING_TENANT_CLAIM");
                err.put("status", 401);
                err.put("message", "JWT Token is missing mandatory 'organization_id' claim. Cross-tenant fallback is strictly prohibited.");
                return new FloodOSService.HttpResult(401, err);
            }
            String orgId = String.valueOf(orgIdObj).trim();

            Object realmAccess = decoded.get("realm_access");
            String role = realmAccess instanceof Map<?, ?> rm && rm.get("roles") instanceof List<?> roles
                    ? KeycloakOidcEngine.resolveFloodOSRole(roles) : null;
            if (role == null) {
                return new FloodOSService.HttpResult(403, Map.of(
                        "error", "NO_VALID_ROLE",
                        "message", "Tài khoản chưa được cấp vai trò nào của FloodOS. Không có vai trò mặc định."));
            }
            String userId = KeycloakOidcEngine.resolveDatabaseUserId(String.valueOf(decoded.getOrDefault("sub", username)), username);
            if (userId == null) {
                return new FloodOSService.HttpResult(401, Map.of("error", "MISSING_USER_IDENTITY", "message", "Token không có sub/preferred_username dùng được."));
            }
            UserAccount liveUser = new UserAccount(userId, username, "******", String.valueOf(decoded.getOrDefault("name", username)), username + "@floodos.vn", orgId, role);
            Map<String, Object> after = new LinkedHashMap<>();
            after.put("username", liveUser.username());
            after.put("role", liveUser.role());
            after.put("organization_id", liveUser.organizationId());
            after.put("auth_mode", "LIVE_KEYCLOAK_OIDC");

            store.auditLedger.appendRecord(
                    orgId,
                    "CORR-AUTH-" + liveUser.username().toUpperCase(Locale.ROOT),
                    "KeycloakSession",
                    liveUser.userId(),
                    "OIDC_SSO_LOGIN_SUCCESS",
                    liveUser.username(),
                    liveUser.role(),
                    null,
                    after,
                    200
            );

            Map<String, Object> res = new LinkedHashMap<>();
            res.put("access_token", token);
            res.put("token_type", "Bearer");
            res.put("expires_in", 3600);
            res.put("sso_issuer", keycloakIssuer);
            res.put("auth_mode", "LIVE_KEYCLOAK_OIDC");
            res.put("user", liveUser.toPublicMap(store.organizations.containsKey(orgId) ? store.organizations.get(orgId).name() : orgId));
            return new FloodOSService.HttpResult(200, res);
        }

        // --------------------------------------------------------------------
        // 2. DEV MOCK STANDALONE MODE: Used exclusively for local offline testing/CI
        //    Issues HS256 tokens signed with process-ephemeral 256-bit key.
        // --------------------------------------------------------------------
        UserAccount user = store.usersByUsername.get(username);
        if (user == null || !user.password().equals(password)) {
            Map<String, Object> err = new LinkedHashMap<>();
            err.put("error", "INVALID_CREDENTIALS");
            err.put("message", "Đăng nhập thất bại: Sai tên đăng nhập hoặc mật khẩu trong bộ dữ liệu demo cục bộ.");
            return new FloodOSService.HttpResult(401, err);
        }

        String token = KeycloakOidcEngine.issueDevMockJwt(user);
        Map<String, Object> decoded = KeycloakOidcEngine.verifyJwt(token);
        String authMode = "STANDALONE_DEV_MOCK";

        Map<String, Object> after = new LinkedHashMap<>();
        after.put("username", user.username());
        after.put("role", user.role());
        after.put("organization_id", user.organizationId());
        after.put("auth_mode", authMode);

        store.auditLedger.appendRecord(
                user.organizationId(),
                "CORR-AUTH-" + user.username().toUpperCase(Locale.ROOT),
                "KeycloakSession",
                user.userId(),
                "OIDC_SSO_LOGIN_SUCCESS",
                user.username(),
                user.role(),
                null,
                after,
                200
        );

        Map<String, Object> res = new LinkedHashMap<>();
        res.put("access_token", token);
        res.put("token_type", "Bearer");
        res.put("expires_in", 86400);
        res.put("sso_issuer", KeycloakOidcEngine.DEFAULT_ISSUER);
        res.put("auth_mode", authMode);
        res.put("warning", "RFC 9700: Resource Owner Password Credentials is deprecated; migrate to /api/v1/auth/pkce/token");
        res.put("user", user.toPublicMap(store.organizations.get(user.organizationId()) != null ? store.organizations.get(user.organizationId()).name() : user.organizationId()));
        return new FloodOSService.HttpResult(200, res);
    }

    /**
     * Exchanges OAuth 2.0 / OIDC Authorization Code and PKCE code_verifier for an access token
     * according to RFC 7636 and RFC 9700 Security Best Practices.
     * Validates cryptographic code_challenge and anti-CSRF state token.
     */
    /**
     * Programmatically acquires an Authorization Code for PKCE flow (RFC 7636).
     * NOTE: This endpoint serves as a Headless CI/CD & Automated Test Bridge. In human-facing
     * web/mobile applications, RFC 9700 mandates browser redirection directly to Keycloak's
     * {@code authorization_url} issued by {@link #generatePkceSession(Map)}.
     * In KEYCLOAK_PRODUCTION: completes Keycloak login flow and returns genuine Keycloak code.
     * In DEV_MOCK_STANDALONE: validates store credentials and issues mock code bound to code_challenge.
     */
    public synchronized FloodOSService.HttpResult acquirePkceAuthCode(Map<String, Object> body) {
        String username = String.valueOf(body.getOrDefault("username", "")).trim();
        String password = String.valueOf(body.getOrDefault("password", "")).trim();
        String codeChallenge = String.valueOf(body.getOrDefault("code_challenge", "")).trim();
        String state = body.containsKey("state") ? String.valueOf(body.get("state")).trim() : null;
        String redirectUri = String.valueOf(body.getOrDefault("redirect_uri", "http://localhost:8000/callback")).trim();
        String clientId = String.valueOf(body.getOrDefault("client_id", KeycloakOidcEngine.DEFAULT_AUDIENCE)).trim();

        if (username.isBlank() || password.isBlank() || codeChallenge.isBlank()) {
            return new FloodOSService.HttpResult(400, Map.of(
                    "error", "MISSING_PARAMETERS",
                    "message", "Fields 'username', 'password', and 'code_challenge' are mandatory for authorization code acquisition."
            ));
        }

        KeycloakOidcEngine.AuthMode currentMode = KeycloakOidcEngine.getActiveAuthMode();
        if (currentMode == KeycloakOidcEngine.AuthMode.KEYCLOAK_PRODUCTION) {
            String issuer = System.getenv().getOrDefault("KEYCLOAK_ISSUER", KeycloakOidcEngine.DEFAULT_ISSUER);
            Optional<String> liveCode = KeycloakOidcEngine.acquireLiveKeycloakAuthCode(
                    issuer, clientId, username, password, redirectUri, codeChallenge, state
            );
            if (liveCode.isEmpty()) {
                return new FloodOSService.HttpResult(401, Map.of(
                        "error", "KEYCLOAK_AUTH_FAILED",
                        "message", "Keycloak login authentication failed for user: " + username
                ));
            }
            Map<String, Object> res = new LinkedHashMap<>();
            res.put("code", liveCode.get());
            if (state != null) {
                res.put("state", state);
            }
            res.put("client_id", clientId);
            res.put("auth_mode", "KEYCLOAK_PRODUCTION");
            return new FloodOSService.HttpResult(200, res);
        }

        // DEV_MOCK_STANDALONE: verify user credentials from store and issue mock code
        UserAccount user = store.usersByUsername.get(username);
        if (user == null || !user.password().equals(password)) {
            return new FloodOSService.HttpResult(401, Map.of(
                    "error", "INVALID_CREDENTIALS",
                    "message", "Invalid username or password in standalone mock mode"
            ));
        }
        String authCode = "code-" + UUID.randomUUID().toString().replace("-", "");
        KeycloakOidcEngine.pendingPkceSessions.put(authCode, new KeycloakOidcEngine.PkceSession(
                authCode, codeChallenge, "S256", clientId, redirectUri, state, Instant.now()
        ));
        Map<String, Object> res = new LinkedHashMap<>();
        res.put("code", authCode);
        if (state != null) {
            res.put("state", state);
        }
        res.put("client_id", clientId);
        res.put("auth_mode", "DEV_MOCK_STANDALONE");
        return new FloodOSService.HttpResult(200, res);
    }

    public synchronized FloodOSService.HttpResult exchangePkceToken(Map<String, Object> body) {
        String code = String.valueOf(body.getOrDefault("code", "")).trim();
        String codeVerifier = String.valueOf(body.getOrDefault("code_verifier", "")).trim();
        String redirectUri = String.valueOf(body.getOrDefault("redirect_uri", "http://localhost:8000/callback")).trim();
        String state = body.containsKey("state") ? String.valueOf(body.get("state")).trim() : null;
        String clientId = String.valueOf(body.getOrDefault("client_id", KeycloakOidcEngine.DEFAULT_AUDIENCE)).trim();
        String clientSecret = body.containsKey("client_secret") ? String.valueOf(body.get("client_secret")).trim() : null;

        if (code.isBlank() || codeVerifier.isBlank()) {
            return new FloodOSService.HttpResult(400, Map.of(
                    "error", "MISSING_PKCE_PARAMETERS",
                    "message", "Both 'code' and 'code_verifier' are mandatory for OAuth 2.0 / OIDC PKCE token exchange (RFC 7636)."
            ));
        }

        if (codeVerifier.length() < 43 || codeVerifier.length() > 128) {
            return new FloodOSService.HttpResult(400, Map.of(
                    "error", "INVALID_CODE_VERIFIER",
                    "message", "RFC 7636 Section 4.1 requires code_verifier length between 43 and 128 characters."
            ));
        }

        KeycloakOidcEngine.AuthMode currentMode = KeycloakOidcEngine.getActiveAuthMode();

        // 1. Production Mode: upstream Keycloak token endpoint
        if (currentMode == KeycloakOidcEngine.AuthMode.KEYCLOAK_PRODUCTION) {
            String keycloakIssuer = System.getenv().getOrDefault("KEYCLOAK_ISSUER", KeycloakOidcEngine.DEFAULT_ISSUER);
            String publicIssuer = System.getenv().getOrDefault("KEYCLOAK_PUBLIC_ISSUER", KeycloakOidcEngine.DEFAULT_PUBLIC_ISSUER);
            KeycloakOidcEngine.KeycloakExchangeResult result = KeycloakOidcEngine.exchangeAuthorizationCodeWithPkceDetailed(
                    keycloakIssuer, clientId, clientSecret, code, codeVerifier, redirectUri
            );

            if (!result.success()) {
                int status = result.statusCode() == 400 ? 400 : 401;
                String err = result.error() != null ? result.error() : "KEYCLOAK_TOKEN_EXCHANGE_FAILED";
                String msg = result.errorDescription() != null ? result.errorDescription() : "Keycloak upstream authorization code exchange failed (RFC 7636).";
                return new FloodOSService.HttpResult(status, Map.of(
                        "error", err,
                        "message", msg
                ));
            }

            Map<String, Object> tokenPayload = result.data();
            String token = String.valueOf(tokenPayload.get("access_token"));
            Map<String, Object> decoded;
            try {
                decoded = KeycloakOidcEngine.verifyJwt(token, publicIssuer, KeycloakOidcEngine.DEFAULT_AUDIENCE);
            } catch (Exception ex) {
                return new FloodOSService.HttpResult(401, Map.of(
                        "error", "KEYCLOAK_INTROSPECTION_FAILED",
                        "message", "Keycloak PKCE token introspection rejected: " + ex.getMessage()
                ));
            }

            Object orgIdObj = decoded.get("organization_id");
            if (orgIdObj == null || String.valueOf(orgIdObj).isBlank()) {
                return new FloodOSService.HttpResult(401, Map.of(
                        "error", "MISSING_TENANT_CLAIM",
                        "status", 401,
                        "message", "PKCE JWT Token is missing mandatory 'organization_id' claim. Cross-tenant fallback is strictly prohibited."
                ));
            }
            String orgId = String.valueOf(orgIdObj).trim();

            Object prefUserObj = decoded.get("preferred_username");
            if (prefUserObj == null || String.valueOf(prefUserObj).isBlank()) {
                return new FloodOSService.HttpResult(401, Map.of(
                        "error", "MISSING_USERNAME_CLAIM",
                        "status", 401,
                        "message", "PKCE JWT Token is missing mandatory 'preferred_username' claim."
                ));
            }
            String username = String.valueOf(prefUserObj).trim();

            Object realmAccess = decoded.get("realm_access");
            String role = realmAccess instanceof Map<?, ?> rm && rm.get("roles") instanceof List<?> roles
                    ? KeycloakOidcEngine.resolveFloodOSRole(roles) : null;
            if (role == null) {
                return new FloodOSService.HttpResult(403, Map.of(
                        "error", "NO_VALID_ROLE",
                        "message", "Tài khoản chưa được cấp vai trò nào của FloodOS. Không có vai trò mặc định."));
            }
            String sub = String.valueOf(decoded.getOrDefault("sub", username));
            String userId = KeycloakOidcEngine.resolveDatabaseUserId(sub, username);
            if (userId == null) {
                return new FloodOSService.HttpResult(401, Map.of("error", "MISSING_USER_IDENTITY", "message", "Token không có sub/preferred_username dùng được."));
            }
            UserAccount liveUser = new UserAccount(userId, username, "******", String.valueOf(decoded.getOrDefault("name", username)), username + "@floodos.vn", orgId, role);
            Map<String, Object> after = new LinkedHashMap<>();
            after.put("username", liveUser.username());
            after.put("role", liveUser.role());
            after.put("organization_id", liveUser.organizationId());
            after.put("auth_mode", "LIVE_KEYCLOAK_PKCE");
            after.put("flow", "OIDC_AUTHORIZATION_CODE_WITH_PKCE");

            store.auditLedger.appendRecord(
                    orgId,
                    "CORR-PKCE-" + liveUser.username().toUpperCase(Locale.ROOT),
                    "KeycloakPkceSession",
                    liveUser.userId(),
                    "OIDC_PKCE_LOGIN_SUCCESS",
                    liveUser.username(),
                    liveUser.role(),
                    null,
                    after,
                    200
            );

            Map<String, Object> res = new LinkedHashMap<>(tokenPayload);
            res.put("flow", "OIDC_AUTHORIZATION_CODE_WITH_PKCE");
            res.put("pkce_verified", true);
            res.put("user", liveUser.toPublicMap(store.organizations.containsKey(orgId) ? store.organizations.get(orgId).name() : orgId));
            return new FloodOSService.HttpResult(200, res);
        }

        // 2. Mock Standalone Mode: verify cryptographically & state
        if (!KeycloakOidcEngine.verifyPkceCodeChallenge(code, codeVerifier, state, clientId, redirectUri)) {
            return new FloodOSService.HttpResult(400, Map.of(
                    "error", "INVALID_GRANT",
                    "message", "PKCE code_verifier does not match code_challenge or anti-CSRF state token mismatch (RFC 7636 Section 4.6 & RFC 6749 Section 10.12)."
            ));
        }

        String targetUsername = String.valueOf(body.getOrDefault("username", "")).trim();
        UserAccount user = store.usersByUsername.get(targetUsername);
        if (user == null) {
            return new FloodOSService.HttpResult(401, Map.of(
                    "error", "INVALID_CREDENTIALS",
                    "message", "Chế độ phát triển cục bộ: cần 'username' của một tài khoản có thật; không có tài khoản mặc định."
            ));
        }

        String token = KeycloakOidcEngine.issueDevMockJwt(user);
        Map<String, Object> after = new LinkedHashMap<>();
        after.put("username", user.username());
        after.put("role", user.role());
        after.put("organization_id", user.organizationId());
        after.put("auth_mode", "STANDALONE_DEV_MOCK_PKCE");
        after.put("flow", "OIDC_AUTHORIZATION_CODE_WITH_PKCE");

        store.auditLedger.appendRecord(
                user.organizationId(),
                "CORR-PKCE-" + user.username().toUpperCase(Locale.ROOT),
                "KeycloakPkceSession",
                user.userId(),
                "OIDC_PKCE_LOGIN_SUCCESS",
                user.username(),
                user.role(),
                null,
                after,
                200
        );

        Map<String, Object> res = new LinkedHashMap<>();
        res.put("access_token", token);
        res.put("token_type", "Bearer");
        res.put("expires_in", 3600);
        res.put("flow", "OIDC_AUTHORIZATION_CODE_WITH_PKCE");
        res.put("pkce_verified", true);
        if (state != null) {
            res.put("state", state);
        }
        res.put("user", user.toPublicMap(store.organizations.containsKey(user.organizationId()) ? store.organizations.get(user.organizationId()).name() : user.organizationId()));
        return new FloodOSService.HttpResult(200, res);
    }
}
