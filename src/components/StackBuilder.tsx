import { useState } from "react";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  TerraformStack,
  TerraformResource,
  TerraformResourceType,
  RESOURCE_TEMPLATES,
  RESOURCE_CATEGORIES,
  STACK_PRESETS,
  generateStackHcl,
} from "@/lib/terraform-mcp";
import { REGION_OPTIONS, ENV_OPTIONS, AwsRegion, Environment } from "@/lib/intent-types";
import { Plus, Trash2, Layers, FileCode, Package, Copy, Network, Server, Shield, Database, Container } from "lucide-react";

interface StackBuilderProps {
  stack: TerraformStack;
  onUpdate: (stack: TerraformStack) => void;
}

const categoryIcons: Record<string, React.ElementType> = {
  Networking: Network,
  Compute: Server,
  Kubernetes: Container,
  Security: Shield,
  "Storage & DB": Database,
};

export function StackBuilder({ stack, onUpdate }: StackBuilderProps) {
  const [activeTab, setActiveTab] = useState("resources");

  const addResource = (type: TerraformResourceType) => {
    const template = RESOURCE_TEMPLATES[type];
    const existing = stack.resources.filter(r => r.type === type).length;
    const newResource: TerraformResource = {
      id: crypto.randomUUID(),
      type,
      name: `${type}_${existing + 1}`,
      config: { ...template.defaultConfig },
    };
    onUpdate({ ...stack, resources: [...stack.resources, newResource] });
  };

  const removeResource = (id: string) => {
    onUpdate({
      ...stack,
      resources: stack.resources.filter(r => r.id !== id).map(r => ({
        ...r,
        dependsOn: r.dependsOn?.filter(d => d !== id),
      })),
    });
  };

  const updateResource = (id: string, updates: Partial<TerraformResource>) => {
    onUpdate({
      ...stack,
      resources: stack.resources.map(r => r.id === id ? { ...r, ...updates } : r),
    });
  };

  const loadPreset = (presetId: string) => {
    const preset = STACK_PRESETS.find(p => p.id === presetId);
    if (!preset) return;
    const resources: TerraformResource[] = preset.resources.map(r => ({
      ...r,
      id: crypto.randomUUID(),
      dependsOn: r.dependsOn,
    }));
    onUpdate({ ...stack, name: preset.name, resources });
  };

  const hcl = generateStackHcl(stack);

  return (
    <Card className="bg-card">
      <CardHeader className="pb-3">
        <div className="flex items-center justify-between">
          <div>
            <CardTitle className="text-base flex items-center gap-2">
              <Layers className="h-4 w-4 text-primary" />
              Terraform Stack Builder
            </CardTitle>
            <CardDescription>
              {stack.resources.length} resources · {stack.environment} · {stack.region}
            </CardDescription>
          </div>
          <Badge variant={stack.status === "applied" ? "default" : stack.status === "failed" ? "destructive" : "secondary"} className="capitalize">
            {stack.status}
          </Badge>
        </div>
      </CardHeader>
      <CardContent className="space-y-4">
        {/* Stack metadata */}
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
          <div className="space-y-1">
            <Label className="text-xs text-muted-foreground uppercase tracking-wider">Stack Name</Label>
            <Input
              value={stack.name}
              onChange={e => onUpdate({ ...stack, name: e.target.value })}
              placeholder="my-stack"
              className="font-mono text-sm"
            />
          </div>
          <div className="space-y-1">
            <Label className="text-xs text-muted-foreground uppercase tracking-wider">Environment</Label>
            <Select value={stack.environment} onValueChange={v => onUpdate({ ...stack, environment: v as Environment })}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                {ENV_OPTIONS.map(o => <SelectItem key={o.value} value={o.value}>{o.label}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1">
            <Label className="text-xs text-muted-foreground uppercase tracking-wider">Region</Label>
            <Select value={stack.region} onValueChange={v => onUpdate({ ...stack, region: v as AwsRegion })}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                {REGION_OPTIONS.map(o => <SelectItem key={o.value} value={o.value}>{o.label}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
        </div>

        {/* Presets */}
        <div className="space-y-2">
          <Label className="text-xs text-muted-foreground uppercase tracking-wider">Quick Start Presets</Label>
          <div className="flex flex-wrap gap-2">
            {STACK_PRESETS.map(p => (
              <Button key={p.id} variant="outline" size="sm" onClick={() => loadPreset(p.id)}>
                <Package className="h-3 w-3 mr-1" /> {p.name}
              </Button>
            ))}
          </div>
        </div>

        <Tabs value={activeTab} onValueChange={setActiveTab}>
          <TabsList className="w-full">
            <TabsTrigger value="resources" className="flex-1">Resources ({stack.resources.length})</TabsTrigger>
            <TabsTrigger value="add" className="flex-1">Add Resource</TabsTrigger>
            <TabsTrigger value="hcl" className="flex-1">HCL Preview</TabsTrigger>
          </TabsList>

          <TabsContent value="resources" className="space-y-2 mt-4">
            {stack.resources.length === 0 ? (
              <div className="text-center py-8 text-muted-foreground">
                <Layers className="h-8 w-8 mx-auto mb-2 opacity-50" />
                <p className="text-sm">No resources yet. Add resources or pick a preset above.</p>
              </div>
            ) : (
              stack.resources.map(resource => {
                const template = RESOURCE_TEMPLATES[resource.type];
                return (
                  <Card key={resource.id} className="bg-muted/30">
                    <CardContent className="py-3 px-4">
                      <div className="flex items-center justify-between gap-2">
                        <div className="flex items-center gap-3 min-w-0">
                          <Badge variant="outline" className="shrink-0 text-xs">{template.category}</Badge>
                          <div className="min-w-0">
                            <div className="flex items-center gap-2">
                              <p className="text-sm font-semibold">{template.label}</p>
                              <Input
                                value={resource.name}
                                onChange={e => updateResource(resource.id, { name: e.target.value })}
                                className="h-6 text-xs font-mono w-32 px-1"
                              />
                            </div>
                            <p className="text-xs text-muted-foreground truncate">
                              {Object.entries(resource.config)
                                .filter(([, v]) => v !== undefined && v !== null && v !== "")
                                .slice(0, 3)
                                .map(([k, v]) => `${k}: ${typeof v === "object" ? "..." : v}`)
                                .join(" · ")}
                            </p>
                          </div>
                        </div>
                        <Button variant="ghost" size="icon" className="h-7 w-7 shrink-0" onClick={() => removeResource(resource.id)}>
                          <Trash2 className="h-3 w-3 text-destructive" />
                        </Button>
                      </div>
                    </CardContent>
                  </Card>
                );
              })
            )}
          </TabsContent>

          <TabsContent value="add" className="mt-4">
            <div className="space-y-4">
              {RESOURCE_CATEGORIES.map(cat => {
                const Icon = categoryIcons[cat.label] ?? Layers;
                return (
                  <div key={cat.key} className="space-y-2">
                    <div className="flex items-center gap-2">
                      <Icon className="h-4 w-4 text-primary" />
                      <span className="text-sm font-semibold">{cat.label}</span>
                    </div>
                    <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
                      {cat.types.map(type => {
                        const template = RESOURCE_TEMPLATES[type];
                        return (
                          <Button key={type} variant="outline" size="sm" className="justify-start" onClick={() => addResource(type)}>
                            <Plus className="h-3 w-3 mr-1" /> {template.label}
                          </Button>
                        );
                      })}
                    </div>
                  </div>
                );
              })}
            </div>
          </TabsContent>

          <TabsContent value="hcl" className="mt-4">
            <div className="relative">
              <pre className="bg-muted rounded-lg p-4 text-xs font-mono overflow-x-auto max-h-[400px] overflow-y-auto leading-relaxed">
                {hcl || "# Add resources to generate HCL"}
              </pre>
              <Button
                variant="ghost"
                size="icon"
                className="absolute top-2 right-2 h-7 w-7"
                onClick={() => navigator.clipboard.writeText(hcl)}
              >
                <Copy className="h-3 w-3" />
              </Button>
            </div>
          </TabsContent>
        </Tabs>
      </CardContent>
    </Card>
  );
}
