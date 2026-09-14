# RUNBOOK -- Manual activities (not automatable in CDK)

These activities have no reliable CloudFormation/CDK equivalent (requests
subject to human approval, out-of-band key generation, email confirmations)
and must be performed manually, in the order indicated. Each item references
the design document.

## 1. Request Bedrock model access (issue deadline: 22/08)

Ref. §27.1, §32.1 Table 32.

This is the first thing to start: AWS approval times are not controllable by
the team.

1. AWS Bedrock Console -> region **eu-south-1** (Milan) -> *Model access*.
2. Request access to:
   - **Qwen3-32B** (dense) -- Docs, Changelog. High priority.
   - **Qwen3-Coder-30B-A3B-Instruct** -- Security. High priority.
   - **Qwen3-235B-A22B** -- scaling fallback (§39.5). Medium priority, but
     request it immediately anyway: needed if the 30B model does not pass
     the Qualification Plan on the golden set (RQ.5, accuracy >= 85%).
3. Verify in advance the absence of organizational Service Control Policies
   (SCP) that block Bedrock in the account.
4. Verify in the console (section *Model access* / *Cross-region inference*)
   whether the Qwen3 models require an **Inference Profile ARN** instead of
   the direct foundation model ARN for on-demand invocation. If so, update
   `BEDROCK_MODEL_ARN_PATTERN` in `lib/config.ts` and the IAM policy in
   `lib/compute-stack.ts` (`InvokeQwenModelsOnly`) accordingly -- the
   typical error in case of mismatch is `ValidationException: Invocation of
   model ID ... is not supported`.

## 2. MongoDB Atlas -- manual handshake before `cdk deploy CodeGuardian-Atlas`

Ref. §27.4, §31.1.

The M10 project and cluster are created and managed manually in the Atlas
console (no API key with write permissions on the project is available to
the team): `lib/atlas-stack.ts` creates only the AWS side of the PrivateLink.

1. **Whoever manages Atlas** (Alessandro) creates the Private Endpoint from
   the existing Atlas project, AWS region **eu-south-1**, and communicates
   the generated service name (`com.amazonaws.vpce-svc-...`).
2. Deploy passing that service name:
   ```bash
   npx cdk deploy CodeGuardian-Atlas --context atlasPrivateEndpointServiceName=<SERVICE_NAME>
   ```
3. Retrieve the `AtlasPrivateEndpointId` output and communicate it to whoever
   manages Atlas: it must be pasted in the Atlas console (Private Endpoint ->
   AWS) to complete the connection.
4. **Dev action post-connection (§27.4 point 4, §31.1):** from the Atlas
   console -> Connect -> Private Endpoint, retrieve the generated connection
   string and update it in the secret:
   ```bash
   aws secretsmanager put-secret-value \
     --secret-id codeguardian/mongo-uri \
     --secret-string '<private-endpoint-connection-string>'
   ```
   Verify connectivity from the backend task before considering this item
   complete. The Atlas Network Access List must not contain any public
   entries (0.0.0.0/0 or IP): it is the absence of public entries, combined
   with active PrivateLink connectivity, that restricts access to the VPC
   only.

## 3. GitHub Actions -- repository secrets

Ref. `.github/workflows/deploy.yml`.

In the GitHub repository (Settings -> Secrets and variables -> Actions),
add:

| Secret                      | Value                                                        |
| ---------------------------- | -------------------------------------------------------------- |
| `AWS_ACCOUNT_ID`             | AWS account ID (12 digits) where the infrastructure is deployed     |
| `FRONTEND_BUCKET_NAME`       | `FrontendBucketName` output of `CodeGuardian-CloudFront`       |
| `CLOUDFRONT_DISTRIBUTION_ID` | `DistributionId` output of `CodeGuardian-CloudFront`            |

Also update `githubOrg`/`githubRepo` in `cdk.json` (or via `--context`) with
the real values BEFORE deploying `CodeGuardian-CicdIdentity`, otherwise the
OIDC role trust policy will point to a placeholder repository.

The role trust policy accepts OIDC tokens from any branch/ref of the
indicated repository. Pull requests can therefore technically assume the
role, but in the pipeline (`.github/workflows/deploy.yml`) they never do:
steps that require AWS are conditioned on `push` to `main`. On PRs only
typecheck and local Docker build run.

## 4. Confirm SNS email subscription (issue deadline: 30/08)

Ref. §27.9 point 3.

After `cdk deploy CodeGuardian-Observability`, the email address specified
in `alertEmail` (`cdk.json` or `--context alertEmail=...`) receives a
confirmation email from AWS SNS. **If nobody clicks the link, the alarms
will never be delivered** and the problem remains invisible until it is
actually needed. Verify the `Confirmed` status in the SNS console ->
Subscriptions.

## 5. First manual push of ECR images (issue deadline: 24/08)

Ref. §27.5 point 4. Before the CI/CD pipeline exists, to validate the
flow:

```bash
aws ecr get-login-password --region eu-south-1 | \
  docker login --username AWS --password-stdin <ACCOUNT_ID>.dkr.ecr.eu-south-1.amazonaws.com

docker build -t <ACCOUNT_ID>.dkr.ecr.eu-south-1.amazonaws.com/codeguardian/backend:latest backend/
docker push <ACCOUNT_ID>.dkr.ecr.eu-south-1.amazonaws.com/codeguardian/backend:latest

docker build -t <ACCOUNT_ID>.dkr.ecr.eu-south-1.amazonaws.com/codeguardian/agents:latest agents/
docker push <ACCOUNT_ID>.dkr.ecr.eu-south-1.amazonaws.com/codeguardian/agents:latest
```

## 6. Bootstrap of us-east-1 (prerequisite for `CodeGuardian-Budget`)

`AWS::Budgets::Budget` exists as a CloudFormation resource only in the
us-east-1 region (AWS Budgets is a global service, like IAM or CloudFront)
-- `lib/budget-stack.ts` deploys there regardless of where the rest of the
infrastructure lives. Before the first `cdk deploy CodeGuardian-Budget`,
bootstrap that region as well:

```bash
npx cdk bootstrap aws://<ACCOUNT_ID>/us-east-1
```

## 7. Activate the cost allocation tag (prerequisite for AWS Budgets)

Ref. §36.2. The CDK budget (`budget-stack.ts`) filters costs with
`costFilters: { TagKeyValue: ["user:Project$CodeGuardian"] }`. For this
filter to work, the `Project` tag must first be **activated as a Cost
Allocation Tag** in Billing and Cost Management -> Cost Allocation Tags
(manual operation, there is no API/CloudFormation resource to activate
it). It takes up to 24 hours to reflect in cost data. Until it is
activated, the budget will show zero spend even with correctly tagged
resources.

## 8. Cost estimate and AWS Budgets (issue deadline: 30/08)

Ref. §36.2. Use the **AWS Pricing Calculator** with the parameters of this
document: 1 NAT Gateway, 1 ElastiCache node, 8 VPC Endpoint Interface (+
Atlas PrivateLink), ECS Compute (Table 26). The MongoDB Atlas M10 cluster
cost is **billed separately by MongoDB** (does not appear in AWS Cost
Explorer/Budgets): add it manually to the estimate and monitor it
separately in the Atlas console. Update `monthlyBudgetUsd` in `cdk.json`
with the amount agreed by the team before deploying `CodeGuardian-Budget`.
