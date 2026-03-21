import { useState } from "react";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Progress } from "@/components/ui/progress";
import { Switch } from "@/components/ui/switch";
import { UserMenu } from "@/components/UserMenu";
import { ThemeToggle } from "@/components/ThemeToggle";
import { NavLink } from "@/components/NavLink";
import {
  Activity, Brain, Shield, Server, BookOpen, GitBranch,
  AlertTriangle, CheckCircle2, Clock, Zap, Eye, Lock,
  RefreshCw, Terminal, MessageSquare, FileText, Layers,
  ArrowRight, Radio, Gauge, HeartPulse, Bot, Workflow,
  ShieldCheck, TriangleAlert, CircleDot, Play, Pause,
  ChevronRight, ExternalLink, Timer,
} from "lucide-react";

// ── Types ──────────────────────────────────────────────
interface McpServer {
  id: string;
  name: string;
  role: string;
  icon: React.ReactNode;
  status: "connected" | "degraded" | "disconnected";
  tools: { name: string; type: "read" | "write"; description: string }[];
}

interface Incident {
  id: string;
  severity: "critical" | "high" | "medium" | "low";
  title: string;
  status: "detected" | "diagnosing" | "remediating" | "validating" | "resolved";
  detectedAt: string;
  resolvedAt?: string;
  steps: { label: string; status: "done" | "active" | "pending"; detail?: string }[];
  mcpCalls: number;
}

// ── Data ───────────────────────────────────────────────
const MCP_SERVERS: McpServer[] = [
  {
    id: "observability",
    name: "Observability Server",
    role: "Prometheus / Grafana metrics & log correlation",
    icon: <Gauge className="h-5 w-5" />,
    status: "connected",
    tools: [
      { name: "fetch_metrics", type: "read", description: "Pull p99 latency, error rates over window T" },
      { name: "query_logs", type: "read", description: "Correlate logs across services by trace ID" },
      { name: "get_alert_history", type: "read", description: "Fetch recent alert timeline" },
    ],
  },
  {
    id: "cloud-control",
    name: "Cloud Control Server",
    role: "AWS / GCP / K8s resource state & mutations",
    icon: <Server className="h-5 w-5" />,
    status: "connected",
    tools: [
      { name: "describe_pod", type: "read", description: "Get K8s pod state & events" },
      { name: "list_deployments", type: "read", description: "List K8s deployments with replica counts" },
      { name: "scale_up_deployment", type: "write", description: "Scale deployment replicas (pre-approved)" },
      { name: "patch_k8s_resource", type: "write", description: "Patch resource limits/requests" },
      { name: "restart_pod", type: "write", description: "Rolling restart of a deployment" },
      { name: "flush_redis_cache", type: "write", description: "Flush Redis cache (pre-approved)" },
    ],
  },
  {
    id: "knowledge",
    name: "Knowledge Server",
    role: "Internal runbooks, Notion docs, GitHub wikis",
    icon: <BookOpen className="h-5 w-5" />,
    status: "connected",
    tools: [
      { name: "search_runbooks", type: "read", description: "Search runbooks by incident type" },
      { name: "get_playbook", type: "read", description: "Retrieve step-by-step playbook" },
      { name: "draft_postmortem", type: "write", description: "Generate markdown post-mortem from session" },
    ],
  },
];

const LIVE_INCIDENTS: Incident[] = [
  {
    id: "INC-2847",
    severity: "critical",
    title: "Pod OOMKilled — checkout-service-7d4f8",
    status: "validating",
    detectedAt: "2026-03-21T14:32:00Z",
    steps: [
      { label: "Alert received from Prometheus", status: "done", detail: "OOMKilled event on checkout-service pod" },
      { label: "Queried K8s pod state via MCP", status: "done", detail: "describe_pod → OOMKilled, memory limit 256Mi" },
      { label: "Fetched last 100 log lines", status: "done", detail: "query_logs → memory spike correlates with batch job at 14:31" },
      { label: "LLM analysis: insufficient memory limits", status: "done", detail: "Identified memory leak in image processing routine" },
      { label: "Patched memory limits +20% (256→307Mi)", status: "done", detail: "patch_k8s_resource executed successfully" },
      { label: "Monitoring stability (5 min window)", status: "active", detail: "3/5 minutes elapsed — no OOM events" },
    ],
    mcpCalls: 8,
  },
  {
    id: "INC-2846",
    severity: "high",
    title: "p99 latency spike — api-gateway",
    status: "diagnosing",
    detectedAt: "2026-03-21T14:28:00Z",
    steps: [
      { label: "Alert: p99 latency > 2s threshold", status: "done", detail: "fetch_metrics → p99 at 3.4s (baseline 200ms)" },
      { label: "Correlating distributed traces", status: "active", detail: "query_logs → tracing upstream dependency bottleneck" },
      { label: "Identify root cause", status: "pending" },
      { label: "Execute remediation", status: "pending" },
      { label: "Validate resolution", status: "pending" },
    ],
    mcpCalls: 4,
  },
  {
    id: "INC-2840",
    severity: "medium",
    title: "Redis cache miss rate elevated — user-profile-svc",
    status: "resolved",
    detectedAt: "2026-03-21T12:15:00Z",
    resolvedAt: "2026-03-21T12:22:00Z",
    steps: [
      { label: "Alert: cache miss rate > 40%", status: "done" },
      { label: "Identified stale TTL configuration", status: "done" },
      { label: "Flushed and re-warmed cache", status: "done" },
      { label: "Validated miss rate < 5%", status: "done" },
    ],
    mcpCalls: 6,
  },
];

const METRICS = {
  mttrReduction: 42,
  toilReduction: 67,
  autoResolved: 84,
  falsePositiveRate: 2.1,
  avgMcpCalls: 7.3,
  incidentsToday: 12,
};

// ── Helpers ────────────────────────────────────────────
function severityColor(s: Incident["severity"]) {
  switch (s) {
    case "critical": return "bg-destructive text-destructive-foreground";
    case "high": return "bg-[hsl(var(--warning))] text-foreground";
    case "medium": return "bg-primary/20 text-primary";
    case "low": return "bg-muted text-muted-foreground";
  }
}

function statusIcon(s: Incident["status"]) {
  switch (s) {
    case "detected": return <Radio className="h-4 w-4 text-destructive animate-pulse" />;
    case "diagnosing": return <Eye className="h-4 w-4 text-[hsl(var(--warning))]" />;
    case "remediating": return <Zap className="h-4 w-4 text-primary animate-pulse" />;
    case "validating": return <HeartPulse className="h-4 w-4 text-[hsl(var(--success))] animate-pulse" />;
    case "resolved": return <CheckCircle2 className="h-4 w-4 text-[hsl(var(--success))]" />;
  }
}

// ── Component ──────────────────────────────────────────
export default function SelfDrivingSRE() {
  const [selectedIncident, setSelectedIncident] = useState<string>(LIVE_INCIDENTS[0].id);
  const [agentMode, setAgentMode] = useState<"responder" | "read-only">("responder");

  const activeIncident = LIVE_INCIDENTS.find(i => i.id === selectedIncident)!;

  return (
    <div className="min-h-screen bg-background text-foreground">
      {/* ── Header ─────────────────────────────── */}
      <header className="sticky top-0 z-50 border-b border-border bg-background/80 backdrop-blur-lg">
        <div className="max-w-[1600px] mx-auto flex items-center justify-between h-14 px-4 md:px-6">
          <div className="flex items-center gap-3">
            <Bot className="h-6 w-6 text-primary" />
            <span className="font-semibold text-lg tracking-tight font-['Space_Grotesk']">Self-Driving SRE</span>
            <Badge variant="outline" className="text-xs border-primary/30 text-primary">MCP-Powered</Badge>
          </div>
          <nav className="hidden md:flex items-center gap-1">
            <NavLink to="/console">Console</NavLink>
            <NavLink to="/golden-path">Golden Paths</NavLink>
            <NavLink to="/backstage">Backstage</NavLink>
            <NavLink to="/sre">SRE</NavLink>
          </nav>
          <div className="flex items-center gap-2">
            <ThemeToggle />
            <UserMenu />
          </div>
        </div>
      </header>

      <main className="max-w-[1600px] mx-auto px-4 md:px-6 py-6 space-y-6">
        {/* ── Top Metrics ──────────────────────── */}
        <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-3">
          {[
            { label: "MTTR Reduction", value: `${METRICS.mttrReduction}%`, icon: <Timer className="h-4 w-4" />, target: "Goal: 40%" },
            { label: "Toil Reduction", value: `${METRICS.toilReduction}%`, icon: <Workflow className="h-4 w-4" />, target: "Auto-resolved" },
            { label: "Auto-Resolved", value: `${METRICS.autoResolved}%`, icon: <Bot className="h-4 w-4" />, target: "No human needed" },
            { label: "False Positive", value: `${METRICS.falsePositiveRate}%`, icon: <ShieldCheck className="h-4 w-4" />, target: "< 5% target" },
            { label: "Avg MCP Calls", value: `${METRICS.avgMcpCalls}`, icon: <Zap className="h-4 w-4" />, target: "Per incident" },
            { label: "Incidents Today", value: `${METRICS.incidentsToday}`, icon: <Activity className="h-4 w-4" />, target: `${Math.round(METRICS.incidentsToday * METRICS.autoResolved / 100)} auto-resolved` },
          ].map((m, i) => (
            <Card key={i} className="border-border">
              <CardContent className="p-4">
                <div className="flex items-center gap-2 text-muted-foreground mb-1">
                  {m.icon}
                  <span className="text-xs font-medium">{m.label}</span>
                </div>
                <div className="text-2xl font-bold font-['Space_Grotesk'] text-foreground">{m.value}</div>
                <span className="text-xs text-muted-foreground">{m.target}</span>
              </CardContent>
            </Card>
          ))}
        </div>

        {/* ── Agent Mode Toggle ────────────────── */}
        <Card className="border-border">
          <CardContent className="p-4 flex items-center justify-between">
            <div className="flex items-center gap-3">
              <Brain className="h-5 w-5 text-primary" />
              <div>
                <p className="font-medium text-sm">Agent Mode</p>
                <p className="text-xs text-muted-foreground">
                  {agentMode === "responder"
                    ? "Responder — can execute pre-approved mutation tools"
                    : "Read-Only — observation and diagnosis only"}
                </p>
              </div>
            </div>
            <div className="flex items-center gap-3">
              <span className="text-xs text-muted-foreground">Read-Only</span>
              <Switch
                checked={agentMode === "responder"}
                onCheckedChange={(v) => setAgentMode(v ? "responder" : "read-only")}
              />
              <span className="text-xs text-muted-foreground">Responder</span>
              {agentMode === "responder" && (
                <Badge className="bg-[hsl(var(--success))]/15 text-[hsl(var(--success))] border-[hsl(var(--success))]/30 text-xs">
                  <Lock className="h-3 w-3 mr-1" /> JIT Scoped
                </Badge>
              )}
            </div>
          </CardContent>
        </Card>

        <Tabs defaultValue="incidents" className="space-y-4">
          <TabsList className="bg-muted/50 border border-border">
            <TabsTrigger value="incidents" className="gap-1.5 text-xs"><AlertTriangle className="h-3.5 w-3.5" /> Live Incidents</TabsTrigger>
            <TabsTrigger value="architecture" className="gap-1.5 text-xs"><Layers className="h-3.5 w-3.5" /> MCP Architecture</TabsTrigger>
            <TabsTrigger value="tools" className="gap-1.5 text-xs"><Terminal className="h-3.5 w-3.5" /> Tool Registry</TabsTrigger>
            <TabsTrigger value="postmortems" className="gap-1.5 text-xs"><FileText className="h-3.5 w-3.5" /> Post-Mortems</TabsTrigger>
          </TabsList>

          {/* ── Live Incidents ─────────────────── */}
          <TabsContent value="incidents" className="space-y-4">
            <div className="grid lg:grid-cols-[340px_1fr] gap-4">
              {/* Incident list */}
              <div className="space-y-2">
                <h3 className="text-sm font-semibold text-muted-foreground px-1">Active & Recent</h3>
                {LIVE_INCIDENTS.map((inc) => (
                  <Card
                    key={inc.id}
                    className={`cursor-pointer transition-all border-border hover:border-primary/40 ${selectedIncident === inc.id ? "ring-1 ring-primary border-primary/50" : ""}`}
                    onClick={() => setSelectedIncident(inc.id)}
                  >
                    <CardContent className="p-3">
                      <div className="flex items-start justify-between gap-2 mb-1.5">
                        <div className="flex items-center gap-2">
                          {statusIcon(inc.status)}
                          <span className="text-xs font-mono text-muted-foreground">{inc.id}</span>
                        </div>
                        <Badge className={`text-[10px] ${severityColor(inc.severity)}`}>{inc.severity}</Badge>
                      </div>
                      <p className="text-sm font-medium leading-tight">{inc.title}</p>
                      <div className="flex items-center gap-3 mt-2 text-xs text-muted-foreground">
                        <span className="flex items-center gap-1"><Clock className="h-3 w-3" />{new Date(inc.detectedAt).toLocaleTimeString()}</span>
                        <span className="flex items-center gap-1"><Zap className="h-3 w-3" />{inc.mcpCalls} MCP calls</span>
                      </div>
                    </CardContent>
                  </Card>
                ))}
              </div>

              {/* Incident detail */}
              <Card className="border-border">
                <CardHeader className="pb-3">
                  <div className="flex items-center justify-between">
                    <div>
                      <div className="flex items-center gap-2 mb-1">
                        {statusIcon(activeIncident.status)}
                        <Badge className={`text-xs ${severityColor(activeIncident.severity)}`}>{activeIncident.severity}</Badge>
                        <span className="text-xs font-mono text-muted-foreground">{activeIncident.id}</span>
                      </div>
                      <CardTitle className="text-lg">{activeIncident.title}</CardTitle>
                    </div>
                    <Badge variant="outline" className="text-xs capitalize">{activeIncident.status}</Badge>
                  </div>
                </CardHeader>
                <CardContent className="space-y-4">
                  <h4 className="text-sm font-semibold text-muted-foreground">Autonomous Resolution Timeline</h4>
                  <div className="space-y-3">
                    {activeIncident.steps.map((step, i) => (
                      <div key={i} className="flex items-start gap-3">
                        <div className="flex flex-col items-center">
                          <div className={`rounded-full p-1 ${
                            step.status === "done" ? "bg-[hsl(var(--success))]/15 text-[hsl(var(--success))]" :
                            step.status === "active" ? "bg-primary/15 text-primary animate-pulse" :
                            "bg-muted text-muted-foreground"
                          }`}>
                            {step.status === "done" ? <CheckCircle2 className="h-4 w-4" /> :
                             step.status === "active" ? <Play className="h-4 w-4" /> :
                             <CircleDot className="h-4 w-4" />}
                          </div>
                          {i < activeIncident.steps.length - 1 && (
                            <div className={`w-px h-6 ${step.status === "done" ? "bg-[hsl(var(--success))]/30" : "bg-border"}`} />
                          )}
                        </div>
                        <div className="flex-1 -mt-0.5">
                          <p className={`text-sm font-medium ${step.status === "pending" ? "text-muted-foreground" : ""}`}>{step.label}</p>
                          {step.detail && <p className="text-xs text-muted-foreground mt-0.5">{step.detail}</p>}
                        </div>
                      </div>
                    ))}
                  </div>

                  {activeIncident.status !== "resolved" && (
                    <div className="flex gap-2 pt-2">
                      <Button size="sm" variant="outline" className="text-xs gap-1.5">
                        <Pause className="h-3.5 w-3.5" /> Pause Agent
                      </Button>
                      <Button size="sm" variant="outline" className="text-xs gap-1.5">
                        <MessageSquare className="h-3.5 w-3.5" /> HITL Escalate
                      </Button>
                    </div>
                  )}
                </CardContent>
              </Card>
            </div>
          </TabsContent>

          {/* ── MCP Architecture ───────────────── */}
          <TabsContent value="architecture" className="space-y-4">
            {/* Architecture diagram */}
            <Card className="border-border">
              <CardHeader>
                <CardTitle className="text-base flex items-center gap-2"><Brain className="h-5 w-5 text-primary" /> MCP Host — SRE Agent</CardTitle>
                <CardDescription>LLM "Brain" orchestrating troubleshooting logic via standardized MCP protocol</CardDescription>
              </CardHeader>
              <CardContent>
                <div className="grid md:grid-cols-3 gap-4">
                  {MCP_SERVERS.map((srv) => (
                    <Card key={srv.id} className="border-border bg-muted/30">
                      <CardContent className="p-4">
                        <div className="flex items-center justify-between mb-3">
                          <div className="flex items-center gap-2">
                            <div className="p-2 rounded-lg bg-primary/10 text-primary">{srv.icon}</div>
                            <div>
                              <p className="text-sm font-semibold">{srv.name}</p>
                              <p className="text-xs text-muted-foreground">{srv.role}</p>
                            </div>
                          </div>
                          <Badge variant="outline" className={`text-[10px] ${
                            srv.status === "connected" ? "border-[hsl(var(--success))]/40 text-[hsl(var(--success))]" :
                            srv.status === "degraded" ? "border-[hsl(var(--warning))]/40 text-[hsl(var(--warning))]" :
                            "border-destructive/40 text-destructive"
                          }`}>
                            {srv.status}
                          </Badge>
                        </div>
                        <div className="space-y-1.5">
                          {srv.tools.map((t) => (
                            <div key={t.name} className="flex items-center gap-2 text-xs">
                              <Badge variant="outline" className={`text-[9px] px-1.5 ${t.type === "write" ? "border-[hsl(var(--warning))]/40 text-[hsl(var(--warning))]" : "border-primary/30 text-primary"}`}>
                                {t.type}
                              </Badge>
                              <code className="font-mono text-muted-foreground">{t.name}</code>
                            </div>
                          ))}
                        </div>
                      </CardContent>
                    </Card>
                  ))}
                </div>
              </CardContent>
            </Card>

            {/* Data flow */}
            <Card className="border-border">
              <CardHeader>
                <CardTitle className="text-base">Autonomous Recovery Flow</CardTitle>
              </CardHeader>
              <CardContent>
                <div className="flex flex-wrap items-center gap-2 text-xs font-medium">
                  {[
                    { label: "Prometheus Alert", icon: <Radio className="h-3.5 w-3.5" /> },
                    { label: "MCP Host Triggered", icon: <Brain className="h-3.5 w-3.5" /> },
                    { label: "Observe (Read Tools)", icon: <Eye className="h-3.5 w-3.5" /> },
                    { label: "LLM Diagnosis", icon: <Activity className="h-3.5 w-3.5" /> },
                    { label: "HITL Gate (if high-risk)", icon: <Shield className="h-3.5 w-3.5" /> },
                    { label: "Remediate (Write Tools)", icon: <Zap className="h-3.5 w-3.5" /> },
                    { label: "Validate (5 min)", icon: <HeartPulse className="h-3.5 w-3.5" /> },
                    { label: "Close & Post-Mortem", icon: <FileText className="h-3.5 w-3.5" /> },
                  ].map((step, i, arr) => (
                    <div key={i} className="flex items-center gap-2">
                      <div className="flex items-center gap-1.5 px-3 py-2 rounded-lg bg-muted border border-border">
                        <span className="text-primary">{step.icon}</span>
                        <span>{step.label}</span>
                      </div>
                      {i < arr.length - 1 && <ChevronRight className="h-4 w-4 text-muted-foreground" />}
                    </div>
                  ))}
                </div>
              </CardContent>
            </Card>

            {/* Security constraints */}
            <div className="grid md:grid-cols-3 gap-4">
              {[
                { title: "Authentication", desc: "All MCP servers use short-lived tokens or IAM roles. JIT-scoped credentials per session.", icon: <Lock className="h-5 w-5" /> },
                { title: "Read-Only Default", desc: "LLM has Read tools only. Promoted to Responder status for pre-approved mutations.", icon: <Eye className="h-5 w-5" /> },
                { title: "Latency Optimized", desc: "Paginated log fetching, cached metric windows, sub-second MCP round-trips.", icon: <Timer className="h-5 w-5" /> },
              ].map((c, i) => (
                <Card key={i} className="border-border">
                  <CardContent className="p-4">
                    <div className="flex items-center gap-2 mb-2 text-primary">{c.icon}<span className="font-semibold text-sm">{c.title}</span></div>
                    <p className="text-xs text-muted-foreground leading-relaxed">{c.desc}</p>
                  </CardContent>
                </Card>
              ))}
            </div>
          </TabsContent>

          {/* ── Tool Registry ──────────────────── */}
          <TabsContent value="tools" className="space-y-4">
            {MCP_SERVERS.map((srv) => (
              <Card key={srv.id} className="border-border">
                <CardHeader className="pb-3">
                  <CardTitle className="text-base flex items-center gap-2">
                    <span className="text-primary">{srv.icon}</span>
                    {srv.name}
                    <Badge variant="outline" className="text-xs ml-auto">{srv.tools.length} tools</Badge>
                  </CardTitle>
                </CardHeader>
                <CardContent>
                  <div className="grid md:grid-cols-2 gap-3">
                    {srv.tools.map((t) => (
                      <div key={t.name} className="flex items-start gap-3 p-3 rounded-lg border border-border bg-muted/20">
                        <div className={`p-1.5 rounded-md ${t.type === "write" ? "bg-[hsl(var(--warning))]/10 text-[hsl(var(--warning))]" : "bg-primary/10 text-primary"}`}>
                          {t.type === "write" ? <Zap className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                        </div>
                        <div className="flex-1">
                          <div className="flex items-center gap-2">
                            <code className="text-sm font-mono font-medium">{t.name}</code>
                            <Badge variant="outline" className={`text-[9px] ${t.type === "write" ? "border-[hsl(var(--warning))]/40 text-[hsl(var(--warning))]" : "border-primary/30 text-primary"}`}>
                              {t.type}
                            </Badge>
                            {t.type === "write" && agentMode === "read-only" && (
                              <Badge variant="outline" className="text-[9px] border-destructive/40 text-destructive">locked</Badge>
                            )}
                          </div>
                          <p className="text-xs text-muted-foreground mt-0.5">{t.description}</p>
                        </div>
                      </div>
                    ))}
                  </div>
                </CardContent>
              </Card>
            ))}

            {/* HITL section */}
            <Card className="border-border border-[hsl(var(--warning))]/30">
              <CardContent className="p-4">
                <div className="flex items-center gap-2 mb-2">
                  <Shield className="h-5 w-5 text-[hsl(var(--warning))]" />
                  <span className="font-semibold text-sm">Human-in-the-Loop (HITL) Gate</span>
                </div>
                <p className="text-xs text-muted-foreground leading-relaxed">
                  High-risk actions (<code className="text-foreground">delete_database</code>, <code className="text-foreground">scale_to_zero</code>, <code className="text-foreground">modify_security_group</code>)
                  trigger a Slack approval workflow before the MCP Host executes the tool. The agent pauses, generates a risk summary,
                  and waits for an authorized responder to approve or deny within a configurable TTL window.
                </p>
              </CardContent>
            </Card>
          </TabsContent>

          {/* ── Post-Mortems ───────────────────── */}
          <TabsContent value="postmortems" className="space-y-4">
            <Card className="border-border">
              <CardHeader>
                <CardTitle className="text-base flex items-center gap-2"><FileText className="h-5 w-5 text-primary" /> Auto-Generated Post-Mortems</CardTitle>
                <CardDescription>The agent drafts markdown post-mortems from the full MCP session history after resolution</CardDescription>
              </CardHeader>
              <CardContent className="space-y-3">
                {LIVE_INCIDENTS.filter(i => i.status === "resolved").map((inc) => (
                  <div key={inc.id} className="flex items-center justify-between p-3 rounded-lg border border-border bg-muted/20">
                    <div className="flex items-center gap-3">
                      <CheckCircle2 className="h-4 w-4 text-[hsl(var(--success))]" />
                      <div>
                        <p className="text-sm font-medium">{inc.title}</p>
                        <p className="text-xs text-muted-foreground">
                          Resolved {inc.resolvedAt ? new Date(inc.resolvedAt).toLocaleString() : "—"} · {inc.mcpCalls} MCP calls
                        </p>
                      </div>
                    </div>
                    <Button size="sm" variant="outline" className="text-xs gap-1.5">
                      <FileText className="h-3.5 w-3.5" /> View Post-Mortem
                    </Button>
                  </div>
                ))}

                {LIVE_INCIDENTS.filter(i => i.status === "resolved").length === 0 && (
                  <p className="text-sm text-muted-foreground text-center py-8">No resolved incidents yet today</p>
                )}

                <div className="pt-4 border-t border-border">
                  <h4 className="text-sm font-semibold mb-2">Post-Mortem Template</h4>
                  <div className="bg-muted rounded-lg p-4 font-mono text-xs text-muted-foreground space-y-1">
                    <p>## Incident {"{ID}"} — Post-Mortem</p>
                    <p>**Severity:** {"{severity}"} | **Duration:** {"{duration}"} | **MCP Calls:** {"{count}"}</p>
                    <p>### Timeline</p>
                    <p>- {"{timestamp}"}: Alert received via Prometheus</p>
                    <p>- {"{timestamp}"}: Agent diagnosed root cause</p>
                    <p>- {"{timestamp}"}: Remediation executed</p>
                    <p>- {"{timestamp}"}: Stability validated</p>
                    <p>### Root Cause</p>
                    <p>{"{LLM-generated analysis from session context}"}</p>
                    <p>### Action Items</p>
                    <p>- [ ] {"{auto-generated preventive measures}"}</p>
                  </div>
                </div>
              </CardContent>
            </Card>
          </TabsContent>
        </Tabs>
      </main>
    </div>
  );
}
