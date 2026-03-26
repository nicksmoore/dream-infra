import { z } from "zod"; // bare specifier; deno.json maps this to npm:zod@3

// ── Primitive enums ──────────────────────────────────────────────────────────

export const SigningStrategySchema = z.enum([
  "AWS_SIGV4",
  "OCI_RSA_V1",
  "GCP_OAUTH2",
  "AZURE_BEARER",
]);
export type SigningStrategy = z.infer<typeof SigningStrategySchema>;

export const IntentSchema = z.enum(["network", "eks", "compute"]);
export type Intent = z.infer<typeof IntentSchema>;

export const ActionSchema = z.enum(["deploy", "destroy", "discover", "status"]);
export type Action = z.infer<typeof ActionSchema>;

export const ProviderSchema = z.enum(["aws", "oci", "gcp", "azure"]);
export type Provider = z.infer<typeof ProviderSchema>;

// ── Enforcement gradient ─────────────────────────────────────────────────────

export const EnforcementSchema = z.object({
  /** Keys injected AFTER template hydration, overwriting anything the user supplied. */
  inject: z.record(z.unknown()),
  /** Keys filled in BEFORE hydration if absent from userSpec. */
  default: z.record(z.unknown()),
  /** Keys that MUST be present in userSpec after defaults are applied; error if missing. */
  required_keys: z.array(z.string()),
});
export type Enforcement = z.infer<typeof EnforcementSchema>;

// ── Request template ─────────────────────────────────────────────────────────

export const RequestTemplateSchema = z.object({
  method: z.enum(["GET", "POST", "PUT", "PATCH", "DELETE"]),
  /** URL with `{placeholder}` tokens resolved at hydration time. */
  url_template: z.string().min(1),
  /** Static headers merged with signer-added headers. */
  headers: z.record(z.string()),
  /** JSON body with `{placeholder}` tokens; omit for GET/DELETE. */
  body_template: z.string().optional(),
});
export type RequestTemplate = z.infer<typeof RequestTemplateSchema>;

// ── Signing metadata ─────────────────────────────────────────────────────────

export const SigningMetadataSchema = z
  .object({
    strategy: SigningStrategySchema,
    signed_headers: z.array(z.string()).min(1),
    /** AWS service name (e.g., "ec2", "eks"). Required for AWS_SIGV4. */
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

// ── Manifest entry ───────────────────────────────────────────────────────────

export const ManifestEntrySchema = z.object({
  intent: IntentSchema,
  action: ActionSchema,
  provider: ProviderSchema,
  request: RequestTemplateSchema,
  signing: SigningMetadataSchema,
  enforcement: EnforcementSchema,
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
  ) {
    super(message);
    this.name = "ManifestError";
  }
}

// ── PreparedRequest (signer contract) ────────────────────────────────────────

/** Passed to the cloud signing functions. Signer adds Authorization header, returns unchanged. */
export interface PreparedRequest {
  method: string;
  url: string;
  headers: Record<string, string>;
  body: string | null;
  signing: {
    strategy: SigningStrategy;
    signed_headers: string[];
    service?: string;
    region: string;
  };
  /** Version of the manifest entry used to produce this request. */
  manifest_version: string;
}
