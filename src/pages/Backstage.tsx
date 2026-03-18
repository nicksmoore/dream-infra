import { useState } from "react";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Separator } from "@/components/ui/separator";
import {
  Search,
  BookOpen,
  GitBranch,
  Shield,
  Layers,
  ExternalLink,
  ChevronRight,
  FileText,
  Code2,
  Network,
  Cpu,
  Database,
  Zap,
  ArrowLeft,
} from "lucide-react";
import { useNavigate } from "react-router-dom";
import { ThemeToggle } from "@/components/ThemeToggle";
import { UserMenu } from "@/components/UserMenu";

interface ServiceEntry {
  id: string;
  name: string;
  description: string;
  owner: string;
  lifecycle: "production" | "staging" | "experimental" | "deprecated";
  type: "service" | "library" | "infrastructure" | "documentation";
  techStack: string[];
  docs: DocEntry[];
}

interface DocEntry {
  title: string;
  path: string;
  type: "adr" | "runbook" | "api-ref" | "guide" | "spec";
}

const SERVICE_CATALOG: ServiceEntry[] = [
  {
    id: "uidi-engine",
    name: "UIDI Engine",
    description: "Intent-to-infrastructure compiler. Resolves natural language to typed intent IDs and dispatches to the deterministic execution layer.",
    owner: "platform-team",
    lifecycle: "production",
    type: "service",
    techStack: ["TypeScript", "Deno", "SigV4", "Raw AWS API"],
    docs: [
      { title: "ADR-001: SDK-less Executor", path: "/docs/adr-001", type: "adr" },
      { title: "ADR-002: Trace-Derived Intents", path: "/docs/adr-002", type: "adr" },
      { title: "ADR-003: Dolt State Layer", path: "/docs/adr-003", type: "adr" },
      { title: "Intent Taxonomy Reference", path: "/docs/intent-taxonomy", type: "api-ref" },
      { title: "Runbook: Engine Troubleshooting", path: "/docs/runbook-engine", type: "runbook" },
    ],
  },
  {
    id: "dag-orchestrator",
    name: "DAG Orchestrator",
    description: "Directed acyclic graph resolver for multi-resource deployments. Handles cross-resource dependencies, parallel execution, and rollback.",
    owner: "platform-team",
    lifecycle: "production",
    type: "library",
    techStack: ["TypeScript", "DAG Resolution", "Topological Sort"],
    docs: [
      { title: "Blueprint Registry Guide", path: "/docs/dag-blueprints", type: "guide" },
      { title: "Dependency Resolution Spec", path: "/docs/dag-resolver-spec", type: "spec" },
      { title: "Runbook: Partial Failure Recovery", path: "/docs/runbook-dag-recovery", type: "runbook" },
    ],
  },
  {
    id: "golden-path-registry",
    name: "Golden Path Registry",
    description: "Curated library of 10 production-hardened deployment templates spanning AWS, GCP, and Azure. Enforces paved-road defaults.",
    owner: "platform-team",
    lifecycle: "production",
    type: "infrastructure",
    techStack: ["TypeScript", "Policy Engine", "JIT Permissions"],
    docs: [
      { title: "Golden Path Template Spec", path: "/docs/golden-path-spec", type: "spec" },
      { title: "JIT Permission Model", path: "/docs/jit-permissions", type: "guide" },
      { title: "Safety Gate Reference", path: "/docs/safety-gate", type: "api-ref" },
    ],
  },
  {
    id: "dolt-state-layer",
    name: "Dolt State Layer",
    description: "Versioned infrastructure state using Dolt-style row-level commits. Every SDK execution produces an immutable snapshot.",
    owner: "platform-team",
    lifecycle: "production",
    type: "infrastructure",
    techStack: ["TypeScript", "Dolt", "Git-for-data"],
    docs: [
      { title: "ADR-003: Dolt vs. Terraform State", path: "/docs/adr-003-dolt", type: "adr" },
      { title: "State Diff & Rollback Guide", path: "/docs/dolt-diff-guide", type: "guide" },
    ],
  },
  {
    id: "ztai-audit",
    name: "ZTAI Audit Engine",
    description: "Zero-Trust Audit Infrastructure. TEE-signed, hash-linked audit records for every intent, dry-run, and execution.",
    owner: "security-team",
    lifecycle: "production",
    type: "service",
    techStack: ["TypeScript", "TEE Signatures", "Rekor", "Roughtime"],
    docs: [
      { title: "ZTAI Record Schema", path: "/docs/ztai-schema", type: "spec" },
      { title: "Audit Chain Verification Guide", path: "/docs/ztai-verify", type: "guide" },
      { title: "Rekor Push Integration", path: "/docs/ztai-rekor", type: "runbook" },
    ],
  },
  {
    id: "credential-vault",
    name: "Credential Vault (BYOC)",
    description: "AES-256-GCM encrypted credential storage. Bring Your Own Credentials with per-user isolation.",
    owner: "security-team",
    lifecycle: "production",
    type: "service",
    techStack: ["TypeScript", "Web Crypto API", "AES-256-GCM"],
    docs: [
      { title: "BYOC Security Model", path: "/docs/byoc-security", type: "guide" },
      { title: "Credential Rotation Runbook", path: "/docs/cred-rotation", type: "runbook" },
    ],
  },
  {
    id: "policy-registry",
    name: "Policy Registry",
    description: "Capacity tiers, resource ceilings, and NLP-driven escalation for Golden Path templates.",
    owner: "platform-team",
    lifecycle: "production",
    type: "library",
    techStack: ["TypeScript", "Policy Engine"],
    docs: [
      { title: "Capacity Tier Reference", path: "/docs/capacity-tiers", type: "api-ref" },
      { title: "Escalation Policy Guide", path: "/docs/escalation-policy", type: "guide" },
    ],
  },
  {
    id: "rmcm-coherence",
    name: "RMCM Coherence Engine",
    description: "Resource Model Coherence Metrics. Validates dependency graphs and surfaces reordering suggestions during batch execution.",
    owner: "platform-team",
    lifecycle: "staging",
    type: "library",
    techStack: ["TypeScript", "Graph Analysis"],
    docs: [
      { title: "Coherence Scoring Algorithm", path: "/docs/rmcm-scoring", type: "spec" },
      { title: "Batch Reordering Logic", path: "/docs/rmcm-reorder", type: "guide" },
    ],
  },
];

const LIFECYCLE_COLORS: Record<string, string> = {
  production: "bg-emerald-500/10 text-emerald-400 border-emerald-500/20",
  staging: "bg-amber-500/10 text-amber-400 border-amber-500/20",
  experimental: "bg-violet-500/10 text-violet-400 border-violet-500/20",
  deprecated: "bg-red-500/10 text-red-400 border-red-500/20",
};

const TYPE_ICONS: Record<string, React.ReactNode> = {
  service: <Cpu className="h-4 w-4" />,
  library: <Code2 className="h-4 w-4" />,
  infrastructure: <Network className="h-4 w-4" />,
  documentation: <FileText className="h-4 w-4" />,
};

const DOC_TYPE_COLORS: Record<string, string> = {
  adr: "text-violet-400",
  runbook: "text-amber-400",
  "api-ref": "text-blue-400",
  guide: "text-emerald-400",
  spec: "text-primary",
};

export default function Backstage() {
  const navigate = useNavigate();
  const [search, setSearch] = useState("");
  const [selectedService, setSelectedService] = useState<ServiceEntry | null>(null);

  const filtered = SERVICE_CATALOG.filter((s) => {
    if (!search) return true;
    const q = search.toLowerCase();
    return (
      s.name.toLowerCase().includes(q) ||
      s.description.toLowerCase().includes(q) ||
      s.techStack.some((t) => t.toLowerCase().includes(q)) ||
      s.owner.includes(q)
    );
  });

  const allDocs = SERVICE_CATALOG.flatMap((s) =>
    s.docs.map((d) => ({ ...d, serviceName: s.name, serviceId: s.id }))
  );
  const filteredDocs = allDocs.filter((d) => {
    if (!search) return true;
    const q = search.toLowerCase();
    return d.title.toLowerCase().includes(q) || d.serviceName.toLowerCase().includes(q);
  });

  return (
    <div className="min-h-screen bg-background">
      {/* Header */}
      <header className="sticky top-0 z-50 glass-panel border-b border-border/50">
        <div className="container max-w-6xl mx-auto px-4 py-3 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <Button variant="ghost" size="sm" onClick={() => navigate("/")} className="gap-1.5 text-muted-foreground hover:text-foreground">
              <ArrowLeft className="h-3.5 w-3.5" /> Back
            </Button>
            <Separator orientation="vertical" className="h-5" />
            <div className="flex items-center gap-2">
              <BookOpen className="h-5 w-5 text-primary" />
              <div>
                <h1 className="text-base font-bold tracking-tight font-display text-foreground">Backstage</h1>
                <p className="text-[10px] text-muted-foreground tracking-wide">Service Catalog & Documentation</p>
              </div>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <ThemeToggle />
            <UserMenu />
          </div>
        </div>
      </header>

      <main className="container max-w-6xl mx-auto px-4 py-8 space-y-6">
        {/* Search */}
        <div className="relative">
          <Search className="absolute left-4 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <Input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search services, docs, ADRs, runbooks…"
            className="pl-11 h-11 text-sm glass-panel-elevated border-border/50"
          />
        </div>

        <Tabs defaultValue="catalog" className="w-full">
          <TabsList className="glass-panel border-0 p-1 h-auto">
            <TabsTrigger value="catalog" className="gap-1.5 data-[state=active]:bg-primary/10 data-[state=active]:text-primary rounded-lg text-xs">
              <Layers className="h-3.5 w-3.5" /> Service Catalog
            </TabsTrigger>
            <TabsTrigger value="docs" className="gap-1.5 data-[state=active]:bg-primary/10 data-[state=active]:text-primary rounded-lg text-xs">
              <FileText className="h-3.5 w-3.5" /> Documentation
            </TabsTrigger>
            <TabsTrigger value="adrs" className="gap-1.5 data-[state=active]:bg-primary/10 data-[state=active]:text-primary rounded-lg text-xs">
              <GitBranch className="h-3.5 w-3.5" /> ADRs
            </TabsTrigger>
          </TabsList>

          {/* Service Catalog */}
          <TabsContent value="catalog" className="space-y-4 mt-4">
            {selectedService ? (
              <div className="space-y-4 animate-fade-in">
                <Button variant="ghost" size="sm" onClick={() => setSelectedService(null)} className="gap-1.5 text-muted-foreground">
                  <ArrowLeft className="h-3.5 w-3.5" /> Back to catalog
                </Button>
                <Card className="glass-panel-elevated border-border/40">
                  <CardHeader>
                    <div className="flex items-center gap-3">
                      {TYPE_ICONS[selectedService.type]}
                      <div>
                        <CardTitle className="text-lg">{selectedService.name}</CardTitle>
                        <CardDescription>{selectedService.description}</CardDescription>
                      </div>
                    </div>
                    <div className="flex items-center gap-2 mt-3 flex-wrap">
                      <Badge variant="outline" className={LIFECYCLE_COLORS[selectedService.lifecycle]}>
                        {selectedService.lifecycle}
                      </Badge>
                      <Badge variant="outline" className="text-[9px]">
                        owner: {selectedService.owner}
                      </Badge>
                      {selectedService.techStack.map((t) => (
                        <Badge key={t} variant="secondary" className="text-[9px] font-mono">{t}</Badge>
                      ))}
                    </div>
                  </CardHeader>
                  <CardContent className="space-y-3">
                    <h3 className="text-sm font-semibold flex items-center gap-2">
                      <FileText className="h-3.5 w-3.5 text-primary" /> Documentation
                    </h3>
                    {selectedService.docs.map((doc) => (
                      <div
                        key={doc.path}
                        className="flex items-center gap-3 p-3 rounded-lg border border-border/30 hover:border-primary/30 hover:bg-primary/5 transition-all cursor-pointer"
                      >
                        <BookOpen className={`h-3.5 w-3.5 ${DOC_TYPE_COLORS[doc.type]}`} />
                        <div className="flex-1">
                          <p className="text-sm font-medium">{doc.title}</p>
                          <p className="text-[10px] text-muted-foreground font-mono">{doc.path}</p>
                        </div>
                        <Badge variant="outline" className={`text-[8px] uppercase ${DOC_TYPE_COLORS[doc.type]}`}>
                          {doc.type}
                        </Badge>
                        <ExternalLink className="h-3 w-3 text-muted-foreground" />
                      </div>
                    ))}
                  </CardContent>
                </Card>
              </div>
            ) : (
              <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                {filtered.map((service) => (
                  <Card
                    key={service.id}
                    className="glass-panel border-border/40 hover:border-primary/40 transition-all cursor-pointer group"
                    onClick={() => setSelectedService(service)}
                  >
                    <CardContent className="p-4">
                      <div className="flex items-start gap-3">
                        <div className="mt-0.5 text-muted-foreground group-hover:text-primary transition-colors">
                          {TYPE_ICONS[service.type]}
                        </div>
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-2 flex-wrap">
                            <span className="font-semibold text-sm">{service.name}</span>
                            <Badge variant="outline" className={`text-[8px] ${LIFECYCLE_COLORS[service.lifecycle]}`}>
                              {service.lifecycle}
                            </Badge>
                          </div>
                          <p className="text-xs text-muted-foreground mt-1 line-clamp-2">{service.description}</p>
                          <div className="flex items-center gap-1.5 mt-2 flex-wrap">
                            {service.techStack.slice(0, 3).map((t) => (
                              <Badge key={t} variant="secondary" className="text-[8px] font-mono">{t}</Badge>
                            ))}
                            <span className="text-[10px] text-muted-foreground ml-1">
                              {service.docs.length} docs
                            </span>
                          </div>
                        </div>
                        <ChevronRight className="h-4 w-4 text-muted-foreground group-hover:text-primary flex-shrink-0 mt-1" />
                      </div>
                    </CardContent>
                  </Card>
                ))}
              </div>
            )}
          </TabsContent>

          {/* Documentation */}
          <TabsContent value="docs" className="space-y-3 mt-4">
            {filteredDocs.map((doc, i) => (
              <div
                key={`${doc.serviceId}-${i}`}
                className="flex items-center gap-3 p-3 glass-panel rounded-lg border-border/30 hover:border-primary/30 hover:bg-primary/5 transition-all cursor-pointer"
              >
                <BookOpen className={`h-3.5 w-3.5 ${DOC_TYPE_COLORS[doc.type]}`} />
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-medium">{doc.title}</p>
                  <p className="text-[10px] text-muted-foreground">
                    {doc.serviceName} · <span className="font-mono">{doc.path}</span>
                  </p>
                </div>
                <Badge variant="outline" className={`text-[8px] uppercase ${DOC_TYPE_COLORS[doc.type]}`}>
                  {doc.type}
                </Badge>
              </div>
            ))}
          </TabsContent>

          {/* ADRs */}
          <TabsContent value="adrs" className="space-y-3 mt-4">
            {allDocs
              .filter((d) => d.type === "adr")
              .map((doc, i) => (
                <Card key={i} className="glass-panel border-border/40">
                  <CardContent className="p-4">
                    <div className="flex items-center gap-3">
                      <GitBranch className="h-4 w-4 text-violet-400" />
                      <div className="flex-1">
                        <p className="text-sm font-semibold">{doc.title}</p>
                        <p className="text-[10px] text-muted-foreground">
                          Service: {doc.serviceName} · Status: <span className="text-emerald-400">Accepted</span>
                        </p>
                      </div>
                      <Badge variant="outline" className="text-[8px] text-violet-400 border-violet-500/20">ADR</Badge>
                    </div>
                  </CardContent>
                </Card>
              ))}
          </TabsContent>
        </Tabs>
      </main>
    </div>
  );
}
