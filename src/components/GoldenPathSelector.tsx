import { useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Separator } from "@/components/ui/separator";
import { AlertTriangle, Check, ChevronRight, ShieldAlert, Sparkles } from "lucide-react";
import type { GoldenPathChoice, GoldenPathTemplate } from "@/lib/golden-path";

interface GoldenPathSelectorProps {
  choices: GoldenPathChoice[];
  onSelect: (template: GoldenPathTemplate) => void;
  onOverride: (justification: string) => void;
}

export function GoldenPathSelector({ choices, onSelect, onOverride }: GoldenPathSelectorProps) {
  const [showOverride, setShowOverride] = useState(false);
  const [justification, setJustification] = useState("");

  if (choices.length === 0) return null;

  // Auto-proceed with high-confidence single match
  const primary = choices[0];
  const hasAlternatives = choices.length > 1;

  return (
    <Card className="bg-card border-primary/20">
      <CardHeader className="pb-3">
        <div className="flex items-center gap-2">
          <Sparkles className="h-5 w-5 text-primary" />
          <CardTitle className="text-base">Golden Path Detected</CardTitle>
          <Badge variant="outline" className="text-[10px] uppercase tracking-widest border-primary/30 text-primary">
            {primary.confidence} confidence
          </Badge>
        </div>
        <p className="text-xs text-muted-foreground mt-1">
          The IDI compiler has identified {hasAlternatives ? `${choices.length} Golden Paths` : "a Golden Path"} for your intent.
          {primary.confidence === "high" && " Proceeding with the recommended path."}
        </p>
      </CardHeader>
      <CardContent className="space-y-3">
        {choices.map((choice, idx) => (
          <button
            key={choice.template.id}
            onClick={() => onSelect(choice.template)}
            className={`w-full text-left rounded-lg border p-4 transition-all hover:border-primary/50 hover:bg-primary/5 ${
              idx === 0 ? "border-primary/30 bg-primary/5" : "border-border"
            }`}
          >
            <div className="flex items-start justify-between">
              <div className="flex items-start gap-3">
                <span className="text-2xl">{choice.template.icon}</span>
                <div>
                  <div className="flex items-center gap-2">
                    <span className="font-semibold text-sm">{choice.template.name}</span>
                    {idx === 0 && (
                      <Badge className="text-[9px] px-1.5 py-0 bg-primary/10 text-primary border-0">
                        RECOMMENDED
                      </Badge>
                    )}
                  </div>
                  <p className="text-xs text-muted-foreground mt-0.5">{choice.template.description}</p>
                  <p className="text-[10px] text-muted-foreground/60 mt-1 italic">{choice.reason}</p>
                  
                  <div className="flex items-center gap-1.5 mt-2 flex-wrap">
                    <Badge variant="secondary" className="text-[9px]">
                      SLO: {choice.template.sloTarget.availability}%
                    </Badge>
                    <Badge variant="secondary" className="text-[9px]">
                      p99: {choice.template.sloTarget.p99LatencyMs}ms
                    </Badge>
                    {choice.template.scaffolding.security.vaultIntegration && (
                      <Badge variant="secondary" className="text-[9px]">
                        <ShieldAlert className="h-2.5 w-2.5 mr-0.5" /> Vault Required
                      </Badge>
                    )}
                    <Badge variant="secondary" className="text-[9px]">
                      ≤ ${choice.template.resourceCeiling.maxMonthlyBudgetUsd}/mo
                    </Badge>
                  </div>
                </div>
              </div>
              <ChevronRight className="h-4 w-4 text-muted-foreground flex-shrink-0 mt-1" />
            </div>
          </button>
        ))}

        <Separator />

        <div className="flex items-center justify-between">
          <p className="text-[10px] text-muted-foreground uppercase tracking-widest">
            Need to go off-road?
          </p>
          <Button
            variant="ghost"
            size="sm"
            className="text-[10px] uppercase tracking-widest text-muted-foreground hover:text-destructive"
            onClick={() => setShowOverride(!showOverride)}
          >
            <AlertTriangle className="h-3 w-3 mr-1" />
            Override Golden Path
          </Button>
        </div>

        {showOverride && (
          <div className="space-y-2 p-3 rounded-lg bg-destructive/5 border border-destructive/20">
            <p className="text-xs text-destructive font-medium">
              ⚠️ Override requires justification for security review
            </p>
            <Textarea
              value={justification}
              onChange={(e) => setJustification(e.target.value)}
              placeholder="Explain why this deployment needs to deviate from the Golden Path..."
              className="min-h-[80px] text-xs bg-card"
            />
            <Button
              variant="destructive"
              size="sm"
              disabled={justification.length < 20}
              onClick={() => onOverride(justification)}
              className="text-xs"
            >
              Proceed Off-Road (Security Review Required)
            </Button>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
