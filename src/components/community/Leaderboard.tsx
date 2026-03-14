import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Trophy, Flame, Skull, Star } from "lucide-react";
import { Badge } from "@/components/ui/badge";
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

const tierStyles = {
  intent: { label: "Intent", color: "bg-nexus-glow/20 text-nexus-glow border-nexus-glow/30" },
  logic: { label: "Logic", color: "bg-nexus-cyan/20 text-nexus-cyan border-nexus-cyan/30" },
  core: { label: "Core", color: "bg-nexus-magenta/20 text-nexus-magenta border-nexus-magenta/30" },
};

const rankMedals = ["🥇", "🥈", "🥉"];

const ContributorRow = ({ contributor, rank }: { contributor: Contributor; rank: number }) => {
  const style = tierStyles[contributor.tier];
  return (
    <div className="flex items-center gap-4 p-4 rounded-lg border border-border/30 bg-nexus-surface-elevated/50 hover:border-nexus-glow/20 transition-colors group">
      <div className="w-8 text-center font-mono font-bold text-lg text-muted-foreground">
        {rank <= 3 ? rankMedals[rank - 1] : rank}
      </div>
      <div className="w-10 h-10 rounded-full bg-muted flex items-center justify-center overflow-hidden border-2 border-border/50">
        {contributor.avatar_url ? (
          <img src={contributor.avatar_url} alt={contributor.github_username} className="w-full h-full object-cover" />
        ) : (
          <span className="text-sm font-bold text-muted-foreground">
            {(contributor.display_name || contributor.github_username).charAt(0).toUpperCase()}
          </span>
        )}
      </div>
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2">
          <span className="font-semibold text-foreground truncate">
            {contributor.display_name || contributor.github_username}
          </span>
          {contributor.is_founding && (
            <Star className="w-4 h-4 text-nexus-gold fill-nexus-gold" />
          )}
          <Badge variant="outline" className={`text-[10px] ${style.color} border`}>
            {style.label}
          </Badge>
        </div>
        <span className="text-xs text-muted-foreground font-mono">@{contributor.github_username}</span>
      </div>
      <div className="text-right">
        <div className="font-mono font-bold text-nexus-glow">{contributor.xp.toLocaleString()} XP</div>
        <div className="text-xs text-muted-foreground">{contributor.pr_count} PRs</div>
      </div>
    </div>
  );
};

const Leaderboard = () => {
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

  const yamlKillers = [...contributors].sort((a, b) => b.yaml_kills - a.yaml_kills).filter((c) => c.yaml_kills > 0);

  // Demo data if empty
  const demoContributors: Contributor[] = contributors.length > 0 ? contributors : [
    { id: "1", github_username: "you-could-be-here", display_name: "Your Name Here", avatar_url: null, tier: "core", xp: 0, pr_count: 0, intents_validated: 0, yaml_kills: 0, is_founding: true },
  ];

  return (
    <section className="py-24 px-6 bg-nexus-surface-elevated relative">
      <div className="max-w-4xl mx-auto">
        <div className="text-center mb-12">
          <h2 className="text-3xl md:text-5xl font-bold mb-4">
            <Trophy className="inline w-10 h-10 text-nexus-gold mr-3" />
            <span className="text-foreground">Leaderboard</span>
          </h2>
          <p className="text-muted-foreground">Ranked by Impact Velocity</p>
        </div>

        <Tabs defaultValue="architects" className="w-full">
          <TabsList className="grid w-full grid-cols-2 mb-8 bg-nexus-surface border border-border/30">
            <TabsTrigger value="architects" className="data-[state=active]:bg-nexus-glow/10 data-[state=active]:text-nexus-glow">
              <Flame className="w-4 h-4 mr-2" />
              Architect's Rank
            </TabsTrigger>
            <TabsTrigger value="yaml" className="data-[state=active]:bg-nexus-magenta/10 data-[state=active]:text-nexus-magenta">
              <Skull className="w-4 h-4 mr-2" />
              Zero-YAML Hall of Fame
            </TabsTrigger>
          </TabsList>

          <TabsContent value="architects">
            {isLoading ? (
              <div className="space-y-3">
                {[1, 2, 3].map((i) => (
                  <div key={i} className="h-20 rounded-lg bg-nexus-surface animate-pulse" />
                ))}
              </div>
            ) : (
              <div className="space-y-3">
                {demoContributors.map((c, i) => (
                  <ContributorRow key={c.id} contributor={c} rank={i + 1} />
                ))}
                {contributors.length === 0 && (
                  <div className="text-center py-12 border border-dashed border-nexus-glow/20 rounded-xl">
                    <p className="text-muted-foreground text-lg mb-2">The board is empty.</p>
                    <p className="text-nexus-glow font-mono">Be the first Founding Architect →</p>
                  </div>
                )}
              </div>
            )}
          </TabsContent>

          <TabsContent value="yaml">
            {yamlKillers.length > 0 ? (
              <div className="space-y-3">
                {yamlKillers.map((c, i) => (
                  <div key={c.id} className="flex items-center gap-4 p-4 rounded-lg border border-border/30 bg-nexus-surface-elevated/50">
                    <div className="w-8 text-center font-mono font-bold text-lg text-muted-foreground">
                      {i <= 2 ? rankMedals[i] : i + 1}
                    </div>
                    <div className="flex-1">
                      <span className="font-semibold text-foreground">{c.display_name || c.github_username}</span>
                    </div>
                    <div className="font-mono font-bold text-nexus-magenta">
                      <Skull className="w-4 h-4 inline mr-1" />
                      {c.yaml_kills} kills
                    </div>
                  </div>
                ))}
              </div>
            ) : (
              <div className="text-center py-12 border border-dashed border-nexus-magenta/20 rounded-xl">
                <Skull className="w-12 h-12 text-nexus-magenta mx-auto mb-4 opacity-50" />
                <p className="text-muted-foreground text-lg mb-2">No YAML has been slain yet.</p>
                <p className="text-nexus-magenta font-mono text-sm">Convert a legacy config to earn your first kill →</p>
              </div>
            )}
          </TabsContent>
        </Tabs>
      </div>
    </section>
  );
};

export default Leaderboard;
