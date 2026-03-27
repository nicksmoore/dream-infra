import { ManifestEntry, ManifestError, ManifestSchema, PreparedOperation, PreparedRequest } from "./manifest-types.ts";
import rawManifest from "./manifest.json" assert { type: "json" };

// ── Boot-time validation ──────────────────────────────────────────────────────

const parseResult = ManifestSchema.safeParse(rawManifest);
if (!parseResult.success) {
  throw new ManifestError(
    "SCHEMA_INVALID",
    `Bundled manifest failed validation: ${parseResult.error.message}`,
  );
}
const MANIFEST = parseResult.data;

// ── lookup ────────────────────────────────────────────────────────────────────

/**
 * Finds the manifest entry for a (intent, action, provider) triple.
 * Returns ManifestError NOT_FOUND if no entry matches.
 */
export function lookup(
  intent: string,
  action: string,
  provider: string,
): ManifestEntry | ManifestError {
  const entry = MANIFEST.entries.find(
    (e) => e.intent === intent && e.action === action && e.provider === provider,
  );
  if (!entry) {
    return new ManifestError(
      "NOT_FOUND",
      `No manifest entry for (${intent}, ${action}, ${provider})`,
    );
  }
  return entry;
}

// ── enforce ───────────────────────────────────────────────────────────────────

/**
 * Applies defaults and validates required_keys.
 * Order: default-fill → validate required_keys.
 * Returns enriched spec or ManifestError MISSING_REQUIRED_KEY.
 */
export function enforce(
  userSpec: Record<string, unknown>,
  entry: ManifestEntry,
): Record<string, unknown> | ManifestError {
  const spec = { ...entry.enforcement.default, ...userSpec };

  for (const key of entry.enforcement.required_keys) {
    if (!(key in spec) || spec[key] === undefined || spec[key] === null) {
      return new ManifestError(
        "MISSING_REQUIRED_KEY",
        `Required key "${key}" is missing from spec for (${entry.intent}, ${entry.action}, ${entry.provider})`,
      );
    }
  }

  return spec;
}

// ── hydrate ───────────────────────────────────────────────────────────────────

/**
 * Applies enforcement.inject (inject always wins) and returns the resolved spec.
 * Template resolution is handled by buildRestRequest() in index.ts for rest-proxy entries.
 */
export function hydrate(
  entry: ManifestEntry,
  enforced: Record<string, unknown>,
): Record<string, unknown> {
  return { ...enforced, ...entry.enforcement.inject };
}

// ── prepareOperation ──────────────────────────────────────────────────────────

/**
 * End-to-end: lookup → enforce → hydrate.
 * Returns PreparedOperation containing the full entry + resolved spec.
 */
export function prepareOperation(
  intent: string,
  action: string,
  provider: string,
  userSpec: Record<string, unknown>,
): PreparedOperation | ManifestError {
  const entry = lookup(intent, action, provider);
  if (entry instanceof ManifestError) return entry;

  const enforced = enforce(userSpec, entry);
  if (enforced instanceof ManifestError) return enforced;

  const resolved_spec = hydrate(entry, enforced);

  return {
    entry,
    resolved_spec,
    manifest_version: MANIFEST.version,
  };
}

// ── buildRestRequest ──────────────────────────────────────────────────────────
// Pure function: PreparedOperation (rest-proxy) → PreparedRequest for signing.
// Lives here (not in index.ts) so it can be imported by Vitest tests without
// pulling in Deno-specific APIs from index.ts.

export function buildRestRequest(op: PreparedOperation): PreparedRequest | ManifestError {
  const execution = op.entry.execution as { type: "rest-proxy"; config: { method: string; url_template: string; headers: Record<string, string>; body_template?: string } };
  const cfg = execution.config;
  const spec = op.resolved_spec;
  const PLACEHOLDER_RE = /\{\{([a-zA-Z_][a-zA-Z0-9_]*)\}\}/g;
  const UNRESOLVED_RE = /\{\{[a-zA-Z_][a-zA-Z0-9_]*\}\}/;

  function resolveTemplate(tmpl: string): string {
    return tmpl.replace(PLACEHOLDER_RE, (_, key) => {
      const value = spec[key];
      if (value === undefined) return `{{${key}}}`;
      if (Array.isArray(value)) return JSON.stringify(value);
      if (typeof value === "boolean") return value ? "true" : "false";
      if (typeof value === "number") return String(value);
      return String(value);
    });
  }

  const url = resolveTemplate(cfg.url_template);
  if (UNRESOLVED_RE.test(url)) {
    const unresolved = url.match(/\{\{[a-zA-Z_][a-zA-Z0-9_]*\}\}/g)?.join(", ") ?? "";
    return new ManifestError("UNRESOLVED_PLACEHOLDER", `Unresolved placeholders in url_template: ${unresolved}`);
  }

  let body: string | null = null;
  if (cfg.body_template) {
    body = resolveTemplate(cfg.body_template);
    if (UNRESOLVED_RE.test(body)) {
      const unresolved = body.match(/\{\{[a-zA-Z_][a-zA-Z0-9_]*\}\}/g)?.join(", ") ?? "";
      return new ManifestError("UNRESOLVED_PLACEHOLDER", `Unresolved placeholders in body_template: ${unresolved}`);
    }
  }

  const signing = op.entry.signing!;
  const signingBlock: PreparedRequest["signing"] = {
    strategy: signing.strategy,
    signed_headers: [...signing.signed_headers],
    ...(signing.service ? { service: signing.service } : {}),
    ...(signing.region_required ? { region: String(spec["region"] ?? "") } : {}),
  };

  return {
    method: cfg.method as PreparedRequest["method"],
    url,
    headers: { ...cfg.headers },
    body,
    signing: signingBlock,
    manifest_version: op.manifest_version,
  };
}
