import {
  ParsedIntent,
  WORKLOAD_OPTIONS,
  COST_OPTIONS,
  ENV_OPTIONS,
  REGION_OPTIONS,
  OS_OPTIONS,
  WorkloadType,
  CostSensitivity,
  Environment,
  AwsRegion,
  OsType,
} from "@/lib/intent-types";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Label } from "@/components/ui/label";
import { Settings2 } from "lucide-react";

interface IntentFormProps {
  intent: ParsedIntent;
  onChange: (intent: ParsedIntent) => void;
}

export function IntentForm({ intent, onChange }: IntentFormProps) {
  return (
    <div className="space-y-4">
      <div className="flex items-center gap-2">
        <Settings2 className="h-5 w-5 text-muted-foreground" />
        <h2 className="text-lg font-semibold">Parsed Configuration</h2>
      </div>
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
        <div className="space-y-2">
          <Label className="text-xs text-muted-foreground uppercase tracking-wider">Workload Type</Label>
          <Select value={intent.workloadType} onValueChange={(v) => onChange({ ...intent, workloadType: v as WorkloadType })}>
            <SelectTrigger><SelectValue /></SelectTrigger>
            <SelectContent>
              {WORKLOAD_OPTIONS.map((o) => <SelectItem key={o.value} value={o.value}>{o.label}</SelectItem>)}
            </SelectContent>
          </Select>
        </div>
        <div className="space-y-2">
          <Label className="text-xs text-muted-foreground uppercase tracking-wider">Cost Sensitivity</Label>
          <Select value={intent.costSensitivity} onValueChange={(v) => onChange({ ...intent, costSensitivity: v as CostSensitivity })}>
            <SelectTrigger><SelectValue /></SelectTrigger>
            <SelectContent>
              {COST_OPTIONS.map((o) => <SelectItem key={o.value} value={o.value}>{o.label}</SelectItem>)}
            </SelectContent>
          </Select>
        </div>
        <div className="space-y-2">
          <Label className="text-xs text-muted-foreground uppercase tracking-wider">Environment</Label>
          <Select value={intent.environment} onValueChange={(v) => onChange({ ...intent, environment: v as Environment })}>
            <SelectTrigger><SelectValue /></SelectTrigger>
            <SelectContent>
              {ENV_OPTIONS.map((o) => <SelectItem key={o.value} value={o.value}>{o.label}</SelectItem>)}
            </SelectContent>
          </Select>
        </div>
        <div className="space-y-2">
          <Label className="text-xs text-muted-foreground uppercase tracking-wider">Region</Label>
          <Select value={intent.region} onValueChange={(v) => onChange({ ...intent, region: v as AwsRegion })}>
            <SelectTrigger><SelectValue /></SelectTrigger>
            <SelectContent>
              {REGION_OPTIONS.map((o) => <SelectItem key={o.value} value={o.value}>{o.label}</SelectItem>)}
            </SelectContent>
          </Select>
        </div>
        <div className="space-y-2">
          <Label className="text-xs text-muted-foreground uppercase tracking-wider">Operating System</Label>
          <Select value={intent.os} onValueChange={(v) => onChange({ ...intent, os: v as OsType })}>
            <SelectTrigger><SelectValue /></SelectTrigger>
            <SelectContent>
              {OS_OPTIONS.map((o) => <SelectItem key={o.value} value={o.value}>{o.label}</SelectItem>)}
            </SelectContent>
          </Select>
        </div>
      </div>
    </div>
  );
}
