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
      dependency: "cf-dist",
    });

    return ops;
  }

  // ─── Pattern 2: Microservices Mesh (SERVICE_MESH) ───
  private async compileMicroservicesMesh(spec: any): Promise<SdkOperation[]> {
    const ops: SdkOperation[] = [];
    const meshName = spec.meshName || "micro-mesh";

    ops.push({
      id: "app-mesh",
      service: "AppMesh",
      command: "CreateMesh",
      input: { meshName }
    });

    ops.push({
      id: "eks-cluster",
      service: "EKS",
      command: "CreateCluster",
      input: {
        name: spec.clusterName,
        roleArn: spec.roleArn,
        resourcesVpcConfig: { subnetIds: spec.subnetIds }
      }
    });

    ops.push({
      id: "wait-eks",
      service: "EKS",
      command: "WaitUntilClusterActive",
      input: { name: spec.clusterName },
      dependency: "eks-cluster"
    });

    ops.push({
      id: "virtual-node",
      service: "AppMesh",
      command: "CreateVirtualNode",
      input: {
        meshName,
        virtualNodeName: "gateway",
        spec: {
          listeners: [{ portMapping: { port: 80, protocol: "http" } }],
          serviceDiscovery: { dns: { hostname: "gateway.local" } }
        }
      },
      dependency: "wait-eks"
    });

    return ops;
  }

  // ─── Pattern 3: Event-Driven Pipeline (EVENT_PIPELINE) ───
  private async compileEventPipeline(spec: any): Promise<SdkOperation[]> {
    const ops: SdkOperation[] = [];
    const baseName = spec.name || "pipeline";

    ops.push({
      id: "sqs-dlq",
      service: "SQS",
      command: "CreateQueue",
      input: { QueueName: `${baseName}-dlq` }
    });

    ops.push({
      id: "sqs-dlq-attrs",
      service: "SQS",
      command: "GetQueueAttributes",
      input: { QueueUrl: "ref(sqs-dlq.QueueUrl)", AttributeNames: ["QueueArn"] },
      dependency: "sqs-dlq"
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
            maxReceiveCount: 3
          })
        }
      },
      dependency: "sqs-dlq-attrs"
    });

    ops.push({
      id: "lambda-fn",
      service: "Lambda",
      command: "CreateFunction",
      input: {
        FunctionName: `${baseName}-processor`,
        Runtime: "nodejs18.x",
        Role: spec._defaultLambdaRole || `arn:aws:iam::${this.accountId}:role/uidi-lambda-execution`,
        Code: { ZipFile: btoa("/* Processor Logic */") },
        Handler: "index.handler"
      }
    });

    return ops;
  }

  // ─── Pattern 4: Internal Tooling API ───
  private async compileInternalApi(spec: any): Promise<SdkOperation[]> {
    const ops: SdkOperation[] = [];
    const baseName = spec.name || "internal-api";
    const subnetIds = (Array.isArray(spec.subnetIds) && spec.subnetIds.length >= 2)
      ? spec.subnetIds.slice(0, 2)
      : ["subnet-auto-a", "subnet-auto-b"];

    ops.push({
      id: "api-gateway",
      service: "ApiGatewayV2",
      command: "CreateApi",
      input: {
        Name: `${baseName}-http-api`,
        ProtocolType: "HTTP"
      },
      riskLevel: "LOW"
    });

    ops.push({
      id: "authorizer-lambda",
      service: "Lambda",
      command: "CreateFunction",
      input: {
        FunctionName: `${baseName}-authorizer`,
        Runtime: "nodejs18.x",
        Role: spec._defaultLambdaRole || `arn:aws:iam::${this.accountId}:role/uidi-lambda-execution`,
        Handler: "index.handler",
        Code: { ZipFile: btoa("/* Lambda Authorizer */") }
      },
      riskLevel: "LOW"
    });

    ops.push({
      id: "rds-subnet-group",
      service: "RDS",
      command: "CreateDBSubnetGroup",
      input: {
        DBSubnetGroupName: `${baseName}-subnet-group`,
        DBSubnetGroupDescription: "IDI Internal API subnet group",
        SubnetIds: subnetIds
      },
      riskLevel: "LOW"
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
        ServerlessV2ScalingConfiguration: { MinCapacity: 0.5, MaxCapacity: 2.0 }
      },
      dependency: "rds-subnet-group",
      riskLevel: "HIGH"
    });

    ops.push({
      id: "rds-proxy",
      service: "RDS",
      command: "CreateDBProxy",
      input: {
        DBProxyName: `${baseName}-proxy`,
        EngineFamily: "POSTGRESQL",
        RoleArn: spec._defaultRdsProxyRole || `arn:aws:iam::${this.accountId}:role/uidi-rds-proxy`,
        Auth: [{ AuthScheme: "SECRETS", IAMAuth: "REQUIRED" }],
        VpcSubnetIds: subnetIds,
      },
      dependency: "rds-cluster",
      riskLevel: "LOW"
    });

    // Latency Guard for internal dashboards/tools
    if (/dashboard|internal tool|internal api|bff/i.test(String(spec.intentText || baseName))) {
      ops.push({
        id: "provisioned-concurrency",
        service: "Lambda",
        command: "PutFunctionConcurrency",
        input: {
          FunctionName: `${baseName}-authorizer`,
          ReservedConcurrentExecutions: 1
        },
        dependency: "authorizer-lambda",
        riskLevel: "LOW"
      });
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
}
