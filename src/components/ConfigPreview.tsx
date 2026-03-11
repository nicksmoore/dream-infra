import { Ec2Config } from "@/lib/intent-types";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Server, DollarSign, MapPin, Monitor } from "lucide-react";

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
      <CardContent>
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
            <p className="text-xs text-muted-foreground uppercase tracking-wider">Est. Monthly Cost</p>
            <p className="text-sm font-semibold flex items-center gap-1 text-accent-foreground">
              <DollarSign className="h-3 w-3" /> {config.estimatedCost}
            </p>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}
