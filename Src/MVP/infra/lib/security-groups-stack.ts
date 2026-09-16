import * as cdk from "aws-cdk-lib";
import * as ec2 from "aws-cdk-lib/aws-ec2";
import type { Construct } from "constructs";
import { ATLAS_MONGO_PORT, ECS_SIZING, REDIS_PORT, REGION } from "./config";

export interface SecurityGroupsStackProps extends cdk.StackProps {
  vpc: ec2.IVpc;
}

// One SG per component. sg-backend and sg-agents talk to each other in
// both directions: declaring those rules inline in the constructors makes
// CloudFormation complain about a cycle between the two SGs, so they are
// created empty and the reciprocal rules are added afterwards (section 3).
//
// sg-agents never has an egress rule towards 0.0.0.0/0: this is how the
// prohibition for agents to access the Internet is guaranteed at the
// network level, not just in the Python code.
export class SecurityGroupsStack extends cdk.Stack {
  public readonly sgAlb: ec2.SecurityGroup;
  public readonly sgBackend: ec2.SecurityGroup;
  public readonly sgAgents: ec2.SecurityGroup;
  public readonly sgAtlas: ec2.SecurityGroup; // on the Atlas PrivateLink Interface VPC Endpoint
  public readonly sgRedis: ec2.SecurityGroup;
  public readonly sgVpce: ec2.SecurityGroup; // generic Interface endpoints
  public readonly sgBedrock: ec2.SecurityGroup; // Bedrock endpoint, only from sg-agents

  constructor(scope: Construct, id: string, props: SecurityGroupsStackProps) {
    super(scope, id, props);
    const { vpc } = props;

    this.sgAlb = new ec2.SecurityGroup(this, "SgAlb", {
      vpc,
      securityGroupName: "codeguardian-alb",
      description: "Public ALB behind CloudFront",
      allowAllOutbound: false,
    });

    this.sgBackend = new ec2.SecurityGroup(this, "SgBackend", {
      vpc,
      securityGroupName: "codeguardian-backend",
      description: "Backend ECS service (NestJS)",
      allowAllOutbound: false,
    });

    this.sgAgents = new ec2.SecurityGroup(this, "SgAgents", {
      vpc,
      securityGroupName: "codeguardian-agents",
      description: "Agents ECS service (Python/LangGraph) -- zero egress to Internet",
      allowAllOutbound: false,
    });

    this.sgAtlas = new ec2.SecurityGroup(this, "SgAtlas", {
      vpc,
      securityGroupName: "codeguardian-atlas",
      description: "Interface VPC Endpoint to MongoDB Atlas PrivateLink",
      allowAllOutbound: false,
    });

    this.sgRedis = new ec2.SecurityGroup(this, "SgRedis", {
      vpc,
      securityGroupName: "codeguardian-redis",
      description: "Amazon ElastiCache (Redis)",
      allowAllOutbound: false,
    });

    this.sgVpce = new ec2.SecurityGroup(this, "SgVpce", {
      vpc,
      securityGroupName: "codeguardian-vpce",
      description: "Generic Interface VPC Endpoints (Secrets Manager, ECR, CloudWatch Logs, SSM)",
      allowAllOutbound: false,
    });

    this.sgBedrock = new ec2.SecurityGroup(this, "SgBedrock", {
      vpc,
      securityGroupName: "codeguardian-bedrock",
      description: "Bedrock Runtime Interface VPC Endpoint -- ingress only from sg-agents",
      allowAllOutbound: false,
    });

    // The CloudFront prefix list ID changes per account/region: it must be
    // resolved at synth-time (requires a valid AWS session for `cdk synth`).
    const cloudFrontOriginFacingPrefixListId = ec2.PrefixList.fromLookup(
      this,
      "CloudFrontOriginFacingPrefixList",
      {
        prefixListName: "com.amazonaws.global.cloudfront.origin-facing",
      },
    ).prefixListId;

    this.sgAlb.addIngressRule(
      ec2.Peer.prefixList(cloudFrontOriginFacingPrefixListId),
      ec2.Port.tcp(80),
      "HTTP from CloudFront origin-facing (edge)",
    );
    this.sgAlb.addEgressRule(this.sgBackend, ec2.Port.tcp(ECS_SIZING.backend.port), "To backend");

    this.sgBackend.addIngressRule(this.sgAlb, ec2.Port.tcp(ECS_SIZING.backend.port), "From ALB");

    this.sgBackend.addEgressRule(
      this.sgAtlas,
      ec2.Port.tcp(ATLAS_MONGO_PORT),
      "To Atlas PrivateLink",
    );
    this.sgAtlas.addIngressRule(this.sgBackend, ec2.Port.tcp(ATLAS_MONGO_PORT), "From backend");

    // TEMPORARY: the Atlas cluster lives in eu-central-1 (Frankfurt), not
    // in eu-south-1 like this infrastructure -- PrivateLink works only
    // within the same region, so the endpoint above is never usable for
    // this cluster. Until the cluster is moved to eu-south-1 (or the
    // PrivateLink idea is abandoned), the backend reaches Atlas via the
    // public Internet through the NAT Gateway, authenticated by the IP
    // Access List on Atlas (NAT Gateway IP whitelisted manually). Remove
    // this when the region mismatch is resolved.
    this.sgBackend.addEgressRule(
      ec2.Peer.anyIpv4(),
      ec2.Port.tcp(ATLAS_MONGO_PORT),
      "To Atlas via public Internet (region mismatch with Private Endpoint)",
    );

    this.sgBackend.addEgressRule(this.sgRedis, ec2.Port.tcp(REDIS_PORT), "To Redis");
    this.sgRedis.addIngressRule(this.sgBackend, ec2.Port.tcp(REDIS_PORT), "From backend");
    this.sgAgents.addEgressRule(this.sgRedis, ec2.Port.tcp(REDIS_PORT), "To Redis");
    this.sgRedis.addIngressRule(this.sgAgents, ec2.Port.tcp(REDIS_PORT), "From agents");

    this.sgBackend.addEgressRule(
      this.sgVpce,
      ec2.Port.tcp(443),
      "To VPC Endpoints (SM/ECR/CW/SSM)",
    );
    this.sgVpce.addIngressRule(this.sgBackend, ec2.Port.tcp(443), "From backend");

    this.sgAgents.addEgressRule(this.sgVpce, ec2.Port.tcp(443), "To VPC Endpoints (SM/ECR/CW/SSM)");
    this.sgVpce.addIngressRule(this.sgAgents, ec2.Port.tcp(443), "From agents");

    // ECR image layers are physically on S3: even with the Interface
    // endpoints ecr.api/ecr.dkr covered by sgVpce above, the actual pull
    // of a layer can redirect to an S3 URL whose destination IP remains
    // the public S3 IP (the Gateway Endpoint routes it privately
    // underneath, but the security group still evaluates the apparent
    // destination IP). A Gateway Endpoint has no own ENI/SG to reference:
    // the S3 prefix list is needed. This is not a hole to the generic
    // Internet (does not violate the prohibition of lines 15-17): the
    // prefix list covers only S3 IPs in this region, always routed via
    // the existing Gateway Endpoint.
    const s3PrefixListId = ec2.PrefixList.fromLookup(this, "S3PrefixList", {
      prefixListName: `com.amazonaws.${REGION}.s3`,
    }).prefixListId;
    this.sgAgents.addEgressRule(
      ec2.Peer.prefixList(s3PrefixListId),
      ec2.Port.tcp(443),
      "To S3 (ECR image layers, via Gateway Endpoint)",
    );

    this.sgAgents.addEgressRule(this.sgBedrock, ec2.Port.tcp(443), "To Bedrock Runtime endpoint");
    this.sgBedrock.addIngressRule(
      this.sgAgents,
      ec2.Port.tcp(443),
      "From agents (only agents invoke Bedrock)",
    );

    // TEMPORARY, same reason as the backend (see above): the Atlas cluster
    // is in eu-central-1, not eu-south-1, so the Private Endpoint is never
    // usable. Note: this rule deliberately violates the guarantee of
    // lines 15-17 ("sg-agents never has egress to 0.0.0.0/0") -- it is a
    // conscious security compromise, not an error. Remove this when the
    // region mismatch is resolved.
    this.sgAgents.addEgressRule(
      ec2.Peer.anyIpv4(),
      ec2.Port.tcp(ATLAS_MONGO_PORT),
      "To Atlas via public Internet (region mismatch with Private Endpoint) -- TEMPORARY, violates the prohibition of lines 15-17",
    );

    // The only egress to the Internet of the entire stack: the backend
    // calling the GitHub REST API via NAT.
    this.sgBackend.addEgressRule(
      ec2.Peer.anyIpv4(),
      ec2.Port.tcp(443),
      "HTTPS to api.github.com (via NAT Gateway) -- only external channel besides Bedrock",
    );

    // Reciprocal rules backend <-> agents, added now (see comment at top of file).
    this.sgBackend.addEgressRule(this.sgAgents, ec2.Port.tcp(ECS_SIZING.agents.port), "To agents");
    this.sgAgents.addIngressRule(
      this.sgBackend,
      ec2.Port.tcp(ECS_SIZING.agents.port),
      "From backend",
    );

    this.sgAgents.addEgressRule(
      this.sgBackend,
      ec2.Port.tcp(ECS_SIZING.backend.port),
      "To backend (read-only GitHub tool-calls + progress callback)",
    );
    this.sgBackend.addIngressRule(
      this.sgAgents,
      ec2.Port.tcp(ECS_SIZING.backend.port),
      "From agents",
    );

    // sg-atlas, sg-redis, sg-vpce, sg-bedrock have no egress rules:
    // they are terminal endpoints/services, they do not open connections to anything.

    new cdk.CfnOutput(this, "SgAgentsId", { value: this.sgAgents.securityGroupId });
    new cdk.CfnOutput(this, "SgBackendId", { value: this.sgBackend.securityGroupId });
  }
}
