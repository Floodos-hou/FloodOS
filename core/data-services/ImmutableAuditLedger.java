// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 OpenAgriOS Contributors

package org.openagrios.core.dataservices;

import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.time.Instant;
import java.time.temporal.ChronoUnit;
import java.util.*;

/**
 * Immutable Cryptographic Audit Ledger & Multi-Entity Data Lineage Service.
 * Records state transitions using a sequential SHA-256 hash chain (`prev_hash` -> `record_hash`)
 * and provides end-to-end lineage queries indexed by `correlation_id`.
 */
public final class ImmutableAuditLedger {

    public static final String GENESIS_HASH = "0".repeat(64);

    public record AuditRecord(
            int seqNo,
            String eventId,
            String organizationId,
            String correlationId,
            String entityType,
            String entityId,
            String action,
            String actorUserId,
            String actorRole,
            int gatewayStatus,
            Map<String, Object> beforeState,
            Map<String, Object> afterState,
            String beforeJson,
            String afterJson,
            String prevHash,
            String recordHash,
            String createdAt
    ) {
        public Map<String, Object> toSummaryMap() {
            Map<String, Object> m = new LinkedHashMap<>();
            m.put("seq_no", seqNo);
            m.put("event_id", eventId);
            m.put("organization_id", organizationId);
            m.put("correlation_id", correlationId);
            m.put("entity_type", entityType);
            m.put("entity_id", entityId);
            m.put("action", action);
            m.put("actor_user_id", actorUserId);
            m.put("actor_role", actorRole);
            m.put("gateway_status", gatewayStatus);
            m.put("prev_hash", prevHash);
            m.put("record_hash", recordHash);
            m.put("created_at", createdAt);
            return m;
        }

        public Map<String, Object> toFullMap() {
            Map<String, Object> m = new LinkedHashMap<>();
            m.put("seq_no", seqNo);
            m.put("event_id", eventId);
            m.put("organization_id", organizationId);
            m.put("correlation_id", correlationId);
            m.put("entity_type", entityType);
            m.put("entity_id", entityId);
            m.put("action", action);
            m.put("actor_user_id", actorUserId);
            m.put("actor_role", actorRole);
            m.put("gateway_status", gatewayStatus);
            m.put("before_state", beforeState != null ? beforeState : Map.of());
            m.put("after_state", afterState != null ? afterState : Map.of());
            m.put("prev_hash", prevHash);
            m.put("record_hash", recordHash);
            m.put("created_at", createdAt);
            return m;
        }
    }

    private final List<AuditRecord> ledger = new ArrayList<>();

    public synchronized void clear() {
        ledger.clear();
    }

    public static String sha256Hex(String input) {
        try {
            MessageDigest md = MessageDigest.getInstance("SHA-256");
            byte[] digest = md.digest(input.getBytes(StandardCharsets.UTF_8));
            StringBuilder sb = new StringBuilder(64);
            for (byte b : digest) {
                sb.append(String.format("%02x", b));
            }
            return sb.toString();
        } catch (Exception e) {
            throw new IllegalStateException("SHA-256 not available", e);
        }
    }

    public synchronized AuditRecord appendRecord(
            String organizationId,
            String correlationId,
            String entityType,
            String entityId,
            String action,
            String actorUserId,
            String actorRole,
            Map<String, Object> beforeState,
            Map<String, Object> afterState,
            int gatewayStatus
    ) {
        String prevHash = ledger.isEmpty() ? GENESIS_HASH : ledger.get(ledger.size() - 1).recordHash();
        int nextSeq = ledger.size() + 1;
        String eventId = String.format("EVT-2026-%04d", nextSeq);
        String ts = Instant.now().truncatedTo(ChronoUnit.SECONDS).toString();

        Map<String, Object> cleanBefore = beforeState != null ? beforeState : new LinkedHashMap<>();
        Map<String, Object> cleanAfter = afterState != null ? afterState : new LinkedHashMap<>();
        String beforeJson = JsonCodec.toCanonicalJson(cleanBefore);
        String afterJson = JsonCodec.toCanonicalJson(cleanAfter);

        String rawChain = String.join("|",
                prevHash,
                String.valueOf(nextSeq),
                eventId,
                organizationId,
                correlationId,
                entityType,
                entityId,
                action,
                actorUserId,
                actorRole,
                ts,
                beforeJson,
                afterJson
        );
        String recordHash = sha256Hex(rawChain);

        AuditRecord rec = new AuditRecord(
                nextSeq, eventId, organizationId, correlationId,
                entityType, entityId, action, actorUserId, actorRole,
                gatewayStatus, cleanBefore, cleanAfter, beforeJson, afterJson,
                prevHash, recordHash, ts
        );
        ledger.add(rec);
        return rec;
    }

    public synchronized Map<String, Object> verifyChainIntegrity() {
        String prevHash = GENESIS_HASH;
        for (AuditRecord r : ledger) {
            String rawChain = String.join("|",
                    prevHash,
                    String.valueOf(r.seqNo()),
                    r.eventId(),
                    r.organizationId(),
                    r.correlationId(),
                    r.entityType(),
                    r.entityId(),
                    r.action(),
                    r.actorUserId(),
                    r.actorRole(),
                    r.createdAt(),
                    r.beforeJson(),
                    r.afterJson()
            );
            String computed = sha256Hex(rawChain);
            if (!r.prevHash().equals(prevHash) || !r.recordHash().equals(computed)) {
                Map<String, Object> broken = new LinkedHashMap<>();
                broken.put("chain_valid", false);
                broken.put("total_blocks", ledger.size());
                broken.put("broken_at_seq", r.seqNo());
                return broken;
            }
            prevHash = r.recordHash();
        }
        Map<String, Object> proof = new LinkedHashMap<>();
        proof.put("chain_valid", true);
        proof.put("algorithm", "SHA-256 Immutable Hash Chain");
        proof.put("total_blocks", ledger.size());
        proof.put("latest_hash", prevHash);
        return proof;
    }

    public synchronized Map<String, Object> getLineageByCorrelation(String orgId, String correlationId) {
        List<Map<String, Object>> steps = new ArrayList<>();
        for (AuditRecord r : ledger) {
            if (r.organizationId().equals(orgId) && r.correlationId().equals(correlationId)) {
                steps.add(r.toFullMap());
            }
        }
        Map<String, Object> res = new LinkedHashMap<>();
        res.put("correlation_id", correlationId);
        res.put("lineage_steps", steps);
        res.put("chain_proof", verifyChainIntegrity());
        return res;
    }

    public synchronized List<Map<String, Object>> listRecentByTenant(String orgId, int limit) {
        List<Map<String, Object>> result = new ArrayList<>();
        for (int i = ledger.size() - 1; i >= 0 && result.size() < limit; i--) {
            AuditRecord r = ledger.get(i);
            if (r.organizationId().equals(orgId)) {
                result.add(r.toFullMap());
            }
        }
        return result;
    }
}
