import { useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { Button } from "@/components/ui/button";
import {
  ArrowRight, ArrowUpRight, Check, ChevronRight,
  Shield, Zap, Lock, GitBranch, Network, Globe,
  Box, Terminal, Eye, Database, Layers
} from "lucide-react";

/* ─── scroll-reveal ─── */
function useReveal(threshold = 0.12) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const obs = new IntersectionObserver(
      ([e]) => { if (e.isIntersecting) { el.classList.add("revealed"); obs.unobserve(el); } },
      { threshold }
    );
    obs.observe(el);
    return () => obs.disconnect();
  }, []);
  return ref;
}

function Reveal({ children, className = "", delay = 0 }: { children: React.ReactNode; className?: string; delay?: number }) {
  const ref = useReveal();
  return (
    <div ref={ref} className={`reveal-section ${className}`} style={{ transitionDelay: `${delay}ms` }}>
      {children}
    </div>
  );
}

/* ─── data ─── */
const CAPABILITIES = [
  { label: "Brand Identity", icon: Eye },
  { label: "Design System", icon: Layers },
  { label: "Golden Paths", icon: Network },
  { label: "Brownfield Migration", icon: GitBranch },
  { label: "Zero-Trust Audit", icon: Shield },
  { label: "JIT Permissions", icon: Lock },
];

const ARCH_LAYERS = [
  { num: "01", tag: "DEE", title: "Direct Execution Engine", desc: "Compiled bijective dispatch table. O(1) lookup. No YAML. No intermediate representation.", color: "hsl(199, 89%, 48%)" },
  { num: "02", tag: "RMCM", title: "Riemannian Manifold Coherence", desc: "Models valid system states as a Riemannian manifold with Fisher information metric.", color: "hsl(160, 84%, 39%)" },
  { num: "03", tag: "Dolt", title: "Observed Truth Layer", desc: "Git-for-data relational database. Every resource has a row. Every row has a version history.", color: "hsl(38, 92%, 50%)" },
  { num: "04", tag: "ZTAI", title: "Zero-Trust Audit Infrastructure", desc: "Append-only, hash-linked chain of TEE-attested records. ECDSA-P256 signed.", color: "hsl(346, 77%, 52%)" },
  { num: "05", tag: "JIT", title: "Just-in-Time Permissions", desc: "No standing AWS credentials. Each layer gets an STS session scoped to exact actions.", color: "hsl(262, 83%, 58%)" },
];

const GOLDEN_PATHS = [
  { name: "VPC Foundation", status: "v1.0 — Live", desc: "VPC + Subnets + IGW + NAT GW + Route Tables + Security Groups. Multi-AZ, JIT per-layer credentials.", tags: ["Multi-AZ", "5-layer JIT"], icon: Network },
  { name: "Web Standard", status: "v1.0 — Phase 2", desc: "ALB + ECS Fargate + RDS Aurora Serverless v2. Production-ready web application stack.", tags: ["ECS Fargate", "Aurora v2"], icon: Globe },
  { name: "Event Driven", status: "v1.0 — Phase 2", desc: "Lambda + SQS + DynamoDB. Serverless async processing with governed execution.", tags: ["Lambda", "SQS"], icon: Zap },
  { name: "Secure Edge", status: "v1.0 — Phase 2", desc: "CloudFront + WAF + Intent-based API Gateway. Secure edge delivery and API management.", tags: ["CloudFront", "WAF"], icon: Shield },
];

const BROWNFIELD_STEPS = [
  { num: "01", cmd: "naawi discover", title: "Discover", desc: "Tag-scoped AWS discovery. Writes to Dolt: normalised attrs, resource_raw, ZTAI records. Rate-limited, resumable, idempotent." },
  { num: "02", cmd: "naawi analyse", title: "Analyse", desc: "RMCM coherence scoring against discovered state. Pattern matching to Golden Paths. Surfaces all BLOCKERs and WARNINGs." },
  { num: "03", cmd: "naawi graduate", title: "Graduate", desc: "Pre-populates Golden Path form from Dolt state. Runs graduation preflight. Marks resources as graduated. No AWS resources changed." },
];

const COMPARISON = [
  { cap: "Configuration layer", existing: "HCL / YAML — orchestrated", naawi: "Eliminated. Bijective dispatch." },
  { cap: "State management", existing: "JSON blob on S3", naawi: "Dolt: versioned, branchable, diffable" },
  { cap: "Drift detection", existing: "API polling on schedule", naawi: "raw_hash compare. Zero steady-state calls." },
  { cap: "Audit trail", existing: "Logs. Mutable.", naawi: "TEE-attested hash chain. Rekor log." },
  { cap: "Permissions model", existing: "RBAC. Standing credentials.", naawi: "JIT per-layer STS. Auto-expire." },
  { cap: "Coherence validation", existing: "OPA / Rego policies", naawi: "Riemannian manifold. Geodesic check." },
  { cap: "Brownfield recovery", existing: "Generates HCL code", naawi: "discover → analyse → graduate. No code." },
];

const PREFLIGHT_LINES = [
  "P-1  Parameter validation .................. ✓",
  "P-2  Dolt state read (0 API calls) ......... ✓",
  "P-3  RMCM coherence score: 0.97 ............ ✓",
  "P-4  JIT credential pre-check .............. ✓",
  "P-5  Dry-run (shared closure) .............. ✓",
  "P-6  PREFLIGHT_COMPLETE — ZTAI #4291 ...... ✓",
];

const ROADMAP = [
  { phase: 0, title: "Patent & Spec", date: "Mar 2026", current: true, items: ["Provisional patent filed", "VPC Foundation Golden Path specified", "Dolt state layer & ZTAI architecture designed"] },
  { phase: 1, title: "Foundation", date: "Apr – May 2026", items: ["VPC Foundation end-to-end pipeline", "Dolt write pipeline + RMCM VPC checks", "ZTAI chain + JIT per-layer credentials"] },
  { phase: 2, title: "Brownfield", date: "May – Jul 2026", items: ["naawi discover — tag-scoped, resumable", "naawi analyse — RMCM on discovered state", "naawi graduate — pre-populated form, preflight"] },
  { phase: 3, title: "Golden Paths", date: "Jun – Aug 2026", items: ["WebStandard, EventDriven, SecureEdge paths", "Open-source launch on GitHub", "Naawi Playground for dry-runs"] },
  { phase: 4, title: "Enterprise", date: "Jul – Sep 2026", items: ["Backstage Scaffolder actions package", "8 Tier 1 integrations shipping", "SOC 2 Type I audit initiated"] },
  { phase: 5, title: "Series A", date: "Oct – Nov 2026", items: ["3 paying enterprise design partners", "SOC 2 Type I complete", "Non-provisional patent filed"] },
];

/* ─── Animated counter ─── */
function Counter({ target, suffix = "" }: { target: number; suffix?: string }) {
  const [count, setCount] = useState(0);
  const ref = useRef<HTMLSpanElement>(null);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const obs = new IntersectionObserver(([e]) => {
      if (e.isIntersecting) {
        let start = 0;
        const step = Math.max(1, Math.floor(target / 40));
        const interval = setInterval(() => {
          start += step;
          if (start >= target) { setCount(target); clearInterval(interval); }
          else setCount(start);
        }, 30);
        obs.unobserve(el);
      }
    }, { threshold: 0.5 });
    obs.observe(el);
    return () => obs.disconnect();
  }, [target]);
  return <span ref={ref}>{count}{suffix}</span>;
}

export default function Landing() {
  const navigate = useNavigate();

  return (
    <div className="min-h-screen bg-[#f5f4f0] text-[#1a1a1a] overflow-x-hidden" style={{ fontFamily: "'Instrument Sans', 'Inter', sans-serif" }}>
      
      {/* ═══ NAV ═══ */}
      <nav className="fixed top-0 inset-x-0 z-50 bg-[#f5f4f0]/80 backdrop-blur-xl">
        <div className="max-w-[1400px] mx-auto px-8 h-[72px] flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="h-8 w-8 rounded-full bg-[#1a1a1a] flex items-center justify-center">
              <Box className="h-4 w-4 text-white" />
            </div>
            <span className="text-lg font-semibold tracking-tight" style={{ fontFamily: "'DM Serif Display', serif" }}>naawi</span>
          </div>
          <div className="hidden md:flex items-center gap-8 text-[15px] text-[#666]">
            <a href="#architecture" className="hover:text-[#1a1a1a] transition-colors">Architecture</a>
            <a href="#golden-paths" className="hover:text-[#1a1a1a] transition-colors">Golden Paths</a>
            <a href="#brownfield" className="hover:text-[#1a1a1a] transition-colors">Migration</a>
            <a href="#roadmap" className="hover:text-[#1a1a1a] transition-colors">Roadmap</a>
          </div>
          <div className="flex items-center gap-4">
            <button onClick={() => navigate("/backstage")} className="hidden md:inline-flex text-[15px] text-[#666] hover:text-[#1a1a1a] transition-colors">
              Docs
            </button>
            <Button
              onClick={() => navigate("/auth")}
              className="h-10 px-6 text-sm font-medium bg-[#1a1a1a] text-white hover:bg-[#333] rounded-full"
            >
              Get Started
            </Button>
          </div>
        </div>
      </nav>

      {/* ═══ HERO ═══ */}
      <section className="pt-[160px] pb-32 px-8">
        <div className="max-w-[1200px] mx-auto">
          <Reveal>
            <div className="inline-flex items-center gap-2 px-4 py-2 rounded-full border border-[#1a1a1a]/10 bg-white/60 mb-10">
              <span className="h-2 w-2 rounded-full bg-[hsl(160,84%,39%)]" />
              <span className="text-sm text-[#666]">Patent Filed — US Provisional Application March 15, 2026</span>
            </div>
          </Reveal>

          <Reveal delay={80}>
            <h1 className="text-[clamp(3rem,7vw,6.5rem)] font-normal leading-[1.02] tracking-[-0.035em] max-w-[900px]" style={{ fontFamily: "'DM Serif Display', serif" }}>
              Infrastructure where{" "}
              <em className="not-italic text-[hsl(199,89%,48%)]">deploy</em>{" "}
              means proven
            </h1>
          </Reveal>

          <Reveal delay={160}>
            <p className="mt-8 text-xl text-[#666] max-w-[580px] leading-[1.7]">
              The deploy button doesn't exist until preflight passes. Every credential expires automatically. Every state change is cryptographically signed.
            </p>
          </Reveal>

          <Reveal delay={240}>
            <div className="mt-12 flex items-center gap-4">
              <Button
                onClick={() => navigate("/auth")}
                className="h-12 px-8 text-[15px] font-medium bg-[#1a1a1a] text-white hover:bg-[#333] rounded-full gap-2"
              >
                Start deploying <ArrowRight className="h-4 w-4" />
              </Button>
              <Button
                variant="ghost"
                onClick={() => document.getElementById("architecture")?.scrollIntoView({ behavior: "smooth" })}
                className="h-12 px-8 text-[15px] font-medium text-[#666] hover:text-[#1a1a1a] hover:bg-transparent rounded-full gap-2"
              >
                Read the architecture <ArrowUpRight className="h-4 w-4" />
              </Button>
            </div>
          </Reveal>

          {/* Capability pills */}
          <Reveal delay={320}>
            <div className="mt-20 flex flex-wrap gap-3">
              {CAPABILITIES.map((cap) => (
                <div key={cap.label} className="flex items-center gap-2 px-4 py-2.5 rounded-full bg-white border border-[#e8e7e4] text-sm text-[#555] shadow-[0_1px_3px_rgba(0,0,0,0.04)]">
                  <cap.icon className="h-4 w-4 text-[#999]" />
                  {cap.label}
                </div>
              ))}
            </div>
          </Reveal>
        </div>
      </section>

      {/* ═══ TERMINAL SHOWCASE ═══ */}
      <section className="px-8 pb-32">
        <div className="max-w-[1200px] mx-auto">
          <Reveal>
            <div className="rounded-[20px] bg-[#1a1a1a] overflow-hidden shadow-[0_40px_120px_-20px_rgba(0,0,0,0.25)]">
              {/* Window chrome */}
              <div className="flex items-center gap-2 px-6 py-4 border-b border-white/[0.06]">
                <span className="h-3 w-3 rounded-full bg-[#ff5f57]" />
                <span className="h-3 w-3 rounded-full bg-[#febc2e]" />
                <span className="h-3 w-3 rounded-full bg-[#28c840]" />
                <span className="ml-6 text-xs text-white/30 font-mono">naawi deploy vpc-foundation --env production</span>
              </div>
              <div className="p-8 font-mono text-sm leading-8">
                <div className="text-white/40">
                  <span className="text-white/25">$</span> <span className="text-white">naawi deploy vpc-foundation --env production</span>
                </div>
                {PREFLIGHT_LINES.map((line, i) => (
                  <div key={i} className="text-[hsl(160,84%,55%)]">{line}</div>
                ))}
                <div className="mt-4 text-[hsl(199,89%,65%)] font-semibold">
                  ⬢ Deploy button activated. All 6 preflight checks passed.
                </div>
                <div className="mt-2 text-white/25 text-xs leading-6">
                  Credentials: 5 STS sessions, TTL 1–5 min, auto-expire<br />
                  Audit: TEE-attested, hash-linked, Rekor-publishable
                </div>
              </div>
            </div>
          </Reveal>
        </div>
      </section>

      {/* ═══ STATS STRIP ═══ */}
      <section className="px-8 pb-32">
        <div className="max-w-[1200px] mx-auto">
          <Reveal>
            <div className="grid grid-cols-2 md:grid-cols-4 gap-px bg-[#e8e7e4] rounded-2xl overflow-hidden border border-[#e8e7e4]">
              {[
                { num: 5, suffix: "", label: "Architecture Layers" },
                { num: 6, suffix: "", label: "Preflight Checks" },
                { num: 0, suffix: "", label: "Standing Credentials" },
                { num: 40, suffix: "+", label: "AWS Services Covered" },
              ].map((stat) => (
                <div key={stat.label} className="bg-white p-8 text-center">
                  <div className="text-4xl md:text-5xl font-light tracking-tight" style={{ fontFamily: "'DM Serif Display', serif" }}>
                    <Counter target={stat.num} suffix={stat.suffix} />
                  </div>
                  <div className="mt-2 text-sm text-[#999]">{stat.label}</div>
                </div>
              ))}
            </div>
          </Reveal>
        </div>
      </section>

      {/* ═══ ARCHITECTURE ═══ */}
      <section id="architecture" className="px-8 py-32 bg-white">
        <div className="max-w-[1200px] mx-auto">
          <div className="grid md:grid-cols-[1fr_1.2fr] gap-20">
            <div className="md:sticky md:top-32 md:self-start">
              <Reveal>
                <p className="text-sm font-medium text-[hsl(199,89%,48%)] tracking-wide uppercase mb-4">Architecture</p>
                <h2 className="text-4xl md:text-5xl leading-[1.1] tracking-tight" style={{ fontFamily: "'DM Serif Display', serif" }}>
                  Five layers.<br />Each independently<br />verifiable.
                </h2>
                <p className="mt-6 text-lg text-[#888] leading-relaxed max-w-[380px]">
                  No layer depends on the layer above it. Every layer is independently deployable, testable, and auditable.
                </p>
              </Reveal>
            </div>

            <div className="space-y-4">
              {ARCH_LAYERS.map((layer, i) => (
                <Reveal key={layer.num} delay={i * 60}>
                  <div className="group p-8 rounded-2xl bg-[#fafaf8] border border-[#eee] hover:border-[#ddd] hover:shadow-[0_8px_40px_-12px_rgba(0,0,0,0.08)] transition-all duration-300">
                    <div className="flex items-start gap-6">
                      <div className="flex flex-col items-center gap-1">
                        <span className="text-3xl font-light tracking-tight" style={{ color: layer.color, fontFamily: "'DM Serif Display', serif" }}>{layer.num}</span>
                        <span className="text-[10px] font-mono text-[#bbb] tracking-widest uppercase">{layer.tag}</span>
                      </div>
                      <div className="flex-1">
                        <h3 className="text-lg font-semibold text-[#1a1a1a]">{layer.title}</h3>
                        <p className="mt-2 text-sm text-[#888] leading-relaxed">{layer.desc}</p>
                      </div>
                    </div>
                  </div>
                </Reveal>
              ))}
            </div>
          </div>
        </div>
      </section>

      {/* ═══ GOLDEN PATHS ═══ */}
      <section id="golden-paths" className="px-8 py-32">
        <div className="max-w-[1200px] mx-auto">
          <Reveal>
            <p className="text-sm font-medium text-[hsl(38,92%,50%)] tracking-wide uppercase mb-4">Golden Path Catalogue</p>
            <h2 className="text-4xl md:text-5xl leading-[1.1] tracking-tight max-w-[600px]" style={{ fontFamily: "'DM Serif Display', serif" }}>
              Click to deploy.<br />Governed by default.
            </h2>
            <p className="mt-6 text-lg text-[#888] leading-relaxed max-w-[520px]">
              Not templates to copy — parameterised, executable artifacts with coherence guarantees.
            </p>
          </Reveal>

          <div className="mt-16 grid md:grid-cols-2 gap-6">
            {GOLDEN_PATHS.map((gp, i) => (
              <Reveal key={gp.name} delay={i * 80}>
                <div className="group p-8 rounded-2xl bg-white border border-[#e8e7e4] hover:shadow-[0_16px_60px_-16px_rgba(0,0,0,0.1)] transition-all duration-500 h-full">
                  <div className="flex items-start justify-between mb-6">
                    <div className="h-12 w-12 rounded-xl bg-[#f5f4f0] flex items-center justify-center border border-[#e8e7e4]">
                      <gp.icon className="h-5 w-5 text-[#888]" />
                    </div>
                    <span className="text-xs text-[#aaa] font-mono">{gp.status}</span>
                  </div>
                  <h3 className="text-xl font-semibold text-[#1a1a1a]">{gp.name}</h3>
                  <p className="mt-3 text-sm text-[#888] leading-relaxed">{gp.desc}</p>
                  <div className="mt-6 flex flex-wrap gap-2">
                    {gp.tags.map(t => (
                      <span key={t} className="text-xs px-3 py-1 rounded-full bg-[#f5f4f0] text-[#888] border border-[#e8e7e4]">{t}</span>
                    ))}
                  </div>
                </div>
              </Reveal>
            ))}
          </div>
        </div>
      </section>

      {/* ═══ BROWNFIELD MIGRATION ═══ */}
      <section id="brownfield" className="px-8 py-32 bg-[#1a1a1a] text-white">
        <div className="max-w-[1200px] mx-auto">
          <Reveal>
            <p className="text-sm font-medium text-[hsl(346,77%,60%)] tracking-wide uppercase mb-4">Brownfield Recovery</p>
            <h2 className="text-4xl md:text-5xl leading-[1.1] tracking-tight max-w-[700px]" style={{ fontFamily: "'DM Serif Display', serif", color: "white" }}>
              Your existing infrastructure becomes the Golden Path.
            </h2>
            <p className="mt-6 text-lg text-white/50 leading-relaxed max-w-[520px]">
              Three commands. Each produces a discrete, reviewable output. No configuration code is generated at any step.
            </p>
          </Reveal>

          <div className="mt-20 grid md:grid-cols-3 gap-8">
            {BROWNFIELD_STEPS.map((step, i) => (
              <Reveal key={step.cmd} delay={i * 120}>
                <div className="h-full">
                  <div className="text-6xl font-light text-white/10 mb-6" style={{ fontFamily: "'DM Serif Display', serif" }}>{step.num}</div>
                  <code className="text-sm font-mono text-[hsl(199,89%,65%)] bg-white/5 px-3 py-1.5 rounded-lg inline-block">{step.cmd}</code>
                  <h3 className="mt-5 text-xl font-semibold text-white">{step.title}</h3>
                  <p className="mt-3 text-sm text-white/40 leading-relaxed">{step.desc}</p>
                </div>
              </Reveal>
            ))}
          </div>
        </div>
      </section>

      {/* ═══ COMPARISON ═══ */}
      <section className="px-8 py-32 bg-white">
        <div className="max-w-[1200px] mx-auto">
          <Reveal>
            <p className="text-sm font-medium text-[hsl(262,83%,58%)] tracking-wide uppercase mb-4">Why Naawi</p>
            <h2 className="text-4xl md:text-5xl leading-[1.1] tracking-tight max-w-[600px]" style={{ fontFamily: "'DM Serif Display', serif" }}>
              Architecture that can't be retrofitted.
            </h2>
          </Reveal>

          <Reveal delay={100}>
            <div className="mt-16 overflow-hidden rounded-2xl border border-[#e8e7e4]">
              <table className="w-full">
                <thead>
                  <tr className="border-b border-[#e8e7e4] bg-[#fafaf8]">
                    <th className="text-left p-5 text-xs font-medium text-[#aaa] uppercase tracking-wider">Capability</th>
                    <th className="text-left p-5 text-xs font-medium text-[#aaa] uppercase tracking-wider">Existing tools</th>
                    <th className="text-left p-5 text-xs font-medium text-[hsl(199,89%,48%)] uppercase tracking-wider">Naawi</th>
                  </tr>
                </thead>
                <tbody>
                  {COMPARISON.map((row) => (
                    <tr key={row.cap} className="border-b border-[#f0efec] last:border-0">
                      <td className="p-5 text-sm font-medium text-[#555]">{row.cap}</td>
                      <td className="p-5 text-sm text-[#aaa]">{row.existing}</td>
                      <td className="p-5 text-sm text-[hsl(160,84%,35%)] font-medium">{row.naawi}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </Reveal>
        </div>
      </section>

      {/* ═══ ROADMAP ═══ */}
      <section id="roadmap" className="px-8 py-32">
        <div className="max-w-[1200px] mx-auto">
          <Reveal>
            <p className="text-sm font-medium text-[hsl(160,84%,39%)] tracking-wide uppercase mb-4">Roadmap</p>
            <h2 className="text-4xl md:text-5xl leading-[1.1] tracking-tight" style={{ fontFamily: "'DM Serif Display', serif" }}>
              Patent to Series A in 8 months.
            </h2>
            <p className="mt-6 text-lg text-[#888] leading-relaxed max-w-[520px]">
              Sequenced for first enterprise design partner, SOC 2 Type I, and non-provisional patent.
            </p>
          </Reveal>

          <div className="mt-20 grid md:grid-cols-2 lg:grid-cols-3 gap-6">
            {ROADMAP.map((phase, i) => (
              <Reveal key={phase.phase} delay={i * 60}>
                <div className={`p-8 rounded-2xl h-full border transition-all duration-300 ${
                  phase.current
                    ? "bg-[#1a1a1a] border-[#1a1a1a] text-white"
                    : "bg-white border-[#e8e7e4] hover:shadow-[0_8px_40px_-12px_rgba(0,0,0,0.08)]"
                }`}>
                  <div className="flex items-center justify-between mb-4">
                    <span className={`text-4xl font-light tracking-tight ${phase.current ? "text-white/20" : "text-[#ddd]"}`} style={{ fontFamily: "'DM Serif Display', serif" }}>
                      {phase.phase}
                    </span>
                    {phase.current && (
                      <span className="text-xs px-3 py-1 rounded-full bg-white/10 text-white/80 font-medium">Now</span>
                    )}
                  </div>
                  <h3 className={`text-lg font-semibold ${phase.current ? "text-white" : "text-[#1a1a1a]"}`}>{phase.title}</h3>
                  <p className={`text-xs mt-1 ${phase.current ? "text-white/40" : "text-[#bbb]"}`}>{phase.date}</p>
                  <ul className="mt-5 space-y-2.5">
                    {phase.items.map(item => (
                      <li key={item} className={`text-sm flex items-start gap-2.5 leading-relaxed ${phase.current ? "text-white/60" : "text-[#888]"}`}>
                        <ChevronRight className={`h-3.5 w-3.5 mt-1 shrink-0 ${phase.current ? "text-white/30" : "text-[#ccc]"}`} />
                        {item}
                      </li>
                    ))}
                  </ul>
                </div>
              </Reveal>
            ))}
          </div>
        </div>
      </section>

      {/* ═══ CTA ═══ */}
      <section className="px-8 py-32 bg-[#1a1a1a]">
        <div className="max-w-[800px] mx-auto text-center">
          <Reveal>
            <h2 className="text-4xl md:text-6xl leading-[1.08] tracking-tight text-white" style={{ fontFamily: "'DM Serif Display', serif" }}>
              Ready to deploy with<br /><em className="not-italic text-[hsl(199,89%,65%)]">mathematical certainty</em>?
            </h2>
          </Reveal>
          <Reveal delay={100}>
            <p className="mt-8 text-lg text-white/40 max-w-[440px] mx-auto leading-relaxed">
              Join the teams moving from config-as-code to observed truth.
            </p>
          </Reveal>
          <Reveal delay={200}>
            <div className="mt-12 flex items-center justify-center gap-4">
              <Button
                onClick={() => navigate("/auth")}
                className="h-14 px-10 text-base font-medium bg-white text-[#1a1a1a] hover:bg-white/90 rounded-full gap-2"
              >
                Get Started <ArrowRight className="h-4 w-4" />
              </Button>
            </div>
          </Reveal>
        </div>
      </section>

      {/* ═══ FOOTER ═══ */}
      <footer className="px-8 py-12 bg-[#1a1a1a] border-t border-white/[0.06]">
        <div className="max-w-[1200px] mx-auto flex flex-col md:flex-row items-center justify-between gap-4">
          <div className="flex items-center gap-3">
            <div className="h-7 w-7 rounded-full bg-white/10 flex items-center justify-center">
              <Box className="h-3.5 w-3.5 text-white/60" />
            </div>
            <span className="text-sm text-white/40" style={{ fontFamily: "'DM Serif Display', serif" }}>naawi</span>
          </div>
          <p className="text-xs text-white/25">
            US Provisional Patent Application filed March 15, 2026
          </p>
        </div>
      </footer>
    </div>
  );
}
