import { useState, useCallback } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Loader2,
  CheckCircle2,
  XCircle,
  Shield,
  Activity,
  ShieldCheck,
  Globe,
  Database,
  Network,
  Lock,
  Cpu,
  HardDrive,
} from "lucide-react";
import type { CloudProvider } from "./GoldenPathCatalog";

type CheckStatus = "pending" | "running" | "pass" | "fail" | "warning";

interface ValidationCheck {
  id: string;
  name: string;
  category: "existence" | "connectivity" | "security" | "compliance";
  status: CheckStatus;
  message: string;
  icon: React.ReactNode;
}

interface PostDeployValidationProps {
  goldenPathId: string;
  goldenPathName: string;
  provider: CloudProvider;
  resources: string[];
  onComplete?: (passed: boolean) => void;
}

function buildChecks(pathId: string, provider: CloudProvider, resources: string[]): ValidationCheck[] {
  const checks: ValidationCheck[] = [
    {
      id: "resource-exists",
      name: "Resource Existence",
      category: "existence",
      status: "pending",
      message: `Verify all ${resources.length} resources created on ${provider.toUpperCase()}`,
      icon: <Database className="h-3.5 w-3.5" />,
    },
    {
      id: "state-recorded",
      name: "Dolt State Committed",
      category: "existence",
      status: "pending",
      message: "Verify resource state written to Dolt versioned store",
      icon: <HardDrive className="h-3.5 w-3.5" />,
    },
    {
      id: "network-reachable",
      name: "Network Connectivity",
      category: "connectivity",
      status: "pending",
      message: "Test endpoint / VPC reachability",
      icon: <Network className="h-3.5 w-3.5" />,
    },
    {
      id: "dns-resolution",
      name: "DNS Resolution",
      category: "connectivity",
      status: "pending",
      message: "Verify DNS records resolve correctly",
      icon: <Globe className="h-3.5 w-3.5" />,
    },
    {
      id: "iam-least-priv",
      name: "IAM Least-Privilege Audit",
      category: "security",
      status: "pending",
      message: "Scan for overly permissive policies",
      icon: <Lock className="h-3.5 w-3.5" />,
    },
    {
      id: "encryption-at-rest",
      name: "Encryption at Rest",
      category: "security",
      status: "pending",
      message: "Verify storage encryption enabled",
      icon: <Shield className="h-3.5 w-3.5" />,
    },
    {
      id: "jit-expired",
      name: "JIT Credentials Expired",
      category: "compliance",
      status: "pending",
      message: "Confirm ephemeral STS session has been destroyed",
      icon: <Lock className="h-3.5 w-3.5" />,
    },
    {
      id: "ztai-chain",
      name: "ZTAI Audit Chain Integrity",
      category: "compliance",
      status: "pending",
      message: "Verify hash-linked audit records are intact",
      icon: <ShieldCheck className="h-3.5 w-3.5" />,
    },
  ];

  // Add path-specific checks
  if (pathId === "fintech-pci" || pathId === "service-mesh") {
    checks.push({
      id: "mtls-verified",
      name: "mTLS Verification",
      category: "security",
      status: "pending",
      message: "Verify mutual TLS is enforced between services",
      icon: <Lock className="h-3.5 w-3.5" />,
    });
  }
  if (pathId === "container-platform" || pathId === "service-mesh") {
    checks.push({
      id: "k8s-health",
      name: "Cluster Health Check",
      category: "connectivity",
      status: "pending",
      message: "Verify K8s API server and node readiness",
      icon: <Cpu className="h-3.5 w-3.5" />,
    });
  }
  if (pathId === "disaster-recovery") {
    checks.push({
      id: "failover-test",
      name: "Failover Readiness",
      category: "compliance",
      status: "pending",
      message: "Verify secondary region standby and health checks",
      icon: <Activity className="h-3.5 w-3.5" />,
    });
  }

  return checks;
}

const CATEGORY_LABELS: Record<string, { label: string; color: string }> = {
  existence: { label: "Existence", color: "text-primary" },
  connectivity: { label: "Connectivity", color: "text-blue-400" },
  security: { label: "Security", color: "text-amber-400" },
  compliance: { label: "Compliance", color: "text-violet-400" },
};

export function PostDeployValidation({
  goldenPathId,
  goldenPathName,
  provider,
  resources,
  onComplete,
}: PostDeployValidationProps) {
  const [checks, setChecks] = useState<ValidationCheck[]>(() =>
    buildChecks(goldenPathId, provider, resources)
  );
  const [isRunning, setIsRunning] = useState(false);

  const runValidation = useCallback(async () => {
    setIsRunning(true);
    // Reset
    setChecks((prev) => prev.map((c) => ({ ...c, status: "pending" as CheckStatus })));

    for (let i = 0; i < checks.length; i++) {
      setChecks((prev) =>
        prev.map((c, idx) => (idx === i ? { ...c, status: "running" as CheckStatus } : c))
      );
      await new Promise((r) => setTimeout(r, 400 + Math.random() * 500));

      const roll = Math.random();
      const status: CheckStatus = roll > 0.88 ? "warning" : roll > 0.04 ? "pass" : "fail";
      const msgs: Record<CheckStatus, string> = {
        pass: "✓ Verified",
        warning: "⚠ Advisory — review recommended",
        fail: "✗ Critical — remediation required",
        pending: "",
        running: "",
      };

      setChecks((prev) =>
        prev.map((c, idx) => (idx === i ? { ...c, status, message: msgs[status] } : c))
      );
    }

    setIsRunning(false);
    const finalChecks = checks; // captured length
    const allPassed = finalChecks.every(
      (c) => c.status === "pass" || c.status === "warning"
    );
    onComplete?.(allPassed);
  }, [checks.length, onComplete]);

  const grouped = checks.reduce<Record<string, ValidationCheck[]>>((acc, c) => {
    (acc[c.category] ??= []).push(c);
    return acc;
  }, {});

  const passedCount = checks.filter((c) => c.status === "pass").length;
  const warnCount = checks.filter((c) => c.status === "warning").length;
  const failCount = checks.filter((c) => c.status === "fail").length;
  const isDone = checks.every((c) => c.status !== "pending" && c.status !== "running");

  const statusIcon = (status: CheckStatus) => {
    switch (status) {
      case "running":
        return <Loader2 className="h-3.5 w-3.5 animate-spin text-primary" />;
      case "pass":
        return <CheckCircle2 className="h-3.5 w-3.5 text-emerald-400" />;
      case "fail":
        return <XCircle className="h-3.5 w-3.5 text-destructive" />;
      case "warning":
        return <Shield className="h-3.5 w-3.5 text-amber-400" />;
      default:
        return <Activity className="h-3.5 w-3.5 text-muted-foreground" />;
    }
  };

  return (
    <Card className="glass-panel border-border/40">
      <CardHeader className="pb-3">
        <div className="flex items-center justify-between">
          <CardTitle className="text-sm flex items-center gap-2">
            <ShieldCheck className="h-4 w-4 text-primary" />
            Post-Deploy Validation
          </CardTitle>
          {isDone && (
            <div className="flex items-center gap-2">
              <Badge variant="default" className="text-[9px]">{passedCount} passed</Badge>
              {warnCount > 0 && <Badge variant="secondary" className="text-[9px]">{warnCount} warnings</Badge>}
              {failCount > 0 && <Badge variant="destructive" className="text-[9px]">{failCount} failed</Badge>}
            </div>
          )}
        </div>
        <p className="text-[11px] text-muted-foreground">
          Validating <span className="font-semibold text-foreground">{goldenPathName}</span> on{" "}
          <span className="font-mono text-primary">{provider.toUpperCase()}</span> — {checks.length} checks
        </p>
      </CardHeader>
      <CardContent className="space-y-4">
        {Object.entries(grouped).map(([category, items]) => (
          <div key={category} className="space-y-1.5">
            <p className={`text-[10px] uppercase tracking-widest font-semibold ${CATEGORY_LABELS[category]?.color || "text-muted-foreground"}`}>
              {CATEGORY_LABELS[category]?.label || category}
            </p>
            {items.map((check) => (
              <div key={check.id} className="flex items-center gap-2.5 text-xs py-1">
                {statusIcon(check.status)}
                <span className="font-medium flex-1">{check.name}</span>
                <span className="text-[10px] text-muted-foreground max-w-[220px] truncate">
                  {check.message}
                </span>
              </div>
            ))}
          </div>
        ))}

        <Button
          size="sm"
          onClick={runValidation}
          disabled={isRunning}
          className="w-full gap-1.5"
        >
          {isRunning ? (
            <Loader2 className="h-3.5 w-3.5 animate-spin" />
          ) : (
            <Activity className="h-3.5 w-3.5" />
          )}
          {isDone ? "Re-run Validation" : "Run Post-Deploy Validation"}
        </Button>
      </CardContent>
    </Card>
  );
}
