import {
  Ec2Config,
  EBS_VOLUME_TYPE_OPTIONS,
  TENANCY_OPTIONS,
  PURCHASE_OPTIONS,
  SHUTDOWN_BEHAVIOR_OPTIONS,
  HTTP_TOKENS_OPTIONS,
  CREDIT_SPEC_OPTIONS,
  INSTANCE_TYPE_CATALOG,
  getInstanceTypesForWorkload,
  EbsVolumeType,
  Tenancy,
  PurchaseOption,
  ShutdownBehavior,
  HttpTokens,
  CreditSpecification,
  WorkloadType,
} from "@/lib/intent-types";
import { Select, SelectContent, SelectGroup, SelectItem, SelectLabel, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { ChevronDown, Server, Network, HardDrive, Shield, Wrench } from "lucide-react";
import { useState } from "react";

interface AdvancedConfigFormProps {
  config: Ec2Config;
  workloadType: WorkloadType;
  onChange: (config: Ec2Config) => void;
}

function SectionHeader({ icon: Icon, title, open }: { icon: React.ElementType; title: string; open: boolean }) {
  return (
    <div className="flex items-center justify-between w-full py-2">
      <div className="flex items-center gap-2">
        <Icon className="h-4 w-4 text-primary" />
        <span className="text-sm font-semibold">{title}</span>
      </div>
      <ChevronDown className={`h-4 w-4 text-muted-foreground transition-transform ${open ? "rotate-180" : ""}`} />
    </div>
  );
}

export function AdvancedConfigForm({ config, workloadType, onChange }: AdvancedConfigFormProps) {
  const [openSections, setOpenSections] = useState<Record<string, boolean>>({});
  const toggle = (key: string) => setOpenSections(prev => ({ ...prev, [key]: !prev[key] }));

  const update = (partial: Partial<Ec2Config>) => onChange({ ...config, ...partial });

  const filteredFamilies = getInstanceTypesForWorkload(workloadType);
  const allFamilies = INSTANCE_TYPE_CATALOG;

  return (
    <div className="space-y-2">
      {/* Instance Type */}
      <Collapsible open={openSections.instance} onOpenChange={() => toggle("instance")}>
        <CollapsibleTrigger className="w-full border-b border-border">
          <SectionHeader icon={Server} title="Instance Type" open={!!openSections.instance} />
        </CollapsibleTrigger>
        <CollapsibleContent className="pt-4 pb-2">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div className="space-y-2 sm:col-span-2">
              <Label className="text-xs text-muted-foreground uppercase tracking-wider">Instance Type</Label>
              <Select value={config.instanceType} onValueChange={(v) => update({ instanceType: v })}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent className="max-h-[300px]">
                  {filteredFamilies.length > 0 && (
                    <SelectGroup>
                      <SelectLabel className="text-xs text-primary">Recommended for {workloadType}</SelectLabel>
                      {filteredFamilies.map(g => g.types.map(t => (
                        <SelectItem key={t} value={t} className="font-mono text-xs">{t} — {g.category}</SelectItem>
                      )))}
                    </SelectGroup>
                  )}
                  <SelectGroup>
                    <SelectLabel className="text-xs">All Instance Types</SelectLabel>
                    {allFamilies.map(g => g.types.map(t => (
                      <SelectItem key={`all-${t}`} value={t} className="font-mono text-xs">{t} — {g.category}</SelectItem>
                    )))}
                  </SelectGroup>
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label className="text-xs text-muted-foreground uppercase tracking-wider">Instance Count</Label>
              <Input
                type="number"
                min={1}
                max={50}
                value={config.instanceCount ?? 1}
                onChange={(e) => update({ instanceCount: parseInt(e.target.value) || 1 })}
              />
            </div>
            <div className="space-y-2">
              <Label className="text-xs text-muted-foreground uppercase tracking-wider">Purchase Option</Label>
              <Select value={config.purchaseOption ?? "on-demand"} onValueChange={(v) => update({ purchaseOption: v as PurchaseOption })}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  {PURCHASE_OPTIONS.map(o => <SelectItem key={o.value} value={o.value}>{o.label}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            {config.purchaseOption === "spot" && (
              <div className="space-y-2">
                <Label className="text-xs text-muted-foreground uppercase tracking-wider">Max Spot Price ($/hr)</Label>
                <Input
                  type="text"
                  placeholder="e.g. 0.05 (blank = market)"
                  value={config.spotMaxPrice ?? ""}
                  onChange={(e) => update({ spotMaxPrice: e.target.value || undefined })}
                />
              </div>
            )}
          </div>
        </CollapsibleContent>
      </Collapsible>

      {/* Networking */}
      <Collapsible open={openSections.network} onOpenChange={() => toggle("network")}>
        <CollapsibleTrigger className="w-full border-b border-border">
          <SectionHeader icon={Network} title="Networking" open={!!openSections.network} />
        </CollapsibleTrigger>
        <CollapsibleContent className="pt-4 pb-2">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label className="text-xs text-muted-foreground uppercase tracking-wider">Subnet ID</Label>
              <Input
                placeholder="subnet-xxxxxxxx"
                value={config.subnetId ?? ""}
                onChange={(e) => update({ subnetId: e.target.value || undefined })}
                className="font-mono text-xs"
              />
            </div>
            <div className="space-y-2">
              <Label className="text-xs text-muted-foreground uppercase tracking-wider">Security Group IDs</Label>
              <Input
                placeholder="sg-xxx, sg-yyy"
                value={config.securityGroupIds?.join(", ") ?? ""}
                onChange={(e) => update({ securityGroupIds: e.target.value ? e.target.value.split(",").map(s => s.trim()) : undefined })}
                className="font-mono text-xs"
              />
            </div>
            <div className="space-y-2">
              <Label className="text-xs text-muted-foreground uppercase tracking-wider">Private IP Address</Label>
              <Input
                placeholder="10.0.1.x"
                value={config.privateIpAddress ?? ""}
                onChange={(e) => update({ privateIpAddress: e.target.value || undefined })}
                className="font-mono text-xs"
              />
            </div>
            <div className="flex items-center gap-3 pt-6">
              <Switch
                checked={config.associatePublicIp ?? false}
                onCheckedChange={(v) => update({ associatePublicIp: v })}
              />
              <Label className="text-sm">Auto-assign Public IP</Label>
            </div>
          </div>
        </CollapsibleContent>
      </Collapsible>

      {/* Storage */}
      <Collapsible open={openSections.storage} onOpenChange={() => toggle("storage")}>
        <CollapsibleTrigger className="w-full border-b border-border">
          <SectionHeader icon={HardDrive} title="Storage (EBS)" open={!!openSections.storage} />
        </CollapsibleTrigger>
        <CollapsibleContent className="pt-4 pb-2">
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
            <div className="space-y-2">
              <Label className="text-xs text-muted-foreground uppercase tracking-wider">Root Volume Size (GiB)</Label>
              <Input
                type="number"
                min={8}
                max={16384}
                value={config.rootVolumeSize ?? 20}
                onChange={(e) => update({ rootVolumeSize: parseInt(e.target.value) || 20 })}
              />
            </div>
            <div className="space-y-2">
              <Label className="text-xs text-muted-foreground uppercase tracking-wider">Volume Type</Label>
              <Select value={config.rootVolumeType ?? "gp3"} onValueChange={(v) => update({ rootVolumeType: v as EbsVolumeType })}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  {EBS_VOLUME_TYPE_OPTIONS.map(o => (
                    <SelectItem key={o.value} value={o.value}>
                      <span className="font-mono">{o.label}</span>
                      <span className="text-xs text-muted-foreground ml-2">— {o.description}</span>
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            {(config.rootVolumeType === "io1" || config.rootVolumeType === "io2" || config.rootVolumeType === "gp3") && (
              <div className="space-y-2">
                <Label className="text-xs text-muted-foreground uppercase tracking-wider">IOPS</Label>
                <Input
                  type="number"
                  min={3000}
                  max={64000}
                  placeholder={config.rootVolumeType === "gp3" ? "3000 (default)" : ""}
                  value={config.rootVolumeIops ?? ""}
                  onChange={(e) => update({ rootVolumeIops: parseInt(e.target.value) || undefined })}
                />
              </div>
            )}
            {config.rootVolumeType === "gp3" && (
              <div className="space-y-2">
                <Label className="text-xs text-muted-foreground uppercase tracking-wider">Throughput (MiB/s)</Label>
                <Input
                  type="number"
                  min={125}
                  max={1000}
                  placeholder="125 (default)"
                  value={config.rootVolumeThroughput ?? ""}
                  onChange={(e) => update({ rootVolumeThroughput: parseInt(e.target.value) || undefined })}
                />
              </div>
            )}
            <div className="flex items-center gap-3 pt-6">
              <Switch
                checked={config.rootVolumeEncrypted ?? true}
                onCheckedChange={(v) => update({ rootVolumeEncrypted: v })}
              />
              <Label className="text-sm">Encrypt Volume</Label>
            </div>
            <div className="flex items-center gap-3 pt-6">
              <Switch
                checked={config.deleteOnTermination ?? true}
                onCheckedChange={(v) => update({ deleteOnTermination: v })}
              />
              <Label className="text-sm">Delete on Termination</Label>
            </div>
          </div>
        </CollapsibleContent>
      </Collapsible>

      {/* Security */}
      <Collapsible open={openSections.security} onOpenChange={() => toggle("security")}>
        <CollapsibleTrigger className="w-full border-b border-border">
          <SectionHeader icon={Shield} title="Security & IAM" open={!!openSections.security} />
        </CollapsibleTrigger>
        <CollapsibleContent className="pt-4 pb-2">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label className="text-xs text-muted-foreground uppercase tracking-wider">Key Pair Name</Label>
              <Input
                placeholder="my-key-pair"
                value={config.keyName ?? ""}
                onChange={(e) => update({ keyName: e.target.value || undefined })}
              />
            </div>
            <div className="space-y-2">
              <Label className="text-xs text-muted-foreground uppercase tracking-wider">IAM Instance Profile</Label>
              <Input
                placeholder="arn:aws:iam::xxx:instance-profile/name"
                value={config.iamInstanceProfile ?? ""}
                onChange={(e) => update({ iamInstanceProfile: e.target.value || undefined })}
                className="font-mono text-xs"
              />
            </div>
            <div className="space-y-2">
              <Label className="text-xs text-muted-foreground uppercase tracking-wider">Metadata (IMDSv2)</Label>
              <Select value={config.httpTokens ?? "required"} onValueChange={(v) => update({ httpTokens: v as HttpTokens })}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  {HTTP_TOKENS_OPTIONS.map(o => <SelectItem key={o.value} value={o.value}>{o.label}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <div className="flex items-center gap-3 pt-6">
              <Switch
                checked={config.terminationProtection ?? false}
                onCheckedChange={(v) => update({ terminationProtection: v })}
              />
              <Label className="text-sm">Termination Protection</Label>
            </div>
          </div>
        </CollapsibleContent>
      </Collapsible>

      {/* Advanced */}
      <Collapsible open={openSections.advanced} onOpenChange={() => toggle("advanced")}>
        <CollapsibleTrigger className="w-full border-b border-border">
          <SectionHeader icon={Wrench} title="Advanced Options" open={!!openSections.advanced} />
        </CollapsibleTrigger>
        <CollapsibleContent className="pt-4 pb-2">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label className="text-xs text-muted-foreground uppercase tracking-wider">Tenancy</Label>
              <Select value={config.tenancy ?? "default"} onValueChange={(v) => update({ tenancy: v as Tenancy })}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  {TENANCY_OPTIONS.map(o => <SelectItem key={o.value} value={o.value}>{o.label}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label className="text-xs text-muted-foreground uppercase tracking-wider">Shutdown Behavior</Label>
              <Select value={config.shutdownBehavior ?? "stop"} onValueChange={(v) => update({ shutdownBehavior: v as ShutdownBehavior })}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  {SHUTDOWN_BEHAVIOR_OPTIONS.map(o => <SelectItem key={o.value} value={o.value}>{o.label}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label className="text-xs text-muted-foreground uppercase tracking-wider">Credit Specification</Label>
              <Select value={config.creditSpecification ?? "standard"} onValueChange={(v) => update({ creditSpecification: v as CreditSpecification })}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  {CREDIT_SPEC_OPTIONS.map(o => <SelectItem key={o.value} value={o.value}>{o.label}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label className="text-xs text-muted-foreground uppercase tracking-wider">Placement Group</Label>
              <Input
                placeholder="my-placement-group"
                value={config.placementGroupName ?? ""}
                onChange={(e) => update({ placementGroupName: e.target.value || undefined })}
              />
            </div>
            <div className="flex items-center gap-3 pt-6">
              <Switch
                checked={config.detailedMonitoring ?? false}
                onCheckedChange={(v) => update({ detailedMonitoring: v })}
              />
              <Label className="text-sm">Detailed Monitoring</Label>
            </div>
            <div className="flex items-center gap-3 pt-6">
              <Switch
                checked={config.ebsOptimized ?? true}
                onCheckedChange={(v) => update({ ebsOptimized: v })}
              />
              <Label className="text-sm">EBS Optimized</Label>
            </div>
            <div className="space-y-2 sm:col-span-2">
              <Label className="text-xs text-muted-foreground uppercase tracking-wider">User Data (startup script)</Label>
              <Textarea
                placeholder="#!/bin/bash&#10;yum update -y"
                value={config.userData ?? ""}
                onChange={(e) => update({ userData: e.target.value || undefined })}
                className="font-mono text-xs min-h-[100px]"
              />
            </div>
          </div>
        </CollapsibleContent>
      </Collapsible>
    </div>
  );
}
