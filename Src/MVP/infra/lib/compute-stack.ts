import * as cdk from "aws-cdk-lib";
import * as ec2 from "aws-cdk-lib/aws-ec2";
import * as ecr from "aws-cdk-lib/aws-ecr";
import * as ecs from "aws-cdk-lib/aws-ecs";
import * as elbv2 from "aws-cdk-lib/aws-elasticloadbalancingv2";
import * as iam from "aws-cdk-lib/aws-iam";
import * as logs from "aws-cdk-lib/aws-logs";
import * as s3 from "aws-cdk-lib/aws-s3";
import * as secretsmanager from "aws-cdk-lib/aws-secretsmanager";
import * as servicediscovery from "aws-cdk-lib/aws-servicediscovery";
import * as ssm from "aws-cdk-lib/aws-ssm";
import { Construct } from "constructs";
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
  REGION,
  RATE_LIMIT_GITHUB_RPM,
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

// ECS Fargate (backend + agents), Cloud Map, ALB. Stanno in un unico stack
// perché sono accoppiati a runtime (target group -> servizio -> namespace).
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

    // La pipeline passa lo SHA del commit via context; "latest" resta solo
    // come default per il primo deploy manuale.
    const imageTag = this.node.tryGetContext("imageTag") ?? "latest";

    this.cluster = new ecs.Cluster(this, "Cluster", {
      vpc,
      clusterName: "codeguardian-cluster",
      containerInsightsV2: ecs.ContainerInsights.ENABLED,
    });

    const namespace = new servicediscovery.PrivateDnsNamespace(this, "CloudMapNamespace", {
      name: CLOUD_MAP_NAMESPACE,
      vpc,
      description: "Service discovery interna backend <-> agents",
    });

    // Execution role: pull immagine + lettura segreti. Task role: permessi
    // a runtime del codice applicativo.
    const backendExecutionRole = new iam.Role(this, "BackendExecutionRole", {
      roleName: "codeguardian-backend-execution-role",
      assumedBy: new iam.ServicePrincipal("ecs-tasks.amazonaws.com"),
      managedPolicies: [iam.ManagedPolicy.fromAwsManagedPolicyName("service-role/AmazonECSTaskExecutionRolePolicy")],
    });

    const backendTaskRole = new iam.Role(this, "BackendTaskRole", {
      roleName: "codeguardian-backend-task-role",
      assumedBy: new iam.ServicePrincipal("ecs-tasks.amazonaws.com"),
    });
    artifactsBucket.grantReadWrite(backendTaskRole);

    const backendLogGroup = new logs.LogGroup(this, "BackendLogGroup", {
      logGroupName: "/ecs/codeguardian/backend",
      retention: logs.RetentionDays.TWO_WEEKS, // di default un Log Group non scade mai
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
        ARTIFACTS_BUCKET: artifactsBucket.bucketName,
      },
      // `secrets` concede da sé il grantRead all'execution role per ciascuna
      // voce. Usano la chiave KMS di default, non la CMK condivisa (vedi
      // kms-secrets-stack.ts).
      secrets: {
        MONGO_URI: ecs.Secret.fromSecretsManager(secretMongoUri),
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
      enableExecuteCommand: true, // debug via SSM Session Manager, niente bastion host
      // Con desiredCount: 1 un deploy bloccato può restare a metà per ore
      // senza il circuit breaker. min/maxHealthyPercent tengono sempre
      // almeno 1 task su durante il deploy.
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
      managedPolicies: [iam.ManagedPolicy.fromAwsManagedPolicyName("service-role/AmazonECSTaskExecutionRolePolicy")],
    });

    const agentsTaskRole = new iam.Role(this, "AgentsTaskRole", {
      roleName: "codeguardian-agents-task-role",
      assumedBy: new iam.ServicePrincipal("ecs-tasks.amazonaws.com"),
    });

    // Solo Qwen3, solo eu-south-1: evita di invocare modelli più costosi o
    // instradare l'inferenza fuori regione per errore.
    agentsTaskRole.addToPolicy(
      new iam.PolicyStatement({
        sid: "InvokeQwenModelsOnly",
        actions: ["bedrock:InvokeModel", "bedrock:InvokeModelWithResponseStream"],
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
        // PROMPTS_DIR non è una env var: i prompt sono bake-in nell'immagine
        // Docker, Fargate non supporta bind mount.
      },
      secrets: {
        INTERNAL_SHARED_SECRET: ecs.Secret.fromSecretsManager(secretInternalSharedSecret),
        BACKEND_BASE_URL: ecs.Secret.fromSsmParameter(paramBackendBaseUrl),
        LLM_PROVIDER: ecs.Secret.fromSsmParameter(paramLlmProvider),
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

    // ECS Exec passa dal canale SSM Session Manager: senza questi permessi
    // sul task role, enableExecuteCommand non basta.
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

    // Nessun dominio custom né certificato sull'ALB: ascolta in chiaro su
    // 80, dietro CloudFront che fornisce TLS su *.cloudfront.net.
    this.alb = new elbv2.ApplicationLoadBalancer(this, "Alb", {
      vpc,
      internetFacing: true,
      securityGroup: sgAlb,
      vpcSubnets: { subnets: vpc.publicSubnets },
      idleTimeout: cdk.Duration.seconds(ALB_IDLE_TIMEOUT_SECONDS), // serve per il WebSocket
      loadBalancerName: "codeguardian-alb",
    });

    const listener = this.alb.addListener("HttpListener", {
      port: 80,
      protocol: elbv2.ApplicationProtocol.HTTP,
      open: false, // l'ingress è già ristretto al prefix list di CloudFront su sg-alb
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
      stickinessCookieDuration: cdk.Duration.seconds(ALB_STICKINESS_DURATION_SECONDS), // cookie AWSALB
    });

    // Estende codeguardian-ci-role (ECR-only finora) coi permessi per
    // aggiornare i servizi ECS. RegisterTaskDefinition/DescribeTaskDefinition
    // non supportano lo scoping a risorsa; DescribeServices/UpdateService sì.
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
