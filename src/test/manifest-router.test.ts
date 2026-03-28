import { describe, it, expect, test } from "vitest";
import { ManifestError } from "../../supabase/functions/uidi-engine/manifest-types";
import * as engine from "../../supabase/functions/uidi-engine/manifest-engine";
// buildRestRequest is exported from manifest-engine.ts (added in Task 5)
import { buildRestRequest, prepareOperation } from "../../supabase/functions/uidi-engine/manifest-engine";
import rawManifest from "../../supabase/functions/uidi-engine/manifest.json";

const MANIFEST = rawManifest as { version: string; entries: Array<{ intent: string; action: string; provider: string; [key: string]: unknown }> };

describe("manifest dispatch — integration (all 9 intents)", () => {
  it("prepareOperation returns rest-proxy entry for network/deploy/aws", () => {
    const op = engine.prepareOperation("network", "deploy", "aws", { region: "us-east-1" });
    expect(op).not.toBeInstanceOf(ManifestError);
    expect((op as any).entry.execution.type).toBe("rest-proxy");
  });

  it("prepareOperation returns ssm-ansible entry for ansible/deploy/naawi-internal", () => {
    const op = engine.prepareOperation("ansible", "deploy", "naawi-internal", { target_host: "10.0.0.1" });
    expect(op).not.toBeInstanceOf(ManifestError);
    expect((op as any).entry.execution.type).toBe("ssm-ansible");
  });

  it("prepareOperation returns k8s-api entry for k8s/deploy/naawi-internal (Deployment guardrails)", () => {
    const op = engine.prepareOperation("k8s", "deploy", "naawi-internal", { namespace: "default", deploymentName: "api", image: "nginx:latest" });
    expect(op).not.toBeInstanceOf(ManifestError);
    expect((op as any).entry.execution.type).toBe("k8s-api");
    expect((op as any).resolved_spec["topologySpreadConstraints"]).toBeDefined();
    expect((op as any).resolved_spec["securityContext"]).toMatchObject({ runAsNonRoot: true });
  });

  it("prepareOperation returns agent-coordinator for sre-supreme/deploy/naawi-internal", () => {
    const op = engine.prepareOperation("sre-supreme", "deploy", "naawi-internal", {});
    expect(op).not.toBeInstanceOf(ManifestError);
    expect((op as any).entry.execution.type).toBe("agent-coordinator");
  });

  it("prepareOperation returns state-manager for dolt/deploy/naawi-internal", () => {
    const op = engine.prepareOperation("dolt", "deploy", "naawi-internal", { resource_id: "res-001" });
    expect(op).not.toBeInstanceOf(ManifestError);
    expect((op as any).entry.execution.type).toBe("state-manager");
  });

  it("prepareOperation returns internal-query for inventory/discover/aws", () => {
    const op = engine.prepareOperation("inventory", "discover", "aws", {});
    expect(op).not.toBeInstanceOf(ManifestError);
    expect((op as any).entry.execution.type).toBe("internal-query");
  });

  it("prepareOperation returns meta-reconcile for reconcile/deploy/naawi-internal", () => {
    const op = engine.prepareOperation("reconcile", "deploy", "naawi-internal", {});
    expect(op).not.toBeInstanceOf(ManifestError);
    expect((op as any).entry.execution.type).toBe("meta-reconcile");
  });

  it("NOT_FOUND for eks (legacy — should use k8s after normalizeIntent)", () => {
    const op = engine.prepareOperation("eks", "deploy", "aws", { region: "us-east-1" });
    expect(op).toBeInstanceOf(ManifestError);
    expect((op as any).code).toBe("NOT_FOUND");
  });

  it("all 9 intents have at least one manifest entry", () => {
    const intents = ["network", "compute", "k8s", "ansible", "reconcile", "inventory", "sre-supreme", "naawi", "dolt"];
    for (const intent of intents) {
      const providers = ["aws", "naawi-internal"];
      const actions = ["discover", "deploy"];
      let found = false;
      for (const provider of providers) {
        for (const action of actions) {
          const op = engine.prepareOperation(intent, action, provider, { region: "us-east-1" });
          if (!(op instanceof ManifestError)) { found = true; break; }
        }
        if (found) break;
      }
      expect(found, `Intent "${intent}" has no manifest entry`).toBe(true);
    }
  });
});

describe("buildRestRequest — template resolution", () => {
  it("resolves {{placeholders}} in url_template for network/deploy/aws", () => {
    const op = engine.prepareOperation("network", "deploy", "aws", { region: "us-east-1" }) as any;
    const req = buildRestRequest(op);
    expect(req).not.toBeInstanceOf(ManifestError);
    expect((req as any).url).toContain("us-east-1");
    expect((req as any).url).not.toContain("{{");
  });

  it("returns ManifestError UNRESOLVED_PLACEHOLDER when spec is missing required placeholder", () => {
    const op = engine.prepareOperation("network", "deploy", "aws", { region: "us-east-1" }) as any;
    const badOp = { ...op, resolved_spec: {} }; // strip resolved_spec to simulate unresolved
    const req = buildRestRequest(badOp);
    expect(req).toBeInstanceOf(ManifestError);
    expect((req as any).code).toBe("UNRESOLVED_PLACEHOLDER");
  });

  it("resolves boolean inject value isIpv6Enabled:false into body_template", () => {
    const op = engine.prepareOperation("network", "deploy", "oci", { region: "us-ashburn-1", compartmentId: "ocid1.test" }) as any;
    const req = buildRestRequest(op);
    expect(req).not.toBeInstanceOf(ManifestError);
    expect((req as any).body).toContain('"isIpv6Enabled":false');
  });

  it("returns null body for GET requests with no body_template", () => {
    const op = engine.prepareOperation("network", "discover", "aws", { region: "us-east-1" }) as any;
    const req = buildRestRequest(op);
    expect(req).not.toBeInstanceOf(ManifestError);
    expect((req as any).body).toBeNull();
  });
});

test("all 14 new intents have at least one manifest entry", () => {
  const newIntents = [
    "storage", "database", "serverless", "cdn", "dns", "loadbalancer",
    "security", "gateway", "secrets", "observability", "orchestration",
    "ai", "container", "gap-analysis",
  ];
  for (const intent of newIntents) {
    const entry = MANIFEST.entries.find(e => e.intent === intent);
    expect(entry, `Intent "${intent}" must have at least one manifest entry`).toBeDefined();
  }
});

test("storage/deploy/aws entry resolves with required bucketName", () => {
  const op = prepareOperation("storage", "deploy", "aws", { region: "us-east-1", bucketName: "test-bucket" });
  expect(op).not.toBeInstanceOf(ManifestError);
});

test("gap-analysis/discover/aws entry requires region", () => {
  const missing = prepareOperation("gap-analysis", "discover", "aws", {});
  expect(missing).toBeInstanceOf(ManifestError);
  expect((missing as ManifestError).code).toBe("MISSING_REQUIRED_KEY");
});
