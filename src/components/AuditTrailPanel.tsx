/**
 * AuditTrailPanel — Chronological chain of dry-runs, approvals, and executions
 * 
 * Every record is TEE-signed and hash-linked. 
 * naawi audit verify checks chain integrity.
 * naawi audit push exports to Rekor transparency log.
 */

import { useState, useMemo } from "react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  Shield, Hash, CheckCircle2, Play, Eye, Upload,
  Fingerprint, Link2, Clock, Terminal, ExternalLink,
} from "lucide-react";

interface AuditRecord {
  id: string;
  type: "dry_run" | "approval" | "execution" | "batch_approved";
  intentId: string;
  timestamp: string;
  actor: string;
  teeSignature: string;
  prevHash: string;
  hash: string;
  status: "verified" | "pending";
  details: string;
}

function generateMockAuditTrail(): AuditRecord[] {
  const now = Date.now();
  const makeHash = () => Array.from(crypto.getRandomValues(new Uint8Array(16)))
    .map(b => b.toString(16).padStart(2, "0")).join("");
  const makeSig = () => Array.from(crypto.getRandomValues(new Uint8Array(32)))
    .map(b => b.toString(16).padStart(2, "0")).join("");

  const records: AuditRecord[] = [];
  let prevHash = "0".repeat(32);

  const entries: Array<{ type: AuditRecord["type"]; intent: string; detail: string; deltaMs: number }> = [
    { type: "dry_run", intent: "naawi.infra.v1.DryRun.ScaleDeployment", detail: "Projected diff: replicas 2→4, +NetworkPolicy, +ServiceMonitor", deltaMs: 0 },
    { type: "approval", intent: "naawi.infra.v1.ScaleDeployment", detail: "Human review verified. Dry-run hash linked.", deltaMs: 12000 },
    { type: "execution", intent: "naawi.infra.v1.ScaleDeployment", detail: "Executed via same closure. Replicas scaled 2→4. Duration: 23s", deltaMs: 45000 },
    { type: "dry_run", intent: "naawi.infra.v1.DryRun.AddCapacity", detail: "Projected: +2 nodes c5.xlarge in us-east-1a", deltaMs: 120000 },
    { type: "dry_run", intent: "naawi.infra.v1.DryRun.ConfigureHPA", detail: "Projected: HPA target CPU 60%, memory 70%", deltaMs: 135000 },
    { type: "batch_approved", intent: "naawi.infra.v1.Batch[AddCapacity,ConfigureHPA]", detail: "Batch approved: 2 steps. Reorder applied (capacity→scale).", deltaMs: 180000 },
    { type: "execution", intent: "naawi.infra.v1.AddCapacity", detail: "2 nodes provisioned. Joined cluster. Duration: 67s", deltaMs: 250000 },
    { type: "execution", intent: "naawi.infra.v1.ConfigureHPA", detail: "HPA attached to deployment. Duration: 4s", deltaMs: 260000 },
  ];

  entries.forEach((e, i) => {
    const hash = makeHash();
    records.push({
      id: `audit-${i}`,
      type: e.type,
      intentId: e.intent,
      timestamp: new Date(now - (entries.length - i) * 60000 + e.deltaMs).toISOString(),
      actor: "engineer@naawi.io",
      teeSignature: makeSig(),
      prevHash,
      hash,
      status: "verified",
      details: e.detail,
    });
    prevHash = hash;
  });

  return records;
}

export function AuditTrailPanel() {
  const records = useMemo(() => generateMockAuditTrail(), []);
  const [chainVerified, setChainVerified] = useState<boolean | null>(null);
  const [isVerifying, setIsVerifying] = useState(false);
  const [isPushing, setIsPushing] = useState(false);

  const verifyChain = async () => {
    setIsVerifying(true);
    await new Promise(r => setTimeout(r, 1500));
    setChainVerified(true);
    setIsVerifying(false);
  };

  const pushToRekor = async () => {
    setIsPushing(true);
    await new Promise(r => setTimeout(r, 2000));
    setIsPushing(false);
  };

  const typeIcon = (type: AuditRecord["type"]) => {
    switch (type) {
      case "dry_run": return <Eye className="h-3.5 w-3.5 text-info" />;
      case "approval": return <CheckCircle2 className="h-3.5 w-3.5 text-success" />;
      case "execution": return <Play className="h-3.5 w-3.5 text-primary" />;
      case "batch_approved": return <Shield className="h-3.5 w-3.5 text-warning" />;
    }
  };

  const typeBadge = (type: AuditRecord["type"]) => {
    const labels: Record<string, string> = {
      dry_run: "DRY-RUN",
      approval: "APPROVED",
      execution: "EXECUTED",
      batch_approved: "BATCH",
    };
    const variants: Record<string, "default" | "secondary" | "outline"> = {
      dry_run: "outline",
      approval: "secondary",
      execution: "default",
      batch_approved: "secondary",
    };
    return <Badge variant={variants[type]} className="text-[10px] font-mono">{labels[type]}</Badge>;
  };

  return (
    <div className="space-y-5 animate-fade-in">
      <div className="flex items-center justify-between">
        <div>
          <h3 className="text-sm font-semibold font-display text-foreground">Audit Trail</h3>
          <p className="text-xs text-muted-foreground mt-0.5">
            TEE-signed, hash-linked chronological chain
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Button
            onClick={verifyChain}
            disabled={isVerifying}
            size="sm"
            variant="secondary"
            className="gap-1.5"
          >
            {isVerifying ? <span className="h-3.5 w-3.5 animate-spin rounded-full border-2 border-primary border-t-transparent" /> : <Shield className="h-3.5 w-3.5" />}
            {chainVerified ? "Re-verify" : "Verify Chain"}
          </Button>
          <Button
            onClick={pushToRekor}
            disabled={isPushing || !chainVerified}
            size="sm"
            variant="outline"
            className="gap-1.5"
          >
            {isPushing ? <span className="h-3.5 w-3.5 animate-spin rounded-full border-2 border-primary border-t-transparent" /> : <Upload className="h-3.5 w-3.5" />}
            Push to Rekor
          </Button>
        </div>
      </div>

      {/* Chain status */}
      {chainVerified !== null && (
        <div className="glass-panel rounded-xl p-3 flex items-center gap-3">
          <CheckCircle2 className="h-4 w-4 text-success" />
          <div>
            <p className="text-xs font-semibold text-foreground">Chain integrity verified</p>
            <p className="text-[10px] text-muted-foreground font-mono">
              naawi audit verify — {records.length} records, 0 breaks, all TEE signatures valid
            </p>
          </div>
        </div>
      )}

      {/* Terminal-style commands */}
      <div className="glass-panel rounded-xl overflow-hidden">
        <div className="px-4 py-2.5 border-b border-border/50 flex items-center gap-2">
          <Terminal className="h-3.5 w-3.5 text-muted-foreground" />
          <span className="text-xs font-medium text-muted-foreground">CLI Reference</span>
        </div>
        <div className="p-3 font-mono text-[11px] space-y-1">
          <div className="terminal-line">
            <span className="cmd">naawi</span> <span className="flag">audit verify</span>
            <span className="dim"> # check chain integrity end-to-end</span>
          </div>
          <div className="terminal-line">
            <span className="cmd">naawi</span> <span className="flag">audit push</span>
            <span className="dim"> # export to Rekor transparency log</span>
          </div>
          <div className="terminal-line">
            <span className="cmd">naawi</span> <span className="flag">audit show</span> <span className="value">--last=10</span>
            <span className="dim"> # view recent records</span>
          </div>
        </div>
      </div>

      {/* Records */}
      <div className="glass-panel rounded-xl overflow-hidden">
        <div className="px-4 py-2.5 border-b border-border/50 flex items-center justify-between">
          <span className="text-xs font-medium text-muted-foreground">Chronological Records</span>
          <span className="text-[10px] text-muted-foreground">{records.length} entries</span>
        </div>
        <div className="divide-y divide-border/20">
          {records.map((record, i) => (
            <div key={record.id} className="px-4 py-3 space-y-2">
              <div className="flex items-center gap-2 flex-wrap">
                {typeIcon(record.type)}
                {typeBadge(record.type)}
                <code className="text-[10px] font-mono text-primary truncate flex-1">{record.intentId}</code>
                <Badge variant="outline" className="glass-badge text-[10px] gap-1">
                  <Clock className="h-2.5 w-2.5" />
                  {new Date(record.timestamp).toLocaleTimeString()}
                </Badge>
              </div>
              <p className="text-xs text-muted-foreground">{record.details}</p>
              <div className="flex items-center gap-4 text-[10px] text-muted-foreground/60 font-mono">
                <span className="flex items-center gap-1">
                  <Link2 className="h-2.5 w-2.5" />
                  prev:{record.prevHash.slice(0, 8)}…
                </span>
                <span className="flex items-center gap-1">
                  <Hash className="h-2.5 w-2.5" />
                  {record.hash.slice(0, 8)}…
                </span>
                <span className="flex items-center gap-1">
                  <Fingerprint className="h-2.5 w-2.5" />
                  tee:{record.teeSignature.slice(0, 12)}…
                </span>
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* SOC 2 note */}
      <div className="glass-subtle rounded-xl p-4 text-center space-y-1">
        <p className="text-xs font-medium text-foreground">SOC 2 & Compliance Ready</p>
        <p className="text-[10px] text-muted-foreground">
          Every dry-run, approval, and execution in a single chain. Each record TEE-signed and hash-linked.
          <br />
          Export to Rekor transparency log for external audit.
        </p>
      </div>
    </div>
  );
}
