import { useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
// Clay aesthetic
import { UserMenu } from "@/components/UserMenu";
import { NavLink } from "@/components/NavLink";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";
import {
  Shield,
  Clock,
  ChevronRight,
  Lock,
  Database,
  Eye,
  FileCheck,
  Layers,
  Network,
  Server,
  Route,
  ShieldCheck,
  ArrowLeft,
  CheckCircle2,
  AlertTriangle,
  Timer,
  Hash,
  Key,
} from "lucide-react";
import { Link } from "react-router-dom";

/* ─── Layer Data ─── */

interface ZtaiRecord {
  phase: string;
  intent_id: string;
  tee_signature: string;
  timestamp: string;
  extra?: Record<string, string>;
}

interface JitScope {
  role_arn: string;
  session_policy: string[];
  ttl: string;
  condition?: string;
}

interface DoltWrite {
  table: string;
  operation: string;
  fields: Record<string, string>;
  commit_message: string;
}

interface GoldenLayer {
  id: number;
  name: string;
  intent_id: string;
  description: string;
  status: "completed" | "running" | "pending" | "warning";
  coherence: number;
  estimated_duration: string;
  icon: React.ReactNode;
  jit: JitScope;
  dolt: DoltWrite;
  ztai_pre: ZtaiRecord;
  ztai_post: ZtaiRecord;
  outputs: Record<string, string>;
}

const LAYERS: GoldenLayer[] = [
  {
    id: 0,
    name: "VPC Creation",
    intent_id: "naawi.infra.v1.CreateVpc",
    description: "Create the foundational VPC with 10.0.0.0/16 CIDR in us-east-1. The VPC is the network boundary — everything else deploys inside it.",
    status: "completed",
    coherence: 100,
    estimated_duration: "~8s",
    icon: <Network className="w-4 h-4" />,
    jit: {
      role_arn: "arn:aws:iam::role/naawi-vpc-execution-role",
      session_policy: ["ec2:CreateVpc", "ec2:DescribeVpcs", "ec2:CreateTags", "ec2:ModifyVpcAttribute"],
      ttl: "2 min",
      condition: "Resource: * (pre-creation, no ARN yet)",
    },
    dolt: {
      table: "infra_state",
      operation: "INSERT",
      fields: { resource_id: "vpc-0a1b2c3d4e", resource_type: "aws::ec2::vpc", region: "us-east-1", cidr_block: "10.0.0.0/16" },
      commit_message: "layer-0: vpc-0a1b2c3d4e created in us-east-1",
    },
    ztai_pre: {
      phase: "PRE_EXECUTION",
      intent_id: "naawi.infra.v1.CreateVpc",
      tee_signature: "tee_sig_a7f3…c2e1",
      timestamp: "2025-01-15T14:23:01.442Z",
    },
    ztai_post: {
      phase: "POST_EXECUTION",
      intent_id: "naawi.infra.v1.CreateVpc",
      tee_signature: "tee_sig_b8d2…f4a3",
      timestamp: "2025-01-15T14:23:09.118Z",
      extra: { sts_session_arn: "arn:aws:sts::assumed-role/naawi-vpc/session-0", credential_ttl: "120s", actual_duration: "7.6s" },
    },
    outputs: { vpc_id: "vpc-0a1b2c3d4e", cidr_block: "10.0.0.0/16", state: "available" },
  },
  {
    id: 1,
    name: "Subnet Provisioning",
    intent_id: "naawi.infra.v1.CreateSubnets",
    description: "Deploy 2 public + 2 private subnets across us-east-1a and us-east-1b. Each subnet gets a /20 CIDR carved from the VPC range.",
    status: "completed",
    coherence: 100,
    estimated_duration: "~12s",
    icon: <Server className="w-4 h-4" />,
    jit: {
      role_arn: "arn:aws:iam::role/naawi-subnet-execution-role",
      session_policy: ["ec2:CreateSubnet", "ec2:DescribeSubnets", "ec2:CreateTags", "ec2:ModifySubnetAttribute"],
      ttl: "3 min",
      condition: "Resource: arn:aws:ec2:*:*:vpc/vpc-0a1b2c3d4e",
    },
    dolt: {
      table: "infra_state",
      operation: "INSERT (×4)",
      fields: { resource_type: "aws::ec2::subnet", vpc_id: "vpc-0a1b2c3d4e", subnets: "pub-1a, pub-1b, priv-1a, priv-1b" },
      commit_message: "layer-1: 4 subnets created in vpc-0a1b2c3d4e",
    },
    ztai_pre: {
      phase: "PRE_EXECUTION",
      intent_id: "naawi.infra.v1.CreateSubnets",
      tee_signature: "tee_sig_c3e5…a1b7",
      timestamp: "2025-01-15T14:23:10.201Z",
    },
    ztai_post: {
      phase: "POST_EXECUTION",
      intent_id: "naawi.infra.v1.CreateSubnets",
      tee_signature: "tee_sig_d4f6…b2c8",
      timestamp: "2025-01-15T14:23:22.487Z",
      extra: { sts_session_arn: "arn:aws:sts::assumed-role/naawi-subnet/session-1", credential_ttl: "180s", actual_duration: "12.2s" },
    },
    outputs: { public_subnet_ids: "subnet-pub1a, subnet-pub1b", private_subnet_ids: "subnet-priv1a, subnet-priv1b" },
  },
  {
    id: 2,
    name: "Internet Gateway + Route Tables",
    intent_id: "naawi.infra.v1.CreateIgwRoutes",
    description: "Attach Internet Gateway, create public and private route tables, associate subnets. Public routes via IGW, private routes prepared for NAT.",
    status: "completed",
    coherence: 100,
    estimated_duration: "~6s",
    icon: <Route className="w-4 h-4" />,
    jit: {
      role_arn: "arn:aws:iam::role/naawi-routing-execution-role",
      session_policy: [
        "ec2:CreateInternetGateway", "ec2:AttachInternetGateway",
        "ec2:CreateRouteTable", "ec2:CreateRoute",
        "ec2:AssociateRouteTable", "ec2:CreateTags",
      ],
      ttl: "3 min",
      condition: "Resource: arn:aws:ec2:*:*:vpc/vpc-0a1b2c3d4e",
    },
    dolt: {
      table: "infra_state",
      operation: "INSERT (×3)",
      fields: { igw_id: "igw-0f1e2d3c", public_rtb: "rtb-pub01", private_rtb: "rtb-priv01" },
      commit_message: "layer-2: IGW + route tables in vpc-0a1b2c3d4e",
    },
    ztai_pre: {
      phase: "PRE_EXECUTION",
      intent_id: "naawi.infra.v1.CreateIgwRoutes",
      tee_signature: "tee_sig_e5g7…c3d9",
      timestamp: "2025-01-15T14:23:23.102Z",
    },
    ztai_post: {
      phase: "POST_EXECUTION",
      intent_id: "naawi.infra.v1.CreateIgwRoutes",
      tee_signature: "tee_sig_f6h8…d4e0",
      timestamp: "2025-01-15T14:23:29.341Z",
      extra: { sts_session_arn: "arn:aws:sts::assumed-role/naawi-routing/session-2", credential_ttl: "180s", actual_duration: "6.2s" },
    },
    outputs: { igw_id: "igw-0f1e2d3c", public_route_table_id: "rtb-pub01", private_route_table_id: "rtb-priv01" },
  },
  {
    id: 3,
    name: "NAT Gateway",
    intent_id: "naawi.infra.v1.CreateNatGateway",
    description: "Allocate Elastic IP, create NAT Gateway in public subnet, add 0.0.0.0/0 route in private route table. This is the slowest step — NAT GW provisioning takes 60-90s.",
    status: "running",
    coherence: 88,
    estimated_duration: "~90s",
    icon: <Shield className="w-4 h-4" />,
    jit: {
      role_arn: "arn:aws:iam::role/naawi-nat-execution-role",
      session_policy: [
        "ec2:AllocateAddress", "ec2:CreateNatGateway",
        "ec2:DescribeNatGateways", "ec2:CreateRoute", "ec2:CreateTags",
      ],
      ttl: "5 min",
      condition: "Resource: arn:aws:ec2:*:*:subnet/subnet-pub1a, arn:aws:ec2:*:*:route-table/rtb-priv01",
    },
    dolt: {
      table: "infra_state",
      operation: "INSERT",
      fields: { nat_gw_id: "nat-0a1b2c…(pending)", eip_alloc_id: "eipalloc-0f1e2d", status: "pending → available" },
      commit_message: "layer-3: NAT GW provisioning in subnet-pub1a",
    },
    ztai_pre: {
      phase: "PRE_EXECUTION",
      intent_id: "naawi.infra.v1.CreateNatGateway",
      tee_signature: "tee_sig_g7i9…e5f1",
      timestamp: "2025-01-15T14:23:30.005Z",
    },
    ztai_post: {
      phase: "STATE_TRANSITION",
      intent_id: "naawi.infra.v1.WaitNatGateway",
      tee_signature: "tee_sig_h8j0…f6g2",
      timestamp: "2025-01-15T14:24:45.…",
      extra: { poll_count: "6", interval: "15s", sts_session_arn: "arn:aws:sts::assumed-role/naawi-nat/session-3", credential_ttl: "300s" },
    },
    outputs: { nat_gateway_id: "nat-0a1b2c…", eip: "52.xx.xx.xx", status: "pending" },
  },
  {
    id: 4,
    name: "Security Group",
    intent_id: "naawi.infra.v1.CreateSecurityGroup",
    description: "Create default VPC security group with egress-only rules. No AuthorizeSecurityGroupIngress — consuming intents must request their own JIT scope for ingress.",
    status: "pending",
    coherence: 100,
    estimated_duration: "~4s",
    icon: <ShieldCheck className="w-4 h-4" />,
    jit: {
      role_arn: "arn:aws:iam::role/naawi-sg-execution-role",
      session_policy: ["ec2:CreateSecurityGroup", "ec2:AuthorizeSecurityGroupEgress", "ec2:CreateTags"],
      ttl: "1 min",
      condition: "Resource: arn:aws:ec2:*:*:vpc/vpc-0a1b2c3d4e — NO AuthorizeSecurityGroupIngress",
    },
    dolt: {
      table: "infra_state",
      operation: "INSERT",
      fields: { sg_id: "(pending)", vpc_id: "vpc-0a1b2c3d4e", ingress_rules: "none — consuming intent scoped" },
      commit_message: "layer-4: egress-only SG in vpc-0a1b2c3d4e",
    },
    ztai_pre: {
      phase: "PRE_EXECUTION",
      intent_id: "naawi.infra.v1.CreateSecurityGroup",
      tee_signature: "(pending)",
      timestamp: "(pending)",
    },
    ztai_post: {
      phase: "POST_EXECUTION",
      intent_id: "naawi.infra.v1.CreateSecurityGroup",
      tee_signature: "(pending)",
      timestamp: "(pending)",
      extra: { credential_ttl: "60s" },
    },
    outputs: {},
  },
];

/* ─── Status Helpers ─── */

function statusColor(s: GoldenLayer["status"]) {
  switch (s) {
    case "completed": return "text-[hsl(var(--success))]";
    case "running": return "text-[hsl(var(--primary))]";
    case "warning": return "text-[hsl(var(--warning))]";
    case "pending": return "text-muted-foreground";
  }
}

function statusBg(s: GoldenLayer["status"]) {
  switch (s) {
    case "completed": return "bg-[hsl(var(--success)/0.12)]";
    case "running": return "bg-[hsl(var(--primary)/0.12)]";
    case "warning": return "bg-[hsl(var(--warning)/0.12)]";
    case "pending": return "bg-muted/50";
  }
}

function statusLabel(s: GoldenLayer["status"]) {
  switch (s) {
    case "completed": return "DONE";
    case "running": return "RUNNING";
    case "warning": return "WARN";
    case "pending": return "PENDING";
  }
}

function coherenceColor(c: number) {
  if (c >= 95) return "text-[hsl(var(--success))]";
  if (c >= 85) return "text-[hsl(var(--warning))]";
  return "text-destructive";
}

/* ─── Sub-components ─── */

function SectionLabel({ icon, label }: { icon: React.ReactNode; label: string }) {
  return (
    <div className="flex items-center gap-2 mb-2">
      <span className="text-muted-foreground">{icon}</span>
      <span className="text-[10px] uppercase tracking-[0.15em] font-semibold text-muted-foreground">{label}</span>
    </div>
  );
}

function CodeBlock({ children }: { children: React.ReactNode }) {
  return (
    <pre className="font-mono text-[11px] leading-relaxed bg-muted/40 rounded-lg p-3 overflow-x-auto border border-border/50">
      {children}
    </pre>
  );
}

function JitSection({ jit }: { jit: JitScope }) {
  return (
    <div>
      <SectionLabel icon={<Key className="w-3.5 h-3.5" />} label="JIT Credential Scope" />
      <div className="glass-subtle rounded-lg p-3 space-y-2">
        <div className="flex items-center gap-2 text-xs">
          <span className="text-muted-foreground">Role:</span>
          <code className="font-mono text-[11px] text-[hsl(var(--primary))]">{jit.role_arn}</code>
        </div>
        <div className="flex items-center gap-2 text-xs">
          <Timer className="w-3 h-3 text-[hsl(var(--warning))]" />
          <span className="text-muted-foreground">TTL:</span>
          <span className="font-mono font-semibold text-[hsl(var(--warning))]">{jit.ttl}</span>
        </div>
        {jit.condition && (
          <div className="text-[11px] font-mono text-muted-foreground italic">{jit.condition}</div>
        )}
        <div className="mt-2">
          <span className="text-[10px] uppercase tracking-wider text-muted-foreground">Session Policy</span>
          <div className="mt-1 flex flex-wrap gap-1">
            {jit.session_policy.map((p) => (
              <Badge key={p} variant="outline" className="font-mono text-[10px] border-border/60 bg-muted/30">
                {p}
              </Badge>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}

function DoltSection({ dolt }: { dolt: DoltWrite }) {
  return (
    <div>
      <SectionLabel icon={<Database className="w-3.5 h-3.5" />} label="Dolt State Write" />
      <CodeBlock>
        <span className="text-[hsl(var(--primary))]">{dolt.operation}</span>
        {" INTO "}
        <span className="text-[hsl(var(--success))]">{dolt.table}</span>
        {"\n"}
        {Object.entries(dolt.fields).map(([k, v]) => (
          <span key={k}>
            {"  "}<span className="text-muted-foreground">{k}:</span>{" "}
            <span className="text-foreground">{v}</span>{"\n"}
          </span>
        ))}
        {"\n"}
        <span className="text-muted-foreground">{"# "}{dolt.commit_message}</span>
      </CodeBlock>
    </div>
  );
}

function ZtaiSection({ pre, post }: { pre: ZtaiRecord; post: ZtaiRecord }) {
  return (
    <div>
      <SectionLabel icon={<FileCheck className="w-3.5 h-3.5" />} label="ZTAI Audit Records" />
      <div className="space-y-2">
        {[pre, post].map((rec, i) => (
          <div key={i} className="glass-subtle rounded-lg p-3">
            <div className="flex items-center gap-2 mb-1">
              <Badge variant="outline" className={`text-[10px] font-mono ${
                rec.phase === "PRE_EXECUTION" ? "border-[hsl(var(--primary)/0.4)] text-[hsl(var(--primary))]" :
                rec.phase === "POST_EXECUTION" ? "border-[hsl(var(--success)/0.4)] text-[hsl(var(--success))]" :
                "border-[hsl(var(--warning)/0.4)] text-[hsl(var(--warning))]"
              }`}>
                {rec.phase}
              </Badge>
              <code className="font-mono text-[10px] text-muted-foreground">{rec.timestamp}</code>
            </div>
            <div className="flex items-center gap-2 text-[11px]">
              <Hash className="w-3 h-3 text-muted-foreground" />
              <code className="font-mono text-muted-foreground">{rec.tee_signature}</code>
            </div>
            {rec.extra && (
              <div className="mt-1.5 flex flex-wrap gap-x-4 gap-y-1">
                {Object.entries(rec.extra).map(([k, v]) => (
                  <span key={k} className="text-[10px] font-mono">
                    <span className="text-muted-foreground">{k}:</span>{" "}
                    <span className="text-foreground">{v}</span>
                  </span>
                ))}
              </div>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}

/* ─── Layer Card ─── */

function LayerCard({ layer }: { layer: GoldenLayer }) {
  const [open, setOpen] = useState(layer.status === "running");

  return (
    <Collapsible open={open} onOpenChange={setOpen}>
      <CollapsibleTrigger asChild>
        <button className={`w-full group glass-panel rounded-xl p-4 transition-all duration-300 hover:shadow-lg cursor-pointer ${
          layer.status === "running" ? "ring-1 ring-[hsl(var(--primary)/0.3)] glass-glow" : ""
        }`}>
          <div className="flex items-center gap-4">
            {/* Layer number */}
            <div className={`w-9 h-9 rounded-lg flex items-center justify-center text-sm font-bold ${statusBg(layer.status)} ${statusColor(layer.status)}`}>
              {layer.id}
            </div>

            {/* Icon + Name */}
            <div className={`${statusColor(layer.status)}`}>{layer.icon}</div>
            <div className="flex-1 text-left">
              <div className="flex items-center gap-2">
                <span className="font-semibold text-sm text-foreground">{layer.name}</span>
                <Badge variant="outline" className={`text-[10px] font-mono ${statusColor(layer.status)} border-current/20`}>
                  {statusLabel(layer.status)}
                </Badge>
              </div>
              <code className="text-[11px] font-mono text-muted-foreground">{layer.intent_id}</code>
            </div>

            {/* Coherence */}
            <div className="text-right hidden sm:block">
              <div className={`text-lg font-bold font-mono ${coherenceColor(layer.coherence)}`}>
                {layer.coherence}%
              </div>
              <div className="text-[10px] text-muted-foreground uppercase tracking-wider">RMCM</div>
            </div>

            {/* Duration */}
            <div className="text-right hidden sm:block">
              <div className="text-xs font-mono text-muted-foreground">{layer.estimated_duration}</div>
            </div>

            {/* Chevron */}
            <ChevronRight className={`w-4 h-4 text-muted-foreground transition-transform duration-200 ${open ? "rotate-90" : ""}`} />
          </div>
          
          {layer.status === "running" && (
            <div className="mt-3 w-full h-1 rounded-full bg-muted/60 overflow-hidden">
              <div className="h-full rounded-full bg-[hsl(var(--primary))] animate-pulse" style={{ width: "62%" }} />
            </div>
          )}
        </button>
      </CollapsibleTrigger>

      <CollapsibleContent className="mt-1">
        <div className="glass-panel-elevated rounded-xl p-5 ml-6 border-l-2 border-[hsl(var(--primary)/0.2)] space-y-5 animate-in slide-in-from-top-2 duration-200">
          {/* Description */}
          <p className="text-sm text-muted-foreground leading-relaxed">{layer.description}</p>

          {/* JIT */}
          <JitSection jit={layer.jit} />

          {/* Dolt */}
          <DoltSection dolt={layer.dolt} />

          {/* ZTAI */}
          <ZtaiSection pre={layer.ztai_pre} post={layer.ztai_post} />

          {/* Outputs */}
          {Object.keys(layer.outputs).length > 0 && (
            <div>
              <SectionLabel icon={<Eye className="w-3.5 h-3.5" />} label="Outputs" />
              <div className="flex flex-wrap gap-2">
                {Object.entries(layer.outputs).map(([k, v]) => (
                  <div key={k} className="glass-subtle rounded-lg px-3 py-1.5">
                    <span className="text-[10px] text-muted-foreground">{k}</span>
                    <div className="font-mono text-xs text-foreground">{v}</div>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      </CollapsibleContent>
    </Collapsible>
  );
}

/* ─── Page ─── */

export default function GoldenPath() {
  const completedCount = LAYERS.filter(l => l.status === "completed").length;
  const totalCoherence = Math.round(LAYERS.reduce((s, l) => s + l.coherence, 0) / LAYERS.length);

  return (
    <div className="min-h-screen bg-[#f5f4f0]" style={{ fontFamily: "'Instrument Sans', 'Inter', sans-serif" }}>
      {/* Header */}
      <header className="sticky top-0 z-50 bg-[#f5f4f0]/80 backdrop-blur-xl border-b border-[#e8e7e4]">
        <div className="max-w-5xl mx-auto px-8 h-[64px] flex items-center justify-between">
          <div className="flex items-center gap-4">
            <Link to="/console" className="flex items-center gap-1.5 text-sm text-[#888] hover:text-[#1a1a1a] transition-colors">
              <ArrowLeft className="w-4 h-4" />
            </Link>
            <Layers className="w-4 h-4 text-[hsl(199,89%,48%)]" />
            <span className="text-sm font-medium text-[#1a1a1a]">Golden Path</span>
            <Badge variant="outline" className="font-mono text-[10px] border-[#e8e7e4]">VPC Foundation</Badge>
          </div>
          <div className="flex items-center gap-3">
            <NavLink to="/backstage">Backstage</NavLink>
            <NavLink to="/brand">Brand</NavLink>
            <UserMenu />
          </div>
        </div>
      </header>

      <main className="max-w-5xl mx-auto px-8 py-8 space-y-8">
        {/* Hero */}
        <div className="space-y-3">
          <div className="flex items-center gap-2">
            <Badge className="bg-[hsl(var(--primary)/0.12)] text-[hsl(var(--primary))] border-0 text-xs font-mono">
              naawi.gold.v1.VpcFoundation
            </Badge>
            <Badge variant="outline" className="text-[10px] font-mono">us-east-1</Badge>
            <Badge variant="outline" className="text-[10px] font-mono">production</Badge>
          </div>
          <h1 className="text-2xl sm:text-3xl font-bold tracking-tight text-foreground" style={{ fontFamily: "'Space Grotesk', sans-serif" }}>
            VPC Foundation Golden Path
          </h1>
          <p className="text-sm text-muted-foreground max-w-2xl leading-relaxed">
            Production-hardened VPC template with per-layer JIT credentials, Dolt-versioned state, and TEE-signed ZTAI audit records.
            The dispatch table is the governor — the probabilism stops at the intent ID.
          </p>
        </div>

        {/* Stats Bar */}
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
          {[
            { label: "Layers", value: `${completedCount}/${LAYERS.length}`, icon: <Layers className="w-3.5 h-3.5" /> },
            { label: "RMCM Coherence", value: `${totalCoherence}%`, icon: <Eye className="w-3.5 h-3.5" /> },
            { label: "JIT Model", value: "Per-Layer STS", icon: <Key className="w-3.5 h-3.5" /> },
            { label: "Audit Chain", value: "TEE-signed", icon: <Lock className="w-3.5 h-3.5" /> },
          ].map((stat) => (
            <div key={stat.label} className="glass-panel rounded-xl p-3 text-center">
              <div className="flex items-center justify-center gap-1.5 text-muted-foreground mb-1">
                {stat.icon}
                <span className="text-[10px] uppercase tracking-wider">{stat.label}</span>
              </div>
              <div className="text-lg font-bold font-mono text-foreground">{stat.value}</div>
            </div>
          ))}
        </div>

        {/* Architecture Callout */}
        <div className="glass-panel-elevated rounded-xl p-4 border-l-2 border-[hsl(var(--primary)/0.4)]">
          <div className="flex items-start gap-3">
            <ShieldCheck className="w-5 h-5 text-[hsl(var(--primary))] mt-0.5 shrink-0" />
            <div className="text-sm space-y-1">
              <p className="font-semibold text-foreground">Deterministic Execution Guarantee</p>
              <p className="text-muted-foreground leading-relaxed">
                The LLM resolves <code className="font-mono text-[hsl(var(--primary))] text-xs">"deploy a production VPC"</code> → <code className="font-mono text-[hsl(var(--primary))] text-xs">naawi.gold.v1.VpcFoundation</code>.
                The dispatch table takes over from there. Dry-run and live closures share the same code path — what you reviewed is exactly what executes.
              </p>
            </div>
          </div>
        </div>

        {/* Layers */}
        <div className="space-y-3">
          <h2 className="text-sm font-semibold uppercase tracking-wider text-muted-foreground flex items-center gap-2">
            <Layers className="w-4 h-4" />
            Execution Layers
          </h2>
          <div className="space-y-2">
            {LAYERS.map((layer) => (
              <LayerCard key={layer.id} layer={layer} />
            ))}
          </div>
        </div>

        {/* Bottom Actions */}
        <div className="flex flex-wrap gap-2 pt-4">
          <Button variant="outline" className="glass-subtle text-xs font-mono gap-2">
            <Eye className="w-3.5 h-3.5" /> View JIT Policy Spec
          </Button>
          <Button variant="outline" className="glass-subtle text-xs font-mono gap-2">
            <Database className="w-3.5 h-3.5" /> Dolt Commit History
          </Button>
          <Button variant="outline" className="glass-subtle text-xs font-mono gap-2">
            <FileCheck className="w-3.5 h-3.5" /> ZTAI Chain Verify
          </Button>
          <Button variant="outline" className="glass-subtle text-xs font-mono gap-2">
            <Shield className="w-3.5 h-3.5" /> RMCM Coherence Report
          </Button>
          <Button variant="outline" className="glass-subtle text-xs font-mono gap-2">
            <Clock className="w-3.5 h-3.5" /> Execution Timeline
          </Button>
        </div>
      </main>
    </div>
  );
}
