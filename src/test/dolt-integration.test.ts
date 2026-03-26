import { describe, it, expect, beforeEach } from "vitest";
import { DoltClient, DoltResource } from "../../supabase/functions/uidi-engine/dolt-client";

describe("Dolt State Layer (ADR-003)", () => {
  let dolt: DoltClient;

  beforeEach(() => {
    dolt = new DoltClient();
  });

  it("should initialize with an empty commit", () => {
    expect(dolt.getHistory()).toHaveLength(1);
    expect(dolt.getLatestHash()).toBeDefined();
  });

  it("should write a resource and create a new commit", async () => {
    const initialHash = dolt.getLatestHash();
    const resource: DoltResource = {
      resource_id: "vpc-123",
      resource_type: "vpc",
      provider: "aws",
      region: "us-east-1",
      intent_hash: "hash-abc",
      ztai_record_index: "ztai-001",
      observed_at: new Date().toISOString(),
      manifest_version: "0",
      state_json: { VpcId: "vpc-123", CidrBlock: "10.0.0.0/16" },
    };

    const commitHash = await dolt.writeResource(resource, "Create VPC");
    
    expect(commitHash).not.toBe(initialHash);
    expect(dolt.getHistory()).toHaveLength(2);
    
    const queried = await dolt.queryResource("vpc-123");
    expect(queried).toEqual(resource);
  });

  it("should produce an accurate diff between commits", async () => {
    const hash0 = dolt.getLatestHash();
    
    // Commit 1: Create VPC
    const res1: DoltResource = {
      resource_id: "vpc-123",
      resource_type: "vpc",
      provider: "aws",
      region: "us-east-1",
      intent_hash: "h1",
      ztai_record_index: "z1",
      observed_at: new Date().toISOString(),
      manifest_version: "0",
      state_json: { VpcId: "vpc-123", Tags: [{ Key: "Env", Value: "dev" }] },
    };
    const hash1 = await dolt.writeResource(res1, "Create VPC");

    // Commit 2: Update Tags
    const res2: DoltResource = {
      ...res1,
      state_json: { VpcId: "vpc-123", Tags: [{ Key: "Env", Value: "prod" }] },
      ztai_record_index: "z2",
    };
    const hash2 = await dolt.writeResource(res2, "Update Tags");

    const diffs = await dolt.diff(hash1, hash2);
    expect(diffs).toHaveLength(1);
    expect(diffs[0].resource_id).toBe("vpc-123");
    expect(diffs[0].old_state.Tags[0].Value).toBe("dev");
    expect(diffs[0].new_state.Tags[0].Value).toBe("prod");
  });

  it("writeResource accepts a DoltResource with manifest_version", async () => {
    const resource: DoltResource = {
      resource_id: "test-vpc-001",
      resource_type: "VPC",
      provider: "aws",
      region: "us-east-1",
      intent_hash: "abc123",
      ztai_record_index: "ztai-001",
      observed_at: new Date().toISOString(),
      manifest_version: "1",
      state_json: { cidrBlock: "10.0.0.0/16" },
    };
    const hash = await dolt.writeResource(resource, "test commit");
    expect(typeof hash).toBe("string");
    expect(hash.length).toBeGreaterThan(0);
  });

  it("writeResource with manifest_version '0' represents pre-manifest rows", async () => {
    const resource: DoltResource = {
      resource_id: "legacy-vpc-001",
      resource_type: "VPC",
      provider: "aws",
      region: "us-east-1",
      intent_hash: "def456",
      ztai_record_index: "ztai-002",
      observed_at: new Date().toISOString(),
      manifest_version: "0",
      state_json: { cidrBlock: "10.0.0.0/16" },
    };
    await dolt.writeResource(resource, "legacy commit");
    const stored = await dolt.queryResource("legacy-vpc-001");
    expect(stored?.manifest_version).toBe("0");
  });
});
