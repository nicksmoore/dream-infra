import { ArrowRight, Github } from "lucide-react";
import { Button } from "@/components/ui/button";

const CTAFooter = () => {
  return (
    <section className="py-24 px-6 bg-nexus-surface relative overflow-hidden">
      {/* Background glow */}
      <div className="absolute inset-0">
        <div className="absolute bottom-0 left-1/2 -translate-x-1/2 w-[800px] h-[400px] bg-nexus-glow/5 blur-[150px] rounded-full" />
      </div>

      <div className="relative z-10 max-w-3xl mx-auto text-center">
        <h2 className="text-3xl md:text-5xl font-bold mb-6">
          <span className="text-foreground">Ready to Kill Some </span>
          <span className="text-transparent bg-clip-text bg-gradient-to-r from-nexus-magenta to-nexus-glow line-through decoration-nexus-magenta/50">
            YAML
          </span>
          <span className="text-foreground">?</span>
        </h2>

        <p className="text-lg text-muted-foreground mb-8 max-w-xl mx-auto">
          Drop a PR, climb the board, and let's make infrastructure conversational. 
          This isn't just code — it's a movement.
        </p>

        <div className="flex flex-col sm:flex-row gap-4 justify-center items-center mb-12">
          <Button
            size="lg"
            className="bg-gradient-to-r from-nexus-glow to-nexus-cyan text-nexus-surface font-bold px-8 py-6 text-lg shadow-[0_0_30px_hsl(var(--nexus-glow)/0.3)] hover:shadow-[0_0_50px_hsl(var(--nexus-glow)/0.5)] transition-all"
            onClick={() => window.open("https://github.com/nicksmoore/project-naawi", "_blank")}
          >
            <Github className="w-5 h-5 mr-2" />
            Fork the Repo
            <ArrowRight className="w-5 h-5 ml-2" />
          </Button>
        </div>

        {/* Tech stack callout */}
        <div className="p-6 rounded-xl border border-border/30 bg-nexus-surface-elevated/50 max-w-lg mx-auto">
          <p className="text-sm font-mono text-muted-foreground mb-3">WE NEED</p>
          <div className="flex flex-wrap justify-center gap-2">
            {["Zig/Rust Wizards", "LLM Prompt Engineers", "SREs", "TypeScript Devs", "SDK Builders"].map((role) => (
              <span
                key={role}
                className="px-3 py-1.5 rounded-full text-xs font-mono border border-nexus-cyan/20 bg-nexus-cyan/5 text-nexus-cyan"
              >
                {role}
              </span>
            ))}
          </div>
        </div>

        <div className="mt-12 text-sm text-muted-foreground/50 font-mono">
          project naawi · infrastructure for the AI era · est. 2026
        </div>
      </div>
    </section>
  );
};

export default CTAFooter;
