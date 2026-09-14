import * as cdk from "aws-cdk-lib";
import * as kms from "aws-cdk-lib/aws-kms";
import * as secretsmanager from "aws-cdk-lib/aws-secretsmanager";
import * as ssm from "aws-cdk-lib/aws-ssm";
import type { Construct } from "constructs";

// KMS, Secrets Manager, Parameter Store. One secret per credential (not a
// single JSON blob): with a single JSON blob the ARN in the Task Definition
// must specify the key to extract, forgetting it injects the entire blob
// into the environment variable.
//
// REDIS_URL is not here: it depends on the ElastiCache cluster endpoint, so
// the parameter is created in data-stack.ts right after provisioning.
//
// The 4 secrets use the default managed key `aws/secretsmanager`, not the
// shared CMK below. This is not a convenience choice: `Secret.grantRead()`
// (called by compute-stack.ts when secrets land in the container) grants
// KMS decrypt by wrapping the grantee in a `ViaServicePrincipal`, which
// does not support identity-based policies -- the grant is therefore
// forced to write to the CMK key policy, which would live here and would
// need to reference the role created in compute-stack.ts: a cycle
// (Secrets <-> Compute). With the default key this is not needed. The CMK
// remains used for S3 and Redis, where the problem does not arise.
export class KmsSecretsStack extends cdk.Stack {
  public readonly kmsKey: kms.Key;

  public readonly secretMongoUri: secretsmanager.Secret;
  public readonly secretJwt: secretsmanager.Secret;
  public readonly secretCredentialMasterKey: secretsmanager.Secret;
  public readonly secretInternalSharedSecret: secretsmanager.Secret;

  public readonly paramBackendBaseUrl: ssm.StringParameter;
  public readonly paramLlmProvider: ssm.StringParameter;

  constructor(scope: Construct, id: string, props?: cdk.StackProps) {
    super(scope, id, props);

    // Used by S3 and ElastiCache (MongoDB Atlas encrypts at rest with its
    // own keys). The explicit grant for the Task Role lives in the
    // respective consumer stacks.
    this.kmsKey = new kms.Key(this, "CodeGuardianKey", {
      alias: "alias/codeguardian-mvp",
      description: "Shared MVP CMK: ElastiCache, S3",
      enableKeyRotation: true,
      removalPolicy: cdk.RemovalPolicy.RETAIN,
    });

    // Placeholder: the real value arrives only after Atlas provisioning
    // (RUNBOOK.md) -- must not be left like this in a shared environment.
    this.secretMongoUri = new secretsmanager.Secret(this, "MongoUriSecret", {
      secretName: "codeguardian/mongo-uri",
      description:
        "MONGO_URI -- MongoDB Atlas Private Endpoint connection string (to update after Atlas provisioning)",
      secretStringValue: cdk.SecretValue.unsafePlainText(
        "REPLACE_AFTER_ATLAS_PRIVATE_ENDPOINT_SETUP",
      ),
    });

    this.secretJwt = new secretsmanager.Secret(this, "JwtSecret", {
      secretName: "codeguardian/jwt-secret",
      description: "JWT_SECRET -- HS256 signing of session tokens",
      generateSecretString: { passwordLength: 64, excludePunctuation: true },
    });

    this.secretCredentialMasterKey = new secretsmanager.Secret(this, "CredentialMasterKeySecret", {
      secretName: "codeguardian/credential-master-key",
      description:
        "CREDENTIAL_MASTER_KEY -- key material for HKDF -> AES-256-GCM on service credentials",
      generateSecretString: { passwordLength: 64, excludePunctuation: true },
    });

    this.secretInternalSharedSecret = new secretsmanager.Secret(
      this,
      "InternalSharedSecretSecret",
      {
        secretName: "codeguardian/internal-shared-secret",
        description:
          "INTERNAL_SHARED_SECRET -- HMAC on /internal/* endpoints between backend and agents",
        generateSecretString: { passwordLength: 64, excludePunctuation: true },
      },
    );

    this.paramBackendBaseUrl = new ssm.StringParameter(this, "BackendBaseUrlParam", {
      parameterName: "/codeguardian/backend-base-url",
      description:
        "BACKEND_BASE_URL -- used by agents for read tool-calls towards the backend",
      stringValue: "http://backend.codeguardian.local:3000",
    });

    this.paramLlmProvider = new ssm.StringParameter(this, "LlmProviderParam", {
      parameterName: "/codeguardian/llm-provider",
      description: "LLM_PROVIDER -- selects the active LLMProvider implementation in agents",
      stringValue: "bedrock",
    });

    new cdk.CfnOutput(this, "MongoUriSecretArn", {
      value: this.secretMongoUri.secretArn,
      description: "Update with the real Atlas Private Endpoint connection string",
    });
  }
}
