// ═══════════════════════════════════════════════════════════════════
// Project Naawi — Golden Path Template Registry
// Intent-to-Golden-Path Mapping: The "Gravity" Mechanism
// ═══════════════════════════════════════════════════════════════════

// ───── Types ─────

export type GoldenPathId =
  | "high-performance-api"
  | "internal-worker"
  | "fintech-pci"
  | "global-spa"
  | "event-pipeline"
  | "service-mesh"
  | "three-tier"
  | "internal-api"
  | "edge-cache"
  | "ml-training"
  | "general-compute";

export type SensitivityTag = "pci-dss" | "hipaa" | "sox" | "sensitive" | "public";
export type RuntimeHint = "zig" | "rust" | "go" | "node" | "python" | "java" | "dotnet";

export interface ScaffoldingSpec {
  networkPolicies: "zero-trust" | "namespace-isolated" | "permissive";
  observability: {
    serviceMonitor: boolean;
    goldenSignals: boolean; // latency, traffic, errors, saturation
    customMetrics?: string[];
  };
  resilience: {
    pdb: boolean; // PodDisruptionBudget
    hpa: boolean; // HorizontalPodAutoscaler
    circuitBreaker?: boolean;
    retryPolicy?: boolean;
  };
  security: {
    vaultIntegration: boolean;
    imdsv2Only: boolean;
    encryptionAtRest: boolean;
    securityContext: boolean;
  };
}

export interface ResourceCeiling {
  maxCpuMillicores: number;
  maxMemoryMb: number;
  maxInstances: number;
  maxMonthlyBudgetUsd: number;
}

export interface SloTarget {
  availability: number; // e.g. 99.9
  p99LatencyMs: number;
  requiresHealthCheck: boolean;
  requiresAlerts: boolean;
}

export interface GoldenPathTemplate {
  id: GoldenPathId;
  name: string;
  description: string;
  icon: string; // emoji
  sensitivityTags: SensitivityTag[];
  runtimeHints: RuntimeHint[];
  scaffolding: ScaffoldingSpec;
  resourceCeiling: ResourceCeiling;
  sloTarget: SloTarget;
  requiredResources: string[];
  suggestedInstanceType: Record<"cheapest" | "balanced" | "production", string>;
  augmentations: string[]; // auto-injected scaffolding descriptions
}

// ───── Template Registry ─────

export const GOLDEN_PATH_REGISTRY: GoldenPathTemplate[] = [
  {
    id: "high-performance-api",
    name: "High-Performance API",
    description: "Blitz Gateway with sub-10ms p99 latency. Includes circuit breakers, rate limiting, and 99.9% SLO.",
    icon: "⚡",
    sensitivityTags: ["sensitive"],
    runtimeHints: ["zig", "rust", "go"],
    scaffolding: {
      networkPolicies: "zero-trust",
      observability: { serviceMonitor: true, goldenSignals: true, customMetrics: ["request_queue_depth", "connection_pool_usage"] },
      resilience: { pdb: true, hpa: true, circuitBreaker: true, retryPolicy: true },
      security: { vaultIntegration: true, imdsv2Only: true, encryptionAtRest: true, securityContext: true },
    },
    resourceCeiling: { maxCpuMillicores: 4000, maxMemoryMb: 8192, maxInstances: 20, maxMonthlyBudgetUsd: 2000 },
    sloTarget: { availability: 99.9, p99LatencyMs: 10, requiresHealthCheck: true, requiresAlerts: true },
    requiredResources: ["eks", "alb", "vpc", "subnets"],
    suggestedInstanceType: { cheapest: "c6g.medium", balanced: "c7g.large", production: "c7g.2xlarge" },
    augmentations: ["ServiceMonitor (Four Golden Signals)", "Envoy Sidecar Proxy", "SecurityContext (non-root)", "PodDisruptionBudget (minAvailable: 2)", "HPA (CPU 60% / Custom Metrics)"],
  },
  {
    id: "internal-worker",
    name: "Internal Worker",
    description: "Queue-depth autoscaling worker. Optimized for batch processing with DLQ and retry policies.",
    icon: "⚙️",
    sensitivityTags: ["public"],
    runtimeHints: ["zig", "rust", "go", "python"],
    scaffolding: {
      networkPolicies: "namespace-isolated",
      observability: { serviceMonitor: true, goldenSignals: true, customMetrics: ["queue_depth", "processing_duration_seconds"] },
      resilience: { pdb: true, hpa: true, retryPolicy: true },
      security: { vaultIntegration: false, imdsv2Only: true, encryptionAtRest: true, securityContext: true },
    },
    resourceCeiling: { maxCpuMillicores: 2000, maxMemoryMb: 4096, maxInstances: 50, maxMonthlyBudgetUsd: 1500 },
    sloTarget: { availability: 99.5, p99LatencyMs: 5000, requiresHealthCheck: true, requiresAlerts: true },
    requiredResources: ["sqs", "lambda", "dynamodb"],
    suggestedInstanceType: { cheapest: "t4g.small", balanced: "m6g.medium", production: "m7g.large" },
    augmentations: ["SQS DLQ (maxReceiveCount: 3)", "Queue-depth HPA", "ServiceMonitor (processing_duration)", "PodDisruptionBudget"],
  },
  {
    id: "fintech-pci",
    name: "Fintech / PCI-DSS",
    description: "Payment-grade infrastructure with mandatory Vault integration, encryption everywhere, and audit logging.",
    icon: "🏦",
    sensitivityTags: ["pci-dss", "sensitive"],
    runtimeHints: ["zig", "rust", "go", "java"],
    scaffolding: {
      networkPolicies: "zero-trust",
      observability: { serviceMonitor: true, goldenSignals: true, customMetrics: ["transaction_count", "payment_latency_ms", "fraud_score"] },
      resilience: { pdb: true, hpa: true, circuitBreaker: true, retryPolicy: true },
      security: { vaultIntegration: true, imdsv2Only: true, encryptionAtRest: true, securityContext: true },
    },
    resourceCeiling: { maxCpuMillicores: 4000, maxMemoryMb: 16384, maxInstances: 10, maxMonthlyBudgetUsd: 5000 },
    sloTarget: { availability: 99.99, p99LatencyMs: 50, requiresHealthCheck: true, requiresAlerts: true },
    requiredResources: ["eks", "rds", "alb", "vpc", "subnets", "kms"],
    suggestedInstanceType: { cheapest: "c6i.large", balanced: "c7i.xlarge", production: "c7i.2xlarge" },
    augmentations: ["Vault Sidecar (auto-unseal)", "mTLS Everywhere", "Audit Log Pipeline", "SecurityContext (non-root, readOnlyRootFs)", "Network Policy (deny-all default)", "PDB (minAvailable: 3)", "Multi-AZ RDS"],
  },
  {
    id: "global-spa",
    name: "Global SPA",
    description: "CloudFront + S3 with Origin Access Control, Lambda@Edge, and global distribution.",
    icon: "🌍",
    sensitivityTags: ["public"],
    runtimeHints: ["node", "python"],
    scaffolding: {
      networkPolicies: "permissive",
      observability: { serviceMonitor: false, goldenSignals: true },
      resilience: { pdb: false, hpa: false },
      security: { vaultIntegration: false, imdsv2Only: true, encryptionAtRest: true, securityContext: false },
    },
    resourceCeiling: { maxCpuMillicores: 500, maxMemoryMb: 512, maxInstances: 1, maxMonthlyBudgetUsd: 200 },
    sloTarget: { availability: 99.9, p99LatencyMs: 200, requiresHealthCheck: false, requiresAlerts: true },
    requiredResources: ["s3", "cloudfront", "route53", "lambda"],
    suggestedInstanceType: { cheapest: "t3.nano", balanced: "t3.nano", production: "t3.nano" },
    augmentations: ["CloudFront OAC", "S3 Bucket Policy (deny public)", "Lambda@Edge (headers)", "Cache Invalidation Pipeline"],
  },
  {
    id: "event-pipeline",
    name: "Event Pipeline",
    description: "SQS → Lambda → DynamoDB with mandatory DLQ, EventBridge integration, and backpressure handling.",
    icon: "📡",
    sensitivityTags: ["public"],
    runtimeHints: ["node", "python", "go", "rust"],
    scaffolding: {
      networkPolicies: "namespace-isolated",
      observability: { serviceMonitor: true, goldenSignals: true, customMetrics: ["queue_depth", "dlq_count", "event_age_seconds"] },
      resilience: { pdb: false, hpa: true, retryPolicy: true },
      security: { vaultIntegration: false, imdsv2Only: true, encryptionAtRest: true, securityContext: true },
    },
    resourceCeiling: { maxCpuMillicores: 1000, maxMemoryMb: 2048, maxInstances: 100, maxMonthlyBudgetUsd: 800 },
    sloTarget: { availability: 99.9, p99LatencyMs: 1000, requiresHealthCheck: true, requiresAlerts: true },
    requiredResources: ["sqs", "lambda", "dynamodb", "eventbridge"],
    suggestedInstanceType: { cheapest: "t4g.micro", balanced: "t4g.small", production: "m6g.medium" },
    augmentations: ["SQS DLQ (Redrive Policy)", "EventBridge Rule", "Lambda Concurrency Limit", "DynamoDB On-Demand"],
  },
  {
    id: "service-mesh",
    name: "Service Mesh",
    description: "EKS + App Mesh with mTLS, circuit breakers, and distributed tracing.",
    icon: "🕸️",
    sensitivityTags: ["sensitive"],
    runtimeHints: ["go", "rust", "java", "node"],
    scaffolding: {
      networkPolicies: "zero-trust",
      observability: { serviceMonitor: true, goldenSignals: true, customMetrics: ["mesh_request_count", "mesh_retry_count"] },
      resilience: { pdb: true, hpa: true, circuitBreaker: true, retryPolicy: true },
      security: { vaultIntegration: true, imdsv2Only: true, encryptionAtRest: true, securityContext: true },
    },
    resourceCeiling: { maxCpuMillicores: 8000, maxMemoryMb: 16384, maxInstances: 30, maxMonthlyBudgetUsd: 3000 },
    sloTarget: { availability: 99.9, p99LatencyMs: 100, requiresHealthCheck: true, requiresAlerts: true },
    requiredResources: ["eks", "app-mesh", "alb"],
    suggestedInstanceType: { cheapest: "m6g.medium", balanced: "m7g.large", production: "m7g.2xlarge" },
    augmentations: ["App Mesh Virtual Services", "Envoy Sidecar (auto-inject)", "Circuit Breaker Thresholds", "Distributed Tracing (X-Ray)", "mTLS"],
  },
  {
    id: "three-tier",
    name: "Enterprise 3-Tier",
    description: "Classic ASG + ALB + RDS + ElastiCache with Multi-AZ, auto-scaling, and health checks.",
    icon: "🏗️",
    sensitivityTags: ["sensitive"],
    runtimeHints: ["java", "dotnet", "node", "python"],
    scaffolding: {
      networkPolicies: "namespace-isolated",
      observability: { serviceMonitor: true, goldenSignals: true },
      resilience: { pdb: true, hpa: true },
      security: { vaultIntegration: false, imdsv2Only: true, encryptionAtRest: true, securityContext: true },
    },
    resourceCeiling: { maxCpuMillicores: 8000, maxMemoryMb: 32768, maxInstances: 20, maxMonthlyBudgetUsd: 4000 },
    sloTarget: { availability: 99.9, p99LatencyMs: 200, requiresHealthCheck: true, requiresAlerts: true },
    requiredResources: ["asg", "alb", "rds", "elasticache", "vpc", "subnets"],
    suggestedInstanceType: { cheapest: "t3.medium", balanced: "m6i.large", production: "m7i.xlarge" },
    augmentations: ["Multi-AZ RDS", "ElastiCache Cluster Mode", "ALB Health Checks (2 failures = unhealthy)", "ASG Scaling Policies", "RDS Proxy"],
  },
  {
    id: "internal-api",
    name: "Internal API",
    description: "API Gateway + Lambda + RDS Proxy for internal tools. Provisioned concurrency for cold-start elimination.",
    icon: "🔧",
    sensitivityTags: ["public"],
    runtimeHints: ["node", "python", "go"],
    scaffolding: {
      networkPolicies: "namespace-isolated",
      observability: { serviceMonitor: true, goldenSignals: true },
      resilience: { pdb: false, hpa: false },
      security: { vaultIntegration: false, imdsv2Only: true, encryptionAtRest: true, securityContext: false },
    },
    resourceCeiling: { maxCpuMillicores: 1000, maxMemoryMb: 2048, maxInstances: 5, maxMonthlyBudgetUsd: 500 },
    sloTarget: { availability: 99.5, p99LatencyMs: 500, requiresHealthCheck: true, requiresAlerts: true },
    requiredResources: ["api-gateway", "lambda", "rds-proxy", "rds"],
    suggestedInstanceType: { cheapest: "t4g.micro", balanced: "t4g.small", production: "t4g.medium" },
    augmentations: ["Lambda Provisioned Concurrency", "RDS Proxy (connection pooling)", "API Gateway Throttling", "CloudWatch Alarms"],
  },
  {
    id: "edge-cache",
    name: "Edge Cache",
    description: "DynamoDB Global Tables + Route53 ARC + Lambda for ultra-low-latency edge data.",
    icon: "🌐",
    sensitivityTags: ["public"],
    runtimeHints: ["node", "python", "rust"],
    scaffolding: {
      networkPolicies: "permissive",
      observability: { serviceMonitor: true, goldenSignals: true },
      resilience: { pdb: false, hpa: false },
      security: { vaultIntegration: false, imdsv2Only: true, encryptionAtRest: true, securityContext: false },
    },
    resourceCeiling: { maxCpuMillicores: 500, maxMemoryMb: 1024, maxInstances: 5, maxMonthlyBudgetUsd: 600 },
    sloTarget: { availability: 99.95, p99LatencyMs: 50, requiresHealthCheck: true, requiresAlerts: true },
    requiredResources: ["dynamodb", "route53", "lambda", "cloudfront"],
    suggestedInstanceType: { cheapest: "t4g.nano", balanced: "t4g.micro", production: "t4g.small" },
    augmentations: ["DynamoDB Global Tables", "Route53 Health Checks", "CloudFront Cache Behaviors", "Lambda@Edge"],
  },
  {
    id: "ml-training",
    name: "ML Training Pipeline",
    description: "GPU-accelerated training with spot instance support, S3 checkpointing, and cost guardrails.",
    icon: "🧠",
    sensitivityTags: ["public"],
    runtimeHints: ["python"],
    scaffolding: {
      networkPolicies: "namespace-isolated",
      observability: { serviceMonitor: true, goldenSignals: true, customMetrics: ["gpu_utilization", "training_loss", "epoch_duration"] },
      resilience: { pdb: false, hpa: false },
      security: { vaultIntegration: false, imdsv2Only: true, encryptionAtRest: true, securityContext: true },
    },
    resourceCeiling: { maxCpuMillicores: 16000, maxMemoryMb: 65536, maxInstances: 8, maxMonthlyBudgetUsd: 10000 },
    sloTarget: { availability: 95.0, p99LatencyMs: 60000, requiresHealthCheck: false, requiresAlerts: true },
    requiredResources: ["ec2", "s3", "ebs"],
    suggestedInstanceType: { cheapest: "g4dn.xlarge", balanced: "g5.2xlarge", production: "p4d.24xlarge" },
    augmentations: ["Spot Instance with Fallback", "S3 Checkpoint Sync", "EBS Snapshot Schedule", "CloudWatch GPU Metrics"],
  },
  {
    id: "general-compute",
    name: "General Compute",
    description: "Standard EC2 instance with sensible defaults. The safe starting point for any workload.",
    icon: "💻",
    sensitivityTags: ["public"],
    runtimeHints: ["node", "python", "go", "java", "dotnet", "rust", "zig"],
    scaffolding: {
      networkPolicies: "permissive",
      observability: { serviceMonitor: false, goldenSignals: false },
      resilience: { pdb: false, hpa: false },
      security: { vaultIntegration: false, imdsv2Only: true, encryptionAtRest: true, securityContext: false },
    },
    resourceCeiling: { maxCpuMillicores: 4000, maxMemoryMb: 8192, maxInstances: 10, maxMonthlyBudgetUsd: 500 },
    sloTarget: { availability: 99.0, p99LatencyMs: 1000, requiresHealthCheck: false, requiresAlerts: false },
    requiredResources: ["ec2"],
    suggestedInstanceType: { cheapest: "t3.nano", balanced: "t3.medium", production: "m6i.large" },
    augmentations: ["IMDSv2 Required", "EBS Encryption", "CloudWatch Basic Monitoring"],
  },
];

// ───── Halt & Report Validation ─────

export type ValidationSeverity = "error" | "warning" | "info";

export interface ValidationResult {
  id: string;
  rule: string;
  severity: ValidationSeverity;
  message: string;
  suggestion?: string;
  passed: boolean;
}

export interface SafetyGateReport {
  passed: boolean;
  halted: boolean;
  results: ValidationResult[];
  goldenPath: GoldenPathTemplate;
  timestamp: string;
}

export function runSafetyGate(
  goldenPath: GoldenPathTemplate,
  config: {
    cpuMillicores?: number;
    memoryMb?: number;
    instanceCount?: number;
    estimatedMonthlyCost?: number;
    hasVaultIntegration?: boolean;
    hasHealthCheck?: boolean;
    hasSloAlerts?: boolean;
    environment?: string;
    sensitivityTags?: SensitivityTag[];
  }
): SafetyGateReport {
  const results: ValidationResult[] = [];
  const env = config.environment || "dev";
  const tags = config.sensitivityTags || goldenPath.sensitivityTags;

  // 1. Resource Ceiling: CPU
  if (config.cpuMillicores) {
    const passed = config.cpuMillicores <= goldenPath.resourceCeiling.maxCpuMillicores;
    results.push({
      id: "cpu-ceiling",
      rule: "Resource Ceiling — CPU",
      severity: passed ? "info" : "error",
      message: passed
        ? `CPU ${config.cpuMillicores}m within ceiling (${goldenPath.resourceCeiling.maxCpuMillicores}m)`
        : `CPU ${config.cpuMillicores}m exceeds Golden Path ceiling of ${goldenPath.resourceCeiling.maxCpuMillicores}m`,
      suggestion: passed ? undefined : `Reduce CPU or escalate to a higher-capacity Golden Path.`,
      passed,
    });
  }

  // 2. Resource Ceiling: Memory
  if (config.memoryMb) {
    const passed = config.memoryMb <= goldenPath.resourceCeiling.maxMemoryMb;
    results.push({
      id: "memory-ceiling",
      rule: "Resource Ceiling — Memory",
      severity: passed ? "info" : "error",
      message: passed
        ? `Memory ${config.memoryMb}MB within ceiling (${goldenPath.resourceCeiling.maxMemoryMb}MB)`
        : `Memory ${config.memoryMb}MB exceeds Golden Path ceiling of ${goldenPath.resourceCeiling.maxMemoryMb}MB`,
      suggestion: passed ? undefined : `Reduce memory or use a storage-optimized path.`,
      passed,
    });
  }

  // 3. Resource Ceiling: Instance Count
  if (config.instanceCount) {
    const passed = config.instanceCount <= goldenPath.resourceCeiling.maxInstances;
    results.push({
      id: "instance-ceiling",
      rule: "Resource Ceiling — Instance Count",
      severity: passed ? "info" : "error",
      message: passed
        ? `${config.instanceCount} instance(s) within ceiling (${goldenPath.resourceCeiling.maxInstances})`
        : `${config.instanceCount} instances exceeds ceiling of ${goldenPath.resourceCeiling.maxInstances}`,
      passed,
    });
  }

  // 4. Budget Ceiling
  if (config.estimatedMonthlyCost) {
    const passed = config.estimatedMonthlyCost <= goldenPath.resourceCeiling.maxMonthlyBudgetUsd;
    results.push({
      id: "budget-ceiling",
      rule: "Budget Ceiling",
      severity: passed ? "info" : "warning",
      message: passed
        ? `Estimated $${config.estimatedMonthlyCost}/mo within budget ($${goldenPath.resourceCeiling.maxMonthlyBudgetUsd}/mo)`
        : `Estimated $${config.estimatedMonthlyCost}/mo exceeds Golden Path budget of $${goldenPath.resourceCeiling.maxMonthlyBudgetUsd}/mo`,
      suggestion: passed ? undefined : `Consider spot instances or a smaller instance type.`,
      passed,
    });
  }

  // 5. Security Context: Vault Integration
  if (goldenPath.scaffolding.security.vaultIntegration) {
    const isSensitive = tags.some(t => ["pci-dss", "hipaa", "sox", "sensitive"].includes(t));
    if (isSensitive) {
      const passed = !!config.hasVaultIntegration;
      results.push({
        id: "vault-required",
        rule: "Security Context — Vault Integration",
        severity: passed ? "info" : "error",
        message: passed
          ? "Vault integration detected for sensitive service"
          : "HALT: No Vault integration specified for a service tagged as sensitive",
        suggestion: passed ? undefined : `Enable BYOC Vault integration in the Vault tab before deploying.`,
        passed,
      });
    }
  }

  // 6. SLO Feasibility: Health Check
  if (goldenPath.sloTarget.requiresHealthCheck) {
    const passed = !!config.hasHealthCheck || env === "dev";
    results.push({
      id: "slo-healthcheck",
      rule: "SLO Feasibility — Health Check",
      severity: passed ? "info" : (env === "prod" ? "error" : "warning"),
      message: passed
        ? `Health check endpoint configured for ${goldenPath.sloTarget.availability}% SLO`
        : `HALT: ${goldenPath.sloTarget.availability}% SLO cannot be measured — missing health check endpoint`,
      suggestion: passed ? undefined : `Add a /health or /readyz endpoint to your service.`,
      passed,
    });
  }

  // 7. SLO Feasibility: Alerts
  if (goldenPath.sloTarget.requiresAlerts && env === "prod") {
    const passed = !!config.hasSloAlerts;
    results.push({
      id: "slo-alerts",
      rule: "SLO Feasibility — Alerting",
      severity: passed ? "info" : "warning",
      message: passed
        ? "SLO alerting configured"
        : `Alerting not configured for ${goldenPath.sloTarget.availability}% SLO target`,
      suggestion: passed ? undefined : `The Golden Path will auto-configure CloudWatch Alarms.`,
      passed,
    });
  }

  // 8. Network Policy (prod)
  if (goldenPath.scaffolding.networkPolicies === "zero-trust" && env === "prod") {
    results.push({
      id: "network-zero-trust",
      rule: "Network Policy — Zero Trust",
      severity: "info",
      message: "Zero-Trust NetworkPolicies will be auto-scaffolded",
      passed: true,
    });
  }

  // 9. Observability
  if (goldenPath.scaffolding.observability.serviceMonitor) {
    results.push({
      id: "observability",
      rule: "Observability — Four Golden Signals",
      severity: "info",
      message: "Prometheus ServiceMonitor for Golden Signals will be auto-injected",
      passed: true,
    });
  }

  // 10. Resilience
  if (goldenPath.scaffolding.resilience.pdb) {
    results.push({
      id: "resilience-pdb",
      rule: "Resilience — PodDisruptionBudget",
      severity: "info",
      message: "PDB will be auto-scaffolded (minAvailable based on instance count)",
      passed: true,
    });
  }

  const hasErrors = results.some(r => !r.passed && r.severity === "error");

  return {
    passed: !hasErrors,
    halted: hasErrors,
    results,
    goldenPath,
    timestamp: new Date().toISOString(),
  };
}

// ───── Intent-to-Golden-Path Mapping ─────

export interface GoldenPathChoice {
  template: GoldenPathTemplate;
  confidence: "high" | "medium" | "low";
  reason: string;
}

export function mapIntentToGoldenPaths(input: string, workloadType?: string): GoldenPathChoice[] {
  const lower = input.toLowerCase();
  const choices: GoldenPathChoice[] = [];

  // Direct keyword matching with confidence scoring
  const matchers: Array<{ id: GoldenPathId; patterns: RegExp[]; confidence: "high" | "medium" }> = [
    { id: "fintech-pci", patterns: [/payment|fintech|pci|transaction|billing|checkout|stripe/], confidence: "high" },
    { id: "high-performance-api", patterns: [/high.?perf|low.?latency|blitz|gateway|api.*(zig|rust)|sub.?10ms/], confidence: "high" },
    { id: "internal-worker", patterns: [/worker|queue.?consumer|batch.?process|background.?job/], confidence: "high" },
    { id: "ml-training", patterns: [/ml|machine.?learn|train|gpu|deep.?learn|model|pytorch|tensorflow/], confidence: "high" },
    { id: "global-spa", patterns: [/spa|static.?site|dashboard|cloudfront|cdn|landing.?page/], confidence: "high" },
    { id: "event-pipeline", patterns: [/event|pipeline|queue|sqs|stream|kafka|kinesis/], confidence: "high" },
    { id: "service-mesh", patterns: [/mesh|microservice|k8s|kubernetes|service.?discovery/], confidence: "high" },
    { id: "three-tier", patterns: [/3.?tier|monolith|legacy|enterprise|asg|classic/], confidence: "high" },
    { id: "internal-api", patterns: [/internal.?api|internal.?tool|bff|back.?office|admin.?api/], confidence: "high" },
    { id: "edge-cache", patterns: [/edge.?cache|global.?session|failover|dynamo.?global/], confidence: "high" },
  ];

  for (const m of matchers) {
    if (m.patterns.some(p => p.test(lower))) {
      const tpl = GOLDEN_PATH_REGISTRY.find(t => t.id === m.id)!;
      choices.push({ template: tpl, confidence: m.confidence, reason: `Matched "${m.id}" pattern from intent keywords` });
    }
  }

  // Runtime-based matching (e.g., "deploy a Zig app")
  const runtimeMatch = lower.match(/\b(zig|rust|go|node|python|java|dotnet)\b/);
  if (runtimeMatch && choices.length === 0) {
    const runtime = runtimeMatch[1] as RuntimeHint;
    const candidates = GOLDEN_PATH_REGISTRY.filter(t => t.runtimeHints.includes(runtime) && t.id !== "general-compute");
    for (const c of candidates.slice(0, 2)) {
      choices.push({ template: c, confidence: "medium", reason: `${runtime} runtime detected — this path supports ${runtime}` });
    }
  }

  // Workload type fallback
  if (choices.length === 0 && workloadType) {
    const workloadMap: Record<string, GoldenPathId> = {
      "global-spa": "global-spa",
      "service-mesh": "service-mesh",
      "event-pipeline": "event-pipeline",
      "internal-api": "internal-api",
      "three-tier": "three-tier",
      "edge-cache": "edge-cache",
      "accelerated": "ml-training",
      "hpc": "ml-training",
      "compute": "high-performance-api",
      "memory": "high-performance-api",
    };
    const mapped = workloadMap[workloadType];
    if (mapped) {
      const tpl = GOLDEN_PATH_REGISTRY.find(t => t.id === mapped)!;
      choices.push({ template: tpl, confidence: "medium", reason: `Mapped from workload type "${workloadType}"` });
    }
  }

  // Always offer general-compute as fallback
  if (choices.length === 0) {
    const general = GOLDEN_PATH_REGISTRY.find(t => t.id === "general-compute")!;
    choices.push({ template: general, confidence: "low", reason: "No specific pattern detected — using General Compute" });
  }

  // Deduplicate by ID
  const seen = new Set<string>();
  return choices.filter(c => {
    if (seen.has(c.template.id)) return false;
    seen.add(c.template.id);
    return true;
  });
}
