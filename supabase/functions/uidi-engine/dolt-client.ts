/**
 * Project Naawi — Dolt State Layer (Mock)
 * ADR-003: Versioned infrastructure state using Dolt logic.
 * 
 * This client simulates a Dolt database where every successful SDK execution
 * produces a versioned commit of the resource state.
 */

export interface DoltResource {
  resource_id: string;      // Primary Key
  resource_type: string;
  provider: "aws" | "gcp" | "azure";
  region: string;
  intent_hash: string;      // SHA-256 of the intent
  ztai_record_index: string; // Link to audit log
  observed_at: string;      // Roughtime timestamp
  state_json: Record<string, any>;
}

export interface DoltCommit {
  hash: string;
  timestamp: string;
  message: string;
  resources: Map<string, DoltResource>;
}

export class DoltClient {
  private history: DoltCommit[] = [];
  private currentResources: Map<string, DoltResource> = new Map();

  constructor() {
    // Initial empty commit
    this.commit("Initial empty state");
  }

  /**
   * Writes/Updates a resource and creates a Dolt commit.
   * Atomic with ZTAI POST_EXECUTION.
   */
  async writeResource(resource: DoltResource, commitMessage: string): Promise<string> {
    // Simulate row-level versioning
    this.currentResources.set(resource.resource_id, { ...resource });
    return this.commit(commitMessage);
  }

  /**
   * Creates a new immutable snapshot of the state.
   */
  private commit(message: string): string {
    const hash = Math.random().toString(36).substring(2, 15);
    this.history.push({
      hash,
      timestamp: new Date().toISOString(),
      message,
      resources: new Map(this.currentResources), // Deep copy
    });
    console.log(`[Dolt] Committed state: ${hash} - ${message}`);
    return hash;
  }

  /**
   * Queries the latest state of a resource.
   * Replaces cloud API describe calls for RMCM.
   */
  async queryResource(resourceId: string): Promise<DoltResource | null> {
    return this.currentResources.get(resourceId) || null;
  }

  /**
   * Returns a diff between two commits.
   */
  async diff(fromHash: string, toHash: string): Promise<any[]> {
    const fromCommit = this.history.find(c => c.hash === fromHash);
    const toCommit = this.history.find(c => c.hash === toHash);

    if (!fromCommit || !toCommit) return [];

    const diffs: any[] = [];
    
    // Simple diff logic: find changed or new resources
    toCommit.resources.forEach((res, id) => {
      const oldRes = fromCommit.resources.get(id);
      if (!oldRes || JSON.stringify(oldRes.state_json) !== JSON.stringify(res.state_json)) {
        diffs.push({
          resource_id: id,
          old_state: oldRes?.state_json || null,
          new_state: res.state_json,
          ztai_record: res.ztai_record_index,
        });
      }
    });

    return diffs;
  }

  getLatestHash(): string {
    return this.history[this.history.length - 1].hash;
  }

  getHistory() {
    return this.history;
  }
}

// Singleton instance for the function runtime
export const dolt = new DoltClient();
