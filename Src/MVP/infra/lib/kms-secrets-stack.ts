import * as cdk from "aws-cdk-lib";
import * as kms from "aws-cdk-lib/aws-kms";
import * as secretsmanager from "aws-cdk-lib/aws-secretsmanager";
import * as ssm from "aws-cdk-lib/aws-ssm";
import { Construct } from "constructs";

// KMS, Secrets Manager, Parameter Store. Un segreto per credenziale (non un
// blob JSON unico): con un JSON unico l'ARN nella Task Definition deve
// specificare la chiave da estrarre, dimenticarlo inietta l'intero blob
// nella variabile d'ambiente.
//
// REDIS_URL non è qui: dipende dall'endpoint del cluster ElastiCache, quindi
// il parametro nasce in data-stack.ts subito dopo il provisioning.
//
// I 4 secret usano la chiave gestita di default `aws/secretsmanager`, non la
// CMK condivisa qui sotto. Non è una scelta di comodo: `Secret.grantRead()`
// (chiamato da compute-stack.ts quando i secret finiscono nel container)
// concede il decrypt KMS avvolgendo il grantee in un `ViaServicePrincipal`,
// che non supporta le policy identity-based -- il grant è quindi costretto a
// scrivere sulla key policy della CMK, che vivrebbe qui e dovrebbe
// referenziare il ruolo creato in compute-stack.ts: un ciclo (Secrets <->
// Compute). Con la chiave di default questo non serve. La CMK resta usata
// per S3 e Redis, dove il problema non si presenta.
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

    // Usata da S3 e ElastiCache (MongoDB Atlas cifra a riposo con chiavi
    // proprie). Il grant esplicito per i Task Role vive nei rispettivi
    // stack consumatori.
    this.kmsKey = new kms.Key(this, "CodeGuardianKey", {
      alias: "alias/codeguardian-mvp",
      description: "CMK condivisa MVP: ElastiCache, S3",
      enableKeyRotation: true,
      removalPolicy: cdk.RemovalPolicy.RETAIN,
    });

    // Placeholder: il valore reale arriva solo dopo il provisioning di
    // Atlas (RUNBOOK.md) -- non va lasciato così in un ambiente condiviso.
    this.secretMongoUri = new secretsmanager.Secret(this, "MongoUriSecret", {
      secretName: "codeguardian/mongo-uri",
      description: "MONGO_URI -- connection string del Private Endpoint MongoDB Atlas (da aggiornare dopo il provisioning Atlas)",
      secretStringValue: cdk.SecretValue.unsafePlainText("REPLACE_AFTER_ATLAS_PRIVATE_ENDPOINT_SETUP"),
    });

    this.secretJwt = new secretsmanager.Secret(this, "JwtSecret", {
      secretName: "codeguardian/jwt-secret",
      description: "JWT_SECRET -- firma HS256 dei token di sessione",
      generateSecretString: { passwordLength: 64, excludePunctuation: true },
    });

    this.secretCredentialMasterKey = new secretsmanager.Secret(this, "CredentialMasterKeySecret", {
      secretName: "codeguardian/credential-master-key",
      description: "CREDENTIAL_MASTER_KEY -- key material per HKDF -> AES-256-GCM sulle credenziali di servizio",
      generateSecretString: { passwordLength: 64, excludePunctuation: true },
    });

    this.secretInternalSharedSecret = new secretsmanager.Secret(this, "InternalSharedSecretSecret", {
      secretName: "codeguardian/internal-shared-secret",
      description: "INTERNAL_SHARED_SECRET -- HMAC sugli endpoint /internal/* tra backend e agents",
      generateSecretString: { passwordLength: 64, excludePunctuation: true },
    });

    this.paramBackendBaseUrl = new ssm.StringParameter(this, "BackendBaseUrlParam", {
      parameterName: "/codeguardian/backend-base-url",
      description: "BACKEND_BASE_URL -- usato dagli agents per le tool-call di lettura verso il backend",
      stringValue: "http://backend.codeguardian.local:3000",
    });

    this.paramLlmProvider = new ssm.StringParameter(this, "LlmProviderParam", {
      parameterName: "/codeguardian/llm-provider",
      description: "LLM_PROVIDER -- seleziona l'implementazione LLMProvider attiva negli agents",
      stringValue: "bedrock",
    });

    new cdk.CfnOutput(this, "MongoUriSecretArn", {
      value: this.secretMongoUri.secretArn,
      description: "Aggiornare con la connection string reale del Private Endpoint Atlas",
    });
  }
}
