import * as cdk from "aws-cdk-lib";
import type * as ec2 from "aws-cdk-lib/aws-ec2";
import type * as ecr from "aws-cdk-lib/aws-ecr";
import * as ecs from "aws-cdk-lib/aws-ecs";
import * as elbv2 from "aws-cdk-lib/aws-elasticloadbalancingv2";
import * as iam from "aws-cdk-lib/aws-iam";
import * as logs from "aws-cdk-lib/aws-logs";
import type * as s3 from "aws-cdk-lib/aws-s3";
import type * as secretsmanager from "aws-cdk-lib/aws-secretsmanager";
import * as servicediscovery from "aws-cdk-lib/aws-servicediscovery";
import type * as ssm from "aws-cdk-lib/aws-ssm";
import type { Construct } from "constructs";
import {
  ALB_DEREGISTRATION_DELAY_SECONDS,
  ALB_IDLE_TIMEOUT_SECONDS,
  ALB_STICKINESS_DURATION_SECONDS,
  BEDROCK_MODEL_ARN_PATTERN,
  CLOUD_MAP_DNS_TTL_SECONDS,
  CLOUD_MAP_NAMESPACE,
  ECS_SIZING,
  HEALTH_CHECK_GRACE_PERIOD_SECONDS,
  HEALTH_CHECK_PATH,
  RATE_LIMIT_GITHUB_RPM,
  REGION,
} from "./config";

export interface ComputeStackProps extends cdk.StackProps {
  vpc: ec2.IVpc;
  sgAlb: ec2.ISecurityGroup;
  sgBackend: ec2.ISecurityGroup;
  sgAgents: ec2.ISecurityGroup;
  backendRepo: ecr.IRepository;
  agentsRepo: ecr.IRepository;
  artifactsBucket: s3.IBucket;
  ciRole: iam.IRole;
  secretMongoUri: secretsmanager.ISecret;
  secretJwt: secretsmanager.ISecret;
  secretCredentialMasterKey: secretsmanager.ISecret;
  secretInternalSharedSecret: secretsmanager.ISecret;
  paramRedisUrl: ssm.IStringParameter;
  paramBackendBaseUrl: ssm.IStringParameter;
  paramLlmProvider: ssm.IStringParameter;
}

// ECS Fargate (backend + agents), Cloud Map, ALB. They live in a single
// stack because they are coupled at runtime (target group -> service ->
// namespace).
export class ComputeStack extends cdk.Stack {
  public readonly cluster: ecs.Cluster;
  public readonly alb: elbv2.ApplicationLoadBalancer;
  public readonly backendService: ecs.FargateService;
  public readonly agentsService: ecs.FargateService;
  public readonly backendTargetGroup: elbv2.ApplicationTargetGroup;

  constructor(scope: Construct, id: string, props: ComputeStackProps) {
    super(scope, id, props);
    const {
      vpc,
      sgAlb,
      sgBackend,
      sgAgents,
      backendRepo,
      agentsRepo,
      artifactsBucket,
      ciRole,
      secretMongoUri,
      secretJwt,
      secretCredentialMasterKey,
      secretInternalSharedSecret,
      paramRedisUrl,
      paramBackendBaseUrl,
      paramLlmProvider,
    } = props;

    // The pipeline passes the commit SHA via context; "latest" remains
    // only as a default for the first manual deploy.
    const imageTag = this.node.tryGetContext("imageTag") ?? "latest";

    this.cluster = new ecs.Cluster(this, "Cluster", {
      vpc,
      clusterName: "codeguardian-cluster",
      containerInsightsV2: ecs.ContainerInsights.ENABLED,
    });

    const namespace = new servicediscovery.PrivateDnsNamespace(this, "CloudMapNamespace", {
      name: CLOUD_MAP_NAMESPACE,
      vpc,
      description: "Internal service discovery backend <-> agents",
    });

    // Execution role: pull image + read secrets. Task role: runtime
    // permissions of the application code.
    const backendExecutionRole = new iam.Role(this, "BackendExecutionRole", {
      roleName: "codeguardian-backend-execution-role",
      assumedBy: new iam.ServicePrincipal("ecs-tasks.amazonaws.com"),
      managedPolicies: [
        iam.ManagedPolicy.fromAwsManagedPolicyName("service-role/AmazonECSTaskExecutionRolePolicy"),
      ],
    });

    const backendTaskRole = new iam.Role(this, "BackendTaskRole", {
      roleName: "codeguardian-backend-task-role",
      assumedBy: new iam.ServicePrincipal("ecs-tasks.amazonaws.com"),
    });
    artifactsBucket.grantReadWrite(backendTaskRole);

    const backendLogGroup = new logs.LogGroup(this, "BackendLogGroup", {
      logGroupName: "/ecs/codeguardian/backend",
      retention: logs.RetentionDays.TWO_WEEKS, // by default a Log Group never expires
      removalPolicy: cdk.RemovalPolicy.DESTROY,
    });

    const backendTaskDef = new ecs.FargateTaskDefinition(this, "BackendTaskDef", {
      family: "codeguardian-backend",
      cpu: ECS_SIZING.backend.cpu,
      memoryLimitMiB: ECS_SIZING.backend.memoryLimitMiB,
      executionRole: backendExecutionRole,
      taskRole: backendTaskRole,
    });

    backendTaskDef.addContainer("backend", {
      image: ecs.ContainerImage.fromEcrRepository(backendRepo, imageTag),
      logging: ecs.LogDrivers.awsLogs({ streamPrefix: "backend", logGroup: backendLogGroup }),
      portMappings: [{ containerPort: ECS_SIZING.backend.port }],
      environment: {
        NODE_ENV: "production",
        PORT: String(ECS_SIZING.backend.port),
        RATE_LIMIT_GITHUB_RPM: String(RATE_LIMIT_GITHUB_RPM),
        REPORTS_BUCKET_NAME: artifactsBucket.bucketName,
        CORS_ORIGIN: this.node.tryGetContext("corsOrigin") ?? "http://localhost:5173",
        // Joi default (env.validation.ts) is "http://agents:8000", designed
        // for Docker Compose. On AWS the backend finds the agents only via
        // Cloud Map, with this name.
        AGENTS_SERVICE_URL: `http://agents.${CLOUD_MAP_NAMESPACE}:${ECS_SIZING.agents.port}`,
        S3_REGION: REGION,
      },
      // `secrets` grants read access to the execution role for each
      // entry by itself. They use the default KMS key, not the shared
      // CMK (see kms-secrets-stack.ts).
      secrets: {
        MONGODB_URI: ecs.Secret.fromSecretsManager(secretMongoUri),
        JWT_SECRET: ecs.Secret.fromSecretsManager(secretJwt),
        CREDENTIAL_MASTER_KEY: ecs.Secret.fromSecretsManager(secretCredentialMasterKey),
        INTERNAL_SHARED_SECRET: ecs.Secret.fromSecretsManager(secretInternalSharedSecret),
        REDIS_URL: ecs.Secret.fromSsmParameter(paramRedisUrl),
      },
    });

    this.backendService = new ecs.FargateService(this, "BackendService", {
      cluster: this.cluster,
      serviceName: "backend",
      taskDefinition: backendTaskDef,
      desiredCount: ECS_SIZING.backend.desiredCount,
      securityGroups: [sgBackend],
      vpcSubnets: { subnets: vpc.privateSubnets },
      assignPublicIp: false,
      healthCheckGracePeriod: cdk.Duration.seconds(HEALTH_CHECK_GRACE_PERIOD_SECONDS),
      enableExecuteCommand: true, // debug via SSM Session Manager, no bastion host
      // With desiredCount: 1 a blocked deploy can stay half-done for hours
      // without the circuit breaker. min/maxHealthyPercent always keep
      // at least 1 task up during deploy.
      circuitBreaker: { rollback: true },
      minHealthyPercent: 100,
      maxHealthyPercent: 200,
      cloudMapOptions: {
        cloudMapNamespace: namespace,
        name: "backend", // -> backend.codeguardian.local
        dnsRecordType: servicediscovery.DnsRecordType.A,
        dnsTtl: cdk.Duration.seconds(CLOUD_MAP_DNS_TTL_SECONDS),
      },
    });

    const agentsExecutionRole = new iam.Role(this, "AgentsExecutionRole", {
      roleName: "codeguardian-agents-execution-role",
      assumedBy: new iam.ServicePrincipal("ecs-tasks.amazonaws.com"),
      managedPolicies: [
        iam.ManagedPolicy.fromAwsManagedPolicyName("service-role/AmazonECSTaskExecutionRolePolicy"),
      ],
    });

    const agentsTaskRole = new iam.Role(this, "AgentsTaskRole", {
      roleName: "codeguardian-agents-task-role",
      assumedBy: new iam.ServicePrincipal("ecs-tasks.amazonaws.com"),
    });

    // Qwen3 only, eu-south-1 only: avoids invoking more expensive models
    // or routing inference out of region by mistake.
    agentsTaskRole.addToPolicy(
      new iam.PolicyStatement({
        sid: "InvokeQwenModelsOnly",
        actions: [
          "bedrock:InvokeModel",
          "bedrock:InvokeModelWithResponseStream",
          "bedrock:Converse",
          "bedrock:ConverseStream",
        ],
        resources: [BEDROCK_MODEL_ARN_PATTERN],
        conditions: { StringEquals: { "aws:RequestedRegion": REGION } },
      }),
    );

    const agentsLogGroup = new logs.LogGroup(this, "AgentsLogGroup", {
      logGroupName: "/ecs/codeguardian/agents",
      retention: logs.RetentionDays.TWO_WEEKS,
      removalPolicy: cdk.RemovalPolicy.DESTROY,
    });

    const agentsTaskDef = new ecs.FargateTaskDefinition(this, "AgentsTaskDef", {
      family: "codeguardian-agents",
      cpu: ECS_SIZING.agents.cpu,
      memoryLimitMiB: ECS_SIZING.agents.memoryLimitMiB,
      executionRole: agentsExecutionRole,
      taskRole: agentsTaskRole,
    });

    agentsTaskDef.addContainer("agents", {
      image: ecs.ContainerImage.fromEcrRepository(agentsRepo, imageTag),
      logging: ecs.LogDrivers.awsLogs({ streamPrefix: "agents", logGroup: agentsLogGroup }),
      portMappings: [{ containerPort: ECS_SIZING.agents.port }],
      environment: {
        PORT: String(ECS_SIZING.agents.port),
        // PROMPTS_DIR is not an env var: prompts are baked into the Docker
        // image, Fargate does not support bind mounts.
        LLM_MODEL_GENERAL: "qwen.qwen3-32b-v1:0",
        LLM_MODEL_SECURITY: "qwen.qwen3-coder-30b-a3b-v1:0",
      },
      secrets: {
        INTERNAL_SHARED_SECRET: ecs.Secret.fromSecretsManager(secretInternalSharedSecret),
        BACKEND_BASE_URL: ecs.Secret.fromSsmParameter(paramBackendBaseUrl),
        LLM_PROVIDER: ecs.Secret.fromSsmParameter(paramLlmProvider),
        // Same secret as the backend (MONGODB_URI), different name: the
        // LangGraph checkpointer on the Python side reads MONGO_URI. Joi
        // default "mongodb://mongo:27017/codeguardian" is the Docker
        // Compose hostname, nonexistent in the VPC.
        MONGO_URI: ecs.Secret.fromSecretsManager(secretMongoUri),
        REDIS_URL: ecs.Secret.fromSsmParameter(paramRedisUrl),
      },
    });

    this.agentsService = new ecs.FargateService(this, "AgentsService", {
      cluster: this.cluster,
      serviceName: "agents",
      taskDefinition: agentsTaskDef,
      desiredCount: ECS_SIZING.agents.desiredCount,
      securityGroups: [sgAgents],
      vpcSubnets: { subnets: vpc.privateSubnets },
      assignPublicIp: false,
      healthCheckGracePeriod: cdk.Duration.seconds(HEALTH_CHECK_GRACE_PERIOD_SECONDS),
      enableExecuteCommand: true,
      circuitBreaker: { rollback: true },
      minHealthyPercent: 100,
      maxHealthyPercent: 200,
      cloudMapOptions: {
        cloudMapNamespace: namespace,
        name: "agents", // -> agents.codeguardian.local
        dnsRecordType: servicediscovery.DnsRecordType.A,
        dnsTtl: cdk.Duration.seconds(CLOUD_MAP_DNS_TTL_SECONDS),
      },
    });

    // ECS Exec goes through the SSM Session Manager channel: without these
    // permissions on the task role, enableExecuteCommand is not enough.
    const execCommandActions = new iam.PolicyStatement({
      sid: "AllowEcsExec",
      actions: [
        "ssmmessages:CreateControlChannel",
        "ssmmessages:CreateDataChannel",
        "ssmmessages:OpenControlChannel",
        "ssmmessages:OpenDataChannel",
      ],
      resources: ["*"],
    });
    backendTaskRole.addToPolicy(execCommandActions);
    agentsTaskRole.addToPolicy(execCommandActions);

    // No custom domain or certificate on the ALB: it listens in plaintext
    // on port 80, behind CloudFront which provides TLS on *.cloudfront.net.
    this.alb = new elbv2.ApplicationLoadBalancer(this, "Alb", {
      vpc,
      internetFacing: true,
      securityGroup: sgAlb,
      vpcSubnets: { subnets: vpc.publicSubnets },
      idleTimeout: cdk.Duration.seconds(ALB_IDLE_TIMEOUT_SECONDS), // needed for WebSocket
      loadBalancerName: "codeguardian-alb",
    });

    const listener = this.alb.addListener("HttpListener", {
      port: 80,
      protocol: elbv2.ApplicationProtocol.HTTP,
      open: false, // ingress is already restricted to the CloudFront prefix list on sg-alb
    });

    this.backendTargetGroup = listener.addTargets("BackendTargetGroup", {
      targetGroupName: "codeguardian-backend-tg",
      port: ECS_SIZING.backend.port,
      protocol: elbv2.ApplicationProtocol.HTTP,
      targets: [this.backendService],
      healthCheck: {
        path: HEALTH_CHECK_PATH,
        interval: cdk.Duration.seconds(30),
        healthyThresholdCount: 2,
        unhealthyThresholdCount: 3,
      },
      deregistrationDelay: cdk.Duration.seconds(ALB_DEREGISTRATION_DELAY_SECONDS),
      stickinessCookieDuration: cdk.Duration.seconds(ALB_STICKINESS_DURATION_SECONDS), // AWSALB cookie
    });

    // Extends codeguardian-ci-role (ECR-only so far) with permissions to
    // update ECS services. RegisterTaskDefinition/DescribeTaskDefinition
    // do not support resource scoping; DescribeServices/UpdateService do.
    ciRole.attachInlinePolicy(
      new iam.Policy(this, "CiDeployPolicy", {
        statements: [
          new iam.PolicyStatement({
            sid: "EcsTaskDefinitions",
            actions: ["ecs:RegisterTaskDefinition", "ecs:DescribeTaskDefinition"],
            resources: ["*"],
          }),
          new iam.PolicyStatement({
            sid: "EcsUpdateService",
            actions: ["ecs:DescribeServices", "ecs:UpdateService"],
            resources: [this.backendService.serviceArn, this.agentsService.serviceArn],
          }),
          new iam.PolicyStatement({
            sid: "PassTaskRoles",
            actions: ["iam:PassRole"],
            resources: [
              backendExecutionRole.roleArn,
              backendTaskRole.roleArn,
              agentsExecutionRole.roleArn,
              agentsTaskRole.roleArn,
            ],
          }),
        ],
      }),
    );

    new cdk.CfnOutput(this, "AlbDnsName", { value: this.alb.loadBalancerDnsName });
    new cdk.CfnOutput(this, "ClusterName", { value: this.cluster.clusterName });
  }
}
