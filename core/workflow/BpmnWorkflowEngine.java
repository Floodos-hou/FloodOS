// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 OpenAgriOS Contributors

package org.openagrios.core.workflow;

import org.w3c.dom.Document;
import org.w3c.dom.Element;
import org.w3c.dom.Node;
import org.w3c.dom.NodeList;

import javax.xml.parsers.DocumentBuilderFactory;
import java.io.File;
import java.util.*;

/**
 * OMG BPMN 2.0 XML Parser and Process Instance Execution Engine.
 * Parses BPMN definitions directly using W3C DOM XML Parser (javax.xml.parsers).
 */
public final class BpmnWorkflowEngine {

    private static final String FLOWABLE_NS = "http://flowable.org/bpmn";

    public static final class BpmnProcessInstance {
        public final String processInstanceId;
        public final String organizationId;
        public final String definitionKey;
        public final String businessKey;
        public String currentStepId;
        public String currentStepName;
        public String candidateGroup;
        public String status;
        public final List<Map<String, Object>> history;
        public String updatedAt;

        public BpmnProcessInstance(
                String processInstanceId,
                String organizationId,
                String definitionKey,
                String businessKey,
                String currentStepId,
                String currentStepName,
                String candidateGroup,
                String status,
                List<Map<String, Object>> history,
                String updatedAt
        ) {
            this.processInstanceId = processInstanceId;
            this.organizationId = organizationId;
            this.definitionKey = definitionKey;
            this.businessKey = businessKey;
            this.currentStepId = currentStepId;
            this.currentStepName = currentStepName;
            this.candidateGroup = candidateGroup;
            this.status = status;
            this.history = new ArrayList<>(history);
            this.updatedAt = updatedAt;
        }

        public Map<String, Object> toMap() {
            Map<String, Object> m = new LinkedHashMap<>();
            m.put("process_instance_id", processInstanceId);
            m.put("organization_id", organizationId);
            m.put("definition_key", definitionKey);
            m.put("business_key", businessKey);
            m.put("current_step_id", currentStepId);
            m.put("current_step_name", currentStepName);
            m.put("candidate_group", candidateGroup);
            m.put("status", status);
            m.put("history", history);
            m.put("updated_at", updatedAt);
            return m;
        }
    }

    private final Map<String, Object> definitions;
    private final Map<String, BpmnProcessInstance> instances = new LinkedHashMap<>();

    public BpmnWorkflowEngine(File bpmnDir) {
        this.definitions = loadBpmnDefinitions(bpmnDir);
    }

    public synchronized void clearInstances() {
        instances.clear();
    }

    public Map<String, Object> getDefinitions() {
        return definitions;
    }

    private static Map<String, Object> loadBpmnDefinitions(File bpmnDir) {
        Map<String, Object> defs = new LinkedHashMap<>();
        Map<String, File> files = new LinkedHashMap<>();
        files.put("service_request", new File(bpmnDir, "service_request.bpmn20.xml"));
        files.put("incident_replan", new File(bpmnDir, "incident_replan.bpmn20.xml"));

        try {
            DocumentBuilderFactory factory = DocumentBuilderFactory.newInstance();
            factory.setNamespaceAware(true);

            for (var entry : files.entrySet()) {
                String key = entry.getKey();
                File f = entry.getValue();
                if (!f.exists()) continue;

                Document doc = factory.newDocumentBuilder().parse(f);
                NodeList processes = doc.getElementsByTagNameNS("http://www.omg.org/spec/BPMN/20100524/MODEL", "process");
                if (processes.getLength() == 0) continue;

                Element proc = (Element) processes.item(0);
                List<Map<String, Object>> steps = new ArrayList<>();
                NodeList children = proc.getChildNodes();
                for (int i = 0; i < children.getLength(); i++) {
                    Node node = children.item(i);
                    if (node instanceof Element elem) {
                        String localName = elem.getLocalName();
                        if (Set.of("startEvent", "userTask", "serviceTask", "endEvent").contains(localName)) {
                            Map<String, Object> step = new LinkedHashMap<>();
                            step.put("id", elem.getAttribute("id"));
                            step.put("name", elem.getAttribute("name"));
                            step.put("type", localName);
                            String cand = elem.getAttributeNS(FLOWABLE_NS, "candidateGroups");
                            step.put("candidateGroups", (cand == null || cand.isBlank()) ? "SYSTEM" : cand);
                            steps.add(step);
                        }
                    }
                }

                Map<String, Object> procMap = new LinkedHashMap<>();
                procMap.put("process_id", proc.getAttribute("id"));
                procMap.put("name", proc.getAttribute("name"));
                procMap.put("steps", steps);
                defs.put(key, procMap);
            }
        } catch (Exception e) {
            throw new IllegalStateException("Failed to parse BPMN 2.0 XML files", e);
        }
        return defs;
    }

    public static Map<String, Object> makeStepHistory(String stepId, String name, String actor, String role, String ts) {
        Map<String, Object> h = new LinkedHashMap<>();
        h.put("step", stepId);
        h.put("name", name);
        h.put("actor", actor);
        h.put("role", role);
        h.put("ts", ts);
        return h;
    }

    public synchronized void startInstance(
            String processInstanceId,
            String orgId,
            String definitionKey,
            String businessKey,
            String currentStepId,
            String currentStepName,
            String candidateGroup,
            List<Map<String, Object>> initialHistory,
            String ts
    ) {
        instances.put(processInstanceId, new BpmnProcessInstance(
                processInstanceId, orgId, definitionKey, businessKey,
                currentStepId, currentStepName, candidateGroup, "ACTIVE", initialHistory, ts
        ));
    }

    public synchronized void advanceInstance(
            String processInstanceId,
            Map<String, Object> completedStep,
            String nextStepId,
            String nextStepName,
            String nextCandidateGroup,
            String ts
    ) {
        BpmnProcessInstance inst = instances.get(processInstanceId);
        if (inst != null) {
            inst.history.add(completedStep);
            inst.currentStepId = nextStepId;
            inst.currentStepName = nextStepName;
            inst.candidateGroup = nextCandidateGroup;
            inst.updatedAt = ts;
        }
    }

    public synchronized void completeActiveTenantInstances(String orgId, String endStepId, String endStepName, String ts) {
        for (BpmnProcessInstance inst : instances.values()) {
            if (inst.organizationId.equals(orgId) && "ACTIVE".equals(inst.status)) {
                inst.currentStepId = endStepId;
                inst.currentStepName = endStepName;
                inst.candidateGroup = "COMPLETED";
                inst.status = "COMPLETED";
                inst.updatedAt = ts;
            }
        }
    }

    public synchronized List<Map<String, Object>> listByTenant(String orgId) {
        List<Map<String, Object>> list = new ArrayList<>();
        List<BpmnProcessInstance> all = new ArrayList<>(instances.values());
        for (int i = all.size() - 1; i >= 0; i--) {
            if (all.get(i).organizationId.equals(orgId)) {
                list.add(all.get(i).toMap());
            }
        }
        return list;
    }
}
