import * as cdk from "aws-cdk-lib";
import * as kms from "aws-cdk-lib/aws-kms";
import * as s3 from "aws-cdk-lib/aws-s3";
import { Construct } from "constructs";
import { ARTIFACTS_LIFECYCLE_EXPIRATION_DAYS } from "./config";

export interface StorageStackProps extends cdk.StackProps {
  kmsKey: kms.IKey;
}

// Bucket S3 per gli artefatti (report esportati): nessun accesso pubblico,
// accesso di rete ristretto al Gateway Endpoint (policy creata in
// vpc-endpoints-stack.ts, dove l'endpoint stesso nasce), lettura/scrittura
// solo per il task role del backend (compute-stack.ts).
//
// Il bucket frontend statico non è qui: vive in cloudfront-stack.ts insieme
// alla distribuzione che lo serve, per evitare una dipendenza circolare nota
// tra bucket e CloudFront quando stanno in stack diversi (vedi quel file).
//
// Niente `enforceSSL: true` qui: creerebbe subito una BucketPolicy in questo
// stack, e vpc-endpoints-stack.ts ne crea già una propria per lo stesso
// bucket -- un bucket ne accetta una sola. Il vincolo HTTPS-only è aggiunto
// insieme al resto là.
export class StorageStack extends cdk.Stack {
  public readonly artifactsBucket: s3.Bucket;

  constructor(scope: Construct, id: string, props: StorageStackProps) {
    super(scope, id, props);
    const { kmsKey } = props;

    this.artifactsBucket = new s3.Bucket(this, "ArtifactsBucket", {
      blockPublicAccess: s3.BlockPublicAccess.BLOCK_ALL,
      encryption: s3.BucketEncryption.KMS,
      encryptionKey: kmsKey,
      versioned: false,
      lifecycleRules: [
        {
          id: "expire-after-30-days",
          enabled: true,
          expiration: cdk.Duration.days(ARTIFACTS_LIFECYCLE_EXPIRATION_DAYS),
        },
      ],
      removalPolicy: cdk.RemovalPolicy.RETAIN,
    });

    new cdk.CfnOutput(this, "ArtifactsBucketName", { value: this.artifactsBucket.bucketName });
  }
}
