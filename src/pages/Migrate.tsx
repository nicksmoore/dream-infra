import { useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Separator } from "@/components/ui/separator";
import {
  ArrowLeft, Search, Brain, ShieldAlert, Play, CheckCircle2, ChevronRight,
} from "lucide-react";
import { useNavigate } from "react-router-dom";
import { ThemeToggle } from "@/components/ThemeToggle";
import { UserMenu } from "@/components/UserMenu";
import { DiscoveryPanel } from "@/components/migration/DiscoveryPanel";
import { IntentInferencePanel } from "@/components/migration/IntentInferencePanel";
import { GapAnalysisPanel } from "@/components/migration/GapAnalysisPanel";
import { RemediationPanel } from "@/components/migration/RemediationPanel";
import { ImportPanel } from "@/components/migration/ImportPanel";

const STEPS = [
  { id: 1, label: "Discovery", icon: <Search className="h-3.5 w-3.5" />, description: "Scan live cloud state" },
  { id: 2, label: "Intent Inference", icon: <Brain className="h-3.5 w-3.5" />, description: "Reverse-engineer intents" },
  { id: 3, label: "Gap Analysis", icon: <ShieldAlert className="h-3.5 w-3.5" />, description: "Measure compliance distance" },
  { id: 4, label: "Remediation", icon: <Play className="h-3.5 w-3.5" />, description: "Close compliance gaps" },
  { id: 5, label: "Import", icon: <CheckCircle2 className="h-3.5 w-3.5" />, description: "Register as Naawi-managed" },
];

export default function Migrate() {
  const navigate = useNavigate();
  const [step, setStep] = useState(1);

  return (
    <div className="min-h-screen bg-background">
      {/* Header */}
      <header className="sticky top-0 z-50 glass-panel border-b border-border/50">
        <div className="container max-w-5xl mx-auto px-4 py-3 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <Button variant="ghost" size="sm" onClick={() => navigate("/console")} className="gap-1.5 text-muted-foreground hover:text-foreground">
              <ArrowLeft className="h-3.5 w-3.5" /> Back
            </Button>
            <Separator orientation="vertical" className="h-5" />
            <div>
              <h1 className="text-base font-bold tracking-tight font-display text-foreground">Brownfield Migration</h1>
              <p className="text-[10px] text-muted-foreground tracking-wide">PRD Part II — Discover · Infer · Analyze · Remediate · Import</p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <ThemeToggle />
            <UserMenu />
          </div>
        </div>
      </header>

      <main className="container max-w-5xl mx-auto px-4 py-6 space-y-6">
        {/* Step indicator */}
        <div className="flex items-center gap-1 overflow-x-auto pb-2">
          {STEPS.map((s, i) => (
            <div key={s.id} className="flex items-center">
              <button
                onClick={() => s.id < step && setStep(s.id)}
                disabled={s.id > step}
                className={`flex items-center gap-2 px-3 py-2 rounded-lg text-xs transition-all whitespace-nowrap ${
                  s.id === step
                    ? "bg-primary/10 text-primary font-semibold border border-primary/30"
                    : s.id < step
                    ? "text-emerald-400 hover:bg-emerald-500/10 cursor-pointer"
                    : "text-muted-foreground opacity-50 cursor-not-allowed"
                }`}
              >
                {s.id < step ? <CheckCircle2 className="h-3.5 w-3.5" /> : s.icon}
                <span>{s.label}</span>
              </button>
              {i < STEPS.length - 1 && <ChevronRight className="h-3.5 w-3.5 text-muted-foreground mx-1 flex-shrink-0" />}
            </div>
          ))}
        </div>

        {/* Step Title */}
        <div>
          <h2 className="text-lg font-bold flex items-center gap-2">
            {STEPS[step - 1].icon}
            Step {step}: {STEPS[step - 1].label}
          </h2>
          <p className="text-xs text-muted-foreground mt-0.5">{STEPS[step - 1].description}</p>
        </div>

        {/* Step Content */}
        {step === 1 && <DiscoveryPanel onComplete={() => setStep(2)} />}
        {step === 2 && <IntentInferencePanel onComplete={() => setStep(3)} />}
        {step === 3 && <GapAnalysisPanel onComplete={() => setStep(4)} />}
        {step === 4 && <RemediationPanel onComplete={() => setStep(5)} />}
        {step === 5 && <ImportPanel />}
      </main>
    </div>
  );
}
