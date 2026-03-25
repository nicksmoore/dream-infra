// eval-engine/dolt-client.ts
// Mock Dolt client for eval-engine — owns TestReport writes.
// Mirrors the pattern from supabase/functions/uidi-engine/dolt-client.ts.

import type { EvalResult } from "./prompts.ts";

export interface TestReport {
  runId: string;
  timestamp: string;
  goldenPathResults: Array<{ templateId: string; result: EvalResult }>;
  nlResults: Array<{ probe: string; result: EvalResult }>;
  summary: {
    goldenPathPassRate: number;          // status=passed / 18 (eval_error counts as failure)
    goldenPathEvalErrors: number;        // count of golden path results with status=eval_error
    nlPassRate: number;                  // status=passed / 5 (eval_error counts as failure)
    nlClassificationAccuracy: number | null; // true classifications / (5 - nlEvalErrors); null if all errored
    nlEvalErrors: number;               // count of NL results with status=eval_error
  };
}

interface EvalCommit {
  hash: string;
  timestamp: string;
  message: string;
  reports: Map<string, TestReport>;
}

export class EvalDoltClient {
  private history: EvalCommit[] = [];
  private currentReports: Map<string, TestReport> = new Map();

  constructor() {
    this.commit("Initial empty state");
  }

  async writeTestReport(report: TestReport, commitMessage: string): Promise<string> {
    this.currentReports.set(report.runId, { ...report });
    return this.commit(commitMessage);
  }

  async getTestReport(runId: string): Promise<TestReport | null> {
    return this.currentReports.get(runId) ?? null;
  }

  getLatestHash(): string {
    return this.history[this.history.length - 1].hash;
  }

  getHistory(): EvalCommit[] {
    return this.history;
  }

  private commit(message: string): string {
    const hash = Math.random().toString(36).substring(2, 15);
    this.history.push({
      hash,
      timestamp: new Date().toISOString(),
      message,
      reports: new Map(this.currentReports),
    });
    console.log(`[EvalDolt] Committed: ${hash} - ${message}`);
    return hash;
  }
}

export const evalDolt = new EvalDoltClient();
