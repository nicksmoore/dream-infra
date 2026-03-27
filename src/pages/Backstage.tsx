import { useState } from "react";
import { IntentConsole } from "@/components/IntentConsole";
import { CapabilityMatrix } from "@/components/CapabilityMatrix";
import { GuardrailInspector } from "@/components/GuardrailInspector";
import type { ManifestEntryUI } from "@/lib/manifest-data";
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
  Play,
  Package,
  Eye,
  Lock,
  Activity,
  CheckCircle2,
  Clock,
  Hash,
} from "lucide-react";
import { useNavigate } from "react-router-dom";
import { ThemeToggle } from "@/components/ThemeToggle";
import { UserMenu } from "@/components/UserMenu";

/* ═══════════ PRD Section 5.4: Three-Phase Backstage Integration ═══════════ */

// Phase 1: Scaffolder Actions (@naawi/backstage-plugin-scaffolder-actions)
interface ScaffolderAction {
  id: string;
  name: string;
  description: string;
  inputSchema: Record<string, string>;
  outputSchema: Record<string, string>;
  composableWith: string[];
  status: "shipped" | "beta" | "planned";
}

const SCAFFOLDER_ACTIONS: ScaffolderAction[] = [
  {
    id: "naawi:run-preflight",
    name: "naawi:run-preflight",
    description: "Runs mandatory P-1 → P-6 preflight sequence for a Golden Path. Produces PREFLIGHT_COMPLETE ZTAI record. Deploy button does not exist until this passes.",
    inputSchema: { golden_path_id: "string", parameters: "GoldenPathParams", environment: "string", region: "string" },
    outputSchema: { preflight_record: "ZtaiRecord", coherence_score: "number", parameter_hash: "string (SHA-256)", cost_delta: "CostEstimate" },
    composableWith: ["github:create-repo", "kubernetes:create-namespace", "naawi:deploy-golden-path"],
    status: "shipped",
  },
  {
    id: "naawi:deploy-golden-path",
    name: "naawi:deploy-golden-path",
    description: "Executes a Golden Path deployment via DEE (Direct Execution Engine). Requires PREFLIGHT_COMPLETE record. JIT credentials vended per-layer. All state committed to Dolt.",
    inputSchema: { golden_path_id: "string", preflight_hash: "string", environment: "string", region: "string" },
    outputSchema: { deployment_id: "string", ztai_chain: "ZtaiRecord[]", dolt_commit: "string", resources_created: "ResourceRef[]" },
    composableWith: ["naawi:run-preflight", "github:create-repo", "slack:notify"],
    status: "shipped",
  },
  {
    id: "naawi:graduate-brownfield",
    name: "naawi:graduate-brownfield",
    description: "Discovers, analyses, and graduates existing infrastructure into a Golden Path. Three-step: discover → analyse → graduate. No configuration code generated.",
    inputSchema: { discovery_scope: "TagFilter", target_golden_path: "string", environment: "string" },
    outputSchema: { graduation_record: "ZtaiRecord", match_confidence: "'STRONG' | 'PARTIAL' | 'LOW'", rmcm_scores: "Record<string, number>", issues: "Issue[]" },
    composableWith: ["naawi:run-preflight", "naawi:deploy-golden-path"],
    status: "beta",
  },
];

// Phase 2: Entity Card Plugin (@naawi/backstage-plugin)
interface EntityCardField {
  label: string;
  value: string;
  source: string;
  icon: React.ReactNode;
}

const ENTITY_CARD_FIELDS: EntityCardField[] = [
  { label: "Governance State", value: "naawi_created", source: "Dolt → naawi_labels.governance_state", icon: <Shield className="h-3.5 w-3.5 text-emerald-400" /> },
  { label: "Last Deployment", value: "2026-03-18T14:23Z", source: "ZTAI → latest POST_EXECUTION", icon: <Play className="h-3.5 w-3.5 text-primary" /> },
  { label: "RMCM Coherence", value: "97.2%", source: "RMCM → geodesic distance", icon: <Eye className="h-3.5 w-3.5 text-primary" /> },
  { label: "Days Since Drift Check", value: "0", source: "Dolt → raw_hash vs. last describe", icon: <Activity className="h-3.5 w-3.5 text-amber-400" /> },
  { label: "JIT Model", value: "Per-Layer STS", source: "ZTAI → credential metadata", icon: <Lock className="h-3.5 w-3.5 text-amber-400" /> },
  { label: "Audit Chain", value: "147 records, verified", source: "ZTAI → chain integrity", icon: <Hash className="h-3.5 w-3.5 text-violet-400" /> },
];

// Phase 3: Full Catalogue Plugin
// (Renders the Golden Path Catalog embedded in Backstage nav — references existing GoldenPathCatalog component)

// Service Catalog (existing but updated with PRD terminology)
interface ServiceEntry {
  id: string;
  name: string;
  description: string;
  owner: string;
  lifecycle: "production" | "staging" | "experimental" | "deprecated";
  type: "service" | "library" | "infrastructure" | "documentation";
  layer: string; // PRD architecture layer
  techStack: string[];
  docs: DocEntry[];
}

interface DocEntry {
  title: string;
  path: string;
  type: "adr" | "runbook" | "api-ref" | "guide" | "spec" | "patent";
}

const SERVICE_CATALOG: ServiceEntry[] = [
  {
    id: "dee-engine",
    name: "Direct Execution Engine (DEE)",
    description: "Layer 1 — Compiled bijective dispatch table mapping intent type IDs to SDK operation closures. O(1) lookup. Immutable at runtime. Patent §4.8 shared closure invariant.",
    owner: "platform-team",
    lifecycle: "production",
    type: "service",
    layer: "Layer 1 — DEE",
    techStack: ["TypeScript", "Deno", "SigV4", "Bijective Dispatch"],
    docs: [
      { title: "ADR-001: SDK-less Executor", path: "/docs/adr-001", type: "adr" },
      { title: "ADR-002: Trace-Derived Intents", path: "/docs/adr-002", type: "adr" },
      { title: "Patent §4.8: Shared Closure Invariant", path: "/docs/patent-4-8", type: "patent" },
      { title: "Intent Taxonomy Reference", path: "/docs/intent-taxonomy", type: "api-ref" },
      { title: "Runbook: Engine Troubleshooting", path: "/docs/runbook-engine", type: "runbook" },
    ],
  },
  {
    id: "rmcm-engine",
    name: "RMCM — Riemannian Manifold Coherence Module",
    description: "Layer 2 — Models valid system states as a Riemannian manifold with Fisher information metric. Geodesic distance check before every SDK call. Reads from Dolt — zero API calls at steady state.",
    owner: "platform-team",
    lifecycle: "production",
    type: "service",
    layer: "Layer 2 — RMCM",
    techStack: ["TypeScript", "Fisher Information", "Manifold Geometry", "Dolt"],
    docs: [
      { title: "Coherence Scoring Algorithm", path: "/docs/rmcm-scoring", type: "spec" },
      { title: "Geodesic Distance Threshold Tuning", path: "/docs/rmcm-geodesic", type: "guide" },
      { title: "CoherenceViolation Error Reference", path: "/docs/rmcm-errors", type: "api-ref" },
    ],
  },
  {
    id: "dolt-state",
    name: "Dolt State Layer",
    description: "Layer 3 — Git-for-data relational database. Normalised attrs tables + resource_raw for drift detection. Every commit linked to ZTAI via ztai_refs. VPC hash mismatch = FoundationDriftError.",
    owner: "platform-team",
    lifecycle: "production",
    type: "infrastructure",
    layer: "Layer 3 — Dolt",
    techStack: ["Dolt", "SQL", "SHA-256", "Roughtime"],
    docs: [
      { title: "ADR-003: Dolt vs. IaC State", path: "/docs/adr-003", type: "adr" },
      { title: "VPC Foundation Schema (Section 6)", path: "/docs/dolt-vpc-schema", type: "spec" },
      { title: "Drift Detection: raw_hash Compare", path: "/docs/dolt-drift", type: "guide" },
      { title: "FoundationDriftError Reference", path: "/docs/foundation-drift", type: "api-ref" },
    ],
  },
  {
    id: "ztai-audit",
    name: "ZTAI — Zero-Trust Audit Infrastructure",
    description: "Layer 4 — Append-only, hash-linked audit chain. ECDSA-P256 TEE-signed records. Rekor transparency log publication. SOC 2 / PCI DSS / ISO 27001 / GDPR / HIPAA compliance.",
    owner: "security-team",
    lifecycle: "production",
    type: "service",
    layer: "Layer 4 — ZTAI",
    techStack: ["ECDSA-P256", "TEE (SEV-SNP/TDX/TPM)", "Rekor", "Roughtime"],
    docs: [
      { title: "ZTAI Record Schema & Phases", path: "/docs/ztai-schema", type: "spec" },
      { title: "TEE Attestation Verification", path: "/docs/ztai-tee", type: "guide" },
      { title: "Rekor Transparency Log Push", path: "/docs/ztai-rekor", type: "runbook" },
      { title: "Compliance Framework Mapping", path: "/docs/ztai-compliance", type: "spec" },
    ],
  },
  {
    id: "jit-permissions",
    name: "JIT Permissions Engine",
    description: "Layer 5 — No standing AWS credentials. Per-layer STS AssumeRole with inline session policies scoped to exact actions and ARNs. TTL = estimated execution + 5min buffer. Session ARN in ZTAI record.",
    owner: "security-team",
    lifecycle: "production",
    type: "service",
    layer: "Layer 5 — JIT",
    techStack: ["AWS STS", "Session Policies", "Inline Scoping"],
    docs: [
      { title: "JIT Permission Matrix (Section 8)", path: "/docs/jit-matrix", type: "spec" },
      { title: "Per-Layer Credential Vending", path: "/docs/jit-vending", type: "guide" },
      { title: "Cross-Layer Isolation Rules", path: "/docs/jit-isolation", type: "api-ref" },
    ],
  },
  {
    id: "golden-path-registry",
    name: "Golden Path Registry",
    description: "Compiled intent batches with versioned parameter schemas, dependency graphs, RMCM thresholds, and community stress-test counts. Not templates — executable artifacts.",
    owner: "platform-team",
    lifecycle: "production",
    type: "infrastructure",
    layer: "Product Surface",
    techStack: ["TypeScript", "Intent Taxonomy", "RMCM", "JIT"],
    docs: [
      { title: "Golden Path Catalogue (Section 5.1)", path: "/docs/golden-path-catalogue", type: "spec" },
      { title: "Preflight Gate (P-0 → P-6)", path: "/docs/preflight-gate", type: "guide" },
      { title: "VPC Dependency Graph (Section 7)", path: "/docs/vpc-dep-graph", type: "spec" },
      { title: "Safety Gate Reference", path: "/docs/safety-gate", type: "api-ref" },
    ],
  },
  {
    id: "brownfield-engine",
    name: "Brownfield-to-Golden-Path Engine",
    description: "Three commands: naawi discover (tag-scoped, resumable), naawi analyse (RMCM on discovered state), naawi graduate (pre-populated form, GRADUATION_COMPLETE). No config code generated.",
    owner: "platform-team",
    lifecycle: "staging",
    type: "service",
    layer: "Product Surface",
    techStack: ["TypeScript", "AWS Describe APIs", "Dolt", "RMCM"],
    docs: [
      { title: "Brownfield Workflow (Section 5.3)", path: "/docs/brownfield-workflow", type: "spec" },
      { title: "Discovery Scope & Rate Limiting", path: "/docs/brownfield-discovery", type: "guide" },
      { title: "Graduation Preflight (P-0)", path: "/docs/brownfield-graduation", type: "guide" },
    ],
  },
  {
    id: "credential-vault",
    name: "Credential Vault (BYOC)",
    description: "AES-256-GCM encrypted credential storage. Bring Your Own Credentials with per-user isolation. Decrypted only during SDK client context, purged immediately after.",
    owner: "security-team",
    lifecycle: "production",
    type: "service",
    layer: "Security",
    techStack: ["Web Crypto API", "AES-256-GCM"],
    docs: [
      { title: "BYOC Security Model", path: "/docs/byoc-security", type: "guide" },
      { title: "Credential Rotation Runbook", path: "/docs/cred-rotation", type: "runbook" },
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
  patent: "text-red-400",
};

const ACTION_STATUS_COLORS: Record<string, string> = {
  shipped: "bg-emerald-500/10 text-emerald-400 border-emerald-500/20",
  beta: "bg-amber-500/10 text-amber-400 border-amber-500/20",
  planned: "bg-muted text-muted-foreground border-border/50",
};

export default function Backstage() {
  const navigate = useNavigate();
  const [search, setSearch] = useState("");
  const [selectedService, setSelectedService] = useState<ServiceEntry | null>(null);
  const [selectedManifestEntry, setSelectedManifestEntry] = useState<ManifestEntryUI | null>(null);
  const [activeTab, setActiveTab] = useState("intent-console");

  const filtered = SERVICE_CATALOG.filter((s) => {
    if (!search) return true;
    const q = search.toLowerCase();
    return (
      s.name.toLowerCase().includes(q) ||
      s.description.toLowerCase().includes(q) ||
      s.layer.toLowerCase().includes(q) ||
      s.techStack.some((t) => t.toLowerCase().includes(q))
    );
  });

  const allDocs = SERVICE_CATALOG.flatMap((s) =>
    s.docs.map((d) => ({ ...d, serviceName: s.name, serviceId: s.id, layer: s.layer }))
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
            <Button variant="ghost" size="sm" onClick={() => navigate("/console")} className="gap-1.5 text-muted-foreground hover:text-foreground">
              <ArrowLeft className="h-3.5 w-3.5" /> Back
            </Button>
            <Separator orientation="vertical" className="h-5" />
            <div className="flex items-center gap-2">
              <BookOpen className="h-5 w-5 text-primary" />
              <div>
                <h1 className="text-base font-bold tracking-tight font-display text-foreground">Backstage</h1>
                <p className="text-[10px] text-muted-foreground tracking-wide">PRD §5.4 — Scaffolder Actions · Entity Cards · Catalogue Plugin</p>
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
            placeholder="Search services, docs, ADRs, scaffolder actions…"
            className="pl-11 h-11 text-sm glass-panel-elevated border-border/50"
          />
        </div>

        <Tabs value={activeTab} onValueChange={setActiveTab} className="w-full">
          <TabsList className="glass-panel border-0 p-1 h-auto flex-wrap">
            <TabsTrigger value="scaffolder" className="gap-1.5 data-[state=active]:bg-primary/10 data-[state=active]:text-primary rounded-lg text-xs">
              <Play className="h-3.5 w-3.5" /> Scaffolder Actions
              <Badge variant="secondary" className="text-[8px] ml-1">Phase 1</Badge>
            </TabsTrigger>
            <TabsTrigger value="entity-cards" className="gap-1.5 data-[state=active]:bg-primary/10 data-[state=active]:text-primary rounded-lg text-xs">
              <Package className="h-3.5 w-3.5" /> Entity Cards
              <Badge variant="secondary" className="text-[8px] ml-1">Phase 2</Badge>
            </TabsTrigger>
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

          {/* ═══════════ SCAFFOLDER ACTIONS (Phase 1) ═══════════ */}
          <TabsContent value="scaffolder" className="space-y-4 mt-4">
            <div className="glass-panel-elevated rounded-xl p-4 border-l-2 border-primary/40">
              <div className="flex items-start gap-3">
                <Package className="w-5 h-5 text-primary mt-0.5 shrink-0" />
                <div className="text-sm space-y-1">
                  <p className="font-semibold text-foreground">@naawi/backstage-plugin-scaffolder-actions</p>
                  <p className="text-muted-foreground leading-relaxed">
                    Composable into any Backstage Scaffolder template. Platform teams wire these alongside{" "}
                    <code className="font-mono text-xs text-primary">github:create-repo</code> and{" "}
                    <code className="font-mono text-xs text-primary">kubernetes:create-namespace</code> in a single "Create Service" template.
                    Backstage user identity flows to ZTAI <code className="font-mono text-xs">agent_principal</code>.
                  </p>
                </div>
              </div>
            </div>

            {SCAFFOLDER_ACTIONS.map((action) => (
              <Card key={action.id} className="glass-panel border-border/40">
                <CardContent className="p-5 space-y-4">
                  <div className="flex items-start justify-between">
                    <div>
                      <div className="flex items-center gap-2 flex-wrap">
                        <code className="font-mono text-sm font-semibold text-primary">{action.name}</code>
                        <Badge variant="outline" className={`text-[8px] uppercase ${ACTION_STATUS_COLORS[action.status]}`}>
                          {action.status}
                        </Badge>
                      </div>
                      <p className="text-xs text-muted-foreground mt-1.5 leading-relaxed max-w-2xl">{action.description}</p>
                    </div>
                  </div>

                  <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                    <div>
                      <span className="text-[10px] uppercase tracking-wider text-muted-foreground font-semibold">Input Schema</span>
                      <pre className="mt-1 font-mono text-[11px] bg-muted/40 rounded-lg p-3 border border-border/50">
                        {Object.entries(action.inputSchema).map(([k, v]) => (
                          <span key={k}>
                            <span className="text-muted-foreground">{k}:</span> <span className="text-primary">{v}</span>{"\n"}
                          </span>
                        ))}
                      </pre>
                    </div>
                    <div>
                      <span className="text-[10px] uppercase tracking-wider text-muted-foreground font-semibold">Output Schema</span>
                      <pre className="mt-1 font-mono text-[11px] bg-muted/40 rounded-lg p-3 border border-border/50">
                        {Object.entries(action.outputSchema).map(([k, v]) => (
                          <span key={k}>
                            <span className="text-muted-foreground">{k}:</span> <span className="text-emerald-400">{v}</span>{"\n"}
                          </span>
                        ))}
                      </pre>
                    </div>
                  </div>

                  <div>
                    <span className="text-[10px] uppercase tracking-wider text-muted-foreground font-semibold">Composable With</span>
                    <div className="flex flex-wrap gap-1.5 mt-1">
                      {action.composableWith.map((c) => (
                        <Badge key={c} variant="secondary" className="text-[9px] font-mono">{c}</Badge>
                      ))}
                    </div>
                  </div>
                </CardContent>
              </Card>
            ))}
          </TabsContent>

          {/* ═══════════ ENTITY CARDS (Phase 2) ═══════════ */}
          <TabsContent value="entity-cards" className="space-y-4 mt-4">
            <div className="glass-panel-elevated rounded-xl p-4 border-l-2 border-primary/40">
              <div className="flex items-start gap-3">
                <Eye className="w-5 h-5 text-primary mt-0.5 shrink-0" />
                <div className="text-sm space-y-1">
                  <p className="font-semibold text-foreground">@naawi/backstage-plugin — Entity Card</p>
                  <p className="text-muted-foreground leading-relaxed">
                    Single EntityPage card per annotated service entity. Scorecard data feeds into Backstage's native scoring systems for platform PM adoption tracking.
                  </p>
                </div>
              </div>
            </div>

            <Card className="glass-panel-elevated border-border/40">
              <CardHeader className="pb-3">
                <div className="flex items-center gap-2">
                  <div className="h-8 w-8 rounded-lg bg-primary/10 flex items-center justify-center">
                    <Shield className="h-4 w-4 text-primary" />
                  </div>
                  <div>
                    <CardTitle className="text-sm">my-payment-service</CardTitle>
                    <CardDescription className="text-[10px] font-mono">naawi.gold.v1.FintechPci</CardDescription>
                  </div>
                  <Badge variant="outline" className="ml-auto text-[8px] bg-emerald-500/10 text-emerald-400 border-emerald-500/20">
                    <CheckCircle2 className="h-2.5 w-2.5 mr-1" /> GOVERNED
                  </Badge>
                </div>
              </CardHeader>
              <CardContent className="space-y-2">
                {ENTITY_CARD_FIELDS.map((field) => (
                  <div key={field.label} className="flex items-center gap-3 py-1.5 border-b border-border/20 last:border-0">
                    {field.icon}
                    <div className="flex-1">
                      <span className="text-xs font-medium">{field.label}</span>
                      <p className="text-[10px] text-muted-foreground font-mono">{field.source}</p>
                    </div>
                    <span className="text-xs font-mono font-semibold text-foreground">{field.value}</span>
                  </div>
                ))}
                <div className="pt-2">
                  <Button variant="outline" size="sm" className="w-full text-[10px] gap-1.5 h-7">
                    <ExternalLink className="h-3 w-3" /> View ZTAI Audit Trail
                  </Button>
                </div>
              </CardContent>
            </Card>

            <div className="glass-panel rounded-xl p-4">
              <p className="text-[10px] uppercase tracking-wider text-muted-foreground font-semibold mb-2">Phase 3: Full Catalogue Plugin</p>
              <p className="text-xs text-muted-foreground leading-relaxed">
                Full Golden Path catalogue embedded in Backstage nav. Parameter form, preflight report, execution timeline, and execution history tabs.
                Graduation wizard for brownfield resources. Software Template registration of all Golden Paths for discovery via Backstage Create menu.
              </p>
              <Badge variant="outline" className="mt-2 text-[9px]">
                <Clock className="h-3 w-3 mr-1" /> Ships 6 weeks after Phase 1
              </Badge>
            </div>
          </TabsContent>

          {/* ═══════════ SERVICE CATALOG ═══════════ */}
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
                      <Badge variant="outline" className="text-[9px] font-mono border-primary/20 text-primary">
                        {selectedService.layer}
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
                          <Badge variant="outline" className="text-[8px] font-mono border-primary/20 text-primary mt-1">
                            {service.layer}
                          </Badge>
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

          {/* ═══════════ DOCUMENTATION ═══════════ */}
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
                    {doc.serviceName} · <span className="font-mono">{doc.layer}</span> · <span className="font-mono">{doc.path}</span>
                  </p>
                </div>
                <Badge variant="outline" className={`text-[8px] uppercase ${DOC_TYPE_COLORS[doc.type]}`}>
                  {doc.type}
                </Badge>
              </div>
            ))}
          </TabsContent>

          {/* ═══════════ ADRs ═══════════ */}
          <TabsContent value="adrs" className="space-y-3 mt-4">
            {allDocs
              .filter((d) => d.type === "adr" || d.type === "patent")
              .map((doc, i) => (
                <Card key={i} className="glass-panel border-border/40">
                  <CardContent className="p-4">
                    <div className="flex items-center gap-3">
                      <GitBranch className={`h-4 w-4 ${doc.type === "patent" ? "text-red-400" : "text-violet-400"}`} />
                      <div className="flex-1">
                        <p className="text-sm font-semibold">{doc.title}</p>
                        <p className="text-[10px] text-muted-foreground">
                          {doc.serviceName} · {doc.layer} · Status: <span className="text-emerald-400">Accepted</span>
                        </p>
                      </div>
                      <Badge variant="outline" className={`text-[8px] ${doc.type === "patent" ? "text-red-400 border-red-500/20" : "text-violet-400 border-violet-500/20"}`}>
                        {doc.type.toUpperCase()}
                      </Badge>
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
