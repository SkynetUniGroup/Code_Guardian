#!/usr/bin/env node
import "source-map-support/register";
import * as cdk from "aws-cdk-lib";
import { AtlasStack } from "../lib/atlas-stack";
import { BudgetStack } from "../lib/budget-stack";
import { CicdIdentityStack } from "../lib/cicd-identity-stack";
import { CloudFrontStack } from "../lib/cloudfront-stack";
import { ComputeStack } from "../lib/compute-stack";
import { PROJECT_TAGS, REGION, SNS_ALERTS_TOPIC_NAME } from "../lib/config";
import { DataStack } from "../lib/data-stack";
import { KmsSecretsStack } from "../lib/kms-secrets-stack";
import { NetworkStack } from "../lib/network-stack";
import { ObservabilityStack } from "../lib/observability-stack";
import { SecurityGroupsStack } from "../lib/security-groups-stack";
import { StorageStack } from "../lib/storage-stack";
import { VpcEndpointsStack } from "../lib/vpc-endpoints-stack";

const app = new cdk.App();

const env: cdk.Environment = {
  account: process.env.CDK_DEFAULT_ACCOUNT,
  region: REGION,
};

const alertEmail = app.node.tryGetContext("alertEmail") ?? process.env.CODEGUARDIAN_ALERT_EMAIL;
if (!alertEmail || alertEmail === "REPLACE_WITH_TEAM_ALERT_EMAIL") {
  throw new Error(
    "Context 'alertEmail' not set: update cdk.json or pass --context alertEmail=<email> (SNS alarm recipient).",
  );
}
const monthlyBudgetUsd = Number(app.node.tryGetContext("monthlyBudgetUsd") ?? "150");

// The order follows the technical dependencies between stacks.

// Independent of each other.
const network = new NetworkStack(app, "CodeGuardian-Network", { env });
const cicdIdentity = new CicdIdentityStack(app, "CodeGuardian-CicdIdentity", { env });
const secrets = new KmsSecretsStack(app, "CodeGuardian-Secrets", { env });
const storage = new StorageStack(app, "CodeGuardian-Storage", { env, kmsKey: secrets.kmsKey });

// Network and security, depend on the VPC.
const securityGroups = new SecurityGroupsStack(app, "CodeGuardian-SecurityGroups", {
  env,
  vpc: network.vpc,
});
const vpcEndpoints = new VpcEndpointsStack(app, "CodeGuardian-VpcEndpoints", {
  env,
  vpc: network.vpc,
  sgVpce: securityGroups.sgVpce,
  sgBedrock: securityGroups.sgBedrock,
  artifactsBucket: storage.artifactsBucket,
});

// Data layer.
const data = new DataStack(app, "CodeGuardian-Data", {
  env,
  vpc: network.vpc,
  sgRedis: securityGroups.sgRedis,
  kmsKey: secrets.kmsKey,
});
const atlas = new AtlasStack(app, "CodeGuardian-Atlas", {
  env,
  vpc: network.vpc,
  sgAtlas: securityGroups.sgAtlas,
});

// Compute, orchestration, distribution.
const compute = new ComputeStack(app, "CodeGuardian-Compute", {
  env,
  vpc: network.vpc,
  sgAlb: securityGroups.sgAlb,
  sgBackend: securityGroups.sgBackend,
  sgAgents: securityGroups.sgAgents,
  backendRepo: cicdIdentity.backendRepo,
  agentsRepo: cicdIdentity.agentsRepo,
  artifactsBucket: storage.artifactsBucket,
  ciRole: cicdIdentity.ciRole,
  secretMongoUri: secrets.secretMongoUri,
  secretJwt: secrets.secretJwt,
  secretCredentialMasterKey: secrets.secretCredentialMasterKey,
  secretInternalSharedSecret: secrets.secretInternalSharedSecret,
  paramRedisUrl: data.paramRedisUrl,
  paramBackendBaseUrl: secrets.paramBackendBaseUrl,
  paramLlmProvider: secrets.paramLlmProvider,
});
compute.addStackDependency(atlas); // Atlas must be ready before the first backend task start

const cloudfront = new CloudFrontStack(app, "CodeGuardian-CloudFront", {
  env,
  alb: compute.alb,
  ciRole: cicdIdentity.ciRole,
});

const observability = new ObservabilityStack(app, "CodeGuardian-Observability", {
  env,
  cluster: compute.cluster,
  backendService: compute.backendService,
  agentsService: compute.agentsService,
  backendTargetGroup: compute.backendTargetGroup,
  redis: data.redis,
  alertEmail,
});

// us-east-1, not eu-south-1: see budget-stack.ts.
const budget = new BudgetStack(app, "CodeGuardian-Budget", {
  env: { account: env.account, region: "us-east-1" },
  alertsTopicArn: `arn:aws:sns:${REGION}:${env.account}:${SNS_ALERTS_TOPIC_NAME}`,
  monthlyBudgetUsd,
});

// Project tags on all stacks, also used as a Cost Filter by AWS Budgets
// in budget-stack.ts.
for (const stack of [
  network,
  cicdIdentity,
  storage,
  securityGroups,
  vpcEndpoints,
  secrets,
  data,
  atlas,
  compute,
  cloudfront,
  observability,
  budget,
]) {
  for (const [key, value] of Object.entries(PROJECT_TAGS)) {
    cdk.Tags.of(stack).add(key, value);
  }
}
