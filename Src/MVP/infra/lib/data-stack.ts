import * as cdk from "aws-cdk-lib";
import * as ec2 from "aws-cdk-lib/aws-ec2";
import * as elasticache from "aws-cdk-lib/aws-elasticache";
import * as kms from "aws-cdk-lib/aws-kms";
import * as ssm from "aws-cdk-lib/aws-ssm";
import { Construct } from "constructs";
import { REDIS_PORT } from "./config";

export interface DataStackProps extends cdk.StackProps {
  vpc: ec2.IVpc;
  sgRedis: ec2.ISecurityGroup;
  kmsKey: kms.IKey;
}

// ElastiCache Redis: coda BullMQ, cache letture GitHub, rate limiter
// applicativo (60 req/min per utente sulle chiamate a GitHub).
//
// Cifratura a riposo + TLS in-transit richiedono un CfnReplicationGroup: un
// CfnCacheCluster "nudo" non le espone per l'engine Redis. Per restare a
// "nodo singolo" (SPOF accettato per l'MVP) si usa un solo nodo primario con
// automaticFailoverEnabled: false.
export class DataStack extends cdk.Stack {
  public readonly redis: elasticache.CfnReplicationGroup;
  public readonly paramRedisUrl: ssm.StringParameter;

  constructor(scope: Construct, id: string, props: DataStackProps) {
    super(scope, id, props);
    const { vpc, sgRedis, kmsKey } = props;

    const subnetGroup = new elasticache.CfnSubnetGroup(this, "RedisSubnetGroup", {
      description: "Subnet group privato per ElastiCache Redis (private-a, private-b)",
      subnetIds: vpc.privateSubnets.map((s) => s.subnetId),
      cacheSubnetGroupName: "codeguardian-redis-subnet-group",
    });

    this.redis = new elasticache.CfnReplicationGroup(this, "RedisReplicationGroup", {
      replicationGroupDescription: "Code Guardian MVP -- Redis nodo singolo (coda BullMQ + cache GitHub + rate limiter RQ.8)",
      engine: "redis",
      // transitEncryptionMode: "required" in creazione richiede Redis >= 7.0.5:
      // fissata esplicitamente per non dipendere dalla versione di default,
      // che può cambiare nel tempo.
      engineVersion: "7.1",
      cacheNodeType: "cache.t3.micro",
      numCacheClusters: 1, // nodo singolo, no repliche -- rischio SPOF accettato
      automaticFailoverEnabled: false,
      multiAzEnabled: false,
      port: REDIS_PORT,
      cacheSubnetGroupName: subnetGroup.ref,
      securityGroupIds: [sgRedis.securityGroupId],
      atRestEncryptionEnabled: true, // va specificato alla creazione, non è più modificabile dopo
      transitEncryptionEnabled: true, // il client deve comunque connettersi con tls: {} lato applicativo
      transitEncryptionMode: "required",
      kmsKeyId: kmsKey.keyArn,
    });
    this.redis.addResourceDependency(subnetGroup);

    // Schema rediss:// per segnalare TLS a ioredis/node-redis -- il client
    // deve comunque passare anche l'opzione `tls: {}`.
    this.paramRedisUrl = new ssm.StringParameter(this, "RedisUrlParam", {
      parameterName: "/codeguardian/redis-url",
      description: "REDIS_URL -- endpoint TLS del Replication Group ElastiCache",
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
