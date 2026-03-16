import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useState } from "react";
import {
  ShieldCheck, ShieldAlert, AlertTriangle, Info, CheckCircle2, XCircle,
  Activity, Lock, Eye, Layers, ArrowRight, ArrowUpCircle, MessageSquare,
} from "lucide-react";
import type { SafetyGateReport as SafetyGateReportType, GoldenPathTemplate } from "@/lib/golden-path";

interface SafetyGateReportProps {
  report: SafetyGateReportType;
  onProceed: () => void;
  onAbort: () => void;
  onEscalate?: (escalationText: string) => void;
}

const SEVERITY_ICON = {
  error: <XCircle className="h-3.5 w-3.5 text-destructive" />,
  warning: <AlertTriangle className="h-3.5 w-3.5 text-yellow-500" />,
  info: <CheckCircle2 className="h-3.5 w-3.5 text-primary" />,
};

const SEVERITY_BG = {
  error: "bg-destructive/10 border-destructive/30",
  warning: "bg-yellow-500/10 border-yellow-500/30",
  info: "bg-primary/5 border-primary/20",
};

export function SafetyGateReport({ report, onProceed, onAbort, onEscalate }: SafetyGateReportProps) {
  const { goldenPath, results, halted, passed } = report;
  const errors = results.filter(r => r.severity === "error" && !r.passed);
  const warnings = results.filter(r => r.severity === "warning" && !r.passed);
  const passed_checks = results.filter(r => r.passed);
  const [escalationInput, setEscalationInput] = useState("");
  const [showEscalation, setShowEscalation] = useState(false);

  return (
    <Card className={`border ${halted ? "border-destructive/40 bg-destructive/5" : "border-primary/30 bg-primary/5"}`}>
      <CardHeader className="pb-3">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            {halted ? (
              <ShieldAlert className="h-5 w-5 text-destructive" />
            ) : (
              <ShieldCheck className="h-5 w-5 text-primary" />
            )}
            <CardTitle className="text-base">
              {halted ? "HALT — Safety Gate Failed" : "Safety Gate Passed"}
            </CardTitle>
          </div>
          <Badge
            variant={halted ? "destructive" : "default"}
            className="text-[10px] uppercase tracking-widest"
          >
            {halted ? `${errors.length} BLOCK${errors.length > 1 ? "S" : ""}` : "CLEAR"}
          </Badge>
        </div>
      </CardHeader>
      <CardContent className="space-y-4">
        {/* Augmentations Preview */}
        <div className="space-y-2">
          <p className="text-[10px] text-muted-foreground uppercase tracking-widest font-medium flex items-center gap-1.5">
            <Layers className="h-3 w-3" /> Auto-Scaffolded by "{goldenPath.name}" Path
          </p>
          <div className="flex flex-wrap gap-1.5">
            {goldenPath.augmentations.map((aug, i) => (
              <Badge key={i} variant="secondary" className="text-[9px] font-mono">
                {aug}
              </Badge>
            ))}
          </div>
        </div>

        <Separator />

        {/* Validation Results */}
        <div className="space-y-2">
          <p className="text-[10px] text-muted-foreground uppercase tracking-widest font-medium flex items-center gap-1.5">
            <Activity className="h-3 w-3" /> Pre-Flight Validation
          </p>

          {/* Errors first */}
          {errors.map(r => (
            <div key={r.id} className={`flex items-start gap-2 p-2.5 rounded-md border ${SEVERITY_BG.error}`}>
              {SEVERITY_ICON.error}
              <div className="flex-1 min-w-0">
                <p className="text-xs font-medium text-destructive">{r.rule}</p>
                <p className="text-[11px] text-muted-foreground">{r.message}</p>
                {r.suggestion && (
                  <p className="text-[10px] text-muted-foreground/70 mt-0.5 italic">💡 {r.suggestion}</p>
                )}
              </div>
            </div>
          ))}

          {/* Warnings */}
          {warnings.map(r => (
            <div key={r.id} className={`flex items-start gap-2 p-2.5 rounded-md border ${SEVERITY_BG.warning}`}>
              {SEVERITY_ICON.warning}
              <div className="flex-1 min-w-0">
                <p className="text-xs font-medium text-yellow-600 dark:text-yellow-400">{r.rule}</p>
                <p className="text-[11px] text-muted-foreground">{r.message}</p>
                {r.suggestion && (
                  <p className="text-[10px] text-muted-foreground/70 mt-0.5 italic">💡 {r.suggestion}</p>
                )}
              </div>
            </div>
          ))}

          {/* Passed checks (collapsed) */}
          {passed_checks.length > 0 && (
            <details className="group">
              <summary className="text-[10px] text-muted-foreground cursor-pointer hover:text-primary transition-colors uppercase tracking-widest">
                {passed_checks.length} check{passed_checks.length > 1 ? "s" : ""} passed ▸
              </summary>
              <div className="mt-2 space-y-1.5">
                {passed_checks.map(r => (
                  <div key={r.id} className={`flex items-start gap-2 p-2 rounded-md border ${SEVERITY_BG.info}`}>
                    {SEVERITY_ICON.info}
                    <div>
                      <p className="text-[11px] font-medium">{r.rule}</p>
                      <p className="text-[10px] text-muted-foreground">{r.message}</p>
                    </div>
                  </div>
                ))}
              </div>
            </details>
          )}
        </div>

        <Separator />

        {/* SLO Target Summary */}
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
          <div className="text-center p-2 rounded-md bg-muted/50">
            <p className="text-[9px] text-muted-foreground uppercase">Availability</p>
            <p className="text-sm font-bold">{goldenPath.sloTarget.availability}%</p>
          </div>
          <div className="text-center p-2 rounded-md bg-muted/50">
            <p className="text-[9px] text-muted-foreground uppercase">p99 Latency</p>
            <p className="text-sm font-bold">{goldenPath.sloTarget.p99LatencyMs}ms</p>
          </div>
          <div className="text-center p-2 rounded-md bg-muted/50">
            <p className="text-[9px] text-muted-foreground uppercase">Max Budget</p>
            <p className="text-sm font-bold">${goldenPath.resourceCeiling.maxMonthlyBudgetUsd}</p>
          </div>
          <div className="text-center p-2 rounded-md bg-muted/50">
            <p className="text-[9px] text-muted-foreground uppercase">Network</p>
            <p className="text-sm font-bold capitalize">{goldenPath.scaffolding.networkPolicies}</p>
          </div>
        </div>

        {/* Actions */}
        <div className="flex items-center justify-end gap-2 pt-2">
          <Button variant="ghost" size="sm" onClick={onAbort} className="text-xs">
            Cancel
          </Button>
          {halted ? (
            <>
              {onEscalate && (
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => setShowEscalation(!showEscalation)}
                  className="text-xs gap-1.5"
                >
                  <ArrowUpCircle className="h-3.5 w-3.5" />
                  Escalate via Intent
                </Button>
              )}
              <Button variant="destructive" size="sm" disabled className="text-xs">
                <ShieldAlert className="h-3.5 w-3.5 mr-1.5" />
                Blocked — Resolve {errors.length} error{errors.length > 1 ? "s" : ""} first
              </Button>
            </>
          ) : (
            <Button size="sm" onClick={onProceed} className="text-xs">
              <ArrowRight className="h-3.5 w-3.5 mr-1.5" />
              Deploy via Golden Path
            </Button>
          )}
        </div>

        {/* NLP Escalation Panel — PRD §3.3 */}
        {halted && showEscalation && onEscalate && (
          <div className="space-y-2 pt-2 border-t border-border/50">
            <div className="flex items-center gap-1.5">
              <MessageSquare className="h-3.5 w-3.5 text-primary" />
              <p className="text-[10px] text-muted-foreground uppercase tracking-widest font-medium">
                Natural Language Escalation
              </p>
            </div>
            <p className="text-[11px] text-muted-foreground">
              Resolve this halt by describing the capacity you need.
              Every escalation is logged as a Dolt commit for auditability.
            </p>
            <div className="flex gap-2">
              <Input
                value={escalationInput}
                onChange={(e) => setEscalationInput(e.target.value)}
                placeholder='e.g. "Escalate this VPC to the Developer-Large capacity tier"'
                className="text-xs h-8 flex-1"
                onKeyDown={(e) => {
                  if (e.key === "Enter" && escalationInput.trim()) {
                    onEscalate(escalationInput.trim());
                    setEscalationInput("");
                    setShowEscalation(false);
                  }
                }}
              />
              <Button
                size="sm"
                className="text-xs h-8"
                disabled={!escalationInput.trim()}
                onClick={() => {
                  if (escalationInput.trim()) {
                    onEscalate(escalationInput.trim());
                    setEscalationInput("");
                    setShowEscalation(false);
                  }
                }}
              >
                <ArrowUpCircle className="h-3.5 w-3.5 mr-1" />
                Escalate
              </Button>
            </div>
            <div className="flex flex-wrap gap-1.5">
              {["Escalate to Developer-Large", "Upgrade to staging tier", "Scale up to production"].map((suggestion) => (
                <button
                  key={suggestion}
                  onClick={() => {
                    setEscalationInput(suggestion);
                  }}
                  className="text-[9px] px-2 py-1 rounded-full bg-muted/60 hover:bg-primary/10 hover:text-primary text-muted-foreground transition-colors cursor-pointer border border-border/30"
                >
                  💡 {suggestion}
                </button>
              ))}
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
