import * as cdk from "aws-cdk-lib";
import * as ecr from "aws-cdk-lib/aws-ecr";
import * as iam from "aws-cdk-lib/aws-iam";
import { Construct } from "constructs";
import { ECR_MAX_TAGGED_IMAGES, ECR_REPOS, ECR_UNTAGGED_MAX_AGE_DAYS } from "./config";

// Repository ECR + identità CI/CD via GitHub OIDC (nessuna chiave IAM
// long-lived salvata come secret del repository). Il ruolo
// `codeguardian-ci-role` copre qui solo il push su ECR; i permessi di
// deploy (ECS) e distribuzione frontend (S3 + CloudFront) vengono aggiunti
// allo stesso ruolo da compute-stack.ts e cloudfront-stack.ts.
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
        description: `Mantieni solo le ultime ${ECR_MAX_TAGGED_IMAGES} immagini taggate`,
        tagStatus: ecr.TagStatus.TAGGED,
        // Match su qualsiasi tag: il tagging reale è lo SHA breve del
        // commit senza prefisso (es. `:a1b2c3d`), un prefisso fisso tipo
        // "sha-" non avrebbe mai fatto match.
        tagPatternList: ["*"],
        maxImageCount: ECR_MAX_TAGGED_IMAGES,
      },
      {
        rulePriority: 2,
        description: `Elimina immagini untagged più vecchie di ${ECR_UNTAGGED_MAX_AGE_DAYS} giorno/i`,
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
      description: "Identità GitHub Actions per build/push immagini, deploy ECS e invalidazione CloudFront",
      assumedBy: new iam.OpenIdConnectPrincipal(githubOidcProvider, {
        StringEquals: {
          "token.actions.githubusercontent.com:aud": "sts.amazonaws.com",
        },
        StringLike: {
          // Qualunque ref/branch del repo può assumere il ruolo; è il
          // workflow (deploy.yml), non il trust policy, a restringere le
          // credenziali AWS al solo push su main.
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
        resources: ["*"], // azione non scopabile a livello di risorsa
      }),
    );

    // Serve al job synth-infra della pipeline: senza questi due permessi,
    // i context lookup di `cdk synth` (AZ della VPC, prefix list di
    // CloudFront) falliscono con AccessDenied.
    this.ciRole.addToPolicy(
      new iam.PolicyStatement({
        sid: "CdkSynthContextLookups",
        actions: ["ec2:DescribeAvailabilityZones", "ec2:DescribeManagedPrefixLists"],
        resources: ["*"],
      }),
    );

    new cdk.CfnOutput(this, "CiRoleArn", { value: this.ciRole.roleArn });
    new cdk.CfnOutput(this, "BackendRepoUri", { value: this.backendRepo.repositoryUri });
    new cdk.CfnOutput(this, "AgentsRepoUri", { value: this.agentsRepo.repositoryUri });
  }
}
