import * as cdk from "aws-cdk-lib";
import * as ecr from "aws-cdk-lib/aws-ecr";
import * as iam from "aws-cdk-lib/aws-iam";
import type { Construct } from "constructs";
import { ECR_MAX_TAGGED_IMAGES, ECR_REPOS, ECR_UNTAGGED_MAX_AGE_DAYS } from "./config";

// ECR repositories + CI/CD identity via GitHub OIDC (no long-lived IAM
// key stored as a repository secret). The `codeguardian-ci-role` role
// covers only ECR push here; deploy (ECS) and frontend distribution (S3 +
// CloudFront) permissions are added to the same role by compute-stack.ts
// and cloudfront-stack.ts.
export class CicdIdentityStack extends cdk.Stack {
  public readonly backendRepo: ecr.Repository;
  public readonly agentsRepo: ecr.Repository;
  public readonly ciRole: iam.Role;

  constructor(scope: Construct, id: string, props?: cdk.StackProps) {
    super(scope, id, props);

    const githubOrg = this.node.tryGetContext("githubOrg") ?? "REPLACE_WITH_GITHUB_ORG";
    const githubRepo = this.node.tryGetContext("githubRepo") ?? "code-guardian";

    const lifecycleRules: ecr.LifecycleRule[] = [
      {
        rulePriority: 1,
        description: `Keep only the last ${ECR_MAX_TAGGED_IMAGES} tagged images`,
        tagStatus: ecr.TagStatus.TAGGED,
        // Match on any tag: the actual tagging is the short SHA of the
        // commit without prefix (e.g. `:a1b2c3d`), a fixed prefix like
        // "sha-" would never match.
        tagPatternList: ["*"],
        maxImageCount: ECR_MAX_TAGGED_IMAGES,
      },
      {
        rulePriority: 2,
        description: `Delete untagged images older than ${ECR_UNTAGGED_MAX_AGE_DAYS} day(s)`,
        tagStatus: ecr.TagStatus.UNTAGGED,
        maxImageAge: cdk.Duration.days(ECR_UNTAGGED_MAX_AGE_DAYS),
      },
    ];

    this.backendRepo = new ecr.Repository(this, "BackendRepo", {
      repositoryName: ECR_REPOS.backend,
      imageScanOnPush: true,
      lifecycleRules,
      removalPolicy: cdk.RemovalPolicy.RETAIN,
    });

    this.agentsRepo = new ecr.Repository(this, "AgentsRepo", {
      repositoryName: ECR_REPOS.agents,
      imageScanOnPush: true,
      lifecycleRules,
      removalPolicy: cdk.RemovalPolicy.RETAIN,
    });

    const githubOidcProvider = new iam.OpenIdConnectProvider(this, "GithubOidcProvider", {
      url: "https://token.actions.githubusercontent.com",
      clientIds: ["sts.amazonaws.com"],
    });

    this.ciRole = new iam.Role(this, "CiRole", {
      roleName: "codeguardian-ci-role",
      description:
        "GitHub Actions identity for image build/push, ECS deploy and CloudFront invalidation",
      assumedBy: new iam.OpenIdConnectPrincipal(githubOidcProvider, {
        StringEquals: {
          "token.actions.githubusercontent.com:aud": "sts.amazonaws.com",
        },
        StringLike: {
          // Any ref/branch of the repo can assume the role; it is the
          // workflow (deploy.yml), not the trust policy, that restricts
          // AWS credentials to pushes on main only.
          "token.actions.githubusercontent.com:sub": `repo:${githubOrg}/${githubRepo}:*`,
        },
      }),
      maxSessionDuration: cdk.Duration.hours(1),
    });

    this.backendRepo.grantPullPush(this.ciRole);
    this.agentsRepo.grantPullPush(this.ciRole);
    this.ciRole.addToPolicy(
      new iam.PolicyStatement({
        sid: "EcrAuth",
        actions: ["ecr:GetAuthorizationToken"],
        resources: ["*"], // action not scoppable at resource level
      }),
    );

    // Needed by the synth-infra job in the pipeline: without these two
    // permissions, the context lookups of `cdk synth` (VPC AZs, CloudFront
    // prefix list) fail with AccessDenied.
    this.ciRole.addToPolicy(
      new iam.PolicyStatement({
        sid: "CdkSynthContextLookups",
        actions: ["ec2:DescribeAvailabilityZones", "ec2:DescribeManagedPrefixLists"],
        resources: ["*"],
      }),
    );

    new cdk.CfnOutput(this, "CiRoleArn", { value: this.ciRole.roleArn });
    new cdk.CfnOutput(this, "BackendRepoURI", { value: this.backendRepo.repositoryUri });
    new cdk.CfnOutput(this, "AgentsRepoURI", { value: this.agentsRepo.repositoryUri });
  }
}
