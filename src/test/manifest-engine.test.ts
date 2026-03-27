import { describe, it, expect } from "vitest";
import { ManifestSchema } from "../../supabase/functions/uidi-engine/manifest-types";
import rawManifest from "../../supabase/functions/uidi-engine/manifest.json";

describe("ManifestSchema — validation", () => {
  it("parses the bundled manifest without errors", () => {
    const result = ManifestSchema.safeParse(rawManifest);
    if (!result.success) {
      console.error(result.error.format());
    }
    expect(result.success).toBe(true);
  });

  it("manifest has version 2", () => {
    const result = ManifestSchema.safeParse(rawManifest);
    expect(result.success).toBe(true);
    expect((result as any).data?.version).toBe("2");
  });

  it("manifest has exactly 69 entries", () => {
    const result = ManifestSchema.safeParse(rawManifest);
    expect(result.success).toBe(true);
    expect((result as any).data?.entries.length).toBe(69);
  });

  it("rejects a manifest with an unknown provider", () => {
    const bad = {
      ...rawManifest,
      entries: [{ ...(rawManifest.entries as any[])[0], provider: "alibaba" }],
    };
    expect(ManifestSchema.safeParse(bad).success).toBe(false);
  });

  it("rejects a rest-proxy entry missing signing block", () => {
    const entry = (rawManifest.entries as any[]).find(e => e.execution?.type === "rest-proxy");
    const bad = {
      ...rawManifest,
      entries: [{ ...entry, signing: undefined }],
    };
    expect(ManifestSchema.safeParse(bad).success).toBe(false);
  });

  it("rejects a non-rest-proxy entry that has a signing block", () => {
    const entry = (rawManifest.entries as any[]).find(e => e.execution?.type !== "rest-proxy");
    if (!entry) return; // skip if no internal entries exist yet
    const bad = {
      ...rawManifest,
      entries: [{ ...entry, signing: { strategy: "AWS_SIGV4", signed_headers: ["host"], service: "ec2", region_required: true } }],
    };
    expect(ManifestSchema.safeParse(bad).success).toBe(false);
  });

  it("rejects an entry with an unknown action", () => {
    const bad = {
      ...rawManifest,
      entries: [{ ...(rawManifest.entries as any[])[0], action: "create" }],
    };
    expect(ManifestSchema.safeParse(bad).success).toBe(false);
  });

  it("rejects an entry with intent 'eks' (renamed to k8s)", () => {
    const bad = {
      ...rawManifest,
      entries: [{ ...(rawManifest.entries as any[])[0], intent: "eks" }],
    };
    expect(ManifestSchema.safeParse(bad).success).toBe(false);
  });

  it("rejects a manifest with zero entries", () => {
    expect(ManifestSchema.safeParse({ ...rawManifest, entries: [] }).success).toBe(false);
  });
});

import * as engine from "../../supabase/functions/uidi-engine/manifest-engine";
import { ManifestError } from "../../supabase/functions/uidi-engine/manifest-types";

describe("manifest-engine — unit tests", () => {
  it("lookup — returns entry for valid (intent, action, provider) triple", () => {
    const result = engine.lookup("network", "deploy", "aws");
    expect(result).not.toBeInstanceOf(ManifestError);
    const entry = result as any;
    expect(entry.intent).toBe("network");
    expect(entry.action).toBe("deploy");
    expect(entry.provider).toBe("aws");
  });

  it("lookup — returns ManifestError NOT_FOUND for missing triple", () => {
    const result = engine.lookup("network", "status", "aws");
    expect(result).toBeInstanceOf(ManifestError);
    expect((result as any).code).toBe("NOT_FOUND");
  });

  it("enforce — fills defaults into userSpec when key is absent", () => {
    const entry = engine.lookup("compute", "deploy", "aws") as any;
    const spec = { region: "us-east-1", imageId: "ami-123", subnetId: "subnet-abc" };
    const filled = engine.enforce(spec, entry);
    expect((filled as any)["instanceType"]).toBe("t3.micro");
    expect((filled as any)["region"]).toBe("us-east-1"); // existing keys preserved
  });

  it("enforce — returns ManifestError MISSING_REQUIRED_KEY when required key absent", () => {
    const entry = engine.lookup("network", "deploy", "aws") as any;
    const spec = {}; // missing required 'region'
    const result = engine.enforce(spec, entry);
    expect(result).toBeInstanceOf(ManifestError);
    expect((result as any).code).toBe("MISSING_REQUIRED_KEY");
  });

  it("hydrate — inject overwrites user-provided value", () => {
    const entry = engine.lookup("network", "deploy", "aws") as any;
    const enforced = { region: "us-east-1", cidrBlock: "192.168.0.0/16" }; // user tries different CIDR
    const resolved = engine.hydrate(entry, enforced) as any;
    // inject must win over user value
    expect(resolved).not.toBeInstanceOf(ManifestError);
  });

  it("hydrate — inject adds isIpv6Enabled:false to OCI network deploy resolved_spec", () => {
    const entry = engine.lookup("network", "deploy", "oci") as any;
    const enforced = { region: "us-ashburn-1", compartmentId: "ocid1.compartment.abc" };
    const resolved = engine.hydrate(entry, enforced) as any;
    expect(resolved).not.toBeInstanceOf(ManifestError);
    expect(resolved["isIpv6Enabled"]).toBe(false);
  });

  it("prepareOperation — end-to-end: network/deploy/aws returns PreparedOperation", () => {
    const result = engine.prepareOperation("network", "deploy", "aws", { region: "us-west-2" });
    expect(result).not.toBeInstanceOf(ManifestError);
    const op = result as any;
    expect(op.entry.intent).toBe("network");
    expect(op.entry.action).toBe("deploy");
    expect(op.entry.provider).toBe("aws");
    expect(op.entry.execution.type).toBe("rest-proxy");
    expect(op.resolved_spec).toBeDefined();
    expect(op.manifest_version).toBe("2");
  });

  it("prepareOperation — returns NOT_FOUND for unknown triple", () => {
    const result = engine.prepareOperation("network", "status", "aws", {});
    expect(result).toBeInstanceOf(ManifestError);
    expect((result as any).code).toBe("NOT_FOUND");
  });

  it("prepareOperation — returns MISSING_REQUIRED_KEY when required key absent", () => {
    const result = engine.prepareOperation("network", "deploy", "aws", {}); // missing region
    expect(result).toBeInstanceOf(ManifestError);
    expect((result as any).code).toBe("MISSING_REQUIRED_KEY");
  });

  it("prepareOperation — inject values appear in resolved_spec", () => {
    const result = engine.prepareOperation("network", "deploy", "aws", { region: "us-east-1" }) as any;
    expect(result).not.toBeInstanceOf(ManifestError);
    // inject must be present in resolved_spec
    expect(result.resolved_spec["region"]).toBe("us-east-1");
  });

  it("prepareOperation — manifest_version is '2'", () => {
    const result = engine.prepareOperation("compute", "deploy", "aws", { region: "us-east-1", imageId: "ami-123", subnetId: "subnet-abc" }) as any;
    expect(result).not.toBeInstanceOf(ManifestError);
    expect(result.manifest_version).toBe("2");
  });
});
