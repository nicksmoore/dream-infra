/**
 * V3 Golden Path Fixtures
 *
 * Each fixture maps a prompt to its canonical { intent, action, spec } triple.
 *
 * expectsManifestEntry: true
 *   → prepareOperation(intent, action, "aws", spec) must succeed (no ManifestError).
 *     Spec keys MUST match the first manifest entry's required_keys (camelCase).
 *     These are the "primary" resource type for each intent/action pair.
 *
 * expectsManifestEntry: false
 *   → Sub-resource or handler-only path. The manifest's first entry won't match
 *     this resource_type, so prepareOperation returns NOT_FOUND or MISSING_REQUIRED_KEY.
 *     The request still works via the handler's own routing. Kept as documentation.
 *
 * Prompts sourced from the comprehensive v3 test prompt list (2026-03-28).
 */

export interface GoldenPathFixture {
  label: string;
  intent: string;
  action: string;
  spec: Record<string, unknown>;
  expectsManifestEntry: boolean;
}

export const V3_GOLDEN_FIXTURES: GoldenPathFixture[] = [

  // ── STORAGE ──────────────────────────────────────────────────────────────────
  // First manifest entry for storage/deploy/aws requires: region, bucketName

  {
    label: "storage/deploy/s3 — create bucket with object lock",
    intent: "storage",
    action: "deploy",
    spec: { region: "us-east-1", bucketName: "prod-assets", object_lock: true },
    expectsManifestEntry: true,
  },
  {
    label: "storage/deploy/efs — provision filesystem (sub-resource, handler-only)",
    intent: "storage",
    action: "deploy",
    spec: { region: "us-west-2", resource_type: "efs", creationToken: "efs-prod-2026" },
    expectsManifestEntry: false,
  },
  {
    label: "storage/discover/s3 — list all buckets",
    intent: "storage",
    action: "discover",
    spec: { region: "us-east-1" },
    expectsManifestEntry: true,
  },
  {
    label: "storage/discover/ebs — list volumes (sub-resource, handler-only)",
    intent: "storage",
    action: "discover",
    spec: { region: "eu-west-1", resource_type: "ebs" },
    expectsManifestEntry: false,
  },
  {
    label: "storage/destroy/s3 — delete bucket",
    intent: "storage",
    action: "destroy",
    spec: { region: "us-east-1", bucketName: "old-archive-bucket" },
    expectsManifestEntry: true,
  },
  {
    label: "storage/destroy/ebs — delete volume (sub-resource, handler-only)",
    intent: "storage",
    action: "destroy",
    spec: { region: "us-west-2", resource_type: "ebs", volume_id: "vol-0abc123def" },
    expectsManifestEntry: false,
  },
  {
    label: "storage/status/s3 — check versioning",
    intent: "storage",
    action: "status",
    spec: { region: "us-east-1", bucketName: "prod-assets" },
    expectsManifestEntry: true,
  },

  // ── DATABASE ─────────────────────────────────────────────────────────────────
  // First manifest entry for database/deploy/aws requires: region, dbInstanceId, masterUsername, masterPassword

  {
    label: "database/deploy/rds — create postgres instance",
    intent: "database",
    action: "deploy",
    spec: {
      region: "us-east-1",
      dbInstanceId: "db-prod-01",
      masterUsername: "admin",
      masterPassword: "s3cur3pass",
      engine: "postgres",
    },
    expectsManifestEntry: true,
  },
  {
    label: "database/deploy/dynamodb — create table (sub-resource, handler-only)",
    intent: "database",
    action: "deploy",
    spec: {
      region: "us-west-2",
      resource_type: "dynamodb",
      table_name: "UserSessions",
      partition_key: "userId",
    },
    expectsManifestEntry: false,
  },
  {
    label: "database/deploy/elasticache — create redis replication group (sub-resource, handler-only)",
    intent: "database",
    action: "deploy",
    spec: {
      region: "us-east-1",
      resource_type: "elasticache",
      replication_group_id: "cache-prod",
      description: "prod cache",
    },
    expectsManifestEntry: false,
  },
  {
    label: "database/discover/rds — list all instances",
    intent: "database",
    action: "discover",
    spec: { region: "us-east-1" },
    expectsManifestEntry: true,
  },
  {
    label: "database/discover/dynamodb — list all tables (sub-resource, handler-only)",
    intent: "database",
    action: "discover",
    spec: { region: "eu-central-1", resource_type: "dynamodb" },
    expectsManifestEntry: false,
  },
  {
    label: "database/discover/elasticache — show replication groups (sub-resource, handler-only)",
    intent: "database",
    action: "discover",
    spec: { region: "us-west-2", resource_type: "elasticache" },
    expectsManifestEntry: false,
  },
  {
    label: "database/destroy/rds — delete instance, skip final snapshot",
    intent: "database",
    action: "destroy",
    spec: {
      region: "us-east-1",
      dbInstanceId: "db-staging-01",
      skip_final_snapshot: true,
    },
    expectsManifestEntry: true,
  },
  {
    label: "database/status/rds — check instance status",
    intent: "database",
    action: "status",
    spec: { region: "us-east-1", dbInstanceId: "db-prod-01" },
    expectsManifestEntry: true,
  },

  // ── SERVERLESS ───────────────────────────────────────────────────────────────
  // First manifest entry for serverless/deploy/aws requires: region, functionName, roleArn, codeBucket, codeKey

  {
    label: "serverless/deploy/lambda — deploy function from S3",
    intent: "serverless",
    action: "deploy",
    spec: {
      region: "us-east-1",
      functionName: "process-orders",
      codeBucket: "deploy-artifacts",
      codeKey: "orders.zip",
      roleArn: "arn:aws:iam::123456789:role/lambda-exec",
    },
    expectsManifestEntry: true,
  },
  {
    label: "serverless/deploy/apprunner — deploy service from ECR (sub-resource, handler-only)",
    intent: "serverless",
    action: "deploy",
    spec: {
      region: "us-east-1",
      resource_type: "apprunner",
      service_name: "api-service",
      image_uri: "123456789.dkr.ecr.us-east-1.amazonaws.com/api:latest",
    },
    expectsManifestEntry: false,
  },
  {
    label: "serverless/discover/lambda — list all functions",
    intent: "serverless",
    action: "discover",
    spec: { region: "us-west-2" },
    expectsManifestEntry: true,
  },
  {
    label: "serverless/destroy/lambda — delete function",
    intent: "serverless",
    action: "destroy",
    spec: { region: "us-east-1", functionName: "legacy-handler" },
    expectsManifestEntry: true,
  },
  {
    label: "serverless/status/lambda — get configuration",
    intent: "serverless",
    action: "status",
    spec: { region: "us-east-1", functionName: "process-orders" },
    expectsManifestEntry: true,
  },

  // ── CDN ──────────────────────────────────────────────────────────────────────
  // cdn/deploy/aws requires: originDomain, originId, callerReference (no region — CloudFront is global)

  {
    label: "cdn/deploy/cloudfront — create distribution",
    intent: "cdn",
    action: "deploy",
    spec: {
      originDomain: "api.example.com",
      originId: "api-origin",
      callerReference: "cf-2026-03-28",
    },
    expectsManifestEntry: true,
  },
  {
    label: "cdn/discover/cloudfront — list all distributions",
    intent: "cdn",
    action: "discover",
    spec: {},
    expectsManifestEntry: true,
  },
  {
    label: "cdn/destroy/cloudfront — delete distribution",
    intent: "cdn",
    action: "destroy",
    spec: { distributionId: "E1ABCD2EFGHIJK" },
    expectsManifestEntry: true,
  },
  {
    label: "cdn/status/cloudfront — check distribution status",
    intent: "cdn",
    action: "status",
    spec: { distributionId: "E1ABCD2EFGHIJK" },
    expectsManifestEntry: true,
  },

  // ── DNS ──────────────────────────────────────────────────────────────────────
  // dns/deploy/aws requires: domainName, callerReference (no region — Route53 is global)

  {
    label: "dns/deploy/route53 — create hosted zone",
    intent: "dns",
    action: "deploy",
    spec: { domainName: "example.com", callerReference: "hz-2026-03-28" },
    expectsManifestEntry: true,
  },
  {
    label: "dns/discover/route53 — list all hosted zones",
    intent: "dns",
    action: "discover",
    spec: {},
    expectsManifestEntry: true,
  },
  {
    label: "dns/destroy/route53 — delete hosted zone",
    intent: "dns",
    action: "destroy",
    spec: { hostedZoneId: "Z1ABCDEF123456" },
    expectsManifestEntry: true,
  },
  {
    label: "dns/status/route53 — get zone details",
    intent: "dns",
    action: "status",
    spec: { hostedZoneId: "Z1ABCDEF123456" },
    expectsManifestEntry: true,
  },

  // ── LOAD BALANCER ─────────────────────────────────────────────────────────────
  // loadbalancer/deploy/aws requires: region, lbName, subnet1, subnet2
  // loadbalancer/destroy/aws requires: region, lbArn
  // loadbalancer/status/aws requires: region, lbArn

  {
    label: "loadbalancer/deploy/alb — create application load balancer",
    intent: "loadbalancer",
    action: "deploy",
    spec: {
      region: "us-east-1",
      lbName: "prod-alb",
      subnet1: "subnet-aaa111",
      subnet2: "subnet-bbb222",
    },
    expectsManifestEntry: true,
  },
  {
    label: "load-balancer alias/deploy/alb — alias normalizes to loadbalancer",
    intent: "load-balancer",
    action: "deploy",
    spec: {
      region: "us-east-1",
      lbName: "prod-alb",
      subnet1: "subnet-aaa111",
      subnet2: "subnet-bbb222",
    },
    expectsManifestEntry: true,
  },
  {
    label: "loadbalancer/discover — list all load balancers",
    intent: "loadbalancer",
    action: "discover",
    spec: { region: "us-east-1" },
    expectsManifestEntry: true,
  },
  {
    label: "loadbalancer/destroy — delete by ARN",
    intent: "loadbalancer",
    action: "destroy",
    spec: {
      region: "us-east-1",
      lbArn: "arn:aws:elasticloadbalancing:us-east-1:123456789:loadbalancer/app/prod-alb/abc123",
    },
    expectsManifestEntry: true,
  },
  {
    label: "loadbalancer/status — check status by ARN",
    intent: "loadbalancer",
    action: "status",
    spec: {
      region: "us-east-1",
      lbArn: "arn:aws:elasticloadbalancing:us-east-1:123456789:loadbalancer/app/prod-alb/abc123",
    },
    expectsManifestEntry: true,
  },

  // ── SECURITY ──────────────────────────────────────────────────────────────────
  // First manifest entry for security/deploy/aws requires: roleName, assumeRolePolicy (no region — IAM is global)
  // Sub-resources (WAF, GuardDuty, SecurityHub, CloudTrail, Config) are handler-only

  {
    label: "security/deploy/iam-role — create lambda exec role",
    intent: "security",
    action: "deploy",
    spec: {
      roleName: "LambdaExecRole",
      assumeRolePolicy: '{"Version":"2012-10-17","Statement":[{"Effect":"Allow","Principal":{"Service":"lambda.amazonaws.com"},"Action":"sts:AssumeRole"}]}',
    },
    expectsManifestEntry: true,
  },
  {
    label: "security/deploy/waf — create web ACL (sub-resource, handler-only)",
    intent: "security",
    action: "deploy",
    spec: {
      region: "us-east-1",
      resource_type: "waf",
      waf_name: "prod-waf",
      default_action: "block",
    },
    expectsManifestEntry: false,
  },
  {
    label: "security/deploy/guardduty — enable detector (sub-resource, handler-only)",
    intent: "security",
    action: "deploy",
    spec: {
      region: "us-east-1",
      resource_type: "guardduty",
      finding_frequency: "FIFTEEN_MINUTES",
    },
    expectsManifestEntry: false,
  },
  {
    label: "security/deploy/securityhub — enable (sub-resource, handler-only)",
    intent: "security",
    action: "deploy",
    spec: { region: "us-east-1", resource_type: "securityhub" },
    expectsManifestEntry: false,
  },
  {
    label: "security/deploy/cloudtrail — create multi-region trail (sub-resource, handler-only)",
    intent: "security",
    action: "deploy",
    spec: {
      region: "us-east-1",
      resource_type: "cloudtrail",
      trail_name: "org-audit-trail",
      s3_bucket: "audit-logs-prod",
      multi_region: true,
      log_validation: true,
    },
    expectsManifestEntry: false,
  },
  {
    label: "security/deploy/config — set up recorder (sub-resource, handler-only)",
    intent: "security",
    action: "deploy",
    spec: {
      region: "us-east-1",
      resource_type: "config",
      recorder_name: "default-recorder",
      role_arn: "arn:aws:iam::123456789:role/config-role",
    },
    expectsManifestEntry: false,
  },
  {
    label: "security/discover/iam-roles — list all roles",
    intent: "security",
    action: "discover",
    spec: {},
    expectsManifestEntry: true,
  },
  {
    label: "security/discover/waf — list web ACLs (sub-resource, handler-only)",
    intent: "security",
    action: "discover",
    spec: { region: "us-east-1", resource_type: "waf" },
    expectsManifestEntry: false,
  },
  {
    label: "security/discover/guardduty — list detectors (sub-resource, handler-only)",
    intent: "security",
    action: "discover",
    spec: { region: "us-east-1", resource_type: "guardduty" },
    expectsManifestEntry: false,
  },
  {
    label: "security/discover/securityhub — show findings (sub-resource, handler-only)",
    intent: "security",
    action: "discover",
    spec: { region: "us-east-1", resource_type: "securityhub" },
    expectsManifestEntry: false,
  },
  {
    label: "security/discover/cloudtrail — list trails (sub-resource, handler-only)",
    intent: "security",
    action: "discover",
    spec: { region: "us-east-1", resource_type: "cloudtrail" },
    expectsManifestEntry: false,
  },
  {
    label: "security/destroy/iam-role — delete role",
    intent: "security",
    action: "destroy",
    spec: { roleName: "OldDeployRole" },
    expectsManifestEntry: true,
  },
  {
    label: "security/status/iam-role — get role details",
    intent: "security",
    action: "status",
    spec: { roleName: "LambdaExecRole" },
    expectsManifestEntry: true,
  },

  // ── GATEWAY ───────────────────────────────────────────────────────────────────
  // gateway/deploy/aws requires: region, apiName
  // Sub-resource vpc-endpoint is handler-only

  {
    label: "gateway/deploy/apigateway — create HTTP API",
    intent: "gateway",
    action: "deploy",
    spec: { region: "us-east-1", apiName: "orders-api" },
    expectsManifestEntry: true,
  },
  {
    label: "gateway/deploy/vpc-endpoint — create interface endpoint (sub-resource, handler-only)",
    intent: "gateway",
    action: "deploy",
    spec: {
      region: "us-east-1",
      resource_type: "vpc-endpoint",
      service_name: "com.amazonaws.us-east-1.s3",
      vpc_id: "vpc-abc123",
    },
    expectsManifestEntry: false,
  },
  {
    label: "gateway/discover/apigateway — list all APIs",
    intent: "gateway",
    action: "discover",
    spec: { region: "us-east-1" },
    expectsManifestEntry: true,
  },
  {
    label: "gateway/discover/vpc-endpoints (sub-resource, handler-only)",
    intent: "gateway",
    action: "discover",
    spec: { region: "us-east-1", resource_type: "vpc-endpoint" },
    expectsManifestEntry: false,
  },
  {
    label: "gateway/destroy/apigateway — delete API",
    intent: "gateway",
    action: "destroy",
    spec: { region: "us-east-1", apiId: "abc123xyz" },
    expectsManifestEntry: true,
  },
  {
    label: "gateway/status/apigateway — get API status",
    intent: "gateway",
    action: "status",
    spec: { region: "us-east-1", apiId: "abc123xyz" },
    expectsManifestEntry: true,
  },

  // ── SECRETS ───────────────────────────────────────────────────────────────────
  // secrets/deploy/aws requires: region, secretName, secretValue
  // secrets/destroy/aws requires: region, secretId
  // secrets/status/aws requires: region, secretId
  // KMS is a sub-resource (handler-only)

  {
    label: "secrets/deploy/secretsmanager — create secret",
    intent: "secrets",
    action: "deploy",
    spec: {
      region: "us-east-1",
      secretName: "prod/db/password",
      secretValue: "MySecretPass123",
    },
    expectsManifestEntry: true,
  },
  {
    label: "secrets/deploy/kms — create symmetric key (sub-resource, handler-only)",
    intent: "secrets",
    action: "deploy",
    spec: {
      region: "us-east-1",
      resource_type: "kms",
      description: "prod-data-encryption",
    },
    expectsManifestEntry: false,
  },
  {
    label: "secrets/discover/secretsmanager — list all secrets",
    intent: "secrets",
    action: "discover",
    spec: { region: "us-east-1" },
    expectsManifestEntry: true,
  },
  {
    label: "secrets/discover/kms — list all keys (sub-resource, handler-only)",
    intent: "secrets",
    action: "discover",
    spec: { region: "us-east-1", resource_type: "kms" },
    expectsManifestEntry: false,
  },
  {
    label: "secrets/destroy/secretsmanager — delete with recovery window",
    intent: "secrets",
    action: "destroy",
    spec: {
      region: "us-east-1",
      secretId: "prod/db/password",
      recovery_window_days: 30,
    },
    expectsManifestEntry: true,
  },
  {
    label: "secrets/status/secretsmanager — describe secret",
    intent: "secrets",
    action: "status",
    spec: { region: "us-east-1", secretId: "prod/db/password" },
    expectsManifestEntry: true,
  },

  // ── OBSERVABILITY ─────────────────────────────────────────────────────────────
  // observability/deploy/aws requires: region, alarmName, namespace, metricName, comparisonOperator, threshold
  // Log group is a sub-resource (handler-only)

  {
    label: "observability/deploy/cloudwatch-alarm — create CPU alarm",
    intent: "observability",
    action: "deploy",
    spec: {
      region: "us-east-1",
      alarmName: "high-cpu-prod",
      metricName: "CPUUtilization",
      namespace: "AWS/EC2",
      threshold: 80,
      comparisonOperator: "GreaterThanThreshold",
    },
    expectsManifestEntry: true,
  },
  {
    label: "observability/deploy/log-group — create log group (sub-resource, handler-only)",
    intent: "observability",
    action: "deploy",
    spec: {
      region: "us-east-1",
      resource_type: "log-group",
      log_group_name: "/app/prod/api",
      retention_days: 90,
    },
    expectsManifestEntry: false,
  },
  {
    label: "observability/discover/cloudwatch-alarm — list all alarms",
    intent: "observability",
    action: "discover",
    spec: { region: "us-east-1" },
    expectsManifestEntry: true,
  },
  {
    label: "observability/destroy/cloudwatch-alarm — delete alarm",
    intent: "observability",
    action: "destroy",
    spec: { region: "us-east-1", alarmName: "high-cpu-prod" },
    expectsManifestEntry: true,
  },
  {
    label: "observability/status/cloudwatch-alarm — check alarm state",
    intent: "observability",
    action: "status",
    spec: { region: "us-east-1", alarmName: "high-cpu-prod" },
    expectsManifestEntry: true,
  },

  // ── ORCHESTRATION ─────────────────────────────────────────────────────────────
  // orchestration/deploy/aws requires: region, stateMachineName, definition, roleArn
  // EventBridge and SSM are sub-resources (handler-only)

  {
    label: "orchestration/deploy/stepfunctions — create state machine",
    intent: "orchestration",
    action: "deploy",
    spec: {
      region: "us-east-1",
      stateMachineName: "order-workflow",
      roleArn: "arn:aws:iam::123456789:role/sfn-role",
      definition: '{"Comment":"Order flow","StartAt":"Process","States":{"Process":{"Type":"Pass","End":true}}}',
    },
    expectsManifestEntry: true,
  },
  {
    label: "orchestration/deploy/eventbridge — create event bus (sub-resource, handler-only)",
    intent: "orchestration",
    action: "deploy",
    spec: { region: "us-east-1", resource_type: "eventbridge", bus_name: "order-events" },
    expectsManifestEntry: false,
  },
  {
    label: "orchestration/deploy/ssm — store parameter (sub-resource, handler-only)",
    intent: "orchestration",
    action: "deploy",
    spec: {
      region: "us-east-1",
      resource_type: "ssm",
      parameter_name: "/prod/api/key",
      parameter_value: "abc-secret-xyz",
      parameter_type: "SecureString",
    },
    expectsManifestEntry: false,
  },
  {
    label: "orchestration/discover/stepfunctions — list state machines",
    intent: "orchestration",
    action: "discover",
    spec: { region: "us-east-1" },
    expectsManifestEntry: true,
  },
  {
    label: "orchestration/discover/eventbridge — list event buses (sub-resource, handler-only)",
    intent: "orchestration",
    action: "discover",
    spec: { region: "us-east-1", resource_type: "eventbridge" },
    expectsManifestEntry: false,
  },
  {
    label: "orchestration/discover/ssm — list parameters (sub-resource, handler-only)",
    intent: "orchestration",
    action: "discover",
    spec: { region: "us-east-1", resource_type: "ssm" },
    expectsManifestEntry: false,
  },
  {
    label: "orchestration/destroy/stepfunctions — delete state machine by ARN",
    intent: "orchestration",
    action: "destroy",
    spec: {
      region: "us-east-1",
      stateMachineArn: "arn:aws:states:us-east-1:123456789:stateMachine:order-workflow",
    },
    expectsManifestEntry: true,
  },
  {
    label: "orchestration/status/stepfunctions — describe state machine",
    intent: "orchestration",
    action: "status",
    spec: {
      region: "us-east-1",
      stateMachineArn: "arn:aws:states:us-east-1:123456789:stateMachine:order-workflow",
    },
    expectsManifestEntry: true,
  },

  // ── AI / ML ───────────────────────────────────────────────────────────────────
  // ai/deploy/aws requires: region, modelId, provisionedModelName
  // ai/status/aws requires: region, provisionedModelId

  {
    label: "ai/deploy/bedrock — provision throughput for claude model",
    intent: "ai",
    action: "deploy",
    spec: {
      region: "us-east-1",
      modelId: "anthropic.claude-3-5-sonnet-20241022-v2:0",
      provisionedModelName: "claude-prod",
    },
    expectsManifestEntry: true,
  },
  {
    label: "ai/discover/bedrock — list foundation models",
    intent: "ai",
    action: "discover",
    spec: { region: "us-east-1" },
    expectsManifestEntry: true,
  },
  {
    label: "ai/status/bedrock — check provisioned model status",
    intent: "ai",
    action: "status",
    spec: { region: "us-east-1", provisionedModelId: "abc123provisionedmodelid" },
    expectsManifestEntry: true,
  },

  // ── CONTAINER ─────────────────────────────────────────────────────────────────
  // container/deploy/aws requires: region, clusterName
  // container/destroy/aws requires: region, clusterArn
  // container/status/aws requires: region, clusterArn

  {
    label: "container/deploy/ecs — create fargate cluster with insights",
    intent: "container",
    action: "deploy",
    spec: { region: "us-east-1", clusterName: "prod-cluster", container_insights: true },
    expectsManifestEntry: true,
  },
  {
    label: "container/discover/ecs — list all clusters",
    intent: "container",
    action: "discover",
    spec: { region: "us-east-1" },
    expectsManifestEntry: true,
  },
  {
    label: "container/destroy/ecs — delete cluster by ARN",
    intent: "container",
    action: "destroy",
    spec: {
      region: "us-east-1",
      clusterArn: "arn:aws:ecs:us-east-1:123456789:cluster/prod-cluster",
    },
    expectsManifestEntry: true,
  },
  {
    label: "container/status/ecs — describe cluster",
    intent: "container",
    action: "status",
    spec: {
      region: "us-east-1",
      clusterArn: "arn:aws:ecs:us-east-1:123456789:cluster/prod-cluster",
    },
    expectsManifestEntry: true,
  },

  // ── GAP ANALYSIS ─────────────────────────────────────────────────────────────
  // gap-analysis/discover/aws requires: region (no resource_type in required_keys)
  // gap-analysis/destroy/aws requires: region, allocationId (first entry = elastic-ip release)
  // Snapshot delete is a sub-resource (handler-only, uses snapshotId key)

  {
    label: "gap-analysis/discover/snapshots — find orphaned EBS snapshots",
    intent: "gap-analysis",
    action: "discover",
    spec: { region: "us-east-1", resource_type: "snapshots" },
    expectsManifestEntry: true,
  },
  {
    label: "gap-analysis/discover/elastic-ips — find unused Elastic IPs",
    intent: "gap-analysis",
    action: "discover",
    spec: { region: "us-east-1", resource_type: "elastic-ips" },
    expectsManifestEntry: true,
  },
  {
    label: "gap-analysis/discover/security-groups — audit open 0.0.0.0/0 rules",
    intent: "gap-analysis",
    action: "discover",
    spec: { region: "us-east-1", resource_type: "security-groups" },
    expectsManifestEntry: true,
  },
  {
    label: "gap-analysis/discover/route53-records — list dangling records",
    intent: "gap-analysis",
    action: "discover",
    spec: { region: "us-east-1", resource_type: "route53-records", zone_id: "Z1ABCDEF123456" },
    expectsManifestEntry: true,
  },
  {
    label: "gap-analysis/discover/unattached-volumes — find unattached EBS",
    intent: "gap-analysis",
    action: "discover",
    spec: { region: "us-east-1", resource_type: "unattached-volumes" },
    expectsManifestEntry: true,
  },
  {
    label: "gap alias/discover — gap normalizes to gap-analysis",
    intent: "gap",
    action: "discover",
    spec: { region: "us-east-1", resource_type: "elastic-ips" },
    expectsManifestEntry: true,
  },
  {
    label: "gap-analysis/destroy/elastic-ip — release allocation",
    intent: "gap-analysis",
    action: "destroy",
    spec: { region: "us-east-1", allocationId: "eipalloc-0abc123def456" },
    expectsManifestEntry: true,
  },
  {
    label: "gap-analysis/destroy/snapshot — delete orphaned snapshot (sub-resource, handler-only)",
    intent: "gap-analysis",
    action: "destroy",
    spec: { region: "us-east-1", resource_type: "snapshots", snapshot_id: "snap-0abc123def456789" },
    expectsManifestEntry: false,
  },
];
