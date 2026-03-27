import { z } from "zod"; // bare specifier; deno.json maps this to npm:zod@3

// ── Primitive enums ──────────────────────────────────────────────────────────

export const SigningStrategySchema = z.enum([
  "AWS_SIGV4",
  "OCI_RSA_V1",
  "GCP_OAUTH2",
  "AZURE_BEARER",
]);
export type SigningStrategy = z.infer<typeof SigningStrategySchema>;

export const IntentSchema = z.enum([
  "network", "compute", "k8s",
  "ansible", "reconcile", "inventory",
  "sre-supreme", "naawi", "dolt",
]);
export type Intent = z.infer<typeof IntentSchema>;

export const ActionSchema = z.enum(["deploy", "destroy", "discover", "status"]);
export type Action = z.infer<typeof ActionSchema>;

export const ProviderSchema = z.enum(["aws", "oci", "gcp", "azure", "naawi-internal"]);
export type Provider = z.infer<typeof ProviderSchema>;

// ── Enforcement gradient ─────────────────────────────────────────────────────

export const EnforcementSchema = z.object({
  inject: z.record(z.unknown()),
  default: z.record(z.unknown()),
  required_keys: z.array(z.string()),
});
export type Enforcement = z.infer<typeof EnforcementSchema>;

// ── Signing metadata (rest-proxy only) ──────────────────────────────────────

export const SigningMetadataSchema = z
  .object({
    strategy: SigningStrategySchema,
    signed_headers: z.array(z.string()).min(1).refine(
      (arr) => new Set(arr).size === arr.length,
      { message: "signed_headers must not contain duplicates" },
    ),
    service: z.string().optional(),
    region_required: z.boolean(),
  })
  .superRefine((val, ctx) => {
    if (val.strategy === "AWS_SIGV4" && !val.service) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "service is required when strategy is AWS_SIGV4",
        path: ["service"],
      });
    }
  });
export type SigningMetadata = z.infer<typeof SigningMetadataSchema>;

// ── Execution config schemas (one per execution type) ────────────────────────

export const RestProxyConfigSchema = z.object({
  method: z.enum(["GET", "POST", "PUT", "PATCH", "DELETE"]),
  url_template: z.string().min(1),      // uses {{placeholder}} syntax
  headers: z.record(z.string()),
  body_template: z.string().optional(), // uses {{placeholder}} syntax
});

export const AnsibleConfigSchema = z.object({
  playbook_path: z.string().min(1),
  extra_vars_template: z.string(),      // JSON string with {{placeholder}} tokens
  ssm_document: z.string().optional(),
});

export const K8sConfigSchema = z.object({
  api_version: z.string().min(1),
  resource_kind: z.string().min(1),
  namespace_template: z.string().min(1),
  resource_template: z.string().min(1), // K8s manifest JSON with {{placeholders}}
});

export const ReconcileConfigSchema = z.object({
  sub_intents: z.array(z.string()).min(1),
  drift_tolerance_seconds: z.number().int().positive(),
  auto_remediate: z.boolean(),
});

export const InternalQueryConfigSchema = z.object({
  scan_providers: z.array(z.string()).min(1),
  scan_regions: z.array(z.string()),    // empty = all regions
  resource_types: z.array(z.string()).min(1),
});

export const StateManagerConfigSchema = z.object({
  branch: z.string().min(1),
  table: z.string().min(1),
  operation: z.enum(["read", "write", "diff", "branch"]),
});

export const AgentCoordinatorConfigSchema = z.object({
  autonomy_level: z.enum(["full-auto", "request-approval", "dry-run"]),
  allowed_tools: z.array(z.string()).min(1),
  max_actions_per_run: z.number().int().positive(),
  forbidden_patterns: z.array(z.string()),
});

// ── Execution discriminated union ─────────────────────────────────────────────

export const RetryPolicySchema = z.enum(["exponential", "linear", "none"]);

export const ExecutionSchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("rest-proxy"),        timeout_ms: z.number().default(30000),  retry_policy: RetryPolicySchema.default("none"),        config: RestProxyConfigSchema }),
  z.object({ type: z.literal("ssm-ansible"),       timeout_ms: z.number().default(60000),  retry_policy: RetryPolicySchema.default("exponential"), config: AnsibleConfigSchema }),
  z.object({ type: z.literal("k8s-api"),           timeout_ms: z.number().default(30000),  retry_policy: RetryPolicySchema.default("exponential"), config: K8sConfigSchema }),
  z.object({ type: z.literal("meta-reconcile"),    timeout_ms: z.number().default(60000),  retry_policy: RetryPolicySchema.default("none"),        config: ReconcileConfigSchema }),
  z.object({ type: z.literal("internal-query"),    timeout_ms: z.number().default(15000),  retry_policy: RetryPolicySchema.default("none"),        config: InternalQueryConfigSchema }),
  z.object({ type: z.literal("state-manager"),     timeout_ms: z.number().default(10000),  retry_policy: RetryPolicySchema.default("none"),        config: StateManagerConfigSchema }),
  z.object({ type: z.literal("agent-coordinator"), timeout_ms: z.number().default(120000), retry_policy: RetryPolicySchema.default("exponential"), config: AgentCoordinatorConfigSchema }),
]);
export type Execution = z.infer<typeof ExecutionSchema>;

// ── Manifest entry ───────────────────────────────────────────────────────────

export const ManifestEntrySchema = z.object({
  intent: IntentSchema,
  action: ActionSchema,
  provider: ProviderSchema,
  execution: ExecutionSchema,
  signing: SigningMetadataSchema.optional(), // required iff execution.type === "rest-proxy"
  enforcement: EnforcementSchema,
}).superRefine((val, ctx) => {
  if (val.execution.type === "rest-proxy" && !val.signing) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, message: "signing is required for rest-proxy entries", path: ["signing"] });
  }
  if (val.execution.type !== "rest-proxy" && val.signing) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, message: "signing is not applicable for non-rest-proxy entries", path: ["signing"] });
  }
});
export type ManifestEntry = z.infer<typeof ManifestEntrySchema>;

// ── Top-level manifest ────────────────────────────────────────────────────────

export const ManifestSchema = z.object({
  version: z.string().min(1),
  generated_at: z.string().datetime(),
  entries: z.array(ManifestEntrySchema).min(1),
});
export type Manifest = z.infer<typeof ManifestSchema>;

// ── Engine error ─────────────────────────────────────────────────────────────

export type ManifestErrorCode =
  | "NOT_FOUND"
  | "MISSING_REQUIRED_KEY"
  | "UNRESOLVED_PLACEHOLDER"
  | "SCHEMA_INVALID";

export class ManifestError extends Error {
  constructor(
    public readonly code: ManifestErrorCode,
    message: string,
    options?: ErrorOptions,
  ) {
    super(message, options);
    this.name = "ManifestError";
  }
}

// ── PreparedOperation (engine return type) ───────────────────────────────────

/** Returned by prepareOperation(). Contains the full entry + resolved spec. */
export interface PreparedOperation {
  entry: ManifestEntry;
  resolved_spec: Record<string, unknown>; // after default-fill + inject applied
  manifest_version: string;
}

// ── PreparedRequest (signer contract, rest-proxy only) ───────────────────────

/** Built by buildRestRequest() in manifest-engine.ts from a PreparedOperation with execution.type === "rest-proxy". */
export interface PreparedRequest {
  method: "GET" | "POST" | "PUT" | "PATCH" | "DELETE";
  url: string;
  headers: Record<string, string>;
  body: string | null;
  signing: {
    strategy: SigningStrategy;
    signed_headers: string[];
    service?: string;
    region?: string;
  };
  manifest_version: string;
}
