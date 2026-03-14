import { Star, Skull, Brain, Code2, Shield, Award } from "lucide-react";

const badges = [
  {
    type: "founder",
    name: "Founding Architect",
    description: "First 100 contributors to land a PR",
    icon: Star,
    color: "text-nexus-gold",
    bgColor: "bg-nexus-gold/10",
    borderColor: "border-nexus-gold/30",
    rarity: "LEGENDARY",
    slots: "100 total",
  },
  {
    type: "yaml_slayer",
    name: "YAML Slayer",
    description: "Converted a legacy config into a Naawi intent",
    icon: Skull,
    color: "text-nexus-magenta",
    bgColor: "bg-nexus-magenta/10",
    borderColor: "border-nexus-magenta/30",
    rarity: "RARE",
    slots: "Unlimited",
  },
  {
    type: "intent_seeker",
    name: "Intent Seeker",
    description: "Validated 10+ intent parsing outputs",
    icon: Brain,
    color: "text-nexus-glow",
    bgColor: "bg-nexus-glow/10",
    borderColor: "border-nexus-glow/30",
    rarity: "COMMON",
    slots: "Unlimited",
  },
  {
    type: "logic_builder",
    name: "Logic Builder",
    description: "Contributed to SDK primitives or compiler logic",
    icon: Code2,
    color: "text-nexus-cyan",
    bgColor: "bg-nexus-cyan/10",
    borderColor: "border-nexus-cyan/30",
    rarity: "UNCOMMON",
    slots: "Unlimited",
  },
  {
    type: "core_architect",
    name: "Core Architect",
    description: "Reached Core Tier — shapes the roadmap",
    icon: Shield,
    color: "text-nexus-magenta",
    bgColor: "bg-nexus-magenta/10",
    borderColor: "border-nexus-magenta/30",
    rarity: "EPIC",
    slots: "By merit",
  },
  {
    type: "bounty_winner",
    name: "Bounty Winner",
    description: "Won a monthly 'Death of YAML' bounty",
    icon: Award,
    color: "text-nexus-gold",
    bgColor: "bg-nexus-gold/10",
    borderColor: "border-nexus-gold/30",
    rarity: "RARE",
    slots: "Monthly",
  },
];

const rarityColors: Record<string, string> = {
  COMMON: "text-muted-foreground",
  UNCOMMON: "text-nexus-glow",
  RARE: "text-nexus-cyan",
  EPIC: "text-nexus-magenta",
  LEGENDARY: "text-nexus-gold",
};

const BadgeShowcase = () => {
  return (
    <section className="py-24 px-6 bg-nexus-surface relative">
      <div className="max-w-6xl mx-auto">
        <div className="text-center mb-16">
          <h2 className="text-3xl md:text-5xl font-bold mb-4">
            <span className="text-foreground">Earn Your </span>
            <span className="text-transparent bg-clip-text bg-gradient-to-r from-nexus-gold to-nexus-magenta">
              Badges
            </span>
          </h2>
          <p className="text-muted-foreground text-lg max-w-2xl mx-auto">
            Each badge is a mark of impact. Collect them as you shape the future of infrastructure.
          </p>
        </div>

        <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-6">
          {badges.map((badge) => {
            const Icon = badge.icon;
            return (
              <div
                key={badge.type}
                className={`group relative p-6 rounded-xl border ${badge.borderColor} ${badge.bgColor} hover:scale-[1.03] transition-all duration-300`}
              >
                <div className="flex items-start justify-between mb-4">
                  <div className={`p-3 rounded-lg ${badge.bgColor} border ${badge.borderColor}`}>
                    <Icon className={`w-8 h-8 ${badge.color}`} />
                  </div>
                  <span className={`text-[10px] font-mono font-bold tracking-widest ${rarityColors[badge.rarity]}`}>
                    {badge.rarity}
                  </span>
                </div>
                <h3 className={`text-lg font-bold ${badge.color} mb-1`}>{badge.name}</h3>
                <p className="text-sm text-muted-foreground mb-3">{badge.description}</p>
                <div className="text-xs font-mono text-muted-foreground/60">{badge.slots}</div>
              </div>
            );
          })}
        </div>
      </div>
    </section>
  );
};

export default BadgeShowcase;
