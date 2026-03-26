import { ManifestEntry, ManifestError, ManifestSchema, PreparedRequest } from "./manifest-types.ts";
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
 * Finds the manifest entry for a given (intent, action, provider) triple.
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
 * Applies the enforcement gradient to a userSpec:
 *   1. Fills in `default` values for missing keys
 *   2. Validates that all `required_keys` are present
 *
 * Returns the enriched spec, or ManifestError MISSING_REQUIRED_KEY.
 * The caller must then pass this to `hydrate`, which applies `inject`.
 */
export function enforce(
  userSpec: Record<string, unknown>,
  entry: ManifestEntry,
): Record<string, unknown> | ManifestError {
  // Step 1: default-fill
  const spec = { ...entry.enforcement.default, ...userSpec };

  // Step 2: validate required_keys
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
 * Resolves placeholder tokens in url_template and body_template, then
 * deep-merges enforcement.inject (inject always wins).
 *
 * Placeholder values are typed:
 *   - string → inserted as-is
 *   - boolean → "true" / "false"
 *   - number → String(value)
 *   - array → JSON.stringify(value)
 *
 * Returns ManifestError UNRESOLVED_PLACEHOLDER if any {token} remains.
 */
export function hydrate(
  entry: ManifestEntry,
  resolvedSpec: Record<string, unknown>,
): PreparedRequest | ManifestError {
  // Merge inject (inject wins over user spec)
  const finalSpec = { ...resolvedSpec, ...entry.enforcement.inject };

  // Placeholder tokens are word-identifier only: {someKey}, {region}, {compartmentId}
  // This regex deliberately excludes JSON structure chars so that a resolved body like
  // {"key":"value"} is not mistaken for an unresolved placeholder.
  const PLACEHOLDER_RE = /\{([a-zA-Z_][a-zA-Z0-9_]*)\}/g;
  const UNRESOLVED_RE = /\{[a-zA-Z_][a-zA-Z0-9_]*\}/;

  function replaceTokens(template: string): string {
    return template.replace(PLACEHOLDER_RE, (match, key) => {
      const value = finalSpec[key];
      if (value === undefined) {
        return match; // leave unresolved for detection below
      }
      if (Array.isArray(value)) return JSON.stringify(value);
      if (typeof value === "boolean") return value ? "true" : "false";
      if (typeof value === "number") return String(value);
      return String(value);
    });
  }

  const resolvedUrl = replaceTokens(entry.request.url_template);

  // Check for unresolved placeholders
  if (UNRESOLVED_RE.test(resolvedUrl)) {
    const unresolved = (resolvedUrl.match(new RegExp(UNRESOLVED_RE.source, "g")) || []).join(", ");
    return new ManifestError(
      "UNRESOLVED_PLACEHOLDER",
      `Unresolved placeholders in url_template: ${unresolved}`,
    );
  }

  let resolvedBody: string | null = null;
  if (entry.request.body_template) {
    const bodyResult = replaceTokens(entry.request.body_template);

    if (UNRESOLVED_RE.test(bodyResult)) {
      const unresolved = (bodyResult.match(new RegExp(UNRESOLVED_RE.source, "g")) || []).join(", ");
      return new ManifestError(
        "UNRESOLVED_PLACEHOLDER",
        `Unresolved placeholders in body_template: ${unresolved}`,
      );
    }
    resolvedBody = bodyResult;
  }

  // Build signing block — region is only included when region_required
  let signingBlock: PreparedRequest["signing"];
  if (entry.signing.region_required) {
    const region = finalSpec["region"];
    if (!region || typeof region !== "string") {
      return new ManifestError(
        "UNRESOLVED_PLACEHOLDER",
        `region is required for (${entry.intent}, ${entry.action}, ${entry.provider}) but was not provided`,
      );
    }
    signingBlock = {
      strategy: entry.signing.strategy,
      signed_headers: [...entry.signing.signed_headers],
      ...(entry.signing.service ? { service: entry.signing.service } : {}),
      region,
    };
  } else {
    signingBlock = {
      strategy: entry.signing.strategy,
      signed_headers: [...entry.signing.signed_headers],
      ...(entry.signing.service ? { service: entry.signing.service } : {}),
    };
  }

  return {
    method: entry.request.method,
    url: resolvedUrl,
    headers: { ...entry.request.headers },
    body: resolvedBody,
    signing: signingBlock,
    manifest_version: MANIFEST.version,
  };
}

// ── prepareRequest ────────────────────────────────────────────────────────────

/**
 * End-to-end helper: lookup → enforce → hydrate.
 * Returns PreparedRequest or ManifestError.
 */
export function prepareRequest(
  intent: string,
  action: string,
  provider: string,
  userSpec: Record<string, unknown>,
): PreparedRequest | ManifestError {
  const entry = lookup(intent, action, provider);
  if (entry instanceof ManifestError) return entry;

  const enforced = enforce(userSpec, entry);
  if (enforced instanceof ManifestError) return enforced;

  return hydrate(entry, enforced);
}
