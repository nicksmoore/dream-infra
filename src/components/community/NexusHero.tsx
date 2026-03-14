import { ArrowRight, Github, Zap } from "lucide-react";
import { Button } from "@/components/ui/button";

const NexusHero = () => {
  return (
    <section className="relative min-h-[90vh] flex items-center justify-center overflow-hidden">
      {/* Animated grid background */}
      <div className="absolute inset-0 bg-nexus-surface">
        <div
          className="absolute inset-0 opacity-10"
          style={{
            backgroundImage:
              "linear-gradient(hsl(var(--nexus-glow) / 0.15) 1px, transparent 1px), linear-gradient(90deg, hsl(var(--nexus-glow) / 0.15) 1px, transparent 1px)",
            backgroundSize: "60px 60px",
          }}
        />
        {/* Glow orbs */}
        <div className="absolute top-1/4 left-1/4 w-96 h-96 rounded-full bg-nexus-glow/5 blur-[120px] animate-glow-pulse" />
        <div className="absolute bottom-1/4 right-1/4 w-72 h-72 rounded-full bg-nexus-magenta/5 blur-[100px] animate-glow-pulse" style={{ animationDelay: "1s" }} />
        <div className="absolute top-1/2 right-1/3 w-64 h-64 rounded-full bg-nexus-cyan/5 blur-[80px] animate-glow-pulse" style={{ animationDelay: "0.5s" }} />
      </div>

      <div className="relative z-10 max-w-5xl mx-auto px-6 text-center">
        {/* Status chip */}
        <div className="inline-flex items-center gap-2 px-4 py-1.5 rounded-full border border-nexus-glow/30 bg-nexus-glow/5 mb-8">
          <span className="w-2 h-2 rounded-full bg-nexus-glow animate-glow-pulse" />
          <span className="text-sm font-mono text-nexus-glow tracking-wide">
            SEEKING FOUNDING ARCHITECTS
          </span>
        </div>

        {/* Title */}
        <h1 className="text-5xl md:text-7xl lg:text-8xl font-bold tracking-tight mb-6">
          <span className="text-foreground">The </span>
          <span className="text-transparent bg-clip-text bg-gradient-to-r from-nexus-glow via-nexus-cyan to-nexus-magenta">
            Death of YAML
          </span>
        </h1>

        <p className="text-xl md:text-2xl text-muted-foreground max-w-3xl mx-auto mb-4 leading-relaxed">
          Project Naawi is the world's first community-driven{" "}
          <span className="text-nexus-cyan font-semibold">"Compiler"</span> for
          Intent-Driven Infrastructure.
        </p>

        <p className="text-lg text-muted-foreground/70 max-w-2xl mx-auto mb-10 font-mono">
          Describe what you want. We provision it. No YAML. No drift. No BS.
        </p>

        {/* CTA row */}
        <div className="flex flex-col sm:flex-row gap-4 justify-center items-center mb-16">
          <Button
            size="lg"
            className="bg-gradient-to-r from-nexus-glow to-nexus-cyan text-nexus-surface font-bold px-8 py-6 text-lg shadow-[0_0_30px_hsl(var(--nexus-glow)/0.3)] hover:shadow-[0_0_50px_hsl(var(--nexus-glow)/0.5)] transition-all"
            onClick={() => window.open("https://github.com/nicksmoore/project-naawi", "_blank")}
          >
            <Github className="w-5 h-5 mr-2" />
            Join the Nexus
            <ArrowRight className="w-5 h-5 ml-2" />
          </Button>
          <Button
            size="lg"
            variant="outline"
            className="border-nexus-magenta/40 text-nexus-magenta hover:bg-nexus-magenta/10 px-8 py-6 text-lg"
            onClick={() => window.open("https://project-naawi.lovable.app", "_blank")}
          >
            <Zap className="w-5 h-5 mr-2" />
            Try the Playground
          </Button>
        </div>

        {/* Stats row */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-6 max-w-3xl mx-auto">
          {[
            { value: "100", label: "Founding Spots", icon: "🌟" },
            { value: "3", label: "Architect Tiers", icon: "🏗️" },
            { value: "∞", label: "YAML to Kill", icon: "💀" },
            { value: "0", label: "Config Files Needed", icon: "⚡" },
          ].map((stat) => (
            <div
              key={stat.label}
              className="p-4 rounded-lg border border-border/50 bg-nexus-surface-elevated/50 backdrop-blur"
            >
              <div className="text-2xl mb-1">{stat.icon}</div>
              <div className="text-2xl font-bold font-mono text-foreground">{stat.value}</div>
              <div className="text-xs text-muted-foreground uppercase tracking-wider">{stat.label}</div>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
};

export default NexusHero;
