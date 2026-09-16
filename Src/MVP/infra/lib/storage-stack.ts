import * as cdk from "aws-cdk-lib";
import type * as kms from "aws-cdk-lib/aws-kms";
import * as s3 from "aws-cdk-lib/aws-s3";
import type { Construct } from "constructs";
import { ARTIFACTS_LIFECYCLE_EXPIRATION_DAYS } from "./config";

export interface StorageStackProps extends cdk.StackProps {
  kmsKey: kms.IKey;
}

// S3 bucket for artifacts (exported reports): no public access, network
// access restricted to the Gateway Endpoint (policy created in
// vpc-endpoints-stack.ts, where the endpoint itself is created),
// read/write only for the backend task role (compute-stack.ts).
//
// The static frontend bucket is not here: it lives in cloudfront-stack.ts
// together with the distribution that serves it, to avoid a known circular
// dependency between bucket and CloudFront when they live in different
// stacks (see that file).
//
// No `enforceSSL: true` here: it would immediately create a BucketPolicy in
// this stack, and vpc-endpoints-stack.ts already creates its own for the
// same bucket -- a bucket accepts only one. The HTTPS-only constraint is
// added together with the rest there.
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
