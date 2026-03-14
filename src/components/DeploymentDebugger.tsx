import { useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { 
  Activity, 
  AlertCircle, 
  ArrowRight, 
  CheckCircle2, 
  Clock, 
  Code2, 
  ExternalLink, 
  Layers, 
  Play, 
  RefreshCw, 
  ShieldAlert, 
  SkipForward, 
  Timer, 
  Zap 
} from "lucide-react";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";

interface SdkCall {
  id: string;
  service: string;
  command: string;
  status: "success" | "failed" | "skipped" | "waiting";
  params: any;
  error?: string;
  duration?: string;
  dependency?: string;
}

export function DeploymentDebugger() {
  const [activeTab, setActiveTab] = useState("diff");
  const [isReRunning, setIsReRunning] = useState(false);
  const [showCorrectedSpec, setShowCorrectedSpec] = useState(false);

  const sdkCalls: SdkCall[] = [
    { id: "[1]", service: "S3", command: "CreateBucket", status: "success", params: { Bucket: "naawi-assets" }, duration: "1.2s" },
    { id: "[2]", service: "S3", command: "PutBucketPolicy", status: "success", params: { Bucket: "naawi-assets" }, dependency: "[1]", duration: "0.8s" },
    { id: "[3]", service: "Route53", command: "GetHostedZone", status: "success", params: { Id: "Z12345" }, duration: "0.5s" },
    { id: "[4]", service: "ACM", command: "RequestCertificate", status: "success", params: { DomainName: "app.naawi.com" }, duration: "2.1s" },
    { id: "[5]", service: "ACM", command: "WaitUntilCertificateValidated", status: "failed", params: { CertificateArn: "arn:aws:acm:..." }, error: "Waiter timed out after 300s. Validation record not found in DNS.", duration: "300.0s", dependency: "[4]" },
    { id: "[6]", service: "CloudFront", command: "CreateDistribution", status: "skipped", params: { Origins: [] }, dependency: "[5]" },
    { id: "[7]", service: "Lambda", command: "CreateFunction", status: "skipped", params: { FunctionName: "security-headers" }, dependency: "[5]" },
    { id: "[8]", service: "Lambda", command: "PublishVersion", status: "skipped", params: { FunctionName: "security-headers" }, dependency: "[7]" },
    { id: "[9]", service: "CloudFront", command: "UpdateDistribution", status: "skipped", params: { LambdaFunctionAssociations: [] }, dependency: "[8]" },
    { id: "[10]", service: "Route53", command: "ChangeResourceRecordSets", status: "skipped", params: { Name: "app.naawi.com", Type: "A", Alias: "CloudFront" }, dependency: "[6]" },
  ];

  const handleReRun = () => {
    setIsReRunning(true);
    setTimeout(() => {
      setIsReRunning(false);
      setShowCorrectedSpec(true);
    }, 2000);
  };

  return (
    <Card className="bg-black/90 border-primary/40 text-white overflow-hidden shadow-2xl">
      <CardHeader className="border-b border-white/10 bg-white/5 py-3">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Activity className="h-4 w-4 text-primary animate-pulse" />
            <CardTitle className="text-sm font-mono tracking-tight uppercase">IDI Engine: Live Debugger</CardTitle>
          </div>
          <div className="flex items-center gap-2">
            <Badge variant="outline" className="text-[10px] border-destructive/50 text-destructive bg-destructive/10">
              FATAL: WAITER_TIMEOUT
            </Badge>
            <Badge variant="outline" className="text-[10px] border-primary/50 text-primary">
              v1.4.2-naawi
            </Badge>
          </div>
        </div>
      </CardHeader>
      <CardContent className="p-0">
        <Tabs value={activeTab} onValueChange={setActiveTab} className="w-full">
          <div className="px-4 pt-2 bg-white/5">
            <TabsList className="bg-transparent border-b border-white/10 rounded-none h-9 w-full justify-start gap-4 p-0">
              <TabsTrigger 
                value="diff" 
                className="rounded-none border-b-2 border-transparent data-[state=active]:border-primary data-[state=active]:bg-transparent text-xs uppercase tracking-wider h-9 px-4"
              >
                Live Diff
              </TabsTrigger>
              <TabsTrigger 
                value="dependencies" 
                className="rounded-none border-b-2 border-transparent data-[state=active]:border-primary data-[state=active]:bg-transparent text-xs uppercase tracking-wider flex items-center gap-1.5 h-9 px-4"
              >
                <Layers className="h-3 w-3" /> Dependency Order
              </TabsTrigger>
              <TabsTrigger 
                value="logs" 
                className="rounded-none border-b-2 border-transparent data-[state=active]:border-primary data-[state=active]:bg-transparent text-xs uppercase tracking-wider h-9 px-4"
              >
                SDK Traces
              </TabsTrigger>
            </TabsList>
          </div>

          <TabsContent value="diff" className="p-4 m-0 space-y-4">
            <Alert variant="destructive" className="bg-destructive/10 border-destructive/30 text-destructive-foreground py-2">
              <ShieldAlert className="h-4 w-4" />
              <AlertTitle className="text-xs font-bold uppercase tracking-widest">Circuit Breaker Tripped</AlertTitle>
              <AlertDescription className="text-[11px] opacity-90">
                Call [5] (ACM.WaitUntilValidated) failed. Cascading failure detected: 7 downstream operations halted to prevent drift.
              </AlertDescription>
            </Alert>

            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <h3 className="text-[10px] font-bold text-muted-foreground uppercase tracking-widest flex items-center gap-1.5">
                  <Clock className="h-3 w-3" /> Execution Timeline
                </h3>
                <div className="space-y-1">
                  {sdkCalls.slice(0, 6).map((call) => (
                    <div key={call.id} className={`flex items-center justify-between p-2 rounded border font-mono text-[10px] ${
                      call.status === "success" ? "bg-primary/5 border-primary/20 text-primary" :
                      call.status === "failed" ? "bg-destructive/10 border-destructive/40 text-destructive" :
                      "bg-white/5 border-white/10 text-muted-foreground"
                    }`}>
                      <div className="flex items-center gap-2">
                        <span>{call.id}</span>
                        <span className="font-bold">{call.service}.{call.command}</span>
                      </div>
                      <div className="flex items-center gap-2">
                        {call.duration && <span className="opacity-50 italic">{call.duration}</span>}
                        {call.status === "success" ? <CheckCircle2 className="h-3 w-3" /> : 
                         call.status === "failed" ? <AlertCircle className="h-3 w-3" /> : 
                         <Timer className="h-3 w-3" />}
                      </div>
                    </div>
                  ))}
                </div>
              </div>

              <div className="space-y-3">
                <h3 className="text-[10px] font-bold text-muted-foreground uppercase tracking-widest flex items-center gap-1.5">
                  <Code2 className="h-3 w-3" /> Actionable Fix
                </h3>
                <div className="bg-blue-500/10 border border-blue-500/30 rounded p-3 space-y-2">
                  <p className="text-[11px] leading-relaxed">
                    ACM validation record missing in Route 53. Manual entry required for <code className="bg-blue-500/20 px-1 rounded">app.naawi.com</code>.
                  </p>
                  <div className="bg-black/40 rounded p-2 text-[10px] font-mono text-blue-300 border border-blue-500/20">
                    <div className="flex justify-between border-b border-white/10 pb-1 mb-1">
                      <span>TYPE: CNAME</span>
                      <span>TTL: 300</span>
                    </div>
                    <div className="truncate">NAME: _abc123.app.naawi.com</div>
                    <div className="truncate text-xs">VALUE: _xyz456.acm-validations.aws.</div>
                  </div>
                  <Button variant="outline" size="sm" className="w-full h-7 text-[10px] border-blue-500/50 hover:bg-blue-500/20 text-blue-400">
                    <ExternalLink className="h-3 w-3 mr-2" /> Open AWS Console
                  </Button>
                </div>
              </div>
            </div>
          </TabsContent>

          <TabsContent value="dependencies" className="p-4 m-0">
            <div className="space-y-4">
              <div className="flex items-center justify-between">
                <h3 className="text-[10px] font-bold text-muted-foreground uppercase tracking-widest">Directed Acyclic Graph (DAG)</h3>
                <Button 
                  onClick={handleReRun}
                  disabled={isReRunning}
                  className="h-8 bg-primary hover:bg-primary/80 text-black font-bold text-[10px] uppercase tracking-tighter gap-1"
                >
                  {isReRunning ? (
                    <RefreshCw className="h-3 w-3 animate-spin" />
                  ) : (
                    <Zap className="h-3 w-3 fill-current" />
                  )}
                  Re-run corrected sequence ↗
                </Button>
              </div>

              {showCorrectedSpec && (
                <div className="bg-primary/10 border border-primary/30 rounded p-3 mb-4 animate-in fade-in slide-in-from-top-2">
                  <h4 className="text-[10px] font-bold text-primary uppercase tracking-widest mb-2 flex items-center gap-2">
                    <CheckCircle2 className="h-3 w-3" /> Corrected SDK Sequence Generated
                  </h4>
                  <ScrollArea className="h-40 w-full bg-black/40 rounded border border-primary/20 p-2">
                    <pre className="text-[9px] font-mono text-primary/80">
{`{
  "operations": [
    { "id": "[5.1]", "service": "Route53", "command": "ChangeResourceRecordSets", "params": { "Name": "_abc123.app.naawi.com", "Value": "_xyz456.acm-validations.aws." } },
    { "id": "[5.2]", "service": "ACM", "command": "WaitUntilCertificateValidated", "dependency": "[5.1]" },
    { "id": "[7]", "service": "Lambda", "command": "CreateFunction", "region": "us-east-1", "params": { "Runtime": "nodejs18.x" } },
    { "id": "[8]", "service": "Lambda", "command": "PublishVersion", "dependency": "[7]" },
    { "id": "[6]", "service": "CloudFront", "command": "CreateDistribution", "params": { "LambdaFunctionAssociations": [ { "LambdaFunctionARN": "ref([8].FunctionArn)" } ] } },
    { "id": "[9]", "service": "Route53", "command": "ChangeResourceRecordSets", "dependency": "[6]" }
  ],
  "security_moat": {
    "hsts": "max-age=63072000; includeSubDomains; preload",
    "csp": "default-src 'self'; script-src 'self' 'unsafe-inline' https://naawi.com;"
  }
}`}
                    </pre>
                  </ScrollArea>
                </div>
              )}

              <div className="relative pt-2">
                {sdkCalls.map((call, i) => (
                  <div key={call.id} className="relative mb-3 last:mb-0">
                    <div className={`flex items-center gap-3 p-2.5 rounded-md border transition-all ${
                      call.status === "success" ? "border-primary/30 bg-primary/5" :
                      call.status === "failed" ? "border-destructive/50 bg-destructive/10" :
                      call.status === "skipped" ? "border-white/10 bg-white/5 opacity-60" :
                      "border-white/10 bg-white/5"
                    }`}>
                      <div className={`w-6 h-6 rounded-full flex items-center justify-center text-[10px] font-mono font-bold ${
                        call.status === "success" ? "bg-primary text-black" :
                        call.status === "failed" ? "bg-destructive text-white" :
                        "bg-white/10 text-white/50"
                      }`}>
                        {i + 1}
                      </div>
                      <div className="flex-1">
                        <div className="flex items-center justify-between">
                          <span className="text-[11px] font-bold font-mono">{call.service}:{call.command}</span>
                          {call.dependency && (
                            <span className="text-[9px] text-muted-foreground flex items-center gap-1 bg-white/5 px-1.5 py-0.5 rounded">
                              <ArrowRight className="h-2 w-2" /> depends on {call.dependency}
                            </span>
                          )}
                        </div>
                        {call.status === "failed" && (
                          <p className="text-[10px] text-destructive mt-1 italic">{call.error}</p>
                        )}
                        {call.status === "skipped" && (
                          <div className="flex items-center gap-1.5 text-[9px] text-muted-foreground mt-1">
                            <SkipForward className="h-2.5 w-2.5" /> Blocked by failure at [5]
                          </div>
                        )}
                      </div>
                    </div>
                    {i < sdkCalls.length - 1 && (
                      <div className="absolute left-3 top-full h-3 w-px bg-white/10" />
                    )}
                  </div>
                ))}
              </div>
            </div>
          </TabsContent>

          <TabsContent value="logs" className="p-0 m-0">
            <ScrollArea className="h-[300px] w-full bg-black/50">
              <div className="p-4 font-mono text-[10px] space-y-1">
                <div className="text-muted-foreground">[2026-03-13 14:22:01] ENGINE: Initializing Project Naawi Runtime v1.4.2</div>
                <div className="text-muted-foreground">[2026-03-13 14:22:02] ENGINE: Parsing intent for 'naawi-app' distribution</div>
                <div className="text-primary">[2026-03-13 14:22:03] CALL [1] S3:CreateBucket -> SUCCESS (naawi-assets)</div>
                <div className="text-primary">[2026-03-13 14:22:04] CALL [2] S3:PutBucketPolicy -> SUCCESS</div>
                <div className="text-primary">[2026-03-13 14:22:05] CALL [3] Route53:GetHostedZone -> SUCCESS (Z12345)</div>
                <div className="text-primary">[2026-03-13 14:22:07] CALL [4] ACM:RequestCertificate -> SUCCESS (arn:aws:acm:...)</div>
                <div className="text-blue-400">[2026-03-13 14:22:08] WAITER: ACM.CertificateValidated polling started...</div>
                <div className="text-yellow-500">[2026-03-13 14:24:08] WAITER: ACM.CertificateValidated still PENDING (120s)</div>
                <div className="text-yellow-500">[2026-03-13 14:26:08] WAITER: ACM.CertificateValidated still PENDING (240s)</div>
                <div className="text-destructive">[2026-03-13 14:27:08] ERROR: ACM.CertificateValidated TIMEOUT (300s)</div>
                <div className="text-destructive font-bold">[2026-03-13 14:27:08] CRITICAL: Circuit breaker halted execution at [5]</div>
                <div className="text-muted-foreground opacity-50">[2026-03-13 14:27:08] SKIP: [6] CloudFront.CreateDistribution</div>
                <div className="text-muted-foreground opacity-50">[2026-03-13 14:27:08] SKIP: [7] Lambda.CreateFunction</div>
                <div className="text-muted-foreground opacity-50">[2026-03-13 14:27:08] SKIP: [8] Lambda.PublishVersion</div>
                <div className="text-muted-foreground opacity-50">[2026-03-13 14:27:08] SKIP: [9] CloudFront.UpdateDistribution</div>
                <div className="text-muted-foreground opacity-50">[2026-03-13 14:27:08] SKIP: [10] Route53.ChangeResourceRecordSets</div>
                <div className="pt-2 text-primary animate-pulse">_</div>
              </div>
            </ScrollArea>
          </TabsContent>
        </Tabs>
      </CardContent>
    </Card>
  );
}
