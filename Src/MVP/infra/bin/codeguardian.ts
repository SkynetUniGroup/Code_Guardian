#!/usr/bin/env node
import "source-map-support/register";
import * as cdk from "aws-cdk-lib";
import { NetworkStack } from "../lib/network-stack";
import { CicdIdentityStack } from "../lib/cicd-identity-stack";
import { StorageStack } from "../lib/storage-stack";
import { SecurityGroupsStack } from "../lib/security-groups-stack";
import { VpcEndpointsStack } from "../lib/vpc-endpoints-stack";
import { KmsSecretsStack } from "../lib/kms-secrets-stack";
import { DataStack } from "../lib/data-stack";
import { AtlasStack } from "../lib/atlas-stack";
import { ComputeStack } from "../lib/compute-stack";
import { CloudFrontStack } from "../lib/cloudfront-stack";
import { ObservabilityStack } from "../lib/observability-stack";
import { BudgetStack } from "../lib/budget-stack";
import { PROJECT_TAGS, REGION, SNS_ALERTS_TOPIC_NAME } from "../lib/config";

const app = new cdk.App();

const env: cdk.Environment = {
  account: process.env.CDK_DEFAULT_ACCOUNT,
  region: REGION,
};

const alertEmail = app.node.tryGetContext("alertEmail") ?? process.env.CODEGUARDIAN_ALERT_EMAIL;
if (!alertEmail || alertEmail === "REPLACE_WITH_TEAM_ALERT_EMAIL") {
  throw new Error(
    "Contesto 'alertEmail' non impostato: aggiornare cdk.json o passare --context alertEmail=<email> (destinatario allarmi SNS).",
  );
}
const monthlyBudgetUsd = Number(app.node.tryGetContext("monthlyBudgetUsd") ?? "150");

// L'ordine segue le dipendenze tecniche tra gli stack.

// Indipendenti tra loro.
const network = new NetworkStack(app, "CodeGuardian-Network", { env });
const cicdIdentity = new CicdIdentityStack(app, "CodeGuardian-CicdIdentity", { env });
const secrets = new KmsSecretsStack(app, "CodeGuardian-Secrets", { env });
const storage = new StorageStack(app, "CodeGuardian-Storage", { env, kmsKey: secrets.kmsKey });

// Rete e sicurezza, dipendono dalla VPC.
const securityGroups = new SecurityGroupsStack(app, "CodeGuardian-SecurityGroups", { env, vpc: network.vpc });
const vpcEndpoints = new VpcEndpointsStack(app, "CodeGuardian-VpcEndpoints", {
  env,
  vpc: network.vpc,
  sgVpce: securityGroups.sgVpce,
  sgBedrock: securityGroups.sgBedrock,
  artifactsBucket: storage.artifactsBucket,
});

// Livello dati.
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

// Compute, orchestrazione, distribuzione.
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
compute.addStackDependency(atlas); // Atlas deve essere pronto prima del primo avvio del task backend

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

// us-east-1, non eu-south-1: vedi budget-stack.ts.
const budget = new BudgetStack(app, "CodeGuardian-Budget", {
  env: { account: env.account, region: "us-east-1" },
  alertsTopicArn: `arn:aws:sns:${REGION}:${env.account}:${SNS_ALERTS_TOPIC_NAME}`,
  monthlyBudgetUsd,
});

// Tag di progetto su tutti gli stack, usato anche come Cost Filter da AWS
// Budgets in budget-stack.ts.
for (const stack of [network, cicdIdentity, storage, securityGroups, vpcEndpoints, secrets, data, atlas, compute, cloudfront, observability, budget]) {
  for (const [key, value] of Object.entries(PROJECT_TAGS)) {
    cdk.Tags.of(stack).add(key, value);
  }
}
