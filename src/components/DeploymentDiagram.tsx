import { useEffect, useRef, useState } from "react";
import mermaid from "mermaid";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { GitBranch } from "lucide-react";

mermaid.initialize({
  startOnLoad: false,
  theme: "dark",
  themeVariables: {
    primaryColor: "#38bdf8",
    primaryTextColor: "#f1f5f9",
    primaryBorderColor: "#1e293b",
    lineColor: "#475569",
    secondaryColor: "#1e293b",
    tertiaryColor: "#0f172a",
    fontFamily: "ui-monospace, monospace",
    fontSize: "12px",
  },
});

interface DeploymentDiagramProps {
  workloadType: string;
  steps: Array<{ id: string; name: string; status: string }>;
}

const PATTERN_DIAGRAMS: Record<string, string> = {
  "global-spa": `graph TD
    A[S3 Bucket] --> B[CloudFront OAC]
    A --> C[Upload index.html]
    B --> D[CloudFront Distribution]
    D --> E[S3 Bucket Policy]
    C --> F[Cache Invalidation]
    D --> F
    E --> G{Custom Domain?}
    G -->|Yes| H[ACM Certificate]
    H --> I[Route53 Record]
    G -->|No| J[CF Default Domain]
    F --> K[Validate: HTTP 200]
    K --> L[Trivy: Scan Config]
    L --> M[Deploy Complete]`,

  "service-mesh": `graph TD
    A[App Mesh] --> B{EKS Required?}
    B -->|Yes| C[EKS Cluster]
    C --> D[Wait Cluster Active]
    D --> E[Virtual Node]
    B -->|No| E
    E --> F[Validate: Mesh Health]
    F --> G[Trivy: Scan Cluster]
    G --> H[Deploy Complete]`,

  "event-pipeline": `graph TD
    A[SQS Dead Letter Queue] --> B[Get DLQ Attributes]
    B --> C[SQS Main Queue]
    C --> D{Lambda Config?}
    D -->|Yes| E[Lambda Function]
    E --> F[Event Source Mapping]
    D -->|No| G[Validate: Queue Ready]
    F --> G
    G --> H[Trivy: Scan Functions]
    H --> I[Deploy Complete]`,

  "internal-api": `graph TD
    A[API Gateway HTTP] --> B{Lambda Config?}
    B -->|Yes| C[Authorizer Lambda]
    C --> D[Concurrency Config]
    B -->|No| E{Subnets Available?}
    D --> E
    E -->|Yes| F[RDS Subnet Group]
    F --> G[Aurora Cluster]
    G --> H{RDS Proxy?}
    H -->|Yes| I[RDS Proxy]
    E -->|No| J[Validate: API Health]
    I --> J
    H -->|No| J
    J --> K[Trivy: Scan Config]
    K --> L[Deploy Complete]`,

  "three-tier": `graph TD
    A[VPC] --> B[Internet Gateway]
    A --> C[Web Security Group]
    A --> D[App Security Group]
    A --> E[DB Security Group]
    B --> F[Attach IGW]
    C --> G[HTTP/HTTPS Ingress]
    D --> H[App Ingress from Web]
    E --> I[DB Ingress from App]
    A --> J[Public Subnets x2]
    A --> K[Private Subnets x2]
    J --> L[Validate: Network]
    K --> L
    L --> M[Trivy: Scan VPC Config]
    M --> N[Deploy Complete]`,
};

export function DeploymentDiagram({ workloadType, steps }: DeploymentDiagramProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [rendered, setRendered] = useState(false);

  const diagramDef = PATTERN_DIAGRAMS[workloadType];

  useEffect(() => {
    if (!diagramDef || !containerRef.current) return;

    setRendered(false);
    const id = `mermaid-${Date.now()}`;
    containerRef.current.innerHTML = "";

    mermaid.render(id, diagramDef).then(({ svg }) => {
      if (containerRef.current) {
        containerRef.current.innerHTML = svg;
        setRendered(true);
      }
    }).catch(console.error);
  }, [diagramDef]);

  if (!diagramDef) return null;

  const completedCount = steps.filter(s => s.status === "done").length;
  const totalCount = steps.length;

  return (
    <Card className="bg-card border-border/50">
      <CardHeader className="pb-2">
        <div className="flex items-center justify-between">
          <CardTitle className="text-sm flex items-center gap-2">
            <GitBranch className="h-4 w-4 text-primary" />
            Deployment DAG
          </CardTitle>
          <Badge variant="outline" className="text-[10px]">
            {completedCount}/{totalCount} ops
          </Badge>
        </div>
      </CardHeader>
      <CardContent>
        <div
          ref={containerRef}
          className="w-full overflow-x-auto [&_svg]:mx-auto [&_svg]:max-w-full"
          style={{ minHeight: rendered ? undefined : 120 }}
        />
        {!rendered && (
          <div className="flex items-center justify-center h-[120px] text-xs text-muted-foreground">
            Rendering diagram...
          </div>
        )}
      </CardContent>
    </Card>
  );
}
