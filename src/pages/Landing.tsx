import { useEffect, useRef } from "react";
import { useNavigate } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  Shield, Zap, Database, Lock, Eye, GitBranch,
  ArrowRight, Check, X, ExternalLink,
  Cloud, Server, Globe, Network, Layers,
  ChevronRight, Terminal, FileCode, Box
} from "lucide-react";

/* ─── scroll-reveal hook ─── */
function useReveal() {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const obs = new IntersectionObserver(
      ([e]) => { if (e.isIntersecting) { el.classList.add("revealed"); obs.unobserve(el); } },
      { threshold: 0.15 }
    );
    obs.observe(el);
    return () => obs.disconnect();
  }, []);
  return ref;
}

function Section({ children, className = "", delay = 0 }: { children: React.ReactNode; className?: string; delay?: number }) {
  const ref = useReveal();
  return (
    <div
      ref={ref}
      className={`reveal-section ${className}`}
      style={{ transitionDelay: `${delay}ms` }}
    >
      {children}
    </div>
  );
}

/* ─── data ─── */
const ARCH_LAYERS = [
  { num: "01", tag: "DEE", title: "Direct Execution Engine", desc: "Compiled bijective dispatch table. O(1) lookup. No YAML. No intermediate representation. Dry-run and live share the same closure — divergence is impossible.", color: "text-sky-400" },
  { num: "02", tag: "RMCM", title: "Riemannian Manifold Coherence", desc: "Models valid system states as a Riemannian manifold with Fisher information metric. Geodesic distance check rejects incoherent executions before any SDK call.", color: "text-emerald-400" },
  { num: "03", tag: "Observed Truth", title: "Dolt State Layer", desc: "Git-for-data relational database. Every resource has a row. Every row has a version history. Every version links to its ZTAI execution record. AWS APIs called once — at write time.", color: "text-amber-400" },
  { num: "04", tag: "ZTAI", title: "Zero-Trust Audit Infrastructure", desc: "Append-only, hash-linked chain of TEE-attested records. ECDSA-P256 signed. Published to Rekor transparency log. Verifiable by any third party.", color: "text-rose-400" },
  { num: "05", tag: "JIT", title: "Just-in-Time Permissions", desc: "No standing AWS credentials. Each layer gets an STS session scoped to exact actions and ARNs. Credentials expire automatically. Session ARN is in the audit record.", color: "text-violet-400" },
];

const PREFLIGHT_STEPS = [
  { id: "P-1", title: "Parameter Validation", desc: "Server-side schema check. CIDR overlap detection against Dolt." },
  { id: "P-2", title: "Dolt State Read", desc: "RMCM queries existing resources. Zero AWS API calls." },
  { id: "P-3", title: "RMCM Coherence", desc: "Dependency graph validation. Per-layer geodesic distance scores." },
  { id: "P-4", title: "JIT Pre-check", desc: "STS AssumeRole capability verified for all layers. No credentials vended." },
  { id: "P-5", title: "Shared Closure Dry-Run", desc: "Same code as live execution. Structured diff produced. TEE-signed." },
  { id: "P-6", title: "PREFLIGHT_COMPLETE", desc: "Overall score, per-layer scores, diff, cost delta. Deploy button activated." },
];

const GOLDEN_PATHS = [
  { name: "VPC Foundation", id: "naawi.gold.v1.VpcFoundation", status: "v1.0 — Specification Complete", desc: "VPC + Subnets + IGW + NAT GW + Route Tables + Security Groups. Multi-AZ, JIT per-layer credentials.", tags: ["AWS us-east-1", "Multi-AZ", "5-layer JIT", "RMCM validated"], icon: Network, accent: "border-sky-500/30 bg-sky-500/5" },
  { name: "Web Standard", id: "naawi.gold.v1.WebStandard", status: "v1.0 — Phase 2", desc: "ALB + ECS Fargate + RDS Aurora Serverless v2. Production-ready web application stack.", tags: ["ALB + ECS Fargate", "Aurora Serverless v2", "Auto-scaling", "TLS termination"], icon: Globe, accent: "border-emerald-500/30 bg-emerald-500/5" },
  { name: "Event Driven", id: "naawi.gold.v1.EventDriven", status: "v1.0 — Phase 2", desc: "Lambda + SQS + DynamoDB. Serverless async processing with governed execution.", tags: ["Lambda", "SQS queues", "DynamoDB", "Dead letter queue"], icon: Zap, accent: "border-amber-500/30 bg-amber-500/5" },
  { name: "Secure Edge", id: "naawi.gold.v1.SecureEdge", status: "v1.0 — Phase 2", desc: "CloudFront + WAF + Intent-based API Gateway. Secure edge delivery and API management.", tags: ["CloudFront CDN", "WAF rules", "API Gateway", "DDoS protection"], icon: Shield, accent: "border-rose-500/30 bg-rose-500/5" },
];

const BROWNFIELD_STEPS = [
  { cmd: "naawi discover", title: "Discover", desc: "Tag-scoped AWS discovery. Writes to Dolt: normalised attrs, resource_raw, ZTAI records. Rate-limited, resumable, idempotent.", output: "Dolt rows + DISCOVERY_IMPORT ZTAI records" },
  { cmd: "naawi analyse", title: "Analyse", desc: "RMCM coherence scoring against discovered state. Pattern matching to Golden Paths. Surfaces all BLOCKERs and WARNINGs. Extracts parameters with confidence levels.", output: "Analysis report + ANALYSIS_COMPLETE ZTAI record" },
  { cmd: "naawi graduate", title: "Graduate", desc: "Pre-populates Golden Path form from Dolt state. Runs graduation preflight (P-0 through P-6). Marks resources as graduated. No AWS resources changed.", output: "GRADUATION_COMPLETE ZTAI record + activated form" },
];

const COMPARISON = [
  { cap: "Configuration layer", existing: "HCL/YAML — orchestrated", naawi: "Eliminated. Bijective dispatch." },
  { cap: "State management", existing: "JSON blob on S3", naawi: "Dolt: versioned, branchable, diffable" },
  { cap: "Drift detection", existing: "API polling on schedule", naawi: "raw_hash compare. Zero steady-state calls." },
  { cap: "Audit trail", existing: "Logs. Mutable.", naawi: "TEE-attested hash chain. Rekor log." },
  { cap: "Permissions model", existing: "RBAC. Standing credentials.", naawi: "JIT per-layer STS. Auto-expire." },
  { cap: "Coherence validation", existing: "OPA/Rego policies", naawi: "Riemannian manifold. Geodesic check." },
  { cap: "Brownfield recovery", existing: "Generates Terraform code", naawi: "discover → analyse → graduate. No code." },
];

const TIER1_INTEGRATIONS = [
  { name: "Slack", events: "Deploy, Preflight, Drift" },
  { name: "PagerDuty", events: "Failures, Rollbacks" },
  { name: "GitHub", events: "Deploy, Preflight" },
  { name: "Jira", events: "Failures, Drift" },
  { name: "ServiceNow", events: "Deploy, Rollback" },
  { name: "Datadog", events: "All events + metrics" },
  { name: "OpsGenie", events: "Failures, Coherence" },
  { name: "Backstage", events: "Deploy, Rollback" },
];

const TIER2_CATEGORIES = [
  { cat: "CI/CD", tools: ["GitHub Actions", "GitLab CI", "Azure DevOps", "CircleCI", "Jenkins", "Buildkite"] },
  { cat: "Observability", tools: ["Grafana", "Prometheus", "New Relic", "Honeycomb", "Dynatrace"] },
  { cat: "Incident", tools: ["Incident.io", "FireHydrant", "Rootly", "VictorOps"] },
  { cat: "Ticketing", tools: ["Linear", "Asana", "Monday.com", "Zendesk", "BMC Remedy"] },
  { cat: "Security", tools: ["Wiz", "Orca", "Lacework", "Prisma Cloud", "Aqua"] },
  { cat: "Portals", tools: ["Port", "OpsLevel", "Cortex", "Compass"] },
  { cat: "Comms", tools: ["Teams", "Google Chat", "Discord"] },
];

const ROADMAP = [
  { phase: 0, title: "Patent & Spec", date: "Mar 2026", current: true, items: ["Provisional patent filed (priority date Mar 15, 2026)", "VPC Foundation Golden Path specified", "Dolt state layer & ZTAI architecture designed", "JIT permission matrix defined"] },
  { phase: 1, title: "Foundation", date: "Apr – May 2026", items: ["VPC Foundation end-to-end pipeline", "Dolt write pipeline + RMCM VPC checks", "ZTAI chain + JIT per-layer credentials", "Preflight gate enforced at API layer"] },
  { phase: 2, title: "Brownfield", date: "May – Jul 2026", items: ["naawi discover — tag-scoped, resumable", "naawi analyse — RMCM on discovered state", "naawi graduate — pre-populated form, preflight", "End-to-end on real enterprise VPC account"] },
  { phase: 3, title: "Golden Paths", date: "Jun – Aug 2026", items: ["WebStandard, EventDriven, SecureEdge paths", "Open-source launch on GitHub", "Community stress-test framework", "Naawi Playground for dry-runs"] },
  { phase: 4, title: "Enterprise", date: "Jul – Sep 2026", items: ["Backstage Scaffolder actions package", "8 Tier 1 integrations shipping", "SOC 2 Type I audit initiated", "Compliance framework mapping published"] },
  { phase: 5, title: "Series A", date: "Oct – Nov 2026", items: ["3 paying enterprise design partners", "SOC 2 Type I complete", "32 Tier 2 community integrations", "Non-provisional patent filed"] },
];

const TERMINAL_LINES = [
  { text: "$ ", cmd: "naawi deploy vpc-foundation --env production", delay: 0 },
  { text: "→ P-1 Parameter validation .............. ", check: true, delay: 200 },
  { text: "→ P-2 Dolt state read (0 API calls) ..... ", check: true, delay: 400 },
  { text: "→ P-3 RMCM coherence score: 0.97 ........ ", check: true, delay: 600 },
  { text: "→ P-4 JIT credential pre-check .......... ", check: true, delay: 800 },
  { text: "→ P-5 Dry-run (shared closure) .......... ", check: true, delay: 1000 },
  { text: "→ P-6 PREFLIGHT_COMPLETE — ZTAI #4291 .. ", check: true, delay: 1200 },
];

export default function Landing() {
  const navigate = useNavigate();

  return (
    <div className="min-h-screen bg-[hsl(225,25%,6%)] text-[hsl(220,14%,90%)] overflow-x-hidden">
      {/* ═══ NAV ═══ */}
      <nav className="fixed top-0 inset-x-0 z-50 border-b border-[hsl(225,14%,14%)] bg-[hsl(225,25%,6%)/0.85] backdrop-blur-xl">
        <div className="max-w-7xl mx-auto px-6 h-14 flex items-center justify-between">
          <div className="flex items-center gap-8">
            <div className="flex items-center gap-2.5">
              <div className="h-7 w-7 rounded-lg bg-sky-500/10 border border-sky-500/20 flex items-center justify-center">
                <Box className="h-3.5 w-3.5 text-sky-400" />
              </div>
              <span className="font-semibold text-sm tracking-tight text-white">naawi</span>
            </div>
            <div className="hidden md:flex items-center gap-6 text-[13px] text-[hsl(220,10%,52%)]">
              <a href="#architecture" className="hover:text-white transition-colors">Architecture</a>
              <a href="#golden-paths" className="hover:text-white transition-colors">Golden Paths</a>
              <a href="#brownfield" className="hover:text-white transition-colors">Brownfield</a>
              <a href="#integrations" className="hover:text-white transition-colors">Integrations</a>
              <a href="#roadmap" className="hover:text-white transition-colors">Roadmap</a>
            </div>
          </div>
          <div className="flex items-center gap-3">
            <button
              onClick={() => navigate("/backstage")}
              className="hidden md:inline-flex text-[13px] text-[hsl(220,10%,52%)] hover:text-white transition-colors"
            >
              Docs
            </button>
            <Button
              size="sm"
              onClick={() => navigate("/auth")}
              className="h-8 px-4 text-xs font-medium bg-white text-[hsl(225,25%,6%)] hover:bg-white/90 rounded-lg"
            >
              Sign in
            </Button>
          </div>
        </div>
      </nav>

      {/* ═══ HERO ═══ */}
      <section className="pt-32 pb-24 px-6 relative">
        <div className="absolute inset-0 overflow-hidden pointer-events-none">
          <div className="absolute top-1/4 left-1/2 -translate-x-1/2 w-[800px] h-[400px] bg-sky-500/[0.04] rounded-full blur-[120px]" />
        </div>
        <div className="max-w-4xl mx-auto text-center relative">
          <Section>
            <div className="inline-flex items-center gap-2 px-3 py-1.5 rounded-full border border-emerald-500/20 bg-emerald-500/5 mb-8">
              <span className="h-1.5 w-1.5 rounded-full bg-emerald-400 animate-pulse" />
              <span className="text-xs text-emerald-400 font-medium">Patent Filed — US Provisional Application March 15, 2026</span>
            </div>
          </Section>

          <Section delay={100}>
            <h1 className="text-5xl md:text-7xl font-bold tracking-tight leading-[1.05] text-white" style={{ textWrap: "balance" as any }}>
              Infrastructure where{" "}
              <span className="bg-gradient-to-r from-sky-400 via-emerald-400 to-sky-400 bg-clip-text text-transparent">
                deploy means proven
              </span>
            </h1>
          </Section>

          <Section delay={200}>
            <p className="mt-6 text-lg text-[hsl(220,10%,52%)] max-w-2xl mx-auto leading-relaxed" style={{ textWrap: "pretty" as any }}>
              The deploy button doesn't exist until preflight passes. Every credential expires automatically. Every state change is cryptographically signed. Your existing infrastructure becomes the Golden Path.
            </p>
          </Section>

          <Section delay={300}>
            <div className="mt-10 flex items-center justify-center gap-4">
              <Button
                onClick={() => navigate("/auth")}
                className="h-11 px-6 text-sm font-medium bg-white text-[hsl(225,25%,6%)] hover:bg-white/90 rounded-xl gap-2"
              >
                Sign in <ArrowRight className="h-4 w-4" />
              </Button>
              <Button
                variant="outline"
                onClick={() => { document.getElementById("architecture")?.scrollIntoView({ behavior: "smooth" }); }}
                className="h-11 px-6 text-sm font-medium border-[hsl(225,14%,18%)] bg-transparent text-white hover:bg-[hsl(225,16%,12%)] rounded-xl"
              >
                Read the Architecture
              </Button>
            </div>
          </Section>

          <Section delay={400}>
            <div className="mt-12 flex items-center justify-center gap-8 text-sm text-[hsl(220,10%,52%)]">
              <span className="flex items-center gap-2"><Lock className="h-4 w-4 text-sky-400" /> Zero Standing Permissions</span>
              <span className="flex items-center gap-2"><GitBranch className="h-4 w-4 text-emerald-400" /> Observed Truth in Dolt</span>
              <span className="flex items-center gap-2"><Zap className="h-4 w-4 text-amber-400" /> No YAML Anywhere</span>
            </div>
          </Section>

          {/* Terminal */}
          <Section delay={500}>
            <div className="mt-16 max-w-2xl mx-auto rounded-xl border border-[hsl(225,14%,16%)] bg-[hsl(225,22%,9%)] overflow-hidden shadow-2xl shadow-black/40">
              <div className="flex items-center gap-2 px-4 py-3 border-b border-[hsl(225,14%,14%)]">
                <span className="h-3 w-3 rounded-full bg-red-500/70" />
                <span className="h-3 w-3 rounded-full bg-yellow-500/70" />
                <span className="h-3 w-3 rounded-full bg-green-500/70" />
                <span className="ml-4 text-xs text-[hsl(220,10%,40%)] font-mono">naawi — preflight</span>
              </div>
              <div className="p-5 font-mono text-[13px] leading-7 text-left">
                {TERMINAL_LINES.map((line, i) => (
                  <div key={i} className={i === 0 ? "text-[hsl(220,10%,52%)]" : "text-emerald-400/80"}>
                    {i === 0 ? (
                      <><span className="text-[hsl(220,10%,40%)]">{line.text}</span><span className="text-white font-semibold">{line.cmd}</span></>
                    ) : (
                      <>{line.text}<Check className="inline h-3.5 w-3.5 text-emerald-400" /></>
                    )}
                  </div>
                ))}
                <div className="mt-3 text-sky-400 font-semibold">
                  ⬢ Deploy button activated. All 6 preflight checks passed.
                </div>
                <div className="mt-2 text-[hsl(220,10%,40%)] text-xs leading-5">
                  Credentials: 5 STS sessions, TTL 1–5 min, auto-expire{"\n"}
                  Audit: TEE-attested, hash-linked, Rekor-publishable
                </div>
              </div>
            </div>
          </Section>
        </div>
      </section>

      {/* ═══ ARCHITECTURE ═══ */}
      <section id="architecture" className="py-24 px-6 border-t border-[hsl(225,14%,12%)]">
        <div className="max-w-5xl mx-auto">
          <Section>
            <p className="text-xs font-medium text-sky-400 tracking-widest uppercase mb-3">Architecture</p>
            <h2 className="text-3xl md:text-4xl font-bold text-white" style={{ textWrap: "balance" as any }}>
              Five layers. Each independently verifiable.
            </h2>
            <p className="mt-4 text-[hsl(220,10%,52%)] max-w-2xl leading-relaxed">
              No layer depends on the layer above it. Every layer is independently deployable, testable, and auditable.
            </p>
          </Section>

          <div className="mt-16 grid gap-6">
            {ARCH_LAYERS.map((layer, i) => (
              <Section key={layer.num} delay={i * 80}>
                <div className="group flex gap-6 p-6 rounded-xl border border-[hsl(225,14%,14%)] bg-[hsl(225,22%,8%)] hover:border-[hsl(225,14%,20%)] transition-colors">
                  <div className="flex flex-col items-center gap-1 pt-1">
                    <span className={`text-2xl font-bold ${layer.color} opacity-60`}>{layer.num}</span>
                    <span className={`text-[10px] font-mono ${layer.color} tracking-wider`}>{layer.tag}</span>
                  </div>
                  <div>
                    <h3 className="text-lg font-semibold text-white">{layer.title}</h3>
                    <p className="mt-2 text-sm text-[hsl(220,10%,48%)] leading-relaxed">{layer.desc}</p>
                  </div>
                </div>
              </Section>
            ))}
          </div>
        </div>
      </section>

      {/* ═══ PREFLIGHT ═══ */}
      <section className="py-24 px-6 border-t border-[hsl(225,14%,12%)]">
        <div className="max-w-5xl mx-auto">
          <Section>
            <p className="text-xs font-medium text-emerald-400 tracking-widest uppercase mb-3">Mandatory Preflight</p>
            <h2 className="text-3xl md:text-4xl font-bold text-white" style={{ textWrap: "balance" as any }}>
              The deploy button doesn't exist until all 6 pass.
            </h2>
            <p className="mt-4 text-[hsl(220,10%,52%)] max-w-2xl leading-relaxed">
              Not disabled. Not greyed out. Not rendered. The button is inserted into the DOM only after a PREFLIGHT_COMPLETE ZTAI record exists for the current parameter hash.
            </p>
          </Section>

          <div className="mt-16 grid md:grid-cols-2 lg:grid-cols-3 gap-4">
            {PREFLIGHT_STEPS.map((step, i) => (
              <Section key={step.id} delay={i * 60}>
                <div className="p-5 rounded-xl border border-[hsl(225,14%,14%)] bg-[hsl(225,22%,8%)] h-full">
                  <span className="text-xs font-mono text-emerald-400 font-semibold">{step.id}</span>
                  <h3 className="mt-2 text-sm font-semibold text-white">{step.title}</h3>
                  <p className="mt-2 text-xs text-[hsl(220,10%,48%)] leading-relaxed">{step.desc}</p>
                </div>
              </Section>
            ))}
          </div>
        </div>
      </section>

      {/* ═══ GOLDEN PATHS ═══ */}
      <section id="golden-paths" className="py-24 px-6 border-t border-[hsl(225,14%,12%)]">
        <div className="max-w-5xl mx-auto">
          <Section>
            <p className="text-xs font-medium text-amber-400 tracking-widest uppercase mb-3">Golden Path Catalogue</p>
            <h2 className="text-3xl md:text-4xl font-bold text-white" style={{ textWrap: "balance" as any }}>
              Click to deploy. Governed by default.
            </h2>
            <p className="mt-4 text-[hsl(220,10%,52%)] max-w-2xl leading-relaxed">
              Not templates to copy — parameterised, executable artifacts with coherence guarantees, versioned schemas, and community stress-test counts.
            </p>
          </Section>

          <div className="mt-16 grid md:grid-cols-2 gap-5">
            {GOLDEN_PATHS.map((gp, i) => (
              <Section key={gp.id} delay={i * 80}>
                <div className={`p-6 rounded-xl border ${gp.accent} h-full`}>
                  <div className="flex items-start justify-between">
                    <gp.icon className="h-6 w-6 text-[hsl(220,10%,52%)]" />
                    <span className="text-[10px] font-mono text-[hsl(220,10%,40%)]">{gp.status}</span>
                  </div>
                  <h3 className="mt-4 text-lg font-semibold text-white">{gp.name}</h3>
                  <p className="text-[11px] font-mono text-[hsl(220,10%,40%)] mt-1">{gp.id}</p>
                  <p className="mt-3 text-sm text-[hsl(220,10%,48%)] leading-relaxed">{gp.desc}</p>
                  <div className="mt-4 flex flex-wrap gap-1.5">
                    {gp.tags.map(t => (
                      <span key={t} className="text-[10px] px-2 py-0.5 rounded-md bg-white/5 text-[hsl(220,10%,56%)] border border-white/5">{t}</span>
                    ))}
                  </div>
                </div>
              </Section>
            ))}
          </div>
        </div>
      </section>

      {/* ═══ BROWNFIELD ═══ */}
      <section id="brownfield" className="py-24 px-6 border-t border-[hsl(225,14%,12%)]">
        <div className="max-w-5xl mx-auto">
          <Section>
            <p className="text-xs font-medium text-rose-400 tracking-widest uppercase mb-3">Brownfield Recovery</p>
            <h2 className="text-3xl md:text-4xl font-bold text-white" style={{ textWrap: "balance" as any }}>
              Your existing infrastructure becomes the Golden Path.
            </h2>
            <p className="mt-4 text-[hsl(220,10%,52%)] max-w-2xl leading-relaxed">
              Three commands. Each produces a discrete, reviewable output. No configuration code is generated at any step.
            </p>
          </Section>

          <div className="mt-16 grid md:grid-cols-3 gap-6">
            {BROWNFIELD_STEPS.map((step, i) => (
              <Section key={step.cmd} delay={i * 100}>
                <div className="p-6 rounded-xl border border-[hsl(225,14%,14%)] bg-[hsl(225,22%,8%)] h-full flex flex-col">
                  <code className="text-xs font-mono text-sky-400 bg-sky-500/10 px-2.5 py-1 rounded-md self-start">{step.cmd}</code>
                  <h3 className="mt-4 text-lg font-semibold text-white">{step.title}</h3>
                  <p className="mt-2 text-sm text-[hsl(220,10%,48%)] leading-relaxed flex-1">{step.desc}</p>
                  <p className="mt-4 text-xs text-[hsl(220,10%,40%)]">
                    <span className="text-[hsl(220,10%,56%)] font-medium">Output:</span> {step.output}
                  </p>
                </div>
              </Section>
            ))}
          </div>
        </div>
      </section>

      {/* ═══ WHY NAAWI / COMPARISON ═══ */}
      <section className="py-24 px-6 border-t border-[hsl(225,14%,12%)]">
        <div className="max-w-5xl mx-auto">
          <Section>
            <p className="text-xs font-medium text-violet-400 tracking-widest uppercase mb-3">Why Naawi</p>
            <h2 className="text-3xl md:text-4xl font-bold text-white" style={{ textWrap: "balance" as any }}>
              Architecture that can't be retrofitted.
            </h2>
            <p className="mt-4 text-[hsl(220,10%,52%)] max-w-2xl leading-relaxed">
              You can't eliminate the configuration layer from a tool built on Terraform. You can't add a cryptographic audit chain to a tool built on log files.
            </p>
          </Section>

          <Section delay={150}>
            <div className="mt-12 rounded-xl border border-[hsl(225,14%,14%)] overflow-hidden">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-[hsl(225,14%,14%)] bg-[hsl(225,22%,8%)]">
                    <th className="text-left p-4 text-xs font-medium text-[hsl(220,10%,40%)] uppercase tracking-wider">Capability</th>
                    <th className="text-left p-4 text-xs font-medium text-[hsl(220,10%,40%)] uppercase tracking-wider">Existing tools</th>
                    <th className="text-left p-4 text-xs font-medium text-sky-400 uppercase tracking-wider">Naawi v1.0</th>
                  </tr>
                </thead>
                <tbody>
                  {COMPARISON.map((row, i) => (
                    <tr key={row.cap} className="border-b border-[hsl(225,14%,12%)] last:border-0">
                      <td className="p-4 text-[hsl(220,10%,56%)] font-medium">{row.cap}</td>
                      <td className="p-4 text-[hsl(220,10%,40%)]">{row.existing}</td>
                      <td className="p-4 text-emerald-400/90">{row.naawi}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </Section>
        </div>
      </section>

      {/* ═══ INTEGRATIONS ═══ */}
      <section id="integrations" className="py-24 px-6 border-t border-[hsl(225,14%,12%)]">
        <div className="max-w-5xl mx-auto">
          <Section>
            <p className="text-xs font-medium text-sky-400 tracking-widest uppercase mb-3">Enterprise Integrations</p>
            <h2 className="text-3xl md:text-4xl font-bold text-white" style={{ textWrap: "balance" as any }}>
              40+ connectors. ZTAI events everywhere.
            </h2>
            <p className="mt-4 text-[hsl(220,10%,52%)] max-w-2xl leading-relaxed">
              8 native Tier 1 integrations at launch. 32+ community webhook connectors for the full enterprise toolchain.
            </p>
          </Section>

          {/* Tier 1 */}
          <Section delay={100}>
            <div className="mt-12">
              <h3 className="text-xs font-medium text-[hsl(220,10%,40%)] uppercase tracking-wider mb-4">
                Tier 1 <span className="text-[hsl(220,10%,32%)]">— Native integrations</span>
              </h3>
              <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                {TIER1_INTEGRATIONS.map(int => (
                  <div key={int.name} className="p-4 rounded-xl border border-[hsl(225,14%,14%)] bg-[hsl(225,22%,8%)]">
                    <h4 className="text-sm font-semibold text-white">{int.name}</h4>
                    <p className="mt-1 text-[11px] text-[hsl(220,10%,40%)]">{int.events}</p>
                  </div>
                ))}
              </div>
            </div>
          </Section>

          {/* Tier 2 */}
          <Section delay={200}>
            <div className="mt-10">
              <h3 className="text-xs font-medium text-[hsl(220,10%,40%)] uppercase tracking-wider mb-4">
                Tier 2 <span className="text-[hsl(220,10%,32%)]">— Community webhook connectors</span>
              </h3>
              <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-3">
                {TIER2_CATEGORIES.map(cat => (
                  <div key={cat.cat} className="p-4 rounded-xl border border-[hsl(225,14%,14%)] bg-[hsl(225,22%,8%)]">
                    <h4 className="text-xs font-semibold text-[hsl(220,10%,56%)] uppercase tracking-wider mb-2">{cat.cat}</h4>
                    <div className="flex flex-wrap gap-1">
                      {cat.tools.map(t => (
                        <span key={t} className="text-[10px] px-1.5 py-0.5 rounded bg-white/5 text-[hsl(220,10%,48%)]">{t}</span>
                      ))}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </Section>
        </div>
      </section>

      {/* ═══ ROADMAP ═══ */}
      <section id="roadmap" className="py-24 px-6 border-t border-[hsl(225,14%,12%)]">
        <div className="max-w-5xl mx-auto">
          <Section>
            <p className="text-xs font-medium text-emerald-400 tracking-widest uppercase mb-3">Roadmap</p>
            <h2 className="text-3xl md:text-4xl font-bold text-white" style={{ textWrap: "balance" as any }}>
              Patent to Series A in 8 months.
            </h2>
            <p className="mt-4 text-[hsl(220,10%,52%)] max-w-2xl leading-relaxed">
              Sequenced for first enterprise design partner, SOC 2 Type I, and non-provisional patent — all before the Series A window.
            </p>
          </Section>

          <div className="mt-16 grid md:grid-cols-2 lg:grid-cols-3 gap-5">
            {ROADMAP.map((phase, i) => (
              <Section key={phase.phase} delay={i * 70}>
                <div className={`p-6 rounded-xl border h-full ${phase.current ? "border-sky-500/30 bg-sky-500/5" : "border-[hsl(225,14%,14%)] bg-[hsl(225,22%,8%)]"}`}>
                  <div className="flex items-center justify-between">
                    <span className={`text-2xl font-bold ${phase.current ? "text-sky-400" : "text-[hsl(220,10%,28%)]"}`}>{phase.phase}</span>
                    {phase.current && <span className="text-[10px] px-2 py-0.5 rounded-full bg-sky-500/10 text-sky-400 font-medium border border-sky-500/20">Now</span>}
                  </div>
                  <h3 className="mt-3 text-base font-semibold text-white">{phase.title}</h3>
                  <p className="text-xs text-[hsl(220,10%,40%)] mt-1">{phase.date}</p>
                  <ul className="mt-4 space-y-2">
                    {phase.items.map(item => (
                      <li key={item} className="text-xs text-[hsl(220,10%,48%)] flex items-start gap-2 leading-relaxed">
                        <ChevronRight className="h-3 w-3 mt-0.5 text-[hsl(220,10%,32%)] shrink-0" />
                        {item}
                      </li>
                    ))}
                  </ul>
                </div>
              </Section>
            ))}
          </div>
        </div>
      </section>

      {/* ═══ FOOTER ═══ */}
      <footer className="py-16 px-6 border-t border-[hsl(225,14%,12%)]">
        <div className="max-w-5xl mx-auto text-center">
          <p className="text-sm text-[hsl(220,10%,36%)]">
            Project Naawi — The infrastructure platform where state is observed truth, execution is mathematically coherent, and every credential expires.
          </p>
          <p className="mt-3 text-xs text-[hsl(220,10%,26%)]">
            US Provisional Patent Application filed March 15, 2026
          </p>
        </div>
      </footer>
    </div>
  );
}
