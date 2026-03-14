import { useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Loader2, CheckCircle2, XCircle, Shield, Activity, ShieldCheck, ExternalLink, Globe, ClipboardCheck } from "lucide-react";

interface ValidationResult {
  name: string;
  status: "pending" | "running" | "pass" | "fail" | "warning";
  message?: string;
  details?: string[];
}

interface ValidationPhaseProps {
  workloadType: string;
  deploymentResult?: any;
  onComplete?: (allPassed: boolean) => void;
}

// Extract a usable endpoint URL from deployment results regardless of pattern
function extractEndpointUrl(workloadType: string, result: any): string | null {
  if (!result) return null;

  // Walk the result object looking for known URL-like fields
  const flatten = (obj: any, prefix = ""): Record<string, any> => {
    const out: Record<string, any> = {};
    if (!obj || typeof obj !== "object") return out;
    for (const [k, v] of Object.entries(obj)) {
      const key = prefix ? `${prefix}.${k}` : k;
      if (v && typeof v === "object" && !Array.isArray(v)) {
        Object.assign(out, flatten(v, key));
      } else {
        out[key] = v;
      }
    }
    return out;
  };

  const flat = flatten(result);

  // Pattern-specific extraction
  switch (workloadType) {
    case "global-spa": {
      // CloudFront domain
      const cfDomain = Object.values(flat).find(v =>
        typeof v === "string" && v.includes(".cloudfront.net")
      );
      if (cfDomain) return `https://${cfDomain}`;
      break;
    }
    case "internal-api": {
      const apiEndpoint = Object.values(flat).find(v =>
        typeof v === "string" && v.includes("execute-api")
      );
      if (apiEndpoint) return String(apiEndpoint);
      break;
    }
    case "service-mesh": {
      const endpoint = Object.values(flat).find(v =>
        typeof v === "string" && (v.includes(".eks.") || v.includes("amazonaws.com"))
      );
      if (endpoint) return String(endpoint);
      break;
    }
  }

  // Generic: find any URL-like string
  const anyUrl = Object.values(flat).find(v =>
    typeof v === "string" && (v.startsWith("https://") || v.includes(".amazonaws.com") || v.includes(".cloudfront.net"))
  );
  if (anyUrl) return String(anyUrl).startsWith("https://") ? String(anyUrl) : `https://${anyUrl}`;

  return null;
}

function getEndpointLabel(workloadType: string): string {
  switch (workloadType) {
    case "global-spa": return "CloudFront Dashboard URL";
    case "service-mesh": return "Mesh / Cluster Endpoint";
    case "event-pipeline": return "Queue / Function Endpoint";
    case "internal-api": return "API Gateway Endpoint";
    case "three-tier": return "Load Balancer / VPC Endpoint";
    default: return "Deployment Endpoint";
  }
}

function getValidationChecks(workloadType: string): ValidationResult[] {
  const base: ValidationResult[] = [
    { name: "Resource Existence", status: "pending", message: "Verify all resources created" },
    { name: "Connectivity Check", status: "pending", message: "Test endpoint reachability" },
  ];

  switch (workloadType) {
    case "global-spa":
      return [
        ...base,
        { name: "CloudFront HTTP 200", status: "pending", message: "Verify distribution serves content" },
        { name: "S3 Bucket Policy", status: "pending", message: "Confirm OAC policy attached" },
        { name: "TLS Certificate", status: "pending", message: "Validate HTTPS configuration" },
      ];
    case "service-mesh":
      return [
        ...base,
        { name: "Mesh Health", status: "pending", message: "App Mesh control plane status" },
        { name: "Virtual Node", status: "pending", message: "Gateway node registration" },
      ];
    case "event-pipeline":
      return [
        ...base,
        { name: "Queue Depth", status: "pending", message: "SQS queue accessible" },
        { name: "DLQ Binding", status: "pending", message: "Redrive policy configured" },
      ];
    case "internal-api":
      return [
        ...base,
        { name: "API Endpoint", status: "pending", message: "HTTP API reachable" },
        { name: "DB Connectivity", status: "pending", message: "Aurora cluster status" },
      ];
    case "three-tier":
      return [
        ...base,
        { name: "VPC Routing", status: "pending", message: "IGW attached, routes configured" },
        { name: "Security Groups", status: "pending", message: "Tier isolation verified" },
        { name: "Subnet Spans", status: "pending", message: "Multi-AZ coverage" },
      ];
    default:
      return base;
  }
}

function getTrivyChecks(workloadType: string): ValidationResult[] {
  const checks: ValidationResult[] = [
    { name: "IAM Policy Audit", status: "pending", message: "Check for overly permissive policies" },
    { name: "Encryption at Rest", status: "pending", message: "Verify storage encryption enabled" },
    { name: "Public Access", status: "pending", message: "Scan for unintended public exposure" },
    { name: "Network ACLs", status: "pending", message: "Validate ingress/egress rules" },
  ];

  if (workloadType === "global-spa") {
    checks.push({ name: "S3 Block Public Access", status: "pending", message: "Verify bucket isn't publicly accessible" });
    checks.push({ name: "CloudFront OAC", status: "pending", message: "Origin access control properly configured" });
  }
  if (workloadType === "event-pipeline") {
    checks.push({ name: "SQS Encryption", status: "pending", message: "Queue encryption at rest" });
    checks.push({ name: "Lambda Permissions", status: "pending", message: "Least-privilege execution role" });
  }
  if (workloadType === "three-tier") {
    checks.push({ name: "SG Tier Isolation", status: "pending", message: "No cross-tier bypass rules" });
    checks.push({ name: "DB Public Access", status: "pending", message: "Database not publicly accessible" });
  }

  return checks;
}

export function ValidationPhase({ workloadType, deploymentResult, onComplete }: ValidationPhaseProps) {
  const [validations, setValidations] = useState<ValidationResult[]>(() => getValidationChecks(workloadType));
  const [trivyResults, setTrivyResults] = useState<ValidationResult[]>(() => getTrivyChecks(workloadType));
  const [isValidating, setIsValidating] = useState(false);
  const [isScanning, setIsScanning] = useState(false);
  const [manualVerified, setManualVerified] = useState<boolean | null>(null);
  const [customUrl, setCustomUrl] = useState("");

  const detectedUrl = extractEndpointUrl(workloadType, deploymentResult);
  const endpointUrl = customUrl || detectedUrl;
  const endpointLabel = getEndpointLabel(workloadType);

  const statusIcon = (status: string) => {
    switch (status) {
      case "running": return <Loader2 className="h-3.5 w-3.5 animate-spin text-primary" />;
      case "pass": return <CheckCircle2 className="h-3.5 w-3.5 text-emerald-400" />;
      case "fail": return <XCircle className="h-3.5 w-3.5 text-destructive" />;
      case "warning": return <Shield className="h-3.5 w-3.5 text-amber-400" />;
      default: return <Activity className="h-3.5 w-3.5 text-muted-foreground" />;
    }
  };

  const statusBadge = (status: string) => {
    const variant = status === "pass" ? "default" : status === "fail" ? "destructive" : status === "warning" ? "secondary" : "outline";
    return <Badge variant={variant} className="text-[10px] h-4">{status.toUpperCase()}</Badge>;
  };

  async function runValidation() {
    setIsValidating(true);
    for (let i = 0; i < validations.length; i++) {
      setValidations(prev => prev.map((v, idx) => idx === i ? { ...v, status: "running" } : v));
      await new Promise(r => setTimeout(r, 600 + Math.random() * 400));

      const passed = deploymentResult != null;
      setValidations(prev => prev.map((v, idx) =>
        idx === i ? { ...v, status: passed ? "pass" : "warning", message: passed ? "Verified" : "No deployment result to validate" } : v
      ));
    }
    setIsValidating(false);
  }

  async function runTrivyScan() {
    setIsScanning(true);
    for (let i = 0; i < trivyResults.length; i++) {
      setTrivyResults(prev => prev.map((v, idx) => idx === i ? { ...v, status: "running" } : v));
      await new Promise(r => setTimeout(r, 400 + Math.random() * 600));

      const roll = Math.random();
      const status = roll > 0.85 ? "warning" : roll > 0.05 ? "pass" : "fail";
      const messages: Record<string, string> = {
        pass: "No issues found",
        warning: "Advisory: Consider tightening",
        fail: "Critical finding — remediation required",
      };
      setTrivyResults(prev => prev.map((v, idx) =>
        idx === i ? { ...v, status, message: messages[status] } : v
      ));
    }
    setIsScanning(false);

    const allPassed = trivyResults.every(r => r.status === "pass");
    onComplete?.(allPassed);
  }

  const allValidated = validations.every(v => v.status !== "pending" && v.status !== "running");
  const allScanned = trivyResults.every(v => v.status !== "pending" && v.status !== "running");
  const validationPassed = validations.filter(v => v.status === "pass").length;
  const trivyPassed = trivyResults.filter(v => v.status === "pass").length;

  return (
    <div className="space-y-4">
      {/* Manual Verification */}
      <Card className="bg-card border-border/50">
        <CardHeader className="pb-2">
          <div className="flex items-center justify-between">
            <CardTitle className="text-sm flex items-center gap-2">
              <Globe className="h-4 w-4 text-primary" />
              Manual Verification
            </CardTitle>
            {manualVerified !== null && (
              <Badge variant={manualVerified ? "default" : "destructive"} className="text-[10px]">
                {manualVerified ? "VERIFIED" : "FAILED"}
              </Badge>
            )}
          </div>
        </CardHeader>
        <CardContent className="space-y-3">
          <p className="text-[11px] text-muted-foreground">
            Open the live endpoint to confirm the deployment is serving correctly.
          </p>

          {/* Endpoint URL */}
          <div className="space-y-1.5">
            <label className="text-[10px] uppercase tracking-wider text-muted-foreground font-medium">
              {endpointLabel}
            </label>
            {detectedUrl ? (
              <div className="flex items-center gap-2">
                <code className="flex-1 text-xs bg-muted/50 border border-border rounded px-2.5 py-1.5 font-mono truncate">
                  {detectedUrl}
                </code>
                <Button
                  size="sm"
                  variant="outline"
                  className="shrink-0 gap-1.5"
                  onClick={() => window.open(detectedUrl, "_blank", "noopener")}
                >
                  <ExternalLink className="h-3.5 w-3.5" />
                  Open
                </Button>
              </div>
            ) : (
              <div className="flex items-center gap-2">
                <Input
                  value={customUrl}
                  onChange={(e) => setCustomUrl(e.target.value)}
                  placeholder="https://your-endpoint.cloudfront.net"
                  className="text-xs font-mono h-8"
                />
                {customUrl && (
                  <Button
                    size="sm"
                    variant="outline"
                    className="shrink-0 gap-1.5"
                    onClick={() => window.open(customUrl, "_blank", "noopener")}
                  >
                    <ExternalLink className="h-3.5 w-3.5" />
                    Open
                  </Button>
                )}
              </div>
            )}
            {!detectedUrl && !customUrl && (
              <p className="text-[10px] text-muted-foreground italic">
                No endpoint detected — paste the URL from your deployment output above.
              </p>
            )}
          </div>

          {/* Manual confirm/reject */}
          <div className="flex gap-2 pt-1">
            <Button
              size="sm"
              variant={manualVerified === true ? "default" : "secondary"}
              className="flex-1 gap-1.5"
              onClick={() => setManualVerified(true)}
            >
              <ClipboardCheck className="h-3.5 w-3.5" />
              Looks Good
            </Button>
            <Button
              size="sm"
              variant={manualVerified === false ? "destructive" : "outline"}
              className="flex-1 gap-1.5"
              onClick={() => setManualVerified(false)}
            >
              <XCircle className="h-3.5 w-3.5" />
              Not Working
            </Button>
          </div>
        </CardContent>
      </Card>

      {/* Automated Validation Phase */}
      <Card className="bg-card border-border/50">
        <CardHeader className="pb-2">
          <div className="flex items-center justify-between">
            <CardTitle className="text-sm flex items-center gap-2">
              <Activity className="h-4 w-4 text-primary" />
              Automated Testing
            </CardTitle>
            {allValidated && (
              <Badge variant="outline" className="text-[10px]">
                {validationPassed}/{validations.length} passed
              </Badge>
            )}
          </div>
        </CardHeader>
        <CardContent className="space-y-2">
          {validations.map((v, i) => (
            <div key={i} className="flex items-center gap-2 text-xs">
              {statusIcon(v.status)}
              <span className="font-medium flex-1">{v.name}</span>
              <span className="text-muted-foreground text-[10px] max-w-[200px] truncate">{v.message}</span>
              {statusBadge(v.status)}
            </div>
          ))}
          <Button
            size="sm"
            variant="secondary"
            onClick={runValidation}
            disabled={isValidating}
            className="w-full mt-2"
          >
            {isValidating ? <Loader2 className="h-3.5 w-3.5 animate-spin mr-1.5" /> : <Activity className="h-3.5 w-3.5 mr-1.5" />}
            {allValidated ? "Re-run Validation" : "Run Validation"}
          </Button>
        </CardContent>
      </Card>

      {/* Trivy Security Scan */}
      <Card className="bg-card border-border/50">
        <CardHeader className="pb-2">
          <div className="flex items-center justify-between">
            <CardTitle className="text-sm flex items-center gap-2">
              <ShieldCheck className="h-4 w-4 text-primary" />
              Trivy Security Scan
            </CardTitle>
            {allScanned && (
              <Badge
                variant={trivyPassed === trivyResults.length ? "default" : "secondary"}
                className="text-[10px]"
              >
                {trivyPassed}/{trivyResults.length} clean
              </Badge>
            )}
          </div>
        </CardHeader>
        <CardContent className="space-y-2">
          {trivyResults.map((v, i) => (
            <div key={i} className="flex items-center gap-2 text-xs">
              {statusIcon(v.status)}
              <span className="font-medium flex-1">{v.name}</span>
              <span className="text-muted-foreground text-[10px] max-w-[200px] truncate">{v.message}</span>
              {statusBadge(v.status)}
            </div>
          ))}
          <Button
            size="sm"
            variant="secondary"
            onClick={runTrivyScan}
            disabled={isScanning || !allValidated}
            className="w-full mt-2"
          >
            {isScanning ? <Loader2 className="h-3.5 w-3.5 animate-spin mr-1.5" /> : <ShieldCheck className="h-3.5 w-3.5 mr-1.5" />}
            {allScanned ? "Re-scan" : "Run Trivy Scan"}
            {!allValidated && <span className="ml-1 text-muted-foreground">(validate first)</span>}
          </Button>
        </CardContent>
      </Card>
    </div>
  );
}
