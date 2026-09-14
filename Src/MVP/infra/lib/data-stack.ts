import * as cdk from "aws-cdk-lib";
import type * as ec2 from "aws-cdk-lib/aws-ec2";
import * as elasticache from "aws-cdk-lib/aws-elasticache";
import type * as kms from "aws-cdk-lib/aws-kms";
import * as ssm from "aws-cdk-lib/aws-ssm";
import type { Construct } from "constructs";
import { REDIS_PORT } from "./config";

export interface DataStackProps extends cdk.StackProps {
  vpc: ec2.IVpc;
  sgRedis: ec2.ISecurityGroup;
  kmsKey: kms.IKey;
}

// ElastiCache Redis: BullMQ queue, GitHub read cache, application-level
// rate limiter (60 req/min per user on GitHub calls).
//
// At-rest encryption + in-transit TLS require a CfnReplicationGroup: a
// bare CfnCacheCluster does not expose them for the Redis engine. To stay
// "single-node" (SPOF accepted for the MVP) a single primary node is used
// with automaticFailoverEnabled: false.
export class DataStack extends cdk.Stack {
  public readonly redis: elasticache.CfnReplicationGroup;
  public readonly paramRedisUrl: ssm.StringParameter;

  constructor(scope: Construct, id: string, props: DataStackProps) {
    super(scope, id, props);
    const { vpc, sgRedis, kmsKey } = props;

    const subnetGroup = new elasticache.CfnSubnetGroup(this, "RedisSubnetGroup", {
      description: "Private subnet group for ElastiCache Redis (private-a, private-b)",
      subnetIds: vpc.privateSubnets.map((s) => s.subnetId),
      cacheSubnetGroupName: "codeguardian-redis-subnet-group",
    });

    this.redis = new elasticache.CfnReplicationGroup(this, "RedisReplicationGroup", {
      replicationGroupDescription:
        "Code Guardian MVP -- Redis single node (BullMQ queue + GitHub cache + rate limiter RQ.8)",
      engine: "redis",
      // transitEncryptionMode: "required" on creation requires Redis >= 7.0.5:
      // pinned explicitly to not depend on the default version, which can
      // change over time.
      engineVersion: "7.1",
      cacheNodeType: "cache.t3.micro",
      numCacheClusters: 1, // single node, no replicas -- SPOF risk accepted
      automaticFailoverEnabled: false,
      multiAzEnabled: false,
      port: REDIS_PORT,
      cacheSubnetGroupName: subnetGroup.ref,
      securityGroupIds: [sgRedis.securityGroupId],
      atRestEncryptionEnabled: true, // must be specified at creation, cannot be changed later
      transitEncryptionEnabled: true, // the client must still connect with tls: {} on the application side
      transitEncryptionMode: "required",
      kmsKeyId: kmsKey.keyArn,
    });
    this.redis.addResourceDependency(subnetGroup);

    // rediss:// scheme to signal TLS to ioredis/node-redis -- the client
    // must still also pass the `tls: {}` option.
    this.paramRedisUrl = new ssm.StringParameter(this, "RedisUrlParam", {
      parameterName: "/codeguardian/redis-url",
      description: "REDIS_URL -- TLS endpoint of the ElastiCache Replication Group",
      // The placeholders inside the string are CloudFormation (Fn::Sub),
      // not JavaScript template literals: AWS resolves them at deploy-time.
      // biome-ignore lint/suspicious/noTemplateCurlyInString: see above
      stringValue: cdk.Fn.sub("rediss://${Host}:${Port}", {
        Host: this.redis.attrPrimaryEndPointAddress,
        Port: this.redis.attrPrimaryEndPointPort,
      }),
    });

    new cdk.CfnOutput(this, "RedisPrimaryEndpoint", {
      value: this.redis.attrPrimaryEndPointAddress,
    });
  }
}
