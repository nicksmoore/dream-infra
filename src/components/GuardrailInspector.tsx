import { useState } from "react";
import { MANIFEST, INTENTS, INTENT_META, ACTION_META, PROVIDER_META, type ManifestEntryUI } from "@/lib/manifest-data";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import { Shield, Lock, Key, ChevronDown, ChevronRight } from "lucide-react";
import { cn } from "@/lib/utils";

export function GuardrailInspector() {
  const [expandedEntry, setExpandedEntry] = useState<string | null>(null);
  const [filterIntent, setFilterIntent] = useState<string | null>(null);

  const entries = filterIntent
    ? MANIFEST.entries.filter(e => e.intent === filterIntent)
    : MANIFEST.entries;

  // Only show entries with non-trivial enforcement
  const interestingEntries = entries.filter(e =>
    Object.keys(e.enforcement.inject).length > 0 ||
    Object.keys(e.enforcement.default).length > 0 ||
    e.enforcement.required_keys.length > 0
  );

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2 text-xs font-mono text-muted-foreground">
          <Shield className="h-4 w-4 text-[hsl(var(--warning))]" />
          <span className="uppercase tracking-widest">Guardrail Inspector</span>
          <span className="text-foreground font-semibold">{interestingEntries.length}</span>
          <span>enforced entries</span>
        </div>
      </div>

      {/* Intent filters */}
      <div className="flex items-center gap-1.5 flex-wrap">
        <button
          onClick={() => setFilterIntent(null)}
          className={cn(
            "px-2.5 py-1 rounded-full text-[10px] font-mono font-medium transition-all",
            !filterIntent ? "bg-primary/15 text-primary border border-primary/30" : "text-muted-foreground hover:text-foreground border border-border/40",
          )}
        >
          All
        </button>
        {INTENTS.map(i => (
          <button
            key={i}
            onClick={() => setFilterIntent(filterIntent === i ? null : i)}
            className={cn(
              "px-2.5 py-1 rounded-full text-[10px] font-mono font-medium transition-all",
              filterIntent === i ? "bg-primary/15 text-primary border border-primary/30" : "text-muted-foreground hover:text-foreground border border-border/40",
            )}
          >
            {INTENT_META[i]?.icon} {INTENT_META[i]?.label || i}
          </button>
        ))}
      </div>

      {/* Entries */}
      <div className="space-y-1.5">
        {interestingEntries.map(entry => {
          const key = `${entry.intent}-${entry.action}-${entry.provider}`;
          const isExpanded = expandedEntry === key;
          const hasInject = Object.keys(entry.enforcement.inject).length > 0;
          const hasDefaults = Object.keys(entry.enforcement.default).length > 0;

          return (
            <div key={key} className="border border-border/30 rounded-lg overflow-hidden">
              <button
                onClick={() => setExpandedEntry(isExpanded ? null : key)}
                className="w-full flex items-center gap-3 px-4 py-2.5 text-left hover:bg-accent/30 transition-colors"
              >
                {isExpanded ? <ChevronDown className="h-3 w-3 text-muted-foreground" /> : <ChevronRight className="h-3 w-3 text-muted-foreground" />}
                <span className="text-xs font-mono font-medium text-foreground">
                  {INTENT_META[entry.intent]?.icon} {entry.intent}/{entry.action}/{entry.provider}
                </span>
                <div className="flex items-center gap-1.5 ml-auto">
                  {hasInject && (
                    <Badge variant="outline" className="text-[8px] font-mono gap-1 text-[hsl(var(--warning))]">
                      <Lock className="h-2 w-2" />
                      {Object.keys(entry.enforcement.inject).length} injected
                    </Badge>
                  )}
                  {hasDefaults && (
                    <Badge variant="outline" className="text-[8px] font-mono gap-1">
                      {Object.keys(entry.enforcement.default).length} defaults
                    </Badge>
                  )}
                  {entry.enforcement.required_keys.length > 0 && (
                    <Badge variant="outline" className="text-[8px] font-mono gap-1 text-[hsl(var(--destructive))]">
                      <Key className="h-2 w-2" />
                      {entry.enforcement.required_keys.length} required
                    </Badge>
                  )}
                </div>
              </button>

              {isExpanded && (
                <div className="px-4 pb-4 space-y-3 border-t border-border/20 bg-muted/10">
                  {/* Injected values (always wins) */}
                  {hasInject && (
                    <div className="pt-3 space-y-1.5">
                      <span className="text-[10px] uppercase tracking-widest text-[hsl(var(--warning))] font-semibold flex items-center gap-1">
                        <Lock className="h-3 w-3" /> Inject (immutable)
                      </span>
                      <pre className="text-xs font-mono bg-[hsl(var(--warning))]/5 border border-[hsl(var(--warning))]/20 rounded p-3 overflow-auto">
                        {JSON.stringify(entry.enforcement.inject, null, 2)}
                      </pre>
                    </div>
                  )}

                  {/* Default values */}
                  {hasDefaults && (
                    <div className="space-y-1.5">
                      <span className="text-[10px] uppercase tracking-widest text-muted-foreground font-semibold">
                        Defaults (overridable)
                      </span>
                      <pre className="text-xs font-mono bg-accent/20 border border-border/30 rounded p-3 overflow-auto">
                        {JSON.stringify(entry.enforcement.default, null, 2)}
                      </pre>
                    </div>
                  )}

                  {/* Required keys */}
                  {entry.enforcement.required_keys.length > 0 && (
                    <div className="space-y-1.5">
                      <span className="text-[10px] uppercase tracking-widest text-[hsl(var(--destructive))] font-semibold flex items-center gap-1">
                        <Key className="h-3 w-3" /> Required Keys
                      </span>
                      <div className="flex flex-wrap gap-1">
                        {entry.enforcement.required_keys.map(k => (
                          <span key={k} className="px-2 py-0.5 rounded text-[10px] font-mono bg-[hsl(var(--destructive))]/10 text-[hsl(var(--destructive))] border border-[hsl(var(--destructive))]/20">
                            {k}
                          </span>
                        ))}
                      </div>
                    </div>
                  )}

                  {/* Execution type */}
                  <div className="text-[10px] font-mono text-muted-foreground pt-1">
                    execution: {entry.execution.type}
                    {entry.signing && ` · signing: ${entry.signing.strategy}`}
                  </div>
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
