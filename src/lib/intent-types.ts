// ===== Project Naawi: Stateless SDK Types =====

export interface SdkOperation {
  id: string;                // Traceable ID for the intent
  service: string;           // e.g., "S3", "RDS", "EC2"
  command: string;           // e.g., "CreateBucket", "ModifyDBInstance"
  discoveryContext: {        // Parameters used for Surgical Discovery
    identifiers: string[];   // ARNs, IDs, or Names to check first
    tags?: Record<string, string>;
  };
  input: Record<string, any>; // The "Desired State" payload for the SDK
  riskLevel: "LOW" | "HIGH";  // Dictates if a human-in-the-loop Diff is mandatory
  dependsOn?: string[];      // IDs of operations that must complete first
}

export interface DiscoveryReport {
  operationId: string;
  status: "MATCH" | "DRIFT" | "NOT_FOUND" | "ERROR";
  liveState?: Record<string, any>;
  suggestedAction: "CREATE" | "UPDATE" | "NONE" | "REPLACE";
  diff?: string[];
}

// ===== Core Intent Types =====
export type WorkloadType = "general" | "compute" | "memory" | "storage" | "accelerated" | "hpc" | "global-spa" | "service-mesh" | "event-pipeline" | "internal-api" | "three-tier";
export type CostSensitivity = "cheapest" | "balanced" | "production";
export type Environment = "dev" | "staging" | "prod";
export type OsType = "amazon-linux-2023" | "ubuntu" | "debian" | "rhel" | "suse" | "windows-2022" | "windows-2019";

// ===== AWS Regions (All Commercial) =====
export type AwsRegion =
  | "us-east-1" | "us-east-2" | "us-west-1" | "us-west-2"
  | "af-south-1"
  | "ap-east-1" | "ap-south-1" | "ap-south-2" | "ap-southeast-1" | "ap-southeast-2" | "ap-southeast-3" | "ap-southeast-4" | "ap-northeast-1" | "ap-northeast-2" | "ap-northeast-3"
  | "ca-central-1" | "ca-west-1"
  | "eu-central-1" | "eu-central-2" | "eu-west-1" | "eu-west-2" | "eu-west-3" | "eu-south-1" | "eu-south-2" | "eu-north-1"
  | "il-central-1"
  | "me-south-1" | "me-central-1"
  | "sa-east-1";

// ===== Instance Types =====
export type InstanceFamily =
  | "t3" | "t3a" | "t4g"
  | "m5" | "m5a" | "m5n" | "m6i" | "m6a" | "m6g" | "m7i" | "m7g" | "m7a"
  | "c5" | "c5a" | "c5n" | "c6i" | "c6a" | "c6g" | "c7i" | "c7g" | "c7a"
  | "r5" | "r5a" | "r5n" | "r6i" | "r6a" | "r6g" | "r7i" | "r7g" | "r7a"
  | "i3" | "i3en" | "i4i" | "d3" | "d3en"
  | "p3" | "p4d" | "p5" | "g4dn" | "g5" | "g6" | "inf1" | "inf2" | "trn1"
  | "hpc6a" | "hpc7g" | "hpc7a"
  | "x2idn" | "x2iedn" | "x2gd";

export type InstanceSize = "nano" | "micro" | "small" | "medium" | "large" | "xlarge" | "2xlarge" | "4xlarge" | "8xlarge" | "12xlarge" | "16xlarge" | "24xlarge" | "48xlarge" | "metal";

// ===== EBS Volume Types =====
export type EbsVolumeType = "gp3" | "gp2" | "io1" | "io2" | "st1" | "sc1" | "standard";

// ===== Tenancy =====
export type Tenancy = "default" | "dedicated" | "host";

// ===== Purchase Option =====
export type PurchaseOption = "on-demand" | "spot";

// ===== Shutdown Behavior =====
export type ShutdownBehavior = "stop" | "terminate";

// ===== Metadata Options (IMDSv2) =====
export type HttpTokens = "optional" | "required";

// ===== Credit Specification (Burstable) =====
export type CreditSpecification = "standard" | "unlimited";

// ===== Architecture =====
export type Architecture = "x86_64" | "arm64";

// ===== Parsed Intent =====
export interface ParsedIntent {
  workloadType: WorkloadType;
  costSensitivity: CostSensitivity;
  environment: Environment;
  region: AwsRegion;
  os: OsType;
  resources?: string[];
}

// ===== Full EC2 Config =====
export interface Ec2Config {
  // Core
  instanceType: string;
  amiDescription: string;
  region: string;
  os: string;
  environment: string;
  estimatedCost: string;

  // Networking
  subnetId?: string;
  securityGroupIds?: string[];
  associatePublicIp?: boolean;
  privateIpAddress?: string;

  // Storage
  rootVolumeSize?: number;       // GiB
  rootVolumeType?: EbsVolumeType;
  rootVolumeIops?: number;
  rootVolumeThroughput?: number;  // MiB/s for gp3
  rootVolumeEncrypted?: boolean;
  deleteOnTermination?: boolean;
  additionalVolumes?: AdditionalVolume[];

  // Security
  keyName?: string;
  iamInstanceProfile?: string;

  // Advanced
  userData?: string;
  instanceCount?: number;
  tenancy?: Tenancy;
  purchaseOption?: PurchaseOption;
  spotMaxPrice?: string;
  shutdownBehavior?: ShutdownBehavior;
  terminationProtection?: boolean;
  detailedMonitoring?: boolean;
  ebsOptimized?: boolean;
  creditSpecification?: CreditSpecification;
  httpTokens?: HttpTokens;    // IMDSv2
  httpEndpoint?: boolean;      // metadata service
  placementGroupName?: string;
  architecture?: Architecture;
}

export interface AdditionalVolume {
  deviceName: string;
  volumeSize: number;
  volumeType: EbsVolumeType;
  iops?: number;
  throughput?: number;
  encrypted?: boolean;
  deleteOnTermination?: boolean;
}

export interface AwsCredentials {
  accessKeyId: string;
  secretAccessKey: string;
}

export interface Deployment {
  id: string;
  instanceId?: string;
  publicIp?: string;
  status: "pending" | "launching" | "running" | "failed";
  config: Ec2Config;
  timestamp: Date;
  error?: string;
}

// ===== Option Lists =====

export const WORKLOAD_OPTIONS: { value: WorkloadType; label: string }[] = [
  { value: "general", label: "General Purpose" },
  { value: "compute", label: "Compute Optimized" },
  { value: "memory", label: "Memory Optimized" },
  { value: "storage", label: "Storage Optimized" },
  { value: "accelerated", label: "Accelerated Computing (GPU)" },
  { value: "hpc", label: "High Performance Computing" },
  { value: "global-spa", label: "Global SPA (CloudFront/S3)" },
  { value: "service-mesh", label: "Microservices Mesh (EKS/App Mesh)" },
  { value: "event-pipeline", label: "Event Pipeline (SQS/Lambda)" },
  { value: "internal-api", label: "Internal API (API GW/Aurora)" },
  { value: "three-tier", label: "Enterprise 3-Tier (ASG/RDS)" },
];

export const COST_OPTIONS: { value: CostSensitivity; label: string }[] = [
  { value: "cheapest", label: "Cheapest" },
  { value: "balanced", label: "Balanced" },
  { value: "production", label: "Production Grade" },
];

export const ENV_OPTIONS: { value: Environment; label: string }[] = [
  { value: "dev", label: "Dev" },
  { value: "staging", label: "Staging" },
  { value: "prod", label: "Prod" },
];

export const REGION_OPTIONS: { value: AwsRegion; label: string }[] = [
  // US
  { value: "us-east-1", label: "US East (N. Virginia)" },
  { value: "us-east-2", label: "US East (Ohio)" },
  { value: "us-west-1", label: "US West (N. California)" },
  { value: "us-west-2", label: "US West (Oregon)" },
  // Africa
  { value: "af-south-1", label: "Africa (Cape Town)" },
  // Asia Pacific
  { value: "ap-east-1", label: "Asia Pacific (Hong Kong)" },
  { value: "ap-south-1", label: "Asia Pacific (Mumbai)" },
  { value: "ap-south-2", label: "Asia Pacific (Hyderabad)" },
  { value: "ap-southeast-1", label: "Asia Pacific (Singapore)" },
  { value: "ap-southeast-2", label: "Asia Pacific (Sydney)" },
  { value: "ap-southeast-3", label: "Asia Pacific (Jakarta)" },
  { value: "ap-southeast-4", label: "Asia Pacific (Melbourne)" },
  { value: "ap-northeast-1", label: "Asia Pacific (Tokyo)" },
  { value: "ap-northeast-2", label: "Asia Pacific (Seoul)" },
  { value: "ap-northeast-3", label: "Asia Pacific (Osaka)" },
  // Canada
  { value: "ca-central-1", label: "Canada (Central)" },
  { value: "ca-west-1", label: "Canada West (Calgary)" },
  // Europe
  { value: "eu-central-1", label: "Europe (Frankfurt)" },
  { value: "eu-central-2", label: "Europe (Zurich)" },
  { value: "eu-west-1", label: "Europe (Ireland)" },
  { value: "eu-west-2", label: "Europe (London)" },
  { value: "eu-west-3", label: "Europe (Paris)" },
  { value: "eu-south-1", label: "Europe (Milan)" },
  { value: "eu-south-2", label: "Europe (Spain)" },
  { value: "eu-north-1", label: "Europe (Stockholm)" },
  // Israel
  { value: "il-central-1", label: "Israel (Tel Aviv)" },
  // Middle East
  { value: "me-south-1", label: "Middle East (Bahrain)" },
  { value: "me-central-1", label: "Middle East (UAE)" },
  // South America
  { value: "sa-east-1", label: "South America (São Paulo)" },
];

export const OS_OPTIONS: { value: OsType; label: string }[] = [
  { value: "amazon-linux-2023", label: "Amazon Linux 2023" },
  { value: "ubuntu", label: "Ubuntu 24.04 LTS" },
  { value: "debian", label: "Debian 12" },
  { value: "rhel", label: "Red Hat Enterprise Linux 9" },
  { value: "suse", label: "SUSE Linux Enterprise 15" },
  { value: "windows-2022", label: "Windows Server 2022" },
  { value: "windows-2019", label: "Windows Server 2019" },
];

export const EBS_VOLUME_TYPE_OPTIONS: { value: EbsVolumeType; label: string; description: string }[] = [
  { value: "gp3", label: "gp3", description: "General Purpose SSD (baseline 3000 IOPS)" },
  { value: "gp2", label: "gp2", description: "General Purpose SSD (burstable)" },
  { value: "io1", label: "io1", description: "Provisioned IOPS SSD" },
  { value: "io2", label: "io2", description: "Provisioned IOPS SSD (durability)" },
  { value: "st1", label: "st1", description: "Throughput Optimized HDD" },
  { value: "sc1", label: "sc1", description: "Cold HDD" },
  { value: "standard", label: "standard", description: "Magnetic (previous gen)" },
];

export const TENANCY_OPTIONS: { value: Tenancy; label: string }[] = [
  { value: "default", label: "Shared (Default)" },
  { value: "dedicated", label: "Dedicated Instance" },
  { value: "host", label: "Dedicated Host" },
];

export const PURCHASE_OPTIONS: { value: PurchaseOption; label: string }[] = [
  { value: "on-demand", label: "On-Demand" },
  { value: "spot", label: "Spot Instance" },
];

export const SHUTDOWN_BEHAVIOR_OPTIONS: { value: ShutdownBehavior; label: string }[] = [
  { value: "stop", label: "Stop" },
  { value: "terminate", label: "Terminate" },
];

export const HTTP_TOKENS_OPTIONS: { value: HttpTokens; label: string }[] = [
  { value: "optional", label: "IMDSv1 & v2 (Optional)" },
  { value: "required", label: "IMDSv2 Only (Required)" },
];

export const CREDIT_SPEC_OPTIONS: { value: CreditSpecification; label: string }[] = [
  { value: "standard", label: "Standard" },
  { value: "unlimited", label: "Unlimited" },
];

export const ARCHITECTURE_OPTIONS: { value: Architecture; label: string }[] = [
  { value: "x86_64", label: "x86_64 (Intel/AMD)" },
  { value: "arm64", label: "ARM64 (Graviton)" },
];

// Instance type catalog organized by family
export const INSTANCE_TYPE_CATALOG: { family: string; category: string; types: string[] }[] = [
  // General Purpose - Burstable
  { family: "T3", category: "General Purpose (Burstable)", types: ["t3.nano", "t3.micro", "t3.small", "t3.medium", "t3.large", "t3.xlarge", "t3.2xlarge"] },
  { family: "T3a", category: "General Purpose (Burstable, AMD)", types: ["t3a.nano", "t3a.micro", "t3a.small", "t3a.medium", "t3a.large", "t3a.xlarge", "t3a.2xlarge"] },
  { family: "T4g", category: "General Purpose (Burstable, Graviton)", types: ["t4g.nano", "t4g.micro", "t4g.small", "t4g.medium", "t4g.large", "t4g.xlarge", "t4g.2xlarge"] },
  // General Purpose - Fixed
  { family: "M5", category: "General Purpose", types: ["m5.large", "m5.xlarge", "m5.2xlarge", "m5.4xlarge", "m5.8xlarge", "m5.12xlarge", "m5.16xlarge", "m5.24xlarge", "m5.metal"] },
  { family: "M5a", category: "General Purpose (AMD)", types: ["m5a.large", "m5a.xlarge", "m5a.2xlarge", "m5a.4xlarge", "m5a.8xlarge", "m5a.12xlarge", "m5a.16xlarge", "m5a.24xlarge"] },
  { family: "M6i", category: "General Purpose (6th Gen)", types: ["m6i.large", "m6i.xlarge", "m6i.2xlarge", "m6i.4xlarge", "m6i.8xlarge", "m6i.12xlarge", "m6i.16xlarge", "m6i.24xlarge", "m6i.32xlarge", "m6i.metal"] },
  { family: "M6g", category: "General Purpose (Graviton2)", types: ["m6g.medium", "m6g.large", "m6g.xlarge", "m6g.2xlarge", "m6g.4xlarge", "m6g.8xlarge", "m6g.12xlarge", "m6g.16xlarge", "m6g.metal"] },
  { family: "M7i", category: "General Purpose (7th Gen)", types: ["m7i.large", "m7i.xlarge", "m7i.2xlarge", "m7i.4xlarge", "m7i.8xlarge", "m7i.12xlarge", "m7i.16xlarge", "m7i.24xlarge", "m7i.48xlarge", "m7i.metal-24xl", "m7i.metal-48xl"] },
  { family: "M7g", category: "General Purpose (Graviton3)", types: ["m7g.medium", "m7g.large", "m7g.xlarge", "m7g.2xlarge", "m7g.4xlarge", "m7g.8xlarge", "m7g.12xlarge", "m7g.16xlarge", "m7g.metal"] },
  { family: "M7a", category: "General Purpose (AMD, 7th Gen)", types: ["m7a.medium", "m7a.large", "m7a.xlarge", "m7a.2xlarge", "m7a.4xlarge", "m7a.8xlarge", "m7a.12xlarge", "m7a.16xlarge", "m7a.24xlarge", "m7a.48xlarge", "m7a.metal-48xl"] },
  // Compute Optimized
  { family: "C5", category: "Compute Optimized", types: ["c5.large", "c5.xlarge", "c5.2xlarge", "c5.4xlarge", "c5.9xlarge", "c5.12xlarge", "c5.18xlarge", "c5.24xlarge", "c5.metal"] },
  { family: "C5a", category: "Compute Optimized (AMD)", types: ["c5a.large", "c5a.xlarge", "c5a.2xlarge", "c5a.4xlarge", "c5a.8xlarge", "c5a.12xlarge", "c5a.16xlarge", "c5a.24xlarge"] },
  { family: "C6i", category: "Compute Optimized (6th Gen)", types: ["c6i.large", "c6i.xlarge", "c6i.2xlarge", "c6i.4xlarge", "c6i.8xlarge", "c6i.12xlarge", "c6i.16xlarge", "c6i.24xlarge", "c6i.32xlarge", "c6i.metal"] },
  { family: "C6g", category: "Compute Optimized (Graviton2)", types: ["c6g.medium", "c6g.large", "c6g.xlarge", "c6g.2xlarge", "c6g.4xlarge", "c6g.8xlarge", "c6g.12xlarge", "c6g.16xlarge", "c6g.metal"] },
  { family: "C7i", category: "Compute Optimized (7th Gen)", types: ["c7i.large", "c7i.xlarge", "c7i.2xlarge", "c7i.4xlarge", "c7i.8xlarge", "c7i.12xlarge", "c7i.16xlarge", "c7i.24xlarge", "c7i.48xlarge", "c7i.metal-24xl", "c7i.metal-48xl"] },
  { family: "C7g", category: "Compute Optimized (Graviton3)", types: ["c7g.medium", "c7g.large", "c7g.xlarge", "c7g.2xlarge", "c7g.4xlarge", "c7g.8xlarge", "c7g.12xlarge", "c7g.16xlarge", "c7g.metal"] },
  { family: "C7a", category: "Compute Optimized (AMD, 7th Gen)", types: ["c7a.medium", "c7a.large", "c7a.xlarge", "c7a.2xlarge", "c7a.4xlarge", "c7a.8xlarge", "c7a.12xlarge", "c7a.16xlarge", "c7a.24xlarge", "c7a.48xlarge", "c7a.metal-48xl"] },
  // Memory Optimized
  { family: "R5", category: "Memory Optimized", types: ["r5.large", "r5.xlarge", "r5.2xlarge", "r5.4xlarge", "r5.8xlarge", "r5.12xlarge", "r5.16xlarge", "r5.24xlarge", "r5.metal"] },
  { family: "R6i", category: "Memory Optimized (6th Gen)", types: ["r6i.large", "r6i.xlarge", "r6i.2xlarge", "r6i.4xlarge", "r6i.8xlarge", "r6i.12xlarge", "r6i.16xlarge", "r6i.24xlarge", "r6i.32xlarge", "r6i.metal"] },
  { family: "R6g", category: "Memory Optimized (Graviton2)", types: ["r6g.medium", "r6g.large", "r6g.xlarge", "r6g.2xlarge", "r6g.4xlarge", "r6g.8xlarge", "r6g.12xlarge", "r6g.16xlarge", "r6g.metal"] },
  { family: "R7i", category: "Memory Optimized (7th Gen)", types: ["r7i.large", "r7i.xlarge", "r7i.2xlarge", "r7i.4xlarge", "r7i.8xlarge", "r7i.12xlarge", "r7i.16xlarge", "r7i.24xlarge", "r7i.48xlarge", "r7i.metal-24xl", "r7i.metal-48xl"] },
  { family: "R7g", category: "Memory Optimized (Graviton3)", types: ["r7g.medium", "r7g.large", "r7g.xlarge", "r7g.2xlarge", "r7g.4xlarge", "r7g.8xlarge", "r7g.12xlarge", "r7g.16xlarge", "r7g.metal"] },
  { family: "X2idn", category: "Memory Optimized (High Memory)", types: ["x2idn.16xlarge", "x2idn.24xlarge", "x2idn.32xlarge", "x2idn.metal"] },
  { family: "X2iedn", category: "Memory Optimized (High Memory, NVMe)", types: ["x2iedn.xlarge", "x2iedn.2xlarge", "x2iedn.4xlarge", "x2iedn.8xlarge", "x2iedn.16xlarge", "x2iedn.24xlarge", "x2iedn.32xlarge", "x2iedn.metal"] },
  // Storage Optimized
  { family: "I3", category: "Storage Optimized", types: ["i3.large", "i3.xlarge", "i3.2xlarge", "i3.4xlarge", "i3.8xlarge", "i3.16xlarge", "i3.metal"] },
  { family: "I3en", category: "Storage Optimized (Dense)", types: ["i3en.large", "i3en.xlarge", "i3en.2xlarge", "i3en.3xlarge", "i3en.6xlarge", "i3en.12xlarge", "i3en.24xlarge", "i3en.metal"] },
  { family: "I4i", category: "Storage Optimized (4th Gen)", types: ["i4i.large", "i4i.xlarge", "i4i.2xlarge", "i4i.4xlarge", "i4i.8xlarge", "i4i.16xlarge", "i4i.32xlarge", "i4i.metal"] },
  { family: "D3", category: "Dense Storage", types: ["d3.xlarge", "d3.2xlarge", "d3.4xlarge", "d3.8xlarge"] },
  { family: "D3en", category: "Dense Storage (Enhanced)", types: ["d3en.xlarge", "d3en.2xlarge", "d3en.4xlarge", "d3en.6xlarge", "d3en.8xlarge", "d3en.12xlarge"] },
  // Accelerated Computing
  { family: "P3", category: "GPU (V100)", types: ["p3.2xlarge", "p3.8xlarge", "p3.16xlarge"] },
  { family: "P4d", category: "GPU (A100)", types: ["p4d.24xlarge"] },
  { family: "P5", category: "GPU (H100)", types: ["p5.48xlarge"] },
  { family: "G4dn", category: "GPU (T4)", types: ["g4dn.xlarge", "g4dn.2xlarge", "g4dn.4xlarge", "g4dn.8xlarge", "g4dn.12xlarge", "g4dn.16xlarge", "g4dn.metal"] },
  { family: "G5", category: "GPU (A10G)", types: ["g5.xlarge", "g5.2xlarge", "g5.4xlarge", "g5.8xlarge", "g5.12xlarge", "g5.16xlarge", "g5.24xlarge", "g5.48xlarge"] },
  { family: "G6", category: "GPU (L4)", types: ["g6.xlarge", "g6.2xlarge", "g6.4xlarge", "g6.8xlarge", "g6.12xlarge", "g6.16xlarge", "g6.24xlarge", "g6.48xlarge"] },
  { family: "Inf1", category: "Inference (Inferentia)", types: ["inf1.xlarge", "inf1.2xlarge", "inf1.6xlarge", "inf1.24xlarge"] },
  { family: "Inf2", category: "Inference (Inferentia2)", types: ["inf2.xlarge", "inf2.8xlarge", "inf2.24xlarge", "inf2.48xlarge"] },
  { family: "Trn1", category: "Training (Trainium)", types: ["trn1.2xlarge", "trn1.32xlarge"] },
  // HPC
  { family: "Hpc6a", category: "HPC (AMD)", types: ["hpc6a.48xlarge"] },
  { family: "Hpc7g", category: "HPC (Graviton3)", types: ["hpc7g.4xlarge", "hpc7g.8xlarge", "hpc7g.16xlarge"] },
  { family: "Hpc7a", category: "HPC (AMD, 7th Gen)", types: ["hpc7a.12xlarge", "hpc7a.24xlarge", "hpc7a.48xlarge", "hpc7a.96xlarge"] },
];

// Helper to get instance types filtered by workload
export function getInstanceTypesForWorkload(workload: WorkloadType): { family: string; category: string; types: string[] }[] {
  const categoryMap: Partial<Record<WorkloadType, string[]>> = {
    general: ["General Purpose", "Burstable"],
    compute: ["Compute Optimized"],
    memory: ["Memory Optimized", "High Memory"],
    storage: ["Storage Optimized", "Dense Storage"],
    accelerated: ["GPU", "Inference", "Training"],
    hpc: ["HPC"],
  };
  const keywords = categoryMap[workload] || [];
  return INSTANCE_TYPE_CATALOG.filter(g => keywords.some(k => g.category.includes(k)));
}

// ===== Mapping Functions =====

export function mapIntentToEc2Config(intent: ParsedIntent): Ec2Config {
  let instanceType: string;

  if (intent.costSensitivity === "cheapest") {
    if (intent.workloadType === "compute") instanceType = "t3.micro";
    else if (intent.workloadType === "memory") instanceType = "t3.small";
    else if (intent.workloadType === "storage") instanceType = "i3.large";
    else if (intent.workloadType === "accelerated") instanceType = "g4dn.xlarge";
    else if (intent.workloadType === "hpc") instanceType = "hpc6a.48xlarge";
    else instanceType = "t3.nano";
  } else if (intent.costSensitivity === "balanced") {
    if (intent.workloadType === "compute") instanceType = "c6i.large";
    else if (intent.workloadType === "memory") instanceType = "r6i.large";
    else if (intent.workloadType === "storage") instanceType = "i4i.large";
    else if (intent.workloadType === "accelerated") instanceType = "g5.xlarge";
    else if (intent.workloadType === "hpc") instanceType = "hpc7a.12xlarge";
    else instanceType = "m6i.large";
  } else {
    if (intent.workloadType === "compute") instanceType = "c7i.2xlarge";
    else if (intent.workloadType === "memory") instanceType = "r7i.2xlarge";
    else if (intent.workloadType === "storage") instanceType = "i4i.4xlarge";
    else if (intent.workloadType === "accelerated") instanceType = "g5.4xlarge";
    else if (intent.workloadType === "hpc") instanceType = "hpc7a.48xlarge";
    else instanceType = "m7i.xlarge";
  }

  return {
    instanceType,
    amiDescription: OS_OPTIONS.find(o => o.value === intent.os)?.label || intent.os,
    region: intent.region,
    os: intent.os,
    environment: intent.environment,
    estimatedCost: "See AWS pricing",
    // Sensible defaults
    rootVolumeSize: 20,
    rootVolumeType: "gp3",
    rootVolumeEncrypted: true,
    deleteOnTermination: true,
    associatePublicIp: intent.environment === "dev",
    instanceCount: 1,
    purchaseOption: "on-demand",
    shutdownBehavior: "stop",
    terminationProtection: intent.environment === "prod",
    detailedMonitoring: intent.environment === "prod",
    ebsOptimized: true,
    httpTokens: "required",
    httpEndpoint: true,
    creditSpecification: "standard",
    tenancy: "default",
  };
}

export function parseIntentRuleBased(input: string): Partial<ParsedIntent> {
  const lower = input.toLowerCase();
  const result: Partial<ParsedIntent> = {};

  // ── Detect resources ──
  const resources: string[] = [];
  if (/\bvpc\b/i.test(lower)) resources.push("vpc");
  if (/\bsubnet/i.test(lower)) resources.push("subnets");
  if (/\bnacl/i.test(lower) || /network.?acl/i.test(lower)) resources.push("nacls");
  if (/\beks\b/i.test(lower) || /elastic.?kubernetes/i.test(lower) || /\bkubernetes\b/i.test(lower) || /\bk8s\b/i.test(lower)) resources.push("eks");
  if (/\bec2\b/i.test(lower) || /\binstance\b/i.test(lower) || /\bserver\b/i.test(lower) || /\bvm\b/i.test(lower)) resources.push("ec2");
  if (/\bs3\b/i.test(lower) || /storage.?bucket/i.test(lower)) resources.push("s3");
  if (/\bcloudfront\b/i.test(lower) || /cdn/i.test(lower)) resources.push("cloudfront");
  if (/\bsqs\b/i.test(lower) || /queue/i.test(lower)) resources.push("sqs");
  if (/\blambda\b/i.test(lower) || /function/i.test(lower)) resources.push("lambda");
  if (/\bapi\b/i.test(lower) || /gateway/i.test(lower)) resources.push("api-gateway");
  if (/\brds\b/i.test(lower) || /database/i.test(lower) || /postgres/i.test(lower) || /aurora/i.test(lower)) resources.push("rds");

  // If VPC mentioned but no subnets/nacls explicitly, include them as they're needed
  if (resources.includes("vpc") && !resources.includes("subnets")) resources.push("subnets");
  // If nothing specific detected, default to ec2
  if (!resources.length) resources.push("ec2");
  result.resources = resources;

  // Workload / Pattern Detection
  if (/global.?dashboard|static.?site|spa|global.?spa|cloudfront/i.test(lower)) result.workloadType = "global-spa";
  else if (/microservice|service.?mesh|app.?mesh|mesh/i.test(lower)) result.workloadType = "service-mesh";
  else if (/queue|pipeline|event.?driven|sqs|event.?bridge/i.test(lower)) result.workloadType = "event-pipeline";
  else if (/internal.?api|internal.?tool|bff|api.?gateway/i.test(lower)) result.workloadType = "internal-api";
  else if (/3-tier|monolith|legacy|asg|enterprise/i.test(lower)) result.workloadType = "three-tier";
  else if (/gpu|accelerat|machine.?learn|deep.?learn|train|infer/i.test(lower)) result.workloadType = "accelerated";
  else if (/hpc|high.?perf|supercomput/i.test(lower)) result.workloadType = "hpc";
  else if (/storage|disk|iops|nvme|database/i.test(lower)) result.workloadType = "storage";
  else if (/comput|cpu|processor|batch|crunch/i.test(lower)) result.workloadType = "compute";
  else if (/memory|ram|cache|redis|in-memory/i.test(lower)) result.workloadType = "memory";
  else result.workloadType = "general";

  // Cost — "right size" maps to balanced
  if (/cheap|small|minimal|free|low.?cost|budget|tiny|nano/i.test(lower)) result.costSensitivity = "cheapest";
  else if (/prod|production|enterprise|high.?avail|reliable|critical/i.test(lower)) result.costSensitivity = "production";
  else if (/right.?siz/i.test(lower) || /balanced/i.test(lower)) result.costSensitivity = "balanced";
  else result.costSensitivity = "balanced";

  // Environment
  if (/prod(uction)?/i.test(lower) && !/non.?prod/i.test(lower)) result.environment = "prod";
  else if (/stag/i.test(lower)) result.environment = "staging";
  else result.environment = "dev";

  // OS
  if (/ubuntu|debian/i.test(lower)) result.os = "ubuntu";
  else if (/debian/i.test(lower)) result.os = "debian";
  else if (/red.?hat|rhel/i.test(lower)) result.os = "rhel";
  else if (/suse|sles/i.test(lower)) result.os = "suse";
  else if (/windows/i.test(lower)) result.os = "windows-2022";
  else result.os = "amazon-linux-2023";

  // Region
  if (/europe|eu|ireland|frankfurt|london|paris|stockholm|milan|spain|zurich/i.test(lower)) {
    if (/frankfurt/i.test(lower)) result.region = "eu-central-1";
    else if (/london/i.test(lower)) result.region = "eu-west-2";
    else if (/paris/i.test(lower)) result.region = "eu-west-3";
    else if (/stockholm/i.test(lower)) result.region = "eu-north-1";
    else if (/milan/i.test(lower)) result.region = "eu-south-1";
    else if (/zurich/i.test(lower)) result.region = "eu-central-2";
    else result.region = "eu-west-1";
  } else if (/tokyo|japan/i.test(lower)) result.region = "ap-northeast-1";
  else if (/seoul|korea/i.test(lower)) result.region = "ap-northeast-2";
  else if (/mumbai|india/i.test(lower)) result.region = "ap-south-1";
  else if (/sydney|australia/i.test(lower)) result.region = "ap-southeast-2";
  else if (/singapore/i.test(lower)) result.region = "ap-southeast-1";
  else if (/hong.?kong/i.test(lower)) result.region = "ap-east-1";
  else if (/canada|toronto/i.test(lower)) result.region = "ca-central-1";
  else if (/brazil|são.?paulo|sao.?paulo/i.test(lower)) result.region = "sa-east-1";
  else if (/bahrain|middle.?east/i.test(lower)) result.region = "me-south-1";
  else if (/cape.?town|africa/i.test(lower)) result.region = "af-south-1";
  else if (/israel|tel.?aviv/i.test(lower)) result.region = "il-central-1";
  else if (/ohio/i.test(lower)) result.region = "us-east-2";
  else if (/california/i.test(lower)) result.region = "us-west-1";
  else if (/oregon|west/i.test(lower)) result.region = "us-west-2";
  else result.region = "us-east-1";

  return result;
}
