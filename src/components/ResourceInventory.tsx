import { useState, useEffect, useRef, useCallback } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { executeIntent } from "@/lib/uidi-engine";
import type { EngineResponse } from "@/lib/uidi-engine";
import { toast } from "@/hooks/use-toast";
import {
  Loader2, Search, Trash2, AlertTriangle, Server, HardDrive, Globe, Network,
  Box, Shield, RefreshCw, Skull, CheckCircle2, Eye, Clock, X, Zap,
} from "lucide-react";

interface InventoryResource {
  id: string;
  type: "ec2" | "vpc" | "ebs" | "eip" | "eks" | "subnet" | "security_group" | "s3" | "cloudfront" | "sqs" | "lambda" | "api_gateway" | "app_mesh";
  name: string;
  region: string;
  state: string;
  managed: boolean;
  waste?: { reason: string; savings_hint?: string };
  tags: Record<string, string>;
  details: Record<string, unknown>;
}

interface InventorySummary {
  total: number;
  managed: number;
  waste: number;
  orphan: number;
  by_type: Record<string, number>;
}

interface DisablingTracker {
  resourceId: string;
  resourceName: string;
  startedAt: number;
  estimatedMinutes: number;
  progress: number;
  status: "disabling" | "retrying" | "deleted" | "failed";
  message?: string;
}

const typeIcons: Record<string, React.ReactNode> = {
  ec2: <Server className="h-4 w-4" />,
  ebs: <HardDrive className="h-4 w-4" />,
  eip: <Globe className="h-4 w-4" />,
  vpc: <Network className="h-4 w-4" />,
  eks: <Box className="h-4 w-4" />,
  subnet: <Network className="h-3 w-3" />,
  security_group: <Shield className="h-3 w-3" />,
  s3: <HardDrive className="h-3.5 w-3.5" />,
  cloudfront: <Globe className="h-3.5 w-3.5" />,
  sqs: <RefreshCw className="h-3.5 w-3.5" />,
  lambda: <Box className="h-3.5 w-3.5" />,
  api_gateway: <Server className="h-3.5 w-3.5" />,
  app_mesh: <Network className="h-3.5 w-3.5" />,
};

const POLL_INTERVAL = 30_000; // 30s between polls
const ESTIMATED_DISABLE_MS = 10 * 60 * 1000; // ~10 min

interface ResourceInventoryProps {
  region: string;
}

export function ResourceInventory({ region }: ResourceInventoryProps) {
  const [resources, setResources] = useState<InventoryResource[]>([]);
  const [summary, setSummary] = useState<InventorySummary | null>(null);
  const [isScanning, setIsScanning] = useState(false);
  const [nukingId, setNukingId] = useState<string | null>(null);
  const [filter, setFilter] = useState<"all" | "managed" | "waste" | "orphan">("all");
  const [disablingTrackers, setDisablingTrackers] = useState<DisablingTracker[]>([]);
  const [nukeAllOpen, setNukeAllOpen] = useState(false);
  const [isNukingAll, setIsNukingAll] = useState(false);
  const [nukeAllProgress, setNukeAllProgress] = useState<{ done: number; total: number } | null>(null);
  const [nukeAllFailures, setNukeAllFailures] = useState<{ id: string; name: string; error: string }[]>([]);
  const pollTimers = useRef<Record<string, number>>({});

  // Progress ticker — updates progress bar smoothly
  useEffect(() => {
    const interval = setInterval(() => {
      setDisablingTrackers(prev => prev.map(t => {
        if (t.status !== "disabling") return t;
        const elapsed = Date.now() - t.startedAt;
        const progress = Math.min(95, (elapsed / ESTIMATED_DISABLE_MS) * 100);
        return { ...t, progress };
      }));
    }, 2000);
    return () => clearInterval(interval);
  }, []);

  // Cleanup poll timers on unmount
  useEffect(() => {
    return () => {
      Object.values(pollTimers.current).forEach(clearInterval);
    };
  }, []);

  const retryNuke = useCallback(async (resourceId: string) => {
    setDisablingTrackers(prev => prev.map(t =>
      t.resourceId === resourceId ? { ...t, status: "retrying" as const, message: "Checking status…" } : t
    ));

    try {
      const result = await executeIntent({
        intent: "inventory" as any,
        action: "nuke" as any,
        spec: { resource_id: resourceId, resource_type: "cloudfront", region },
      });

      const details = result.details as any;

      if (result.status === "error") {
        if (result.error?.includes("not fully disabled") || result.error?.includes("DistributionNotDisabled")) {
          // Still disabling, keep polling
          setDisablingTrackers(prev => prev.map(t =>
            t.resourceId === resourceId ? { ...t, status: "disabling" as const, message: "Still disabling…" } : t
          ));
          return;
        }
        throw new Error(result.error || result.message);
      }

      if (details?.state === "disabling") {
        setDisablingTrackers(prev => prev.map(t =>
          t.resourceId === resourceId ? { ...t, status: "disabling" as const, message: result.message } : t
        ));
        return;
      }

      // Success! Distribution deleted
      if (pollTimers.current[resourceId]) {
        clearInterval(pollTimers.current[resourceId]);
        delete pollTimers.current[resourceId];
      }
      setDisablingTrackers(prev => prev.map(t =>
        t.resourceId === resourceId ? { ...t, status: "deleted" as const, progress: 100, message: "Distribution deleted!" } : t
      ));
      setResources(prev => prev.filter(r => r.id !== resourceId));
      toast({ title: "CloudFront destroyed", description: `Distribution ${resourceId} deleted` });

      // Auto-remove tracker after 5s
      setTimeout(() => {
        setDisablingTrackers(prev => prev.filter(t => t.resourceId !== resourceId));
      }, 5000);
    } catch (e) {
      setDisablingTrackers(prev => prev.map(t =>
        t.resourceId === resourceId ? { ...t, status: "failed" as const, message: e instanceof Error ? e.message : "Failed" } : t
      ));
      if (pollTimers.current[resourceId]) {
        clearInterval(pollTimers.current[resourceId]);
        delete pollTimers.current[resourceId];
      }
    }
  }, [region]);

  function startDisablingTracker(resourceId: string, resourceName: string) {
    const tracker: DisablingTracker = {
      resourceId, resourceName,
      startedAt: Date.now(),
      estimatedMinutes: 10,
      progress: 0,
      status: "disabling",
      message: "CloudFront is disabling the distribution…",
    };
    setDisablingTrackers(prev => [...prev.filter(t => t.resourceId !== resourceId), tracker]);

    // Start polling every 30s
    if (pollTimers.current[resourceId]) clearInterval(pollTimers.current[resourceId]);
    pollTimers.current[resourceId] = window.setInterval(() => {
      retryNuke(resourceId);
    }, POLL_INTERVAL);
  }

  function cancelTracker(resourceId: string) {
    if (pollTimers.current[resourceId]) {
      clearInterval(pollTimers.current[resourceId]);
      delete pollTimers.current[resourceId];
    }
    setDisablingTrackers(prev => prev.filter(t => t.resourceId !== resourceId));
  }

  async function scan() {
    setIsScanning(true);
    try {
      const result = await executeIntent({
        intent: "inventory" as any,
        action: "scan" as any,
        spec: { region },
      });
      if (result.status === "error") throw new Error(result.error || result.message);
      const details = result.details as { resources: InventoryResource[]; summary: InventorySummary };
      setResources(details.resources || []);
      setSummary(details.summary || null);
      toast({ title: "Scan complete", description: result.message });
    } catch (e) {
      toast({ title: "Scan failed", description: e instanceof Error ? e.message : "Unknown error", variant: "destructive" });
    } finally {
      setIsScanning(false);
    }
  }

  async function nukeResource(resource: InventoryResource) {
    setNukingId(resource.id);
    try {
      const result = await executeIntent({
        intent: "inventory" as any,
        action: "nuke" as any,
        spec: {
          resource_id: resource.id,
          resource_type: resource.type,
          region: resource.region,
          ...(resource.type === "eks" ? { cluster_name: resource.name } : {}),
          ...(resource.type === "s3" ? { bucket_name: resource.name } : {}),
          ...(resource.type === "lambda" ? { function_name: resource.name } : {}),
          ...(resource.type === "app_mesh" ? { mesh_name: resource.name } : {}),
          ...(resource.type === "sqs" ? { queue_url: (resource.details as any)?.queue_url } : {}),
        },
      });
      if (result.status === "error") throw new Error(result.error || result.message);

      const details = result.details as any;
      if (details?.state === "disabling") {
        // Start the auto-polling tracker
        startDisablingTracker(resource.id, resource.name);
        return;
      }

      toast({ title: "Resource destroyed", description: result.message });
      if (details?.steps?.length > 1) {
        toast({ title: "Cleanup steps", description: details.steps.join(" → ") });
      }
      setResources(prev => prev.filter(r => r.id !== resource.id));
    } catch (e) {
      toast({ title: "Destroy failed", description: e instanceof Error ? e.message : "Unknown error", variant: "destructive" });
    } finally {
      setNukingId(null);
    }
  }

  const nukeable = resources.filter(r =>
    (r.type !== "vpc" || r.managed) && !(r.details as any)?.is_default
  );

  // Destroy order: L2 compute first (EKS/EC2 hold ENIs), then L1, then L0 networking last
  const NUKE_ORDER: InventoryResource["type"][] = [
    "eks", "ec2", "lambda", "cloudfront", "api_gateway", "app_mesh",
    "sqs", "s3", "ebs", "eip",
    "security_group", "subnet", "vpc",
  ];

  async function retryFailed() {
    if (nukeAllFailures.length === 0) return;
    const toRetry = nukeAllFailures
      .map(f => resources.find(r => r.id === f.id))
      .filter(Boolean) as typeof resources;
    if (toRetry.length === 0) {
      setNukeAllFailures([]);
      return;
    }

    setIsNukingAll(true);
    setNukeAllFailures([]);
    const ordered = [...toRetry].sort(
      (a, b) => NUKE_ORDER.indexOf(a.type) - NUKE_ORDER.indexOf(b.type)
    );
    setNukeAllProgress({ done: 0, total: ordered.length });
    const failures: { id: string; name: string; error: string }[] = [];

    for (let i = 0; i < ordered.length; i++) {
      const r = ordered[i];
      setNukeAllProgress({ done: i, total: ordered.length });
      try {
        const result = await executeIntent({
          intent: "inventory" as any,
          action: "nuke" as any,
          spec: {
            resource_id: r.id,
            resource_type: r.type,
            region: r.region,
            ...(r.type === "eks"      ? { cluster_name: r.name } : {}),
            ...(r.type === "s3"       ? { bucket_name: r.name } : {}),
            ...(r.type === "lambda"   ? { function_name: r.name } : {}),
            ...(r.type === "app_mesh" ? { mesh_name: r.name } : {}),
            ...(r.type === "sqs"      ? { queue_url: (r.details as any)?.queue_url } : {}),
          },
        });
        if (result.status === "error") {
          failures.push({ id: r.id, name: r.name, error: result.error || result.message || "Unknown error" });
        } else {
          setResources(prev => prev.filter(x => x.id !== r.id));
        }
      } catch (e) {
        failures.push({ id: r.id, name: r.name, error: e instanceof Error ? e.message : "Unknown error" });
      }
    }

    setNukeAllProgress({ done: ordered.length, total: ordered.length });
    setNukeAllFailures(failures);
    setIsNukingAll(false);
    setNukeAllProgress(null);
  }

  async function nukeAll() {
    setNukeAllOpen(false);
    setIsNukingAll(true);
    setNukeAllFailures([]);

    const ordered = [...nukeable].sort(
      (a, b) => NUKE_ORDER.indexOf(a.type) - NUKE_ORDER.indexOf(b.type)
    );

    setNukeAllProgress({ done: 0, total: ordered.length });
    const failures: { id: string; name: string; error: string }[] = [];

    for (let i = 0; i < ordered.length; i++) {
      const r = ordered[i];
      setNukeAllProgress({ done: i, total: ordered.length });
      try {
        const result = await executeIntent({
          intent: "inventory" as any,
          action: "nuke" as any,
          spec: {
            resource_id: r.id,
            resource_type: r.type,
            region: r.region,
            ...(r.type === "eks"      ? { cluster_name: r.name } : {}),
            ...(r.type === "s3"       ? { bucket_name: r.name } : {}),
            ...(r.type === "lambda"   ? { function_name: r.name } : {}),
            ...(r.type === "app_mesh" ? { mesh_name: r.name } : {}),
            ...(r.type === "sqs"      ? { queue_url: (r.details as any)?.queue_url } : {}),
          },
        });
        if (result.status === "error") {
          failures.push({ id: r.id, name: r.name, error: result.error || result.message || "Unknown error" });
        } else {
          setResources(prev => prev.filter(x => x.id !== r.id));
        }
      } catch (e) {
        failures.push({ id: r.id, name: r.name, error: e instanceof Error ? e.message : "Unknown error" });
      }
    }

    setNukeAllProgress({ done: ordered.length, total: ordered.length });
    setNukeAllFailures(failures);
    setIsNukingAll(false);
    setNukeAllProgress(null);

    if (failures.length === 0) {
      toast({ title: "☢️ Nuke All complete", description: `${ordered.length} resource(s) destroyed.` });
    } else {
      toast({
        title: `Nuke All: ${ordered.length - failures.length} destroyed, ${failures.length} failed`,
        description: failures.map(f => `${f.name}: ${f.error}`).join(" · ").slice(0, 200),
        variant: "destructive",
      });
    }
  }

  const filtered = resources.filter(r => {
    if (filter === "managed") return r.managed;
    if (filter === "waste") return !!r.waste;
    if (filter === "orphan") return !r.managed && r.type !== "vpc";
    return true;
  });

  const wasteCount = resources.filter(r => r.waste).length;

  return (
    <Card className="bg-card border-border">
      <CardHeader className="pb-3">
        <div className="flex items-center justify-between">
          <CardTitle className="text-base flex items-center gap-2">
            <Eye className="h-4 w-4 text-primary" />
            Resource Inventory
          </CardTitle>
          <div className="flex items-center gap-2">
            {nukeable.length > 0 && !isNukingAll && (
              <Button
                variant="destructive"
                size="sm"
                onClick={() => setNukeAllOpen(true)}
                className="gap-1.5"
              >
                <Zap className="h-3 w-3" />
                Nuke All ({nukeable.length})
              </Button>
            )}
            {isNukingAll && nukeAllProgress && (
              <div className="flex items-center gap-2 text-xs text-muted-foreground">
                <Loader2 className="h-3 w-3 animate-spin text-destructive" />
                <span className="font-mono">{nukeAllProgress.done}/{nukeAllProgress.total}</span>
              </div>
            )}
            <Button variant="outline" size="sm" onClick={scan} disabled={isScanning || isNukingAll}>
              {isScanning ? <Loader2 className="h-3 w-3 animate-spin mr-1" /> : <Search className="h-3 w-3 mr-1" />}
              {isScanning ? "Scanning…" : "Scan Region"}
            </Button>
          </div>
        </div>
      </CardHeader>
      <CardContent className="space-y-4">
        {/* CloudFront disabling trackers */}
        {disablingTrackers.length > 0 && (
          <div className="space-y-2">
            {disablingTrackers.map(tracker => (
              <div
                key={tracker.resourceId}
                className={`p-3 rounded-lg border transition-colors ${
                  tracker.status === "deleted"
                    ? "border-primary/30 bg-primary/5"
                    : tracker.status === "failed"
                    ? "border-destructive/30 bg-destructive/5"
                    : "border-border bg-muted/20"
                }`}
              >
                <div className="flex items-center justify-between mb-2">
                  <div className="flex items-center gap-2">
                    <Globe className="h-4 w-4 text-muted-foreground" />
                    <div>
                      <p className="text-sm font-medium text-foreground">
                        {tracker.status === "deleted" ? "✓ " : ""}
                        CloudFront: {tracker.resourceName}
                      </p>
                      <p className="text-xs text-muted-foreground font-mono">{tracker.resourceId}</p>
                    </div>
                  </div>
                  <div className="flex items-center gap-2">
                    {tracker.status === "disabling" && (
                      <Badge variant="outline" className="text-xs">
                        <Clock className="h-3 w-3 mr-1" />
                        {Math.ceil((ESTIMATED_DISABLE_MS - (Date.now() - tracker.startedAt)) / 60000)}m left
                      </Badge>
                    )}
                    {tracker.status === "retrying" && (
                      <Badge variant="outline" className="text-xs">
                        <Loader2 className="h-3 w-3 mr-1 animate-spin" /> Checking…
                      </Badge>
                    )}
                    {tracker.status === "deleted" && (
                      <Badge className="text-xs bg-primary/20 text-primary border-0">
                        <CheckCircle2 className="h-3 w-3 mr-1" /> Deleted
                      </Badge>
                    )}
                    {tracker.status === "failed" && (
                      <Badge variant="destructive" className="text-xs">Failed</Badge>
                    )}
                    {tracker.status !== "deleted" && (
                      <Button variant="ghost" size="sm" className="h-6 w-6 p-0" onClick={() => cancelTracker(tracker.resourceId)}>
                        <X className="h-3 w-3" />
                      </Button>
                    )}
                  </div>
                </div>
                <Progress
                  value={tracker.progress}
                  className="h-1.5"
                />
                <p className="text-xs text-muted-foreground mt-1.5">
                  {tracker.message || "Waiting for AWS to finish disabling…"}
                  {tracker.status === "disabling" && " Auto-retrying every 30s."}
                </p>
              </div>
            ))}
          </div>
        )}

        {/* Summary cards */}
        {summary && (
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
            <button onClick={() => setFilter("all")} className={`p-3 rounded-lg border text-left transition-colors ${filter === "all" ? "border-primary bg-primary/5" : "border-border bg-muted/30 hover:bg-muted/50"}`}>
              <p className="text-2xl font-bold text-foreground">{summary.total}</p>
              <p className="text-xs text-muted-foreground">Total</p>
            </button>
            <button onClick={() => setFilter("managed")} className={`p-3 rounded-lg border text-left transition-colors ${filter === "managed" ? "border-primary bg-primary/5" : "border-border bg-muted/30 hover:bg-muted/50"}`}>
              <p className="text-2xl font-bold text-primary">{summary.managed}</p>
              <p className="text-xs text-muted-foreground">UIDI Managed</p>
            </button>
            <button onClick={() => setFilter("waste")} className={`p-3 rounded-lg border text-left transition-colors ${filter === "waste" ? "border-destructive bg-destructive/5" : "border-border bg-muted/30 hover:bg-muted/50"}`}>
              <p className="text-2xl font-bold text-destructive">{summary.waste}</p>
              <p className="text-xs text-muted-foreground">Waste</p>
            </button>
            <button onClick={() => setFilter("orphan")} className={`p-3 rounded-lg border text-left transition-colors ${filter === "orphan" ? "border-accent bg-accent/5" : "border-border bg-muted/30 hover:bg-muted/50"}`}>
              <p className="text-2xl font-bold text-accent-foreground">{summary.orphan}</p>
              <p className="text-xs text-muted-foreground">Unmanaged</p>
            </button>
          </div>
        )}

        {/* Nuke All failure details */}
        {nukeAllFailures.length > 0 && (
          <div className="rounded-lg border border-destructive/30 bg-destructive/5 p-3 space-y-1.5">
            <div className="flex items-center gap-2">
              <AlertTriangle className="h-4 w-4 text-destructive shrink-0" />
              <span className="text-xs font-semibold text-destructive">{nukeAllFailures.length} resource(s) failed to destroy</span>
              <div className="ml-auto flex items-center gap-1">
                <Button variant="outline" size="sm" className="h-5 px-2 text-xs border-destructive/40 text-destructive hover:bg-destructive/10" onClick={retryFailed} disabled={isNukingAll}>
                  Retry Failed
                </Button>
                <Button variant="ghost" size="sm" className="h-5 w-5 p-0" onClick={() => setNukeAllFailures([])}>
                  <X className="h-3 w-3" />
                </Button>
              </div>
            </div>
            {nukeAllFailures.map(f => (
              <div key={f.id} className="flex items-start gap-2 text-xs">
                <span className="font-mono text-muted-foreground shrink-0">{f.id}</span>
                <span className="text-destructive">{f.error}</span>
              </div>
            ))}
          </div>
        )}

        {/* Waste alert */}
        {wasteCount > 0 && (
          <div className="flex items-center gap-2 p-3 rounded-lg bg-destructive/10 border border-destructive/20">
            <AlertTriangle className="h-4 w-4 text-destructive shrink-0" />
            <p className="text-xs text-foreground">
              <span className="font-semibold">{wasteCount} resource(s) generating waste.</span>{" "}
              Orphaned volumes and idle EIPs cost money even when unused.
            </p>
          </div>
        )}

        {/* Resource table */}
        {resources.length > 0 && (
          <div className="rounded-lg border border-border overflow-hidden">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="w-8"></TableHead>
                  <TableHead>Resource</TableHead>
                  <TableHead>Type</TableHead>
                  <TableHead>Region</TableHead>
                  <TableHead>State</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead className="text-right">Action</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {filtered.map(r => {
                  const isDisabling = disablingTrackers.some(t => t.resourceId === r.id && t.status === "disabling");
                  return (
                    <TableRow key={r.id} className={r.waste ? "bg-destructive/5" : isDisabling ? "bg-muted/20" : ""}>
                      <TableCell>{typeIcons[r.type] || null}</TableCell>
                      <TableCell>
                        <div>
                          <p className="text-sm font-medium">{r.name}</p>
                          <p className="text-xs text-muted-foreground font-mono">{r.id}</p>
                        </div>
                      </TableCell>
                      <TableCell>
                        <Badge variant="outline" className="text-xs uppercase">{r.type}</Badge>
                      </TableCell>
                      <TableCell>
                        <span className="text-xs font-mono text-muted-foreground">{r.region}</span>
                      </TableCell>
                      <TableCell>
                        <Badge
                          variant={r.state === "running" || r.state === "available" || r.state === "associated" || r.state === "ACTIVE" ? "default" : "secondary"}
                          className="text-xs"
                        >
                          {isDisabling ? "disabling" : r.state}
                        </Badge>
                      </TableCell>
                      <TableCell>
                        <div className="flex gap-1 flex-wrap">
                          {r.managed && (
                            <Badge className="text-xs bg-primary/20 text-primary border-0">
                              <CheckCircle2 className="h-3 w-3 mr-0.5" /> UIDI
                            </Badge>
                          )}
                          {r.waste && (
                            <Badge variant="destructive" className="text-xs">
                              <AlertTriangle className="h-3 w-3 mr-0.5" /> Waste
                            </Badge>
                          )}
                          {isDisabling && (
                            <Badge variant="outline" className="text-xs text-muted-foreground">
                              <Clock className="h-3 w-3 mr-0.5" /> Disabling…
                            </Badge>
                          )}
                          {!r.managed && r.type !== "vpc" && !isDisabling && (
                            <Badge variant="outline" className="text-xs text-muted-foreground">Unmanaged</Badge>
                          )}
                        </div>
                        {r.waste && (
                          <p className="text-xs text-destructive mt-1">{r.waste.savings_hint}</p>
                        )}
                      </TableCell>
                      <TableCell className="text-right">
                        {r.type !== "vpc" || r.managed ? (
                          <Button
                            variant="destructive"
                            size="sm"
                            onClick={() => nukeResource(r)}
                            disabled={nukingId === r.id || (r.details as any)?.is_default || isDisabling}
                          >
                            {nukingId === r.id ? (
                              <Loader2 className="h-3 w-3 animate-spin" />
                            ) : isDisabling ? (
                              <><Clock className="h-3 w-3 mr-1" /> Wait</>
                            ) : (
                              <><Skull className="h-3 w-3 mr-1" /> Nuke</>
                            )}
                          </Button>
                        ) : null}
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          </div>
        )}

        {resources.length === 0 && !isScanning && (
          <div className="text-center py-8 text-muted-foreground">
            <Search className="h-8 w-8 mx-auto mb-2 opacity-50" />
            <p className="text-sm">No inventory data. Click "Scan Region" to discover resources.</p>
          </div>
        )}
      </CardContent>

      <AlertDialog open={nukeAllOpen} onOpenChange={setNukeAllOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle className="flex items-center gap-2 text-destructive">
              <Zap className="h-5 w-5" /> Nuke All Resources?
            </AlertDialogTitle>
            <AlertDialogDescription className="space-y-2">
              <span className="block">
                This will permanently destroy <strong>{nukeable.length} resource(s)</strong> in <strong>{region}</strong>.
                This action cannot be undone.
              </span>
              <span className="block text-xs font-mono bg-muted rounded px-2 py-1.5 text-destructive">
                {nukeable.map(r => r.id).join("\n")}
              </span>
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={nukeAll}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              <Zap className="h-4 w-4 mr-1.5" /> Yes, Nuke All
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </Card>
  );
}
