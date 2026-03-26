import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Trophy, Skull, Search } from "lucide-react";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";

interface Contributor {
  id: string;
  github_username: string;
  display_name: string | null;
  avatar_url: string | null;
  tier: "intent" | "logic" | "core";
  xp: number;
  pr_count: number;
  intents_validated: number;
  yaml_kills: number;
  is_founding: boolean;
}

const tierLabel: Record<string, string> = {
  intent: "Intent Seeker",
  logic: "Logic Builder",
  core: "Core Architect",
};

const Leaderboard = () => {
  const [search, setSearch] = useState("");

  const { data: contributors = [], isLoading } = useQuery({
    queryKey: ["leaderboard"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("contributors")
        .select("*")
        .order("xp", { ascending: false })
        .limit(50);
      if (error) throw error;
      return data as Contributor[];
    },
  });

  const filtered = contributors.filter(
    (c) =>
      (c.display_name || c.github_username)
        .toLowerCase()
        .includes(search.toLowerCase())
  );

  const yamlKillers = [...contributors]
    .sort((a, b) => b.yaml_kills - a.yaml_kills)
    .filter((c) => c.yaml_kills > 0);

  const renderTable = (data: Contributor[], scoreKey: "xp" | "yaml_kills") => {
    const rows = scoreKey === "yaml_kills" ? data : filtered;
    return (
      <div className="w-full">
        {/* Table header */}
        <div className="grid grid-cols-[4rem_1fr_8rem_8rem] border-b border-border/30 pb-3 mb-2">
          <span className="font-mono text-[11px] uppercase tracking-[0.2em] text-muted-foreground">Rank</span>
          <span className="font-mono text-[11px] uppercase tracking-[0.2em] text-muted-foreground">
            {scoreKey === "yaml_kills" ? "Operative" : "Architect"}
          </span>
          <span className="font-mono text-[11px] uppercase tracking-[0.2em] text-muted-foreground text-right">
            {scoreKey === "yaml_kills" ? "Kills" : "Score"}
          </span>
          <span className="font-mono text-[11px] uppercase tracking-[0.2em] text-muted-foreground text-right">
            {scoreKey === "yaml_kills" ? "PRs" : "Events"}
          </span>
        </div>

        {/* Rows */}
        {rows.length === 0 && !isLoading && (
          <div className="text-center py-16">
            <p className="text-muted-foreground font-mono text-sm mb-2">
              {search ? "No operatives match that query." : "The board is empty."}
            </p>
            <p className="font-mono text-sm" style={{ color: "hsl(var(--nexus-glow))" }}>
              Be the first Founding Architect →
            </p>
          </div>
        )}

        {isLoading && (
          <div className="space-y-0">
            {Array.from({ length: 8 }).map((_, i) => (
              <div
                key={i}
                className="grid grid-cols-[4rem_1fr_8rem_8rem] py-3.5 border-b border-border/10"
              >
                <div className="h-4 w-6 rounded bg-muted/30 animate-pulse" />
                <div className="h-4 w-32 rounded bg-muted/30 animate-pulse" />
                <div className="h-4 w-16 rounded bg-muted/30 animate-pulse ml-auto" />
                <div className="h-4 w-12 rounded bg-muted/30 animate-pulse ml-auto" />
              </div>
            ))}
          </div>
        )}

        <div className="divide-y divide-border/10">
          {rows.map((c, i) => {
            const rank = i + 1;
            const isTop3 = rank <= 3;
            const score = scoreKey === "yaml_kills" ? c.yaml_kills : c.xp;
            const events = scoreKey === "yaml_kills" ? c.pr_count : c.pr_count + c.intents_validated;
            const name = c.display_name || c.github_username;

            return (
              <div
                key={c.id}
                className="grid grid-cols-[4rem_1fr_8rem_8rem] py-3.5 items-center group hover:bg-muted/5 transition-colors cursor-default"
              >
                {/* Rank */}
                <span
                  className={`font-mono text-sm font-bold ${
                    isTop3
                      ? "text-[hsl(var(--nexus-glow))]"
                      : "text-muted-foreground"
                  }`}
                >
                  {rank}
                </span>

                {/* Name + tier */}
                <div className="flex items-center gap-3 min-w-0">
                  <span
                    className={`font-mono text-sm font-medium truncate ${
                      isTop3
                        ? "text-[hsl(var(--nexus-cyan))]"
                        : "text-foreground"
                    } group-hover:text-[hsl(var(--nexus-cyan))] transition-colors`}
                  >
                    {name}
                  </span>
                  {c.is_founding && (
                    <span
                      className="text-[10px] font-mono px-1.5 py-0.5 rounded border"
                      style={{
                        color: "hsl(var(--nexus-gold))",
                        borderColor: "hsl(var(--nexus-gold) / 0.3)",
                        background: "hsl(var(--nexus-gold) / 0.08)",
                      }}
                    >
                      FOUNDER
                    </span>
                  )}
                  <span className="text-[10px] font-mono text-muted-foreground hidden md:inline">
                    {tierLabel[c.tier]}
                  </span>
                </div>

                {/* Score */}
                <span
                  className="font-mono text-sm font-bold text-right tabular-nums"
                  style={{ color: "hsl(var(--nexus-glow))" }}
                >
                  {score.toLocaleString()}
                </span>

                {/* Events */}
                <span className="font-mono text-sm text-muted-foreground text-right tabular-nums">
                  {events.toLocaleString()}
                </span>
              </div>
            );
          })}
        </div>
      </div>
    );
  };

  return (
    <section className="py-24 px-6 relative" style={{ background: "hsl(var(--nexus-surface))" }}>
      {/* Background matrix effect - subtle */}
      <div
        className="absolute inset-0 opacity-[0.03] pointer-events-none overflow-hidden font-mono text-[10px] leading-3 break-all select-none"
        style={{ color: "hsl(var(--nexus-glow))" }}
        aria-hidden="true"
      >
        {Array.from({ length: 6 }).map((_, i) => (
          <div key={i} className="whitespace-nowrap">
            {"ナアウィ・プラットフォーム・インテント・ドリブン・インフラストラクチャ・".repeat(12)}
          </div>
        ))}
      </div>

      <div className="max-w-4xl mx-auto relative z-10">
        {/* Header */}
        <div className="text-center mb-10">
          <h2
            className="text-4xl md:text-6xl font-bold font-mono tracking-tight mb-3"
            style={{ color: "hsl(var(--nexus-glow))" }}
          >
            LEADERBOARD
          </h2>
          <p className="font-mono text-sm text-muted-foreground tracking-[0.15em] uppercase">
            // Top Architects by Reputation Score //
          </p>
        </div>

        {/* Search */}
        <div className="relative mb-8">
          <Search className="absolute left-4 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
          <input
            type="text"
            placeholder="Search architects..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="w-full pl-11 pr-4 py-3 rounded-lg font-mono text-sm bg-transparent border border-border/30 text-foreground placeholder:text-muted-foreground/50 focus:outline-none focus:border-[hsl(var(--nexus-glow))] focus:ring-1 focus:ring-[hsl(var(--nexus-glow))/0.2] transition-colors"
            style={{ background: "hsl(var(--nexus-surface-elevated) / 0.5)" }}
          />
        </div>

        {/* Tabs */}
        <Tabs defaultValue="architects" className="w-full">
          <TabsList className="grid w-full grid-cols-2 mb-6 bg-transparent border border-border/20 rounded-lg p-1">
            <TabsTrigger
              value="architects"
              className="font-mono text-xs tracking-wider uppercase data-[state=active]:bg-[hsl(var(--nexus-glow))/0.1] data-[state=active]:text-[hsl(var(--nexus-glow))] rounded-md transition-colors"
            >
              <Trophy className="w-3.5 h-3.5 mr-2" />
              Architect's Rank
            </TabsTrigger>
            <TabsTrigger
              value="yaml"
              className="font-mono text-xs tracking-wider uppercase data-[state=active]:bg-[hsl(var(--nexus-magenta))/0.1] data-[state=active]:text-[hsl(var(--nexus-magenta))] rounded-md transition-colors"
            >
              <Skull className="w-3.5 h-3.5 mr-2" />
              YAML Kill Board
            </TabsTrigger>
          </TabsList>

          <div
            className="rounded-xl border border-border/20 p-6"
            style={{ background: "hsl(var(--nexus-surface-elevated) / 0.4)" }}
          >
            <TabsContent value="architects" className="mt-0">
              {renderTable(contributors, "xp")}
            </TabsContent>

            <TabsContent value="yaml" className="mt-0">
              {yamlKillers.length > 0 ? (
                renderTable(yamlKillers, "yaml_kills")
              ) : (
                <div className="text-center py-16">
                  <Skull
                    className="w-10 h-10 mx-auto mb-4 opacity-40"
                    style={{ color: "hsl(var(--nexus-magenta))" }}
                  />
                  <p className="text-muted-foreground font-mono text-sm mb-2">
                    No YAML has been slain yet.
                  </p>
                  <p
                    className="font-mono text-sm"
                    style={{ color: "hsl(var(--nexus-magenta))" }}
                  >
                    Convert a legacy config to earn your first kill →
                  </p>
                </div>
              )}
            </TabsContent>
          </div>
        </Tabs>
      </div>
    </section>
  );
};

export default Leaderboard;
