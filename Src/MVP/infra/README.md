# Code Guardian -- AWS Infrastructure (MVP)

AWS infrastructure as code (AWS CDK v2, TypeScript) for the Code Guardian
MVP, region **eu-south-1** (Milan). It implements Parts IV-V of the design
document: same network topology, same Security Groups, same ECS sizing,
same architectural decisions.

The Docker images for `backend` and `agents` are the ones validated in the
PoC: this infrastructure requires no changes to the application code, only
environment variables and IAM permissions in place of the PoC's static
keys.

Two peculiarities of this infrastructure, for first-time readers:

- The static frontend bucket is created in `cloudfront-stack.ts`, not in
  `storage-stack.ts` alongside the artifacts bucket -- keeping it separate
  from the CloudFront distribution that serves it would create a known
  circular dependency between the two stacks.
- `CodeGuardian-Budget` is the only stack that deploys to **us-east-1**
  instead of eu-south-1: `AWS::Budgets::Budget` exists as a CloudFormation
  resource only there, since AWS Budgets is a global service.

## Prerequisites

1. Node.js >= 20, AWS CLI configured with credentials for the target account.
2. Manual prerequisite activities: see **`RUNBOOK.md`** (Bedrock access
   request, Atlas keys, GitHub Actions secrets, SNS confirmation).
3. Update `cdk.json` (`context`) with the actual project values:
   `atlasPrivateEndpointServiceName`, `alertEmail`,
   `githubOrg`/`githubRepo`, `monthlyBudgetUsd`.

## Quick start

```bash
npm install
aws login
npx cdk bootstrap aws://<ACCOUNT_ID>/eu-south-1
npx cdk bootstrap aws://<ACCOUNT_ID>/us-east-1  # only for CodeGuardian-Budget
npm run synth      # verify that all stacks synthesize correctly
npm run deploy:all # or one stack at a time, see package.json "scripts"
```

Incremental deploy in the technical dependency order (equivalent to
`deploy:all`, useful for isolating an error in a specific stage):

```bash
npm run deploy:network
npm run deploy:cicd-identity
npm run deploy:secrets
npm run deploy:storage
npm run deploy:security-groups
npm run deploy:vpc-endpoints
npm run deploy:data
npm run deploy:atlas          # requires --context atlasPrivateEndpointServiceName=<...>, see RUNBOOK.md
npm run deploy:compute
npm run deploy:cloudfront
npm run deploy:observability
npm run deploy:budget         # deploys to us-east-1, requires bootstrap there
```

After the first complete deploy, follow steps 4 and 5 in `RUNBOOK.md`
(confirm SNS email subscription, first push of ECR images) before
considering the environment operational.

## Structure

```
bin/codeguardian.ts          -- CDK entry point, wiring between stacks
lib/config.ts                -- shared constants (CIDRs, ports, sizing...)
lib/network-stack.ts          -- VPC, subnets, IGW, NAT
lib/security-groups-stack.ts  -- Security Groups (anti-cycle pattern)
lib/vpc-endpoints-stack.ts    -- VPC Endpoints Gateway + Interface
lib/kms-secrets-stack.ts      -- KMS, Secrets Manager, Parameter Store
lib/storage-stack.ts          -- S3 artifacts bucket
lib/data-stack.ts             -- ElastiCache Redis
lib/atlas-stack.ts            -- MongoDB Atlas, AWS side of PrivateLink (project/cluster managed manually)
lib/cicd-identity-stack.ts    -- ECR + CI/CD role (GitHub OIDC)
lib/compute-stack.ts          -- ECS Fargate, Task Def, IAM, Cloud Map, ALB
lib/cloudfront-stack.ts       -- Frontend S3 bucket + CloudFront + OAC + SPA routing
lib/observability-stack.ts    -- SNS, CloudWatch alarms
lib/budget-stack.ts           -- AWS Budgets (us-east-1)
.github/workflows/deploy.yml  -- CI/CD pipeline
RUNBOOK.md                    -- manual activities (Bedrock, Atlas, SNS...)
```

## CI/CD pipeline

`.github/workflows/deploy.yml` runs in two modes:

- **Pull request**: only CDK code typecheck (`tsc --noEmit`) and local
  Docker build of the two images, as a smoke test. No AWS credentials
  involved.
- **Push to `main`**: build + push images to ECR, `cdk synth` as a
  pre-deploy gate, then deploy of the Compute stack and the frontend.

The OIDC trust policy of the `codeguardian-ci-role` accepts tokens from
any branch/ref of the repository; it is the workflow itself, with `if`
conditions on individual steps, that restricts the use of AWS credentials
to pushes on `main` only. If you want a restriction at the trust policy
level too, you can add a `StringLike` condition on the `sub` claim in
`cicd-identity-stack.ts`.

## Debug (ECS Exec)

The `backend` and `agents` services have `enableExecuteCommand: true`:
shell access to containers for debugging goes through AWS Systems Manager
Session Manager, without a bastion host or SSH keys:

```bash
aws ecs execute-command --cluster codeguardian-cluster --task <TASK_ID> \\
  --container backend --interactive --command "/bin/sh"
```

## Integration with frontend/backend/agents

- **Frontend**: Vite build with `VITE_API_BASE_URL=/api/v1` (relative path,
  Same-Origin behind CloudFront -- no CORS configuration), sync to the
  frontend bucket (`FrontendBucketName` output of `CodeGuardian-CloudFront`),
  invalidation via the same stack (`DistributionId` output).
- **Backend**: reads `MONGO_URI`, `JWT_SECRET`, `CREDENTIAL_MASTER_KEY`,
  `INTERNAL_SHARED_SECRET`, `REDIS_URL` from environment variables
  (injected by ECS via Secrets Manager/Parameter Store) -- no code changes
  required compared to the PoC.
- **Agents**: reads `INTERNAL_SHARED_SECRET`, `BACKEND_BASE_URL`
  (`http://backend.codeguardian.local:3000`), `LLM_PROVIDER=bedrock`;
  invokes Bedrock through the Task Role (no API keys), scope limited to
  the Qwen3 family in eu-south-1.
