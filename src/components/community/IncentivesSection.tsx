import { Lock, Eye, MessageSquare, Tv, Gift, Sparkles } from "lucide-react";

const incentives = [
  {
    icon: Sparkles,
    title: "Founding Badge",
    description: "First 100 contributors earn a permanent Founding Architect badge — visible on the leaderboard forever.",
    color: "text-nexus-gold",
    bgColor: "bg-nexus-gold/5",
    borderColor: "border-nexus-gold/20",
  },
  {
    icon: Eye,
    title: '"Naawi-Alpha" Access',
    description: "Top contributors get first-look at the private roadmap and upcoming SDK features before public release.",
    color: "text-nexus-cyan",
    bgColor: "bg-nexus-cyan/5",
    borderColor: "border-nexus-cyan/20",
  },
  {
    icon: Lock,
    title: "Aura Strategy Advisory",
    description: "A private Discord channel where top-tier contributors help shape Aura Strategy services — direct line to the commercial side.",
    color: "text-nexus-magenta",
    bgColor: "bg-nexus-magenta/5",
    borderColor: "border-nexus-magenta/20",
  },
  {
    icon: Tv,
    title: 'Bi-Weekly "Intent Sessions"',
    description: "Live-streamed hacking sessions where we live-code a feature suggested by the community in real-time.",
    color: "text-nexus-glow",
    bgColor: "bg-nexus-glow/5",
    borderColor: "border-nexus-glow/20",
  },
  {
    icon: Gift,
    title: '"Death of YAML" Bounty',
    description: "Monthly rewards — swag, professional credits, or spotlight features — for the most creative legacy config kill.",
    color: "text-nexus-magenta",
    bgColor: "bg-nexus-magenta/5",
    borderColor: "border-nexus-magenta/20",
  },
  {
    icon: MessageSquare,
    title: "Private Nexus Discord",
    description: "Top contributors get access to the inner circle — shape SDK primitives, vote on features, and connect with the core team.",
    color: "text-nexus-cyan",
    bgColor: "bg-nexus-cyan/5",
    borderColor: "border-nexus-cyan/20",
  },
];

const IncentivesSection = () => {
  return (
    <section className="py-24 px-6 bg-nexus-surface-elevated relative">
      <div className="max-w-6xl mx-auto">
        <div className="text-center mb-16">
          <h2 className="text-3xl md:text-5xl font-bold mb-4 text-foreground">
            Early Access &{" "}
            <span className="text-transparent bg-clip-text bg-gradient-to-r from-nexus-cyan to-nexus-magenta">
              Influence
            </span>
          </h2>
          <p className="text-muted-foreground text-lg max-w-2xl mx-auto">
            The currency here is influence over the ecosystem. Ship code, climb the ranks, shape the future.
          </p>
        </div>

        <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-6">
          {incentives.map((item) => {
            const Icon = item.icon;
            return (
              <div
                key={item.title}
                className={`p-6 rounded-xl border ${item.borderColor} ${item.bgColor} hover:scale-[1.02] transition-all duration-300`}
              >
                <Icon className={`w-8 h-8 ${item.color} mb-4`} />
                <h3 className="text-lg font-bold text-foreground mb-2">{item.title}</h3>
                <p className="text-sm text-muted-foreground leading-relaxed">{item.description}</p>
              </div>
            );
          })}
        </div>
      </div>
    </section>
  );
};

export default IncentivesSection;
