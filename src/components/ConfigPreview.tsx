import { Ec2Config } from "@/lib/intent-types";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Server, DollarSign, MapPin, Monitor, HardDrive, Shield, Network } from "lucide-react";

interface ConfigPreviewProps {
  config: Ec2Config;
}

export function ConfigPreview({ config }: ConfigPreviewProps) {
  return (
    <Card className="border-primary/20 bg-card">
      <CardHeader className="pb-3">
        <CardTitle className="text-base flex items-center gap-2">
          <Server className="h-4 w-4 text-primary" />
          Resolved EC2 Configuration
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        {/* Core */}
        <div className="grid grid-cols-2 sm:grid-cols-3 gap-4">
          <div className="space-y-1">
            <p className="text-xs text-muted-foreground uppercase tracking-wider">Instance Type</p>
            <Badge variant="secondary" className="font-mono text-sm">{config.instanceType}</Badge>
          </div>
          <div className="space-y-1">
            <p className="text-xs text-muted-foreground uppercase tracking-wider">AMI</p>
            <p className="text-sm font-medium flex items-center gap-1">
              <Monitor className="h-3 w-3" /> {config.amiDescription}
            </p>
          </div>
          <div className="space-y-1">
            <p className="text-xs text-muted-foreground uppercase tracking-wider">Region</p>
            <p className="text-sm font-medium flex items-center gap-1">
              <MapPin className="h-3 w-3" /> {config.region}
            </p>
          </div>
          <div className="space-y-1">
            <p className="text-xs text-muted-foreground uppercase tracking-wider">Environment</p>
            <Badge
              variant={config.environment === "prod" ? "destructive" : "secondary"}
              className="capitalize"
            >
              {config.environment}
            </Badge>
          </div>
          <div className="space-y-1">
            <p className="text-xs text-muted-foreground uppercase tracking-wider">Count</p>
            <p className="text-sm font-semibold">{config.instanceCount ?? 1}</p>
          </div>
          <div className="space-y-1">
            <p className="text-xs text-muted-foreground uppercase tracking-wider">Purchase</p>
            <Badge variant="outline" className="capitalize">{config.purchaseOption ?? "on-demand"}</Badge>
          </div>
        </div>

        {/* Storage & Networking summary */}
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-4 pt-2 border-t border-border">
          <div className="space-y-1">
            <p className="text-xs text-muted-foreground uppercase tracking-wider flex items-center gap-1">
              <HardDrive className="h-3 w-3" /> Root Volume
            </p>
            <p className="text-sm font-mono">
              {config.rootVolumeSize ?? 20} GiB {config.rootVolumeType ?? "gp3"}
            </p>
          </div>
          <div className="space-y-1">
            <p className="text-xs text-muted-foreground uppercase tracking-wider flex items-center gap-1">
              <Network className="h-3 w-3" /> Public IP
            </p>
            <p className="text-sm">{config.associatePublicIp ? "Yes" : "No"}</p>
          </div>
          <div className="space-y-1">
            <p className="text-xs text-muted-foreground uppercase tracking-wider flex items-center gap-1">
              <Shield className="h-3 w-3" /> IMDSv2
            </p>
            <p className="text-sm">{config.httpTokens === "required" ? "Required" : "Optional"}</p>
          </div>
          <div className="space-y-1">
            <p className="text-xs text-muted-foreground uppercase tracking-wider">EBS Encrypted</p>
            <p className="text-sm">{config.rootVolumeEncrypted ? "Yes" : "No"}</p>
          </div>
        </div>

        {/* Extra details if set */}
        {(config.keyName || config.iamInstanceProfile || config.subnetId || config.securityGroupIds?.length) && (
          <div className="grid grid-cols-2 sm:grid-cols-3 gap-4 pt-2 border-t border-border">
            {config.keyName && (
              <div className="space-y-1">
                <p className="text-xs text-muted-foreground uppercase tracking-wider">Key Pair</p>
                <p className="text-sm font-mono">{config.keyName}</p>
              </div>
            )}
            {config.subnetId && (
              <div className="space-y-1">
                <p className="text-xs text-muted-foreground uppercase tracking-wider">Subnet</p>
                <p className="text-sm font-mono truncate">{config.subnetId}</p>
              </div>
            )}
            {config.securityGroupIds && config.securityGroupIds.length > 0 && (
              <div className="space-y-1">
                <p className="text-xs text-muted-foreground uppercase tracking-wider">Security Groups</p>
                <div className="flex flex-wrap gap-1">
                  {config.securityGroupIds.map(sg => (
                    <Badge key={sg} variant="outline" className="font-mono text-xs">{sg}</Badge>
                  ))}
                </div>
              </div>
            )}
            {config.iamInstanceProfile && (
              <div className="space-y-1 col-span-2">
                <p className="text-xs text-muted-foreground uppercase tracking-wider">IAM Profile</p>
                <p className="text-sm font-mono truncate">{config.iamInstanceProfile}</p>
              </div>
            )}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
