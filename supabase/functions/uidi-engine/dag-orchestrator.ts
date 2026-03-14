import { EC2Client, DescribeVpcsCommand, DescribeSubnetsCommand } from "npm:@aws-sdk/client-ec2";
import { S3Client, HeadBucketCommand } from "npm:@aws-sdk/client-s3";
import { CloudFrontClient, GetDistributionCommand } from "npm:@aws-sdk/client-cloudfront";
import { Route53Client, ListHostedZonesByNameCommand } from "npm:@aws-sdk/client-route-53";


export interface SdkOperation {
  id: string;
  service: string;
  command: string;
  input: Record<string, any>;
  dependency?: string; // ID of the operation this depends on
  region?: string;
  riskLevel?: "LOW" | "HIGH";
  discoveryContext?: {
    identifiers: string[];
  };
}

export class DagOrchestrator {
  private ec2: EC2Client;
  private s3: S3Client;
  private cf: CloudFrontClient;
  private r53: Route53Client;
  

  constructor(private region: string, private credentials: any) {
    this.ec2 = new EC2Client({ region, credentials });
    this.s3 = new S3Client({ region, credentials });
    this.cf = new CloudFrontClient({ region: "us-east-1", credentials }); // CF is global
    this.r53 = new Route53Client({ region: "us-east-1", credentials }); // R53 is global
    this.eks = new EKSClient({ region, credentials });
  }

  async generateDag(pattern: string, spec: any): Promise<SdkOperation[]> {
    console.log(`[DagOrchestrator] Compiling DAG for pattern: ${pattern}`);
    
    switch (pattern) {
      case "global-spa":
      case "EDGE_STATIC_SPA":
        return this.compileGlobalSpa(spec);
      case "microservices-mesh":
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
    const { domainName, bucketName } = spec;
    const ops: SdkOperation[] = [];
    const intentHash = this.generateClientToken(spec, "pattern1");

    ops.push({
      id: "s3-bucket",
      service: "S3",
      command: "CreateBucket",
      input: { Bucket: bucketName },
      riskLevel: "LOW"
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
          SigningProtocol: "sigv4"
        }
      }
    });

    ops.push({
      id: "acm-cert",
      service: "ACM",
      command: "RequestCertificate",
      input: {
        DomainName: domainName,
        ValidationMethod: "DNS",
        IdempotencyToken: intentHash.slice(0, 32)
      },
      region: "us-east-1"
    });

    ops.push({
      id: "lambda-security",
      service: "Lambda",
      command: "CreateFunction",
      input: {
        FunctionName: `${bucketName}-security-headers`,
        Runtime: "nodejs18.x",
        Role: "arn:aws:iam::ACCOUNT:role/EdgeLambdaRole",
        Handler: "index.handler",
        Code: { ZipFile: new TextEncoder().encode("/* Security Headers Logic */") }
      },
      region: "us-east-1"
    });

    ops.push({
      id: "lambda-version",
      service: "Lambda",
      command: "PublishVersion",
      input: { FunctionName: "ref(lambda-security.FunctionName)" },
      dependency: "lambda-security",
      region: "us-east-1"
    });

    ops.push({
      id: "wait-cert",
      service: "ACM",
      command: "WaitUntilCertificateValidated",
      input: { CertificateArn: "ref(acm-cert.CertificateArn)" },
      dependency: "acm-cert",
      region: "us-east-1"
    });

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
              S3OriginConfig: { OriginAccessIdentity: "" }
            }]
          },
          DefaultCacheBehavior: {
            TargetOriginId: "S3Origin",
            ViewerProtocolPolicy: "redirect-to-https",
            ForwardedValues: { QueryString: false, Cookies: { Forward: "none" } },
            MinTTL: 0,
            DefaultTTL: 86400,
            MaxTTL: 31536000,
            LambdaFunctionAssociations: {
              Quantity: 1,
              Items: [{
                EventType: "viewer-response",
                LambdaFunctionARN: "ref(lambda-version.FunctionArn)"
              }]
            }
          },
          ViewerCertificate: {
            ACMCertificateArn: "ref(acm-cert.CertificateArn)",
            SSLSupportMethod: "sni-only"
          }
        }
      },
      dependency: "wait-cert"
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
            Condition: { StringEquals: { "AWS:SourceArn": "ref(cf-dist.Distribution.ARN)" } }
          }]
        })
      },
      dependency: "cf-dist"
    });

    ops.push({
      id: "r53-record",
      service: "Route53",
      command: "ChangeResourceRecordSets",
      input: {
        HostedZoneId: spec.hostedZoneId,
        ChangeBatch: {
          Changes: [{
            Action: "UPSERT",
            ResourceRecordSet: {
              Name: domainName,
              Type: "A",
              AliasTarget: {
                HostedZoneId: "Z2FDTNDATAQYW2",
                DNSName: "ref(cf-dist.Distribution.DomainName)",
                EvaluateTargetHealth: false
              }
            }
          }]
        }
      },
      dependency: "cf-dist"
    });

    ops.push({
      id: "cf-invalidation",
      service: "CloudFront",
      command: "CreateInvalidation",
      input: {
        DistributionId: "ref(cf-dist.Distribution.Id)",
        InvalidationBatch: {
          Paths: { Quantity: 1, Items: ["/*"] },
          CallerReference: spec.buildHash || intentHash
        }
      },
      dependency: "cf-dist"
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
        Role: spec.roleArn,
        Code: { ZipFile: new TextEncoder().encode("/* Processor Logic */") },
        Handler: "index.handler"
      }
    });

    return ops;
  }

  // ─── Pattern 4: Internal Tooling API ───
  private async compileInternalApi(spec: any): Promise<SdkOperation[]> {
    const ops: SdkOperation[] = [];
    const vpcId = spec.vpcId;

    const subnets = await this.ec2.send(new DescribeSubnetsCommand({
      Filters: [{ Name: "vpc-id", Values: [vpcId] }]
    }));
    
    const subnetIds = subnets.Subnets?.slice(0, 2).map(s => s.SubnetId) || [];
    if (subnetIds.length < 2) throw new Error("Need at least 2 subnets for RDS");

    ops.push({
      id: "rds-subnet-group",
      service: "RDS",
      command: "CreateDBSubnetGroup",
      input: {
        DBSubnetGroupName: `${spec.name}-subnet-group`,
        DBSubnetGroupDescription: "Auto-discovered for Internal API",
        SubnetIds: subnetIds
      }
    });

    ops.push({
      id: "rds-cluster",
      service: "RDS",
      command: "CreateDBCluster",
      input: {
        DBClusterIdentifier: `${spec.name}-aurora`,
        Engine: "aurora-postgresql",
        DBSubnetGroupName: `${spec.name}-subnet-group`,
        ServerlessV2ScalingConfiguration: { MinCapacity: 0.5, MaxCapacity: 1.0 }
      },
      dependency: "rds-subnet-group"
    });

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
