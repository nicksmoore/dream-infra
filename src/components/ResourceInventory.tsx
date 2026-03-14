import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { executeIntent } from "@/lib/uidi-engine";
import type { EngineResponse } from "@/lib/uidi-engine";
import { toast } from "@/hooks/use-toast";
import {
  Loader2, Search, Trash2, AlertTriangle, Server, HardDrive, Globe, Network,
  Box, Shield, RefreshCw, Skull, CheckCircle2, Eye
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

interface ResourceInventoryProps {
  region: string;
}

export function ResourceInventory({ region }: ResourceInventoryProps) {
  const [resources, setResources] = useState<InventoryResource[]>([]);
  const [summary, setSummary] = useState<InventorySummary | null>(null);
  const [isScanning, setIsScanning] = useState(false);
  const [nukingId, setNukingId] = useState<string | null>(null);
  const [filter, setFilter] = useState<"all" | "managed" | "waste" | "orphan">("all");

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
        },
      });
      if (result.status === "error") throw new Error(result.error || result.message);
      toast({ title: "Resource destroyed", description: result.message });
      // Remove from list
      setResources(prev => prev.filter(r => r.id !== resource.id));
    } catch (e) {
      toast({ title: "Destroy failed", description: e instanceof Error ? e.message : "Unknown error", variant: "destructive" });
    } finally {
      setNukingId(null);
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
          <Button variant="outline" size="sm" onClick={scan} disabled={isScanning}>
            {isScanning ? <Loader2 className="h-3 w-3 animate-spin mr-1" /> : <Search className="h-3 w-3 mr-1" />}
            {isScanning ? "Scanning…" : "Scan Region"}
          </Button>
        </div>
      </CardHeader>
      <CardContent className="space-y-4">
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
                  <TableHead>State</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead className="text-right">Action</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {filtered.map(r => (
                  <TableRow key={r.id} className={r.waste ? "bg-destructive/5" : ""}>
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
                      <Badge
                        variant={r.state === "running" || r.state === "available" || r.state === "associated" || r.state === "ACTIVE" ? "default" : "secondary"}
                        className="text-xs"
                      >
                        {r.state}
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
                        {!r.managed && r.type !== "vpc" && (
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
                          disabled={nukingId === r.id || (r.details as any)?.is_default}
                        >
                          {nukingId === r.id ? (
                            <Loader2 className="h-3 w-3 animate-spin" />
                          ) : (
                            <><Skull className="h-3 w-3 mr-1" /> Nuke</>
                          )}
                        </Button>
                      ) : null}
                    </TableCell>
                  </TableRow>
                ))}
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
    </Card>
  );
}
