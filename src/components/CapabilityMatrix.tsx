import { useState } from "react";
import { MANIFEST, INTENTS, ACTIONS, PROVIDERS, lookupEntry, PROVIDER_META, INTENT_META, ACTION_META, type ManifestEntryUI } from "@/lib/manifest-data";
import { Badge } from "@/components/ui/badge";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";

interface CapabilityMatrixProps {
  onSelectEntry?: (entry: ManifestEntryUI) => void;
}

export function CapabilityMatrix({ onSelectEntry }: CapabilityMatrixProps) {
  const [hoveredCell, setHoveredCell] = useState<string | null>(null);

  const totalEntries = MANIFEST.entries.length;
  const liveEntries = MANIFEST.entries.filter(e => e.execution.type === "rest-proxy").length;
  const stubEntries = totalEntries - liveEntries;

  return (
    <div className="space-y-4">
      {/* Stats bar */}
      <div className="flex items-center gap-4 text-xs font-mono text-muted-foreground">
        <span className="uppercase tracking-widest">Capability Matrix</span>
        <span className="text-foreground font-semibold">{totalEntries}</span>
        <span>entries</span>
        <div className="flex items-center gap-1.5">
          <span className="h-2 w-2 rounded-full bg-[hsl(var(--success))]" />
          <span>{liveEntries} live</span>
        </div>
        <div className="flex items-center gap-1.5">
          <span className="h-2 w-2 rounded-full bg-[hsl(var(--warning))]" />
          <span>{stubEntries} stub</span>
        </div>
        <span className="ml-auto text-[10px] opacity-60">v{MANIFEST.version}</span>
      </div>

      {/* Matrix grid */}
      <div className="overflow-x-auto">
        <table className="w-full border-collapse font-mono text-xs">
          <thead>
            <tr>
              <th className="text-left p-2 text-muted-foreground font-medium text-[10px] uppercase tracking-widest border-b border-border/40">
                Intent
              </th>
              {ACTIONS.map(action => (
                <th key={action} className="p-2 text-center text-[10px] uppercase tracking-widest font-medium border-b border-border/40" style={{ color: ACTION_META[action]?.color }}>
                  {ACTION_META[action]?.label || action}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {INTENTS.map(intent => (
              <tr key={intent} className="group">
                <td className="p-2 border-b border-border/20 whitespace-nowrap">
                  <span className="mr-1.5">{INTENT_META[intent]?.icon || "•"}</span>
                  <span className="text-foreground font-medium">{INTENT_META[intent]?.label || intent}</span>
                </td>
                {ACTIONS.map(action => {
                  const entries = PROVIDERS.map(provider => {
                    const entry = lookupEntry(intent, action, provider);
                    return entry ? { provider, entry } : null;
                  }).filter(Boolean) as { provider: string; entry: ManifestEntryUI }[];

                  const cellKey = `${intent}-${action}`;
                  const isHovered = hoveredCell === cellKey;

                  return (
                    <td
                      key={cellKey}
                      className={cn(
                        "p-1.5 border-b border-border/20 text-center transition-colors",
                        isHovered && "bg-accent/30",
                      )}
                      onMouseEnter={() => setHoveredCell(cellKey)}
                      onMouseLeave={() => setHoveredCell(null)}
                    >
                      {entries.length === 0 ? (
                        <span className="text-muted-foreground/20">—</span>
                      ) : (
                        <div className="flex items-center justify-center gap-0.5 flex-wrap">
                          {entries.map(({ provider, entry }) => {
                            const isLive = entry.execution.type === "rest-proxy";
                            const meta = PROVIDER_META[provider];
                            return (
                              <Tooltip key={provider}>
                                <TooltipTrigger asChild>
                                  <button
                                    onClick={() => onSelectEntry?.(entry)}
                                    className={cn(
                                      "px-1.5 py-0.5 rounded text-[9px] font-bold uppercase transition-all cursor-pointer",
                                      "hover:scale-110 hover:shadow-md",
                                      isLive
                                        ? "bg-[hsl(var(--success))]/15 text-[hsl(var(--success))] border border-[hsl(var(--success))]/30"
                                        : "bg-[hsl(var(--warning))]/15 text-[hsl(var(--warning))] border border-[hsl(var(--warning))]/30",
                                    )}
                                  >
                                    {meta?.label || provider}
                                  </button>
                                </TooltipTrigger>
                                <TooltipContent side="top" className="font-mono text-xs max-w-xs">
                                  <p className="font-bold">{intent}/{action}/{provider}</p>
                                  <p className="text-muted-foreground">
                                    {isLive ? "🟢 Live (rest-proxy)" : `🟡 Stub (${entry.execution.type})`}
                                  </p>
                                  <p className="text-muted-foreground">
                                    Required: {entry.enforcement.required_keys.length > 0 ? entry.enforcement.required_keys.join(", ") : "none"}
                                  </p>
                                </TooltipContent>
                              </Tooltip>
                            );
                          })}
                        </div>
                      )}
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* Legend */}
      <div className="flex items-center gap-6 text-[10px] text-muted-foreground pt-2 border-t border-border/30">
        <div className="flex items-center gap-1.5">
          <span className="px-1.5 py-0.5 rounded bg-[hsl(var(--success))]/15 text-[hsl(var(--success))] border border-[hsl(var(--success))]/30 font-bold">AWS</span>
          <span>= Live (rest-proxy, signed API call)</span>
        </div>
        <div className="flex items-center gap-1.5">
          <span className="px-1.5 py-0.5 rounded bg-[hsl(var(--warning))]/15 text-[hsl(var(--warning))] border border-[hsl(var(--warning))]/30 font-bold">NAAWI</span>
          <span>= Stub (202 accepted, processing)</span>
        </div>
      </div>
    </div>
  );
}
