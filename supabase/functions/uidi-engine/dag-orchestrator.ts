// DAG Orchestrator — generates SdkOperation specs (no SDK imports needed)

export interface SdkOperation {
  id: string;
  service: string;
  command: string;
  input: Record<string, any>;
  dependency?: string;
  region?: string;
  riskLevel?: "LOW" | "HIGH";
  discoveryContext?: {
    identifiers: string[];
  };
}

export class DagOrchestrator {
  private accountId: string;

  constructor(private region: string, private credentials: any) {
    this.accountId = credentials.accountId || "";
  }

  private normalizeName(value: string, fallback: string, max = 48): string {
    const normalized = (value || fallback)
      .toLowerCase()
      .replace(/[^a-z0-9-]/g, "-")
      .replace(/-+/g, "-")
      .replace(/^-|-$/g, "");

    const safe = normalized || fallback;
    return safe.slice(0, max).replace(/-$/g, "") || fallback;
  }

  private normalizeBucketName(value: string): string {
    let v = (value || "")
      .toLowerCase()
      .replace(/[^a-z0-9.-]/g, "-")
      .replace(/\.\.+/g, ".")
      .replace(/-+/g, "-")
      .replace(/\.-|\-\./g, "-")
      .replace(/^[-.]+|[-.]+$/g, "");

    if (!v) v = `uidi-${Date.now().toString(36)}`;
    if (v.length < 3) v = `${v}-uidi`;
    if (v.length > 63) v = v.slice(0, 63).replace(/[-.]+$/g, "");

    if (!/^[a-z0-9]/.test(v)) v = `a${v}`;
    if (!/[a-z0-9]$/.test(v)) v = `${v}0`;
    return v;
  }

  private asRoleArn(value: unknown): string | undefined {
    if (typeof value !== "string") return undefined;
    return /^arn:aws[a-zA-Z-]*:iam::\d{12}:role\/.+/.test(value) ? value : undefined;
  }

  private asSubnetIds(value: unknown): string[] {
    if (!Array.isArray(value)) return [];
    return value.filter((v): v is string => typeof v === "string" && v.startsWith("subnet-"));
  }

  async generateDag(pattern: string, spec: any): Promise<SdkOperation[]> {
    if (!this.accountId) this.accountId = spec.accountId || "";

    console.log(`[DagOrchestrator] Compiling DAG for pattern: ${pattern}`);

    switch (pattern) {
      case "global-spa":
      case "EDGE_STATIC_SPA":
        return this.compileGlobalSpa(spec);
      case "microservices-mesh":
      case "service-mesh":
      case "SERVICE_MESH":
        return this.compileMicroservicesMesh(spec);
      case "event-pipeline":
      case "EVENT_PIPELINE":
        return this.compileEventPipeline(spec);
      case "internal-api":
        return this.compileInternalApi(spec);
      case "three-tier":
        return this.compileThreeTier(spec);
      default:
        throw new Error(`Unknown SRE pattern: ${pattern}`);
    }
  }

  // ─── Pattern 1: The Global SPA (EDGE_STATIC_SPA) ───
  private async compileGlobalSpa(spec: any): Promise<SdkOperation[]> {
    const ops: SdkOperation[] = [];
    const intentHash = this.generateClientToken(spec, "pattern1");
    const baseName = this.normalizeName(String(spec.name || "global-spa"), "global-spa", 36);
    const suffix = Date.now().toString(36);
    const bucketName = this.normalizeBucketName(String(spec.bucketName || `${baseName}-${this.region}-${suffix}`));
    const domainName = typeof spec.domainName === "string" && spec.domainName.includes(".")
      ? spec.domainName.toLowerCase()
      : undefined;
    const hostedZoneId = typeof spec.hostedZoneId === "string" && spec.hostedZoneId.trim().length > 0
      ? spec.hostedZoneId.trim()
      : undefined;
    const enableCustomDomain = Boolean(spec.enableCustomDomain && domainName && hostedZoneId);

    ops.push({
      id: "s3-bucket",
      service: "S3",
      command: "CreateBucket",
      input: { Bucket: bucketName },
      riskLevel: "LOW",
    });

    ops.push({
      id: "cf-oac",
      service: "CloudFront",
      command: "CreateOriginAccessControl",
      input: {
        OriginAccessControlConfig: {
          Name: `${bucketName}-oac`,
          OriginAccessControlOriginType: "s3",
          SigningBehavior: "always",
          SigningProtocol: "sigv4",
        },
      },
    });

    if (enableCustomDomain) {
      ops.push({
        id: "acm-cert",
        service: "ACM",
        command: "RequestCertificate",
        input: {
          DomainName: domainName,
          ValidationMethod: "DNS",
          IdempotencyToken: intentHash.slice(0, 32),
        },
        region: "us-east-1",
      });

      ops.push({
        id: "wait-cert",
        service: "ACM",
        command: "WaitUntilCertificateValidated",
        input: { CertificateArn: "ref(acm-cert.CertificateArn)" },
        dependency: "acm-cert",
        region: "us-east-1",
      });
    }

    ops.push({
      id: "cf-dist",
      service: "CloudFront",
      command: "CreateDistribution",
      input: {
        DistributionConfig: {
          CallerReference: intentHash,
          Comment: `${baseName} distribution`,
          Enabled: true,
          Origins: {
            Quantity: 1,
            Items: [{
              Id: "S3Origin",
              DomainName: `${bucketName}.s3.${this.region}.amazonaws.com`,
              OriginAccessControlId: "ref(cf-oac.OriginAccessControl.Id)",
              S3OriginConfig: { OriginAccessIdentity: "" },
            }],
          },
          DefaultCacheBehavior: {
            TargetOriginId: "S3Origin",
            ViewerProtocolPolicy: "redirect-to-https",
            ForwardedValues: { QueryString: false, Cookies: { Forward: "none" } },
            MinTTL: 0,
            DefaultTTL: 86400,
            MaxTTL: 31536000,
          },
          ViewerCertificate: enableCustomDomain
            ? {
                ACMCertificateArn: "ref(acm-cert.CertificateArn)",
                SSLSupportMethod: "sni-only",
              }
            : {
                CloudFrontDefaultCertificate: true,
              },
        },
      },
      dependency: enableCustomDomain ? "wait-cert" : "cf-oac",
    });

    if (spec.enableBucketPolicy === true) {
      ops.push({
        id: "s3-policy",
        service: "S3",
        command: "PutBucketPolicy",
        input: {
          Bucket: bucketName,
          Policy: JSON.stringify({
            Version: "2012-10-17",
            Statement: [{
              Effect: "Allow",
              Principal: { Service: "cloudfront.amazonaws.com" },
              Action: "s3:GetObject",
              Resource: `arn:aws:s3:::${bucketName}/*`,
              Condition: { StringEquals: { "AWS:SourceArn": "ref(cf-dist.Distribution.ARN)" } },
            }],
          }),
        },
        dependency: "cf-dist",
      });
    }

    if (enableCustomDomain) {
      ops.push({
        id: "r53-record",
        service: "Route53",
        command: "ChangeResourceRecordSets",
        input: {
          HostedZoneId: hostedZoneId,
          ChangeBatch: {
            Changes: [{
              Action: "UPSERT",
              ResourceRecordSet: {
                Name: domainName,
                Type: "A",
                AliasTarget: {
                  HostedZoneId: "Z2FDTNDATAQYW2",
                  DNSName: "ref(cf-dist.Distribution.DomainName)",
                  EvaluateTargetHealth: false,
                },
              },
            }],
          },
        },
        dependency: "cf-dist",
      });
    }

    // Upload a working dashboard index.html
    const dashboardTitle = spec.dashboardTitle || spec.intentText || baseName;
    const cfDomain = "ref(cf-dist.Distribution.DomainName)";
    const dashboardHtml = this.buildDashboardHtml(dashboardTitle, cfDomain, bucketName);

    ops.push({
      id: "s3-index",
      service: "S3",
      command: "PutObject",
      input: {
        Bucket: bucketName,
        Key: "index.html",
        Body: dashboardHtml,
        ContentType: "text/html",
      },
      dependency: "s3-bucket",
    });

    ops.push({
      id: "cf-invalidation",
      service: "CloudFront",
      command: "CreateInvalidation",
      input: {
        DistributionId: "ref(cf-dist.Distribution.Id)",
        InvalidationBatch: {
          Paths: { Quantity: 1, Items: ["/*"] },
          CallerReference: spec.buildHash || intentHash,
        },
      },
      dependency: "s3-index",
    });

    return ops;
  }

  // ─── Pattern 2: Microservices Mesh (SERVICE_MESH) ───
  private async compileMicroservicesMesh(spec: any): Promise<SdkOperation[]> {
    const ops: SdkOperation[] = [];
    const baseName = this.normalizeName(String(spec.name || "service-mesh"), "service-mesh", 36);
    const meshName = this.normalizeName(String(spec.meshName || `${baseName}-mesh`), "micro-mesh", 32);
    const clusterName = this.normalizeName(String(spec.clusterName || `${baseName}-eks`), "uidi-eks", 32);
    const subnetIds = this.asSubnetIds(spec.subnetIds);
    const roleArn = this.asRoleArn(spec.roleArn);
    const canCreateEks = subnetIds.length >= 2 && Boolean(roleArn);

    ops.push({
      id: "app-mesh",
      service: "AppMesh",
      command: "CreateMesh",
      input: { meshName },
      riskLevel: "LOW",
    });

    if (canCreateEks) {
      ops.push({
        id: "eks-cluster",
        service: "EKS",
        command: "CreateCluster",
        input: {
          name: clusterName,
          roleArn,
          resourcesVpcConfig: { subnetIds },
        },
      });

      ops.push({
        id: "wait-eks",
        service: "EKS",
        command: "WaitUntilClusterActive",
        input: { name: clusterName },
        dependency: "eks-cluster",
      });
    }

    ops.push({
      id: "virtual-node",
      service: "AppMesh",
      command: "CreateVirtualNode",
      input: {
        meshName,
        virtualNodeName: "gateway",
        spec: {
          listeners: [{ portMapping: { port: 80, protocol: "http" } }],
          serviceDiscovery: { dns: { hostname: "gateway.local" } },
        },
      },
      dependency: canCreateEks ? "wait-eks" : "app-mesh",
    });

    return ops;
  }

  // ─── Pattern 3: Event-Driven Pipeline (EVENT_PIPELINE) ───
  private async compileEventPipeline(spec: any): Promise<SdkOperation[]> {
    const ops: SdkOperation[] = [];
    const baseName = this.normalizeName(String(spec.name || "pipeline"), "pipeline", 40);

    ops.push({
      id: "sqs-dlq",
      service: "SQS",
      command: "CreateQueue",
      input: { QueueName: `${baseName}-dlq` },
      riskLevel: "LOW",
    });

    ops.push({
      id: "sqs-dlq-attrs",
      service: "SQS",
      command: "GetQueueAttributes",
      input: { QueueUrl: "ref(sqs-dlq.QueueUrl)", AttributeNames: ["QueueArn"] },
      dependency: "sqs-dlq",
    });

    ops.push({
      id: "sqs-main",
      service: "SQS",
      command: "CreateQueue",
      input: {
        QueueName: `${baseName}-main`,
        Attributes: {
          RedrivePolicy: JSON.stringify({
            deadLetterTargetArn: "ref(sqs-dlq-attrs.Attributes.QueueArn)",
            maxReceiveCount: 3,
          }),
        },
      },
      dependency: "sqs-dlq-attrs",
    });

    const lambdaRoleArn = this.asRoleArn(spec.lambdaRoleArn || spec.roleArn);
    const lambdaZipBase64 = typeof spec.lambdaZipBase64 === "string" && spec.lambdaZipBase64.length > 0
      ? spec.lambdaZipBase64
      : undefined;

    if (lambdaRoleArn && lambdaZipBase64) {
      ops.push({
        id: "lambda-fn",
        service: "Lambda",
        command: "CreateFunction",
        input: {
          FunctionName: `${baseName}-processor`,
          Runtime: "nodejs18.x",
          Role: lambdaRoleArn,
          Code: { ZipFile: lambdaZipBase64 },
          Handler: "index.handler",
        },
      });
    }

    return ops;
  }

  // ─── Pattern 4: Internal Tooling API ───
  private async compileInternalApi(spec: any): Promise<SdkOperation[]> {
    const ops: SdkOperation[] = [];
    const baseName = this.normalizeName(String(spec.name || "internal-api"), "internal-api", 36);
    const subnetIds = this.asSubnetIds(spec.subnetIds).slice(0, 2);
    const lambdaRoleArn = this.asRoleArn(spec.lambdaRoleArn || spec.roleArn);
    const lambdaZipBase64 = typeof spec.lambdaZipBase64 === "string" && spec.lambdaZipBase64.length > 0
      ? spec.lambdaZipBase64
      : undefined;
    const rdsProxyRoleArn = this.asRoleArn(spec.rdsProxyRoleArn);
    const rdsSecretArn = typeof spec.rdsSecretArn === "string" && spec.rdsSecretArn.startsWith("arn:aws:secretsmanager:")
      ? spec.rdsSecretArn
      : undefined;

    ops.push({
      id: "api-gateway",
      service: "ApiGatewayV2",
      command: "CreateApi",
      input: {
        name: `${baseName}-http-api`,
        protocolType: "HTTP",
      },
      riskLevel: "LOW",
    });

    if (lambdaRoleArn && lambdaZipBase64) {
      ops.push({
        id: "authorizer-lambda",
        service: "Lambda",
        command: "CreateFunction",
        input: {
          FunctionName: `${baseName}-authorizer`,
          Runtime: "nodejs18.x",
          Role: lambdaRoleArn,
          Handler: "index.handler",
          Code: { ZipFile: lambdaZipBase64 },
        },
        riskLevel: "LOW",
      });

      if (/dashboard|internal tool|internal api|bff/i.test(String(spec.intentText || baseName))) {
        ops.push({
          id: "provisioned-concurrency",
          service: "Lambda",
          command: "PutFunctionConcurrency",
          input: {
            FunctionName: `${baseName}-authorizer`,
            ReservedConcurrentExecutions: 1,
          },
          dependency: "authorizer-lambda",
          riskLevel: "LOW",
        });
      }
    }

    if (subnetIds.length >= 2) {
      ops.push({
        id: "rds-subnet-group",
        service: "RDS",
        command: "CreateDBSubnetGroup",
        input: {
          DBSubnetGroupName: `${baseName}-subnet-group`,
          DBSubnetGroupDescription: "UIDI Internal API subnet group",
          SubnetIds: subnetIds,
        },
        riskLevel: "LOW",
      });

      ops.push({
        id: "rds-cluster",
        service: "RDS",
        command: "CreateDBCluster",
        input: {
          DBClusterIdentifier: `${baseName}-aurora`,
          Engine: "aurora-postgresql",
          EngineMode: "provisioned",
          DBSubnetGroupName: `${baseName}-subnet-group`,
          MasterUsername: String(spec.dbMasterUsername || "appadmin"),
          ManageMasterUserPassword: true,
          ServerlessV2ScalingConfiguration: { MinCapacity: 0.5, MaxCapacity: 2.0 },
        },
        dependency: "rds-subnet-group",
        riskLevel: "HIGH",
      });

      if (rdsProxyRoleArn && rdsSecretArn) {
        ops.push({
          id: "rds-proxy",
          service: "RDS",
          command: "CreateDBProxy",
          input: {
            DBProxyName: `${baseName}-proxy`,
            EngineFamily: "POSTGRESQL",
            RoleArn: rdsProxyRoleArn,
            Auth: [{ AuthScheme: "SECRETS", IAMAuth: "REQUIRED", SecretArn: rdsSecretArn }],
            VpcSubnetIds: subnetIds,
          },
          dependency: "rds-cluster",
          riskLevel: "LOW",
        });
      }
    }

    return ops;
  }

  // ─── Pattern 5: Enterprise 3-Tier ───
  private async compileThreeTier(spec: any): Promise<SdkOperation[]> {
    const ops: SdkOperation[] = [];
    const vpcCidr = "10.0.0.0/16";

    ops.push({
      id: "vpc",
      service: "EC2",
      command: "CreateVpc",
      input: { CidrBlock: vpcCidr, TagSpecification: [{ ResourceType: "vpc", Tags: [{ Key: "Name", Value: spec.name }] }] }
    });

    const azs = ["us-east-1a", "us-east-1b"];
    azs.forEach((az, i) => {
      const cidr = `10.0.${i}.0/24`;
      const id = `subnet-${i}`;
      ops.push({
        id: id,
        service: "EC2",
        command: "CreateSubnet",
        input: {
          VpcId: "ref(vpc.VpcId)",
          CidrBlock: cidr,
          AvailabilityZone: az
        },
        dependency: "vpc"
      });
    });

    return ops;
  }

  private generateClientToken(spec: any, salt: string): string {
    return `${salt}-${Date.now()}`; 
  }

  private buildDashboardHtml(title: string, cfDomain: string, bucketName: string): string {
    const ts = new Date().toISOString();
    return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>${this.escHtml(title)} — Dashboard</title>
<style>
*{margin:0;padding:0;box-sizing:border-box}
body{font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;background:#0a0e17;color:#e2e8f0;min-height:100vh;display:flex;flex-direction:column}
header{background:linear-gradient(135deg,#1a1f2e 0%,#0f172a 100%);border-bottom:1px solid #1e293b;padding:1.5rem 2rem;display:flex;align-items:center;gap:1rem}
header h1{font-size:1.25rem;font-weight:600;background:linear-gradient(135deg,#38bdf8,#818cf8);-webkit-background-clip:text;-webkit-text-fill-color:transparent}
.badge{background:#1e293b;border:1px solid #334155;border-radius:6px;padding:.25rem .75rem;font-size:.7rem;color:#94a3b8;letter-spacing:.05em;text-transform:uppercase}
main{flex:1;padding:2rem;max-width:1200px;margin:0 auto;width:100%}
.grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(280px,1fr));gap:1.25rem;margin-bottom:2rem}
.card{background:#111827;border:1px solid #1e293b;border-radius:12px;padding:1.5rem;transition:border-color .2s}
.card:hover{border-color:#334155}
.card h3{font-size:.75rem;text-transform:uppercase;letter-spacing:.08em;color:#64748b;margin-bottom:.5rem}
.card .val{font-size:1.75rem;font-weight:700;color:#f1f5f9}
.card .sub{font-size:.8rem;color:#22d3ee;margin-top:.25rem}
.status{display:inline-flex;align-items:center;gap:.35rem;font-size:.8rem;padding:.35rem .75rem;border-radius:999px;font-weight:500}
.status.ok{background:#064e3b;color:#6ee7b7}
.status.progress{background:#1e3a5f;color:#7dd3fc}
.meta{margin-top:2rem;padding:1.25rem;background:#111827;border:1px solid #1e293b;border-radius:12px}
.meta h3{font-size:.85rem;font-weight:600;color:#94a3b8;margin-bottom:.75rem}
.meta-row{display:flex;justify-content:space-between;padding:.4rem 0;border-bottom:1px solid #1e293b;font-size:.8rem}
.meta-row:last-child{border:none}
.meta-row .label{color:#64748b}
.meta-row .value{color:#cbd5e1;font-family:'SF Mono',monospace;font-size:.75rem}
footer{text-align:center;padding:1.5rem;color:#475569;font-size:.75rem;border-top:1px solid #1e293b}
</style>
</head>
<body>
<header>
<svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="#38bdf8" stroke-width="2"><path d="M12 2L2 7l10 5 10-5-10-5z"/><path d="M2 17l10 5 10-5"/><path d="M2 12l10 5 10-5"/></svg>
<h1>${this.escHtml(title)}</h1>
<span class="badge">UIDI Engine</span>
<span class="status ok">● Live</span>
</header>
<main>
<div class="grid">
<div class="card"><h3>Distribution</h3><div class="val"><span class="status ok">● Active</span></div><div class="sub">CloudFront CDN</div></div>
<div class="card"><h3>Origin</h3><div class="val">S3</div><div class="sub">${this.escHtml(bucketName)}</div></div>
<div class="card"><h3>Edge Locations</h3><div class="val">450+</div><div class="sub">Global PoPs</div></div>
<div class="card"><h3>Protocol</h3><div class="val">HTTPS</div><div class="sub">TLS 1.3 · redirect-to-https</div></div>
</div>
<div class="meta">
<h3>Deployment Metadata</h3>
<div class="meta-row"><span class="label">Deployed At</span><span class="value">${ts}</span></div>
<div class="meta-row"><span class="label">Region</span><span class="value">us-east-1 (Global Edge)</span></div>
<div class="meta-row"><span class="label">Engine</span><span class="value">UIDI SRE-Supreme v2</span></div>
<div class="meta-row"><span class="label">Pattern</span><span class="value">EDGE_STATIC_SPA (Global Dashboard)</span></div>
</div>
</main>
<footer>Provisioned by UIDI Engine · Project Naawi Runtime</footer>
</body>
</html>`;
  }

  private escHtml(s: string): string {
    return String(s).replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;").replace(/"/g,"&quot;");
  }
}
