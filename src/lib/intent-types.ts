export type WorkloadType = "general" | "compute" | "memory";
export type CostSensitivity = "cheapest" | "balanced" | "production";
export type Environment = "dev" | "staging" | "prod";
export type AwsRegion = "us-east-1" | "us-west-2" | "eu-west-1" | "ap-southeast-1";
export type OsType = "amazon-linux-2023" | "ubuntu";

export interface ParsedIntent {
  workloadType: WorkloadType;
  costSensitivity: CostSensitivity;
  environment: Environment;
  region: AwsRegion;
  os: OsType;
}

export interface Ec2Config {
  instanceType: string;
  amiDescription: string;
  region: string;
  os: string;
  environment: string;
  estimatedCost: string;
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

export const WORKLOAD_OPTIONS: { value: WorkloadType; label: string }[] = [
  { value: "general", label: "General Purpose" },
  { value: "compute", label: "Compute Intensive" },
  { value: "memory", label: "Memory Intensive" },
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
  { value: "us-east-1", label: "US East (N. Virginia)" },
  { value: "us-west-2", label: "US West (Oregon)" },
  { value: "eu-west-1", label: "EU (Ireland)" },
  { value: "ap-southeast-1", label: "Asia Pacific (Singapore)" },
];

export const OS_OPTIONS: { value: OsType; label: string }[] = [
  { value: "amazon-linux-2023", label: "Amazon Linux 2023" },
  { value: "ubuntu", label: "Ubuntu 24.04 LTS" },
];

export function mapIntentToEc2Config(intent: ParsedIntent): Ec2Config {
  let instanceType: string;

  if (intent.costSensitivity === "cheapest") {
    instanceType = intent.workloadType === "compute" ? "t3.micro" : "t3.nano";
  } else if (intent.costSensitivity === "balanced") {
    if (intent.workloadType === "compute") instanceType = "c5.large";
    else if (intent.workloadType === "memory") instanceType = "r5.large";
    else instanceType = "t3.medium";
  } else {
    if (intent.workloadType === "compute") instanceType = "c5.xlarge";
    else if (intent.workloadType === "memory") instanceType = "r5.large";
    else instanceType = "m5.large";
  }

  const costMap: Record<string, string> = {
    "t3.nano": "~$3.80/mo",
    "t3.micro": "~$7.60/mo",
    "t3.medium": "~$30.40/mo",
    "c5.large": "~$62/mo",
    "c5.xlarge": "~$124/mo",
    "r5.large": "~$91/mo",
    "m5.large": "~$70/mo",
  };

  return {
    instanceType,
    amiDescription: intent.os === "amazon-linux-2023" ? "Amazon Linux 2023" : "Ubuntu 24.04 LTS",
    region: intent.region,
    os: intent.os,
    environment: intent.environment,
    estimatedCost: costMap[instanceType] || "Unknown",
  };
}

export function parseIntentRuleBased(input: string): Partial<ParsedIntent> {
  const lower = input.toLowerCase();
  const result: Partial<ParsedIntent> = {};

  // Workload
  if (/comput|cpu|processor|batch|crunch/i.test(lower)) result.workloadType = "compute";
  else if (/memory|ram|cache|redis|in-memory/i.test(lower)) result.workloadType = "memory";
  else result.workloadType = "general";

  // Cost
  if (/cheap|small|minimal|free|low.?cost|budget|tiny|nano/i.test(lower)) result.costSensitivity = "cheapest";
  else if (/prod|production|enterprise|high.?avail|reliable|critical/i.test(lower)) result.costSensitivity = "production";
  else result.costSensitivity = "balanced";

  // Environment
  if (/prod(uction)?/i.test(lower) && !/non.?prod/i.test(lower)) result.environment = "prod";
  else if (/stag/i.test(lower)) result.environment = "staging";
  else result.environment = "dev";

  // OS
  if (/ubuntu|debian/i.test(lower)) result.os = "ubuntu";
  else result.os = "amazon-linux-2023";

  // Region
  if (/europe|eu|ireland/i.test(lower)) result.region = "eu-west-1";
  else if (/asia|singapore|ap/i.test(lower)) result.region = "ap-southeast-1";
  else if (/oregon|west/i.test(lower)) result.region = "us-west-2";
  else result.region = "us-east-1";

  return result;
}
