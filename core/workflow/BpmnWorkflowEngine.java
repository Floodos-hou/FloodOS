// SPDX-License-Identifier: Apache-2.0

// Copyright 2026 OpenAgriOS Contributors



package org.openagrios.core.workflow;



import org.openagrios.core.dataservices.JsonCodec;

import org.w3c.dom.Document;

import org.w3c.dom.Element;

import org.w3c.dom.Node;

import org.w3c.dom.NodeList;



import javax.xml.parsers.DocumentBuilderFactory;

import java.io.ByteArrayOutputStream;
import java.io.File;

import java.net.URI;

import java.net.http.HttpClient;

import java.net.http.HttpRequest;

import java.net.http.HttpResponse;

import java.nio.charset.StandardCharsets;
import java.nio.file.Files;

import java.time.Duration;

import java.util.*;



/**

 * OMG BPMN 2.0 XML Parser and Workflow Process Execution Engine.

 * Supports dual-mode execution:

 * 1. FLOWABLE_REST_ENGINE_V7: Calls live Flowable REST Engine (:8080) via REST API

 *    when Docker Compose infrastructure is active.

 * 2. EMBEDDED_W3C_DOM_BPMN_ENGINE: Standalone in-process execution parsing standard

 *    BPMN 2.0 XML via W3C DOM without external container dependencies.

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

        public String engineRuntime;

        public String flowableInstanceId;



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

                String updatedAt,

                String engineRuntime,

                String flowableInstanceId

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

            this.engineRuntime = engineRuntime;

            this.flowableInstanceId = flowableInstanceId;

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

            m.put("engine_runtime", engineRuntime);

            if (flowableInstanceId != null) {

                m.put("flowable_instance_id", flowableInstanceId);

            }

            return m;

        }

    }



    private final File bpmnDir;
    private final String flowableRestUrl;
    private final String flowableUser;
    private final String flowablePassword;

    private final HttpClient httpClient;

    private final Map<String, Object> definitions;
    private final Map<String, File> bpmnFiles = new LinkedHashMap<>();
    private final Set<String> deployedDefinitions = Collections.synchronizedSet(new HashSet<>());

    private final Map<String, BpmnProcessInstance> instances = new LinkedHashMap<>();



    public BpmnWorkflowEngine(File bpmnDir) {

        this(bpmnDir, resolveFlowableUrl());

    }



    private static String resolveFlowableUrl() {

        String env = System.getenv("FLOWABLE_REST_URL");

        if (env == null || env.isBlank()) {

            env = System.getenv("FLOWABLE_ENDPOINT");

        }

        if (env != null && !env.isBlank()) {

            return env;

        }

        return "http://localhost:8081/flowable-rest";

    }



        public BpmnWorkflowEngine(File bpmnDir, String flowableRestUrl) {
        this(
                bpmnDir,
                flowableRestUrl,
                System.getenv().getOrDefault("FLOWABLE_REST_USER", "rest-admin"),
                System.getenv().getOrDefault("FLOWABLE_REST_PASSWORD", "test")
        );
    }

    public BpmnWorkflowEngine(File bpmnDir, String flowableRestUrl, String flowableUser, String flowablePassword) {
        this.bpmnDir = bpmnDir;
        this.flowableRestUrl = flowableRestUrl != null ? flowableRestUrl.replaceAll("/+$", "") : "http://localhost:8081/flowable-rest";
        this.flowableUser = (flowableUser != null && !flowableUser.isBlank()) ? flowableUser : "rest-admin";
        this.flowablePassword = (flowablePassword != null && !flowablePassword.isBlank()) ? flowablePassword : "test";
        this.httpClient = HttpClient.newBuilder()
                .connectTimeout(Duration.ofSeconds(5))
                .build();
        this.definitions = loadBpmnDefinitions(bpmnDir);
    }



    public String getFlowableRestUrl() {

        return flowableRestUrl;

    }



    public synchronized void clearInstances() {

        instances.clear();

    }



    public Map<String, Object> getDefinitions() {

        return definitions;

    }



    private Map<String, Object> loadBpmnDefinitions(File bpmnDir) {

        Map<String, Object> defs = new LinkedHashMap<>();
        if (bpmnDir == null) return defs;

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

                bpmnFiles.put(key, f);

                Document doc = factory.newDocumentBuilder().parse(f);

                NodeList processes = doc.getElementsByTagNameNS("http://www.omg.org/spec/BPMN/20100524/MODEL", "process");

                if (processes.getLength() == 0) continue;



                Element proc = (Element) processes.item(0);
                String procId = proc.getAttribute("id");
                if (procId != null && !procId.isBlank()) {
                    bpmnFiles.put(procId, f);
                }

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

                procMap.put("process_id", procId);

                procMap.put("name", proc.getAttribute("name"));

                procMap.put("steps", steps);

                defs.put(key, procMap);
                if (procId != null && !procId.isBlank() && !defs.containsKey(procId)) {
                    defs.put(procId, procMap);
                }

            }

        } catch (Exception e) {

            throw new IllegalStateException("Failed to parse BPMN 2.0 XML files", e);

        }

        return defs;

    }

    /**
     * Auto-deploys a BPMN 2.0 definition XML to Flowable REST API v7.0.0
     * using standard multipart/form-data POST /service/repository/deployments.
     */
    public synchronized boolean deployProcessDefinition(String definitionKey) {
        if (deployedDefinitions.contains(definitionKey)) {
            return true;
        }
        File f = bpmnFiles.get(definitionKey);
        if (f == null || !f.exists()) {
            return false;
        }
        try {
            String deployUrl = flowableRestUrl + "/service/repository/deployments";
            String creds = flowableUser + ":" + flowablePassword;
            String basicAuth = "Basic " + Base64.getEncoder().encodeToString(creds.getBytes(StandardCharsets.UTF_8));
            String boundary = "----OpenAgriOsBpmnBoundary" + System.currentTimeMillis();
            byte[] fileBytes = Files.readAllBytes(f.toPath());

            ByteArrayOutputStream baos = new ByteArrayOutputStream();
            String header = "--" + boundary + "\r\n"
                    + "Content-Disposition: form-data; name=\"file\"; filename=\"" + f.getName() + "\"\r\n"
                    + "Content-Type: text/xml\r\n\r\n";
            String footer = "\r\n--" + boundary + "--\r\n";
            baos.write(header.getBytes(StandardCharsets.UTF_8));
            baos.write(fileBytes);
            baos.write(footer.getBytes(StandardCharsets.UTF_8));

            HttpRequest deployReq = HttpRequest.newBuilder()
                    .uri(URI.create(deployUrl))
                    .timeout(Duration.ofSeconds(10))
                    .header("Authorization", basicAuth)
                    .header("Content-Type", "multipart/form-data; boundary=" + boundary)
                    .POST(HttpRequest.BodyPublishers.ofByteArray(baos.toByteArray()))
                    .build();

            HttpResponse<String> deployResp = httpClient.send(deployReq, HttpResponse.BodyHandlers.ofString());
            if (deployResp.statusCode() == 200 || deployResp.statusCode() == 201) {
                deployedDefinitions.add(definitionKey);
                deployedDefinitions.add(f.getName());
                return true;
            }
        } catch (Exception e) {
            // Container offline or starting up
        }
        return false;
    }

    private HttpResponse<String> sendFlowableRequestWithRetry(HttpRequest req, boolean isProduction) throws Exception {
        int maxAttempts = isProduction ? 6 : 1;
        Exception lastException = null;
        for (int attempt = 1; attempt <= maxAttempts; attempt++) {
            try {
                return httpClient.send(req, HttpResponse.BodyHandlers.ofString());
            } catch (Exception e) {
                lastException = e;
                if (attempt < maxAttempts) {
                    try {
                        Thread.sleep(2000);
                    } catch (InterruptedException ie) {
                        Thread.currentThread().interrupt();
                        break;
                    }
                }
            }
        }
        throw lastException;
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

        String runtimeMode = "EMBEDDED_W3C_DOM_BPMN_ENGINE (Flowable REST offline)";

        String flowableId = null;



                String workflowMode = System.getenv().getOrDefault("OPENAGRIOS_WORKFLOW_MODE",
                "KEYCLOAK_PRODUCTION".equalsIgnoreCase(System.getenv("OPENAGRIOS_AUTH_MODE"))
                        ? "FLOWABLE_PRODUCTION"
                        : "EMBEDDED_DEV_MOCK");

        boolean isProduction = "FLOWABLE_PRODUCTION".equalsIgnoreCase(workflowMode);

        // Attempt live call to Flowable REST API v7.0.0
        try {
            // Auto-deploy BPMN XML to Flowable repository if not yet registered
            if (!deployedDefinitions.contains(definitionKey)) {
                deployProcessDefinition(definitionKey);
            }

            String url = flowableRestUrl + "/service/runtime/process-instances";
            String creds = flowableUser + ":" + flowablePassword;
            String basicAuth = "Basic " + Base64.getEncoder().encodeToString(creds.getBytes(StandardCharsets.UTF_8));

            String jsonPayload = String.format(

                    "{\"processDefinitionKey\":\"%s\",\"businessKey\":\"%s\"}",

                    definitionKey, businessKey

            );

            HttpRequest req = HttpRequest.newBuilder()

                    .uri(URI.create(url))

                    .timeout(Duration.ofSeconds(10))

                    .header("Authorization", basicAuth)

                    .header("Content-Type", "application/json")

                    .POST(HttpRequest.BodyPublishers.ofString(jsonPayload))

                    .build();



            HttpResponse<String> resp = sendFlowableRequestWithRetry(req, isProduction);
            if (resp.statusCode() == 200 || resp.statusCode() == 201) {
                Map<String, Object> resMap = JsonCodec.parseObject(resp.body());
                flowableId = String.valueOf(resMap.getOrDefault("id", "flowable-" + processInstanceId));
                runtimeMode = "FLOWABLE_REST_ENGINE_V7 (Live Container)";
            } else if (resp.statusCode() == 400 && resp.body().contains("No process definition found")) {
                // If definition was not found, deploy and retry once
                if (deployProcessDefinition(definitionKey)) {
                    HttpResponse<String> retryResp = httpClient.send(req, HttpResponse.BodyHandlers.ofString());
                    if (retryResp.statusCode() == 200 || retryResp.statusCode() == 201) {
                        Map<String, Object> resMap = JsonCodec.parseObject(retryResp.body());
                        flowableId = String.valueOf(resMap.getOrDefault("id", "flowable-" + processInstanceId));
                        runtimeMode = "FLOWABLE_REST_ENGINE_V7 (Live Container)";
                    } else if (isProduction) {
                        throw new IllegalStateException("FLOWABLE_PRODUCTION error: Flowable REST API responded with HTTP "
                                + retryResp.statusCode() + " at " + url + ": " + retryResp.body() + ". Silent fallback to mock is prohibited in production.");
                    }
                } else if (isProduction) {
                    throw new IllegalStateException("FLOWABLE_PRODUCTION error: Flowable REST API responded with HTTP "
                            + resp.statusCode() + " at " + url + ": " + resp.body() + ". Silent fallback to mock is prohibited in production.");
                }
            } else if (isProduction) {
                throw new IllegalStateException("FLOWABLE_PRODUCTION error: Flowable REST API responded with HTTP "
                        + resp.statusCode() + " at " + url + ": " + resp.body() + ". Silent fallback to mock is prohibited in production.");
            }
        } catch (Exception e) {
            if (isProduction) {
                throw new IllegalStateException("FLOWABLE_PRODUCTION connection failure to Flowable REST at "
                        + flowableRestUrl + ": " + e.getMessage() + ". Silent fallback to mock is prohibited in production.", e);
            }
            // Standalone development/testing mode: smoothly executes embedded W3C DOM BPMN 2.0 parser & state machine
            runtimeMode = "EMBEDDED_W3C_DOM_BPMN_ENGINE (Flowable REST offline)";
        }



        instances.put(processInstanceId, new BpmnProcessInstance(

                processInstanceId, orgId, definitionKey, businessKey,

                currentStepId, currentStepName, candidateGroup, "ACTIVE", initialHistory, ts,

                runtimeMode, flowableId

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

