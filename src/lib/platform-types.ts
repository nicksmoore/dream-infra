// ═══════════════════════════════════════════════════════════
// IDI Platform Types — Three Pillars Foundation
// ═══════════════════════════════════════════════════════════

// ───── Cloud Providers ─────

export type CloudProvider = "aws" | "gcp" | "azure" | "oci";

export const PROVIDER_OPTIONS: { value: CloudProvider; label: string; icon: string }[] = [
  { value: "aws", label: "Amazon Web Services", icon: "☁️" },
  { value: "gcp", label: "Google Cloud Platform", icon: "🔷" },
  { value: "azure", label: "Microsoft Azure", icon: "🔶" },
  { value: "oci", label: "Oracle Cloud Infrastructure", icon: "🔴" },
];

// ───── User Segments ─────

export type UserSegment = "free" | "developer" | "team" | "enterprise";

export interface UserProfile {
  id: string;
  email: string | null;
  display_name: string | null;
  segment: UserSegment;
  organization_id: string | null;
  created_at: string;
  updated_at: string;
}

export const SEGMENT_LIMITS: Record<UserSegment, {
  providers: CloudProvider[];
  maxCredentials: number;
  canNuke: boolean;
  canReconcile: boolean;
  maxIntentsPerHour: number;
}> = {
  free: {
    providers: ["aws"],
    maxCredentials: 0,
    canNuke: false,
    canReconcile: false,
    maxIntentsPerHour: 10,
  },
  developer: {
    providers: ["aws", "gcp", "azure", "oci"],
    maxCredentials: 3,
    canNuke: true,
    canReconcile: true,
    maxIntentsPerHour: 100,
  },
  team: {
    providers: ["aws", "gcp", "azure", "oci"],
    maxCredentials: 10,
    canNuke: true,
    canReconcile: true,
    maxIntentsPerHour: 500,
  },
  enterprise: {
    providers: ["aws", "gcp", "azure", "oci"],
    maxCredentials: 50,
    canNuke: true,
    canReconcile: true,
    maxIntentsPerHour: 5000,
  },
};

// ───── Native Mapping (Feature 1) ─────

export interface ProviderMapping {
  id: string;
  provider: CloudProvider;
  service_name: string;
  spec_version: string;
  mapping_data: ProviderMappingData;
  spec_hash: string;
  ingested_at: string;
  expires_at: string | null;
}

export interface ProviderMappingData {
  endpoints: ProviderEndpoint[];
  auth_pattern: "sigv4" | "bearer" | "api_key";
  base_url_template: string;
  rate_limits?: Record<string, number>;
}

export interface ProviderEndpoint {
  operation: string;
  method: "GET" | "POST" | "PUT" | "DELETE" | "PATCH";
  path: string;
  parameters: EndpointParameter[];
  response_schema: Record<string, unknown>;
  idempotency_key?: string;
  pagination?: { type: "token" | "offset"; param: string };
}

export interface EndpointParameter {
  name: string;
  type: "string" | "number" | "boolean" | "object" | "array";
  required: boolean;
  location: "query" | "body" | "header" | "path";
  description?: string;
}

// ───── Surgical Discovery (Feature 2) ─────

export interface DiscoveryScope {
  provider: CloudProvider;
  region: string;
  resource_type: string;
  identifiers: ResourceIdentifier[];
}

export interface ResourceIdentifier {
  type: "arn" | "id" | "tag" | "name";
  value: string;
}

export interface CachedMetadata {
  id: string;
  user_id: string;
  provider: CloudProvider;
  region: string;
  resource_type: string;
  resource_id: string;
  metadata: Record<string, unknown>;
  cached_at: string;
  ttl_seconds: number;
}

export interface DiscoveryResult {
  scope: DiscoveryScope;
  resources: DiscoveredResource[];
  api_calls_made: number;
  cache_hits: number;
  latency_ms: number;
  rate_limit_events: RateLimitEvent[];
}

export interface DiscoveredResource {
  id: string;
  arn?: string;
  type: string;
  state: string;
  tags: Record<string, string>;
  metadata: Record<string, unknown>;
  from_cache: boolean;
}

export interface RateLimitEvent {
  call: string;
  response_code: number;
  retry_count: number;
  resolution: "success" | "failed";
  timestamp: string;
}

// ───── Credential Vault (Feature 3 / BYOC) ─────

export interface StoredCredential {
  id: string;
  provider: CloudProvider;
  label: string;
  created_at: string;
  updated_at: string;
  // encrypted_credentials and iv are never sent to client
}

export interface CredentialInput {
  provider: CloudProvider;
  label: string;
  credentials: Record<string, string>;
}

// ───── Audit Log ─────

export interface AuditLogEntry {
  id: string;
  user_id: string;
  intent_text: string | null;
  resolved_calls: Record<string, unknown>[] | null;
  provider: CloudProvider | null;
  region: string | null;
  action: string;
  result: string | null;
  error: string | null;
  created_at: string;
}
