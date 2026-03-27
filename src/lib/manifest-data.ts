/**
 * Static representation of the UIDI manifest for frontend UI rendering.
 * Mirrors supabase/functions/uidi-engine/manifest.json — no runtime API call needed.
 */

export interface ManifestEntryUI {
  intent: string;
  action: string;
  provider: string;
  execution: {
    type: string;
    config: Record<string, unknown>;
    timeout_ms?: number;
    retry_policy?: string;
  };
  signing?: {
    strategy: string;
    signed_headers: string[];
    service?: string;
    region_required: boolean;
  };
  enforcement: {
    inject: Record<string, unknown>;
    default: Record<string, unknown>;
    required_keys: string[];
  };
}

export interface ManifestUI {
  version: string;
  generated_at: string;
  entries: ManifestEntryUI[];
}

// Import manifest statically (bundled at build time via Vite JSON import)
import rawManifest from "../../supabase/functions/uidi-engine/manifest.json";
export const MANIFEST: ManifestUI = rawManifest as ManifestUI;

// Derived constants
export const INTENTS = [...new Set(MANIFEST.entries.map(e => e.intent))].sort();
export const ACTIONS = [...new Set(MANIFEST.entries.map(e => e.action))].sort();
export const PROVIDERS = [...new Set(MANIFEST.entries.map(e => e.provider))].sort();

export const EXECUTION_TYPES = [...new Set(MANIFEST.entries.map(e => e.execution.type))].sort();

export function lookupEntry(intent: string, action: string, provider: string): ManifestEntryUI | undefined {
  return MANIFEST.entries.find(e => e.intent === intent && e.action === action && e.provider === provider);
}

export function entriesForIntentAction(intent: string, action: string): ManifestEntryUI[] {
  return MANIFEST.entries.filter(e => e.intent === intent && e.action === action);
}

/** Extracts all placeholder keys from url_template and body_template */
export function extractPlaceholders(entry: ManifestEntryUI): string[] {
  const config = entry.execution.config as Record<string, string>;
  const templates = [config.url_template, config.body_template, config.extra_vars_template, config.resource_template, config.namespace_template].filter(Boolean);
  const keys = new Set<string>();
  for (const tmpl of templates) {
    const matches = tmpl.matchAll(/\{\{([a-zA-Z_][a-zA-Z0-9_]*)\}\}/g);
    for (const m of matches) keys.add(m[1]);
  }
  return [...keys];
}

/** Returns all user-fillable fields: required_keys + template placeholders - injected keys */
export function getUserFields(entry: ManifestEntryUI): { key: string; required: boolean; defaultValue?: unknown; injected: boolean }[] {
  const placeholders = extractPlaceholders(entry);
  const allKeys = new Set([...entry.enforcement.required_keys, ...placeholders]);
  const injectedKeys = new Set(Object.keys(entry.enforcement.inject));
  
  return [...allKeys].sort().map(key => ({
    key,
    required: entry.enforcement.required_keys.includes(key),
    defaultValue: entry.enforcement.default[key],
    injected: injectedKeys.has(key),
  }));
}

// Provider display metadata
export const PROVIDER_META: Record<string, { label: string; color: string }> = {
  aws: { label: "AWS", color: "hsl(38, 92%, 50%)" },
  oci: { label: "OCI", color: "hsl(0, 72%, 51%)" },
  gcp: { label: "GCP", color: "hsl(199, 89%, 48%)" },
  azure: { label: "Azure", color: "hsl(210, 78%, 51%)" },
  "naawi-internal": { label: "Naawi", color: "hsl(160, 84%, 39%)" },
};

export const INTENT_META: Record<string, { label: string; icon: string }> = {
  network: { label: "Network", icon: "🌐" },
  compute: { label: "Compute", icon: "⚡" },
  k8s: { label: "Kubernetes", icon: "☸️" },
  ansible: { label: "Ansible", icon: "🔧" },
  reconcile: { label: "Reconcile", icon: "🔄" },
  inventory: { label: "Inventory", icon: "📦" },
  "sre-supreme": { label: "SRE Supreme", icon: "🤖" },
  naawi: { label: "Naawi Agent", icon: "🧠" },
  dolt: { label: "Dolt State", icon: "🗃️" },
};

export const ACTION_META: Record<string, { label: string; color: string }> = {
  deploy: { label: "Deploy", color: "hsl(var(--success))" },
  discover: { label: "Discover", color: "hsl(var(--info))" },
  destroy: { label: "Destroy", color: "hsl(var(--destructive))" },
  status: { label: "Status", color: "hsl(var(--warning))" },
};
