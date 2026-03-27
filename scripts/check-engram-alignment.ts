#!/usr/bin/env npx tsx
/**
 * check-engram-alignment.ts
 *
 * Validates that every Inject key declared in .engram has at least one
 * corresponding entry in manifest.json enforcement.inject.
 *
 * Exit 0: all rules covered
 * Exit 1: one or more .engram inject rules have no manifest coverage
 */

import * as fs from "fs";
import * as path from "path";

const ROOT = process.cwd();

// ── Parse .engram ────────────────────────────────────────────────────────────

function parseEngramInjectKeys(engramContent: string): string[] {
  const keys: string[] = [];

  for (const line of engramContent.split("\n")) {
    const trimmed = line.trim();

    // Only process Inject: lines (not Default:, not comments, not Intent:)
    if (!trimmed.startsWith("Inject:")) continue;

    // Extract the value after "Inject:"
    const value = trimmed.slice("Inject:".length).trim();

    // Split on comma, but respect array values like ["10.1.0.0/16"]
    const tokens = splitInjectTokens(value);

    for (const token of tokens) {
      const key = extractKeyFromToken(token.trim());
      if (key) keys.push(key);
    }
  }

  return keys;
}

/**
 * Splits a comma-separated token list while respecting JSON arrays [...]
 */
function splitInjectTokens(value: string): string[] {
  const tokens: string[] = [];
  let depth = 0;
  let current = "";

  for (const char of value) {
    if (char === "[") depth++;
    else if (char === "]") depth--;

    if (char === "," && depth === 0) {
      tokens.push(current.trim());
      current = "";
    } else {
      current += char;
    }
  }

  if (current.trim()) tokens.push(current.trim());
  return tokens;
}

/**
 * Extracts the key name from an inject token.
 * Handles:
 *   - key-value:  "isIpv6Enabled: false"              → "isIpv6Enabled"
 *   - dot-path:   "routingConfig.routingMode: REGIONAL" → "routingMode" (leaf)
 *   - bare key:   "topologySpreadConstraints"          → "topologySpreadConstraints"
 *
 * For dot-path forms the LEAF segment is returned so that manifest flat keys
 * (e.g. "routingMode") match .engram dotted paths (e.g. "routingConfig.routingMode").
 */
function extractKeyFromToken(token: string): string | null {
  if (!token) return null;

  // Key-value or dot-path form: has a colon
  const colonIdx = token.indexOf(":");
  if (colonIdx > 0) {
    const fullKey = token.slice(0, colonIdx).trim();
    const parts = fullKey.split(".");
    // Return the leaf (last segment) for dot-path keys
    return parts[parts.length - 1];
  }

  // Bare key form: no colon — the whole token is the key
  if (/^[a-zA-Z_][a-zA-Z0-9_.]*$/.test(token)) {
    return token;
  }

  return null;
}

// ── Collect manifest inject keys ─────────────────────────────────────────────

function collectManifestInjectKeys(manifest: any): Set<string> {
  const keys = new Set<string>();

  for (const entry of manifest.entries) {
    const inject = entry?.enforcement?.inject;
    if (inject && typeof inject === "object") {
      for (const key of Object.keys(inject)) {
        keys.add(key);
      }
    }
  }

  return keys;
}

// ── Main ─────────────────────────────────────────────────────────────────────

function main() {
  const engramPath = path.join(ROOT, ".engram");
  const manifestPath = path.join(
    ROOT,
    "supabase",
    "functions",
    "uidi-engine",
    "manifest.json"
  );

  if (!fs.existsSync(engramPath)) {
    console.error(`[check-engram] ERROR: .engram not found at ${engramPath}`);
    process.exit(1);
  }

  if (!fs.existsSync(manifestPath)) {
    console.error(
      `[check-engram] ERROR: manifest.json not found at ${manifestPath}`
    );
    process.exit(1);
  }

  const engramContent = fs.readFileSync(engramPath, "utf-8");
  const manifestContent = JSON.parse(fs.readFileSync(manifestPath, "utf-8"));

  const engramKeys = parseEngramInjectKeys(engramContent);
  const manifestKeys = collectManifestInjectKeys(manifestContent);

  console.log(
    `[check-engram] Found ${engramKeys.length} inject key(s) in .engram`
  );
  console.log(
    `[check-engram] Found ${manifestKeys.size} inject key(s) in manifest.json`
  );

  const missing: string[] = [];
  for (const key of engramKeys) {
    if (!manifestKeys.has(key)) {
      missing.push(key);
    }
  }

  if (missing.length === 0) {
    console.log(
      "[check-engram] \u2713 All .engram inject rules have manifest coverage"
    );
    process.exit(0);
  } else {
    console.error(
      `[check-engram] \u2717 ${missing.length} .engram inject rule(s) have NO manifest coverage:`
    );
    for (const key of missing) {
      console.error(
        `  - "${key}" is declared in .engram but not found in any manifest.json enforcement.inject`
      );
    }
    process.exit(1);
  }
}

main();
