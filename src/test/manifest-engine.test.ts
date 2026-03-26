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
          ...(rawManifest as any).entries[0],
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
          ...(rawManifest as any).entries[0],
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
          ...(rawManifest as any).entries[0],
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
