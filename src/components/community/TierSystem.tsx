import { Brain, Code2, Shield, ArrowUp } from "lucide-react";

const tiers = [
  {
    level: 1,
    name: "Intent Tier",
    title: "Intent Seekers",
    description: "Submit prompts, validate NLP output, and help train the intent parser to understand infrastructure language.",
    icon: Brain,
    color: "nexus-glow",
    borderColor: "border-nexus-glow/30",
    bgColor: "bg-nexus-glow/5",
    glowColor: "shadow-[0_0_20px_hsl(var(--nexus-glow)/0.15)]",
    xpRange: "0 – 500 XP",
    activities: ["Submit intent prompts", "Validate parsed output", "Report edge cases"],
  },
  {
    level: 2,
    name: "Logic Tier",
    title: "Logic Builders",
    description: "Build SDK primitives, compiler logic, and the DAG resolution engine that turns intents into infrastructure.",
    icon: Code2,
    color: "nexus-cyan",
    borderColor: "border-nexus-cyan/30",
    bgColor: "bg-nexus-cyan/5",
    glowColor: "shadow-[0_0_20px_hsl(var(--nexus-cyan)/0.15)]",
    xpRange: "500 – 2000 XP",
    activities: ["Build SDK primitives", "Write compiler logic", "Extend DAG resolver"],
  },
  {
    level: 3,
    name: "Core Tier",
    title: "Core Architects",
    description: "Stress-test the engine against real infrastructure providers. Shape the roadmap. Influence the commercial strategy.",
    icon: Shield,
    color: "nexus-magenta",
    borderColor: "border-nexus-magenta/30",
    bgColor: "bg-nexus-magenta/5",
    glowColor: "shadow-[0_0_20px_hsl(var(--nexus-magenta)/0.15)]",
    xpRange: "2000+ XP",
    activities: ["Stress-test providers", "Shape the roadmap", "Advisory access"],
  },
];

const TierSystem = () => {
  return (
    <section className="py-24 px-6 bg-nexus-surface relative">
      <div className="max-w-6xl mx-auto">
        <div className="text-center mb-16">
          <h2 className="text-3xl md:text-5xl font-bold mb-4">
            <span className="text-foreground">The Architect's </span>
            <span className="text-transparent bg-clip-text bg-gradient-to-r from-nexus-glow to-nexus-cyan">
              Rank
            </span>
          </h2>
          <p className="text-muted-foreground text-lg max-w-2xl mx-auto">
            Contributions are ranked by <span className="text-nexus-gold font-semibold">Impact Velocity</span>. 
            Level up through the tiers and gain influence over the ecosystem.
          </p>
        </div>

        <div className="grid md:grid-cols-3 gap-8">
          {tiers.map((tier, i) => {
            const Icon = tier.icon;
            return (
              <div
                key={tier.name}
                className={`relative group p-8 rounded-xl border ${tier.borderColor} ${tier.bgColor} ${tier.glowColor} hover:scale-[1.02] transition-all duration-300`}
              >
                {/* Level badge */}
                <div className={`absolute -top-3 left-6 px-3 py-1 rounded-full text-xs font-mono font-bold border ${tier.borderColor} ${tier.bgColor} text-${tier.color}`}>
                  LVL {tier.level}
                </div>

                <div className="mt-4">
                  <Icon className={`w-10 h-10 text-${tier.color} mb-4`} />
                  <h3 className={`text-2xl font-bold text-${tier.color} mb-1`}>{tier.name}</h3>
                  <p className="text-sm text-muted-foreground font-mono mb-4">{tier.xpRange}</p>
                  <p className="text-muted-foreground mb-6">{tier.description}</p>

                  <div className="space-y-2">
                    {tier.activities.map((activity) => (
                      <div key={activity} className="flex items-center gap-2 text-sm text-foreground/80">
                        <ArrowUp className={`w-3 h-3 text-${tier.color}`} />
                        {activity}
                      </div>
                    ))}
                  </div>
                </div>

                {i < 2 && (
                  <div className="hidden md:block absolute -right-6 top-1/2 -translate-y-1/2 z-10">
                    <ArrowUp className="w-5 h-5 text-muted-foreground rotate-90" />
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </div>
    </section>
  );
};

export default TierSystem;
