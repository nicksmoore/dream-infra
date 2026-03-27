import { useState, useMemo } from "react";
import { INTENTS, ACTIONS, PROVIDERS, lookupEntry, getUserFields, INTENT_META, ACTION_META, PROVIDER_META, entriesForIntentAction, type ManifestEntryUI } from "@/lib/manifest-data";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Label } from "@/components/ui/label";
import { Card, CardContent } from "@/components/ui/card";
import { invokeFunction } from "@/lib/api-client";
import { toast } from "@/hooks/use-toast";
import { Play, Lock, Loader2, AlertTriangle, CheckCircle2, Terminal } from "lucide-react";
import { cn } from "@/lib/utils";

interface IntentConsoleProps {
  initialEntry?: ManifestEntryUI;
}

export function IntentConsole({ initialEntry }: IntentConsoleProps) {
  const [intent, setIntent] = useState(initialEntry?.intent || INTENTS[0]);
  const [action, setAction] = useState(initialEntry?.action || ACTIONS[0]);
  const [provider, setProvider] = useState(initialEntry?.provider || "");
  const [fieldValues, setFieldValues] = useState<Record<string, string>>({});
  const [isExecuting, setIsExecuting] = useState(false);
  const [result, setResult] = useState<any>(null);

  // Available providers for selected intent+action
  const availableProviders = useMemo(() => {
    return entriesForIntentAction(intent, action).map(e => e.provider);
  }, [intent, action]);

  // Auto-select first provider when intent/action changes
  const effectiveProvider = availableProviders.includes(provider) ? provider : availableProviders[0] || "";

  const entry = useMemo(() => lookupEntry(intent, action, effectiveProvider), [intent, action, effectiveProvider]);
  const fields = useMemo(() => entry ? getUserFields(entry) : [], [entry]);

  const isLive = entry?.execution.type === "rest-proxy";

  // Reset field values when entry changes
  const handleIntentChange = (v: string) => {
    setIntent(v);
    setFieldValues({});
    setResult(null);
  };
  const handleActionChange = (v: string) => {
    setAction(v);
    setFieldValues({});
    setResult(null);
  };
  const handleProviderChange = (v: string) => {
    setProvider(v);
    setFieldValues({});
    setResult(null);
  };

  const handleExecute = async () => {
    if (!entry) return;
    setIsExecuting(true);
    setResult(null);
    try {
      const spec: Record<string, unknown> = { ...fieldValues, provider: effectiveProvider };
      // Apply defaults for empty fields
      for (const f of fields) {
        if (f.defaultValue !== undefined && !spec[f.key]) {
          spec[f.key] = f.defaultValue;
        }
      }

      const { data, error } = await invokeFunction("uidi-engine", {
        body: { intent, action, spec, metadata: { source: "intent-console" } },
      });
      if (error) throw new Error(error.message);
      setResult(data);
      toast({ title: "Execution Complete", description: `${intent}/${action}/${effectiveProvider}` });
    } catch (e: any) {
      setResult({ error: e.message });
      toast({ title: "Execution Failed", description: e.message, variant: "destructive" });
    } finally {
      setIsExecuting(false);
    }
  };

  const missingRequired = fields.filter(f => f.required && !f.injected && !fieldValues[f.key] && f.defaultValue === undefined);

  return (
    <div className="space-y-6">
      {/* Selectors */}
      <div className="grid grid-cols-3 gap-3">
        <div className="space-y-1.5">
          <Label className="text-[10px] uppercase tracking-widest text-muted-foreground font-semibold">Intent</Label>
          <Select value={intent} onValueChange={handleIntentChange}>
            <SelectTrigger className="font-mono text-xs h-9">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {INTENTS.map(i => (
                <SelectItem key={i} value={i} className="font-mono text-xs">
                  {INTENT_META[i]?.icon} {INTENT_META[i]?.label || i}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div className="space-y-1.5">
          <Label className="text-[10px] uppercase tracking-widest text-muted-foreground font-semibold">Action</Label>
          <Select value={action} onValueChange={handleActionChange}>
            <SelectTrigger className="font-mono text-xs h-9">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {ACTIONS.map(a => (
                <SelectItem key={a} value={a} className="font-mono text-xs">
                  {ACTION_META[a]?.label || a}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div className="space-y-1.5">
          <Label className="text-[10px] uppercase tracking-widest text-muted-foreground font-semibold">Provider</Label>
          <Select value={effectiveProvider} onValueChange={handleProviderChange}>
            <SelectTrigger className="font-mono text-xs h-9">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {availableProviders.map(p => (
                <SelectItem key={p} value={p} className="font-mono text-xs">
                  {PROVIDER_META[p]?.label || p}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      </div>

      {/* No entry state */}
      {!entry && availableProviders.length === 0 && (
        <div className="text-center py-8 text-muted-foreground text-sm font-mono">
          No manifest entry for {intent}/{action}
        </div>
      )}

      {/* Dynamic fields */}
      {entry && fields.length > 0 && (
        <Card className="border-border/40 bg-card/50">
          <CardContent className="pt-4 space-y-3">
            <div className="flex items-center justify-between mb-2">
              <span className="text-[10px] uppercase tracking-widest text-muted-foreground font-semibold">Parameters</span>
              <Badge variant={isLive ? "default" : "secondary"} className="text-[9px] font-mono">
                {isLive ? "🟢 rest-proxy" : `🟡 ${entry.execution.type}`}
              </Badge>
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              {fields.map(field => (
                <div key={field.key} className="space-y-1">
                  <Label className="text-[10px] font-mono flex items-center gap-1.5">
                    <span className={cn(field.required && !field.injected ? "text-foreground" : "text-muted-foreground")}>
                      {field.key}
                    </span>
                    {field.required && !field.injected && (
                      <span className="text-[hsl(var(--destructive))]">*</span>
                    )}
                    {field.injected && (
                      <Lock className="h-2.5 w-2.5 text-[hsl(var(--warning))]" />
                    )}
                  </Label>
                  {field.injected ? (
                    <div className="h-9 flex items-center px-3 rounded-md border border-border/40 bg-muted/30 text-xs font-mono text-muted-foreground">
                      {JSON.stringify(entry.enforcement.inject[field.key])}
                      <Badge variant="outline" className="ml-auto text-[8px]">injected</Badge>
                    </div>
                  ) : (
                    <Input
                      className="h-9 font-mono text-xs"
                      placeholder={field.defaultValue !== undefined ? `default: ${field.defaultValue}` : field.key}
                      value={fieldValues[field.key] || ""}
                      onChange={e => setFieldValues(prev => ({ ...prev, [field.key]: e.target.value }))}
                    />
                  )}
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      )}

      {/* Execute button */}
      {entry && (
        <div className="flex items-center gap-3">
          <Button
            onClick={handleExecute}
            disabled={isExecuting || missingRequired.length > 0}
            className="font-mono text-xs gap-2"
            variant={isLive ? "default" : "secondary"}
          >
            {isExecuting ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Play className="h-3.5 w-3.5" />}
            {isLive ? "Execute" : "Submit (202)"}
          </Button>
          {missingRequired.length > 0 && (
            <span className="text-[10px] text-[hsl(var(--destructive))] font-mono flex items-center gap-1">
              <AlertTriangle className="h-3 w-3" />
              Missing: {missingRequired.map(f => f.key).join(", ")}
            </span>
          )}
        </div>
      )}

      {/* Result */}
      {result && (
        <Card className="border-border/40 bg-card/50 overflow-hidden">
          <CardContent className="p-0">
            <div className={cn(
              "flex items-center gap-2 px-4 py-2 text-[10px] font-mono uppercase tracking-widest",
              result.error ? "bg-[hsl(var(--destructive))]/10 text-[hsl(var(--destructive))]" : "bg-[hsl(var(--success))]/10 text-[hsl(var(--success))]",
            )}>
              {result.error ? <AlertTriangle className="h-3 w-3" /> : <CheckCircle2 className="h-3 w-3" />}
              {result.error ? "Error" : "Response"}
            </div>
            <pre className="p-4 text-xs font-mono overflow-auto max-h-80 text-foreground/90">
              {JSON.stringify(result, null, 2)}
            </pre>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
