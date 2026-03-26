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

  it("rejects a manifest with an unknown provider", () => {
    const bad = {
      ...rawManifest,
      entries: [
        {
          ...(rawManifest.entries as any[])[0],
          provider: "alibaba",
        },
      ],
    };
    expect(ManifestSchema.safeParse(bad).success).toBe(false);
  });

  it("rejects a manifest entry with AWS_SIGV4 strategy but no service", () => {
    const bad = {
      ...rawManifest,
      entries: [
        {
          ...(rawManifest.entries as any[])[0],
          provider: "aws",
          signing: {
            strategy: "AWS_SIGV4",
            signed_headers: ["host", "x-amz-date"],
            region_required: true,
            // service intentionally omitted
          },
        },
      ],
    };
    expect(ManifestSchema.safeParse(bad).success).toBe(false);
  });

  it("rejects an entry with an unknown action", () => {
    const bad = {
      ...rawManifest,
      entries: [
        {
          ...(rawManifest.entries as any[])[0],
          action: "create", // not in the action enum
        },
      ],
    };
    expect(ManifestSchema.safeParse(bad).success).toBe(false);
  });

  it("rejects a manifest with zero entries", () => {
    const bad = { ...rawManifest, entries: [] };
    expect(ManifestSchema.safeParse(bad).success).toBe(false);
  });
});

// ── Lazy import so tests can control what manifest-engine sees ───────────────
// (engine is not created yet; these tests will fail until Step 3.3)

import { describe as describeEngine, it as itEngine, expect as expectEngine, beforeEach } from "vitest";

describeEngine("manifest-engine — unit tests", () => {
  // We import dynamically so TypeScript doesn't error before the file exists.
  // Replace with a static import once manifest-engine.ts is created.
  let engine: typeof import("../../supabase/functions/uidi-engine/manifest-engine");

  beforeEach(async () => {
    engine = await import("../../supabase/functions/uidi-engine/manifest-engine");
  });

  itEngine("lookup — returns entry for valid (intent, action, provider) triple", () => {
    const result = engine.lookup("network", "deploy", "aws");
    expectEngine(result).not.toBeInstanceOf(Error);
    const entry = result as any;
    expectEngine(entry.intent).toBe("network");
    expectEngine(entry.action).toBe("deploy");
    expectEngine(entry.provider).toBe("aws");
  });

  itEngine("lookup — returns ManifestError NOT_FOUND for missing triple", () => {
    const result = engine.lookup("network", "status", "aws");
    expectEngine(result).toBeInstanceOf(Error);
    expectEngine((result as any).code).toBe("NOT_FOUND");
  });

  itEngine("enforce — fills defaults into userSpec when key is absent", () => {
    const entry = engine.lookup("compute", "deploy", "aws") as any;
    const spec = { region: "us-east-1", imageId: "ami-123", subnetId: "subnet-abc" };
    const filled = engine.enforce(spec, entry);
    expectEngine(filled["instanceType"]).toBe("t3.micro");
    expectEngine(filled["region"]).toBe("us-east-1"); // existing keys preserved
  });

  itEngine("enforce — throws ManifestError MISSING_REQUIRED_KEY when required key absent", () => {
    const entry = engine.lookup("network", "deploy", "aws") as any;
    const spec = {}; // missing required 'region'
    const result = engine.enforce(spec, entry);
    expectEngine(result).toBeInstanceOf(Error);
    expectEngine((result as any).code).toBe("MISSING_REQUIRED_KEY");
  });

  itEngine("hydrate — resolves {placeholder} tokens in url_template", () => {
    const entry = engine.lookup("network", "deploy", "aws") as any;
    const resolvedSpec = { region: "us-east-1", cidrBlock: "10.0.0.0/16" };
    const prepared = engine.hydrate(entry, resolvedSpec) as any;
    expectEngine(prepared.url).toContain("us-east-1");
    expectEngine(prepared.url).not.toContain("{region}");
  });

  itEngine("hydrate — inject overwrites user-provided value (cidrBlock forced to '10.0.0.0/16')", () => {
    const entry = engine.lookup("network", "deploy", "aws") as any;
    const resolvedSpec = { region: "us-east-1", cidrBlock: "192.168.0.0/16" }; // user tries different CIDR
    const prepared = engine.hydrate(entry, resolvedSpec) as any;
    // The inject enforcement.inject.cidrBlock = "10.0.0.0/16" must win
    expectEngine(prepared.url).toContain("10.0.0.0"); // inject value wins, not user value
  });

  itEngine("hydrate — inject adds isIpv6Enabled:false to OCI network deploy", () => {
    const entry = engine.lookup("network", "deploy", "oci") as any;
    const resolvedSpec = { region: "us-ashburn-1", compartmentId: "ocid1.compartment.abc" };
    const prepared = engine.hydrate(entry, resolvedSpec) as any;
    expectEngine(prepared.body).not.toBeNull();
    const body = JSON.parse(prepared.body!);
    expectEngine(body.isIpv6Enabled).toBe(false);
  });

  itEngine("hydrate — body is null for GET requests", () => {
    const entry = engine.lookup("network", "discover", "aws") as any;
    const resolvedSpec = { region: "us-east-1" };
    const prepared = engine.hydrate(entry, resolvedSpec) as any;
    expectEngine(prepared.body).toBeNull();
  });

  itEngine("hydrate — throws ManifestError UNRESOLVED_PLACEHOLDER when placeholder not in spec", () => {
    const entry = engine.lookup("network", "deploy", "gcp") as any;
    const resolvedSpec = {}; // missing required placeholders
    const result = engine.hydrate(entry, resolvedSpec);
    expectEngine(result).toBeInstanceOf(Error);
    expectEngine((result as any).code).toBe("UNRESOLVED_PLACEHOLDER");
  });

  itEngine("hydrate — manifest_version is carried through from manifest", () => {
    const entry = engine.lookup("network", "deploy", "aws") as any;
    const resolvedSpec = { region: "us-east-1", cidrBlock: "10.0.0.0/16" };
    const prepared = engine.hydrate(entry, resolvedSpec);
    expectEngine((prepared as any).manifest_version).toBe("1");
  });

  itEngine("prepareRequest — end-to-end: network/deploy/aws returns PreparedRequest", () => {
    const result = engine.prepareRequest("network", "deploy", "aws", {
      region: "us-west-2",
    });
    expectEngine(result).not.toBeInstanceOf(Error);
    const prepared = result as any;
    expectEngine(prepared.method).toBe("POST");
    expectEngine(prepared.url).toContain("us-west-2");
    expectEngine(prepared.signing.strategy).toBe("AWS_SIGV4");
    expectEngine(prepared.manifest_version).toBe("1");
  });
});
