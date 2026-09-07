import * as cdk from "aws-cdk-lib";
import * as ec2 from "aws-cdk-lib/aws-ec2";
import * as iam from "aws-cdk-lib/aws-iam";
import * as s3 from "aws-cdk-lib/aws-s3";
import { Construct } from "constructs";

export interface VpcEndpointsStackProps extends cdk.StackProps {
  vpc: ec2.IVpc;
  sgVpce: ec2.ISecurityGroup; // endpoint Interface generici (SM, ECR, CloudWatch, SSM)
  sgBedrock: ec2.ISecurityGroup; // endpoint Bedrock Runtime, ingress solo da sg-agents
  artifactsBucket: s3.IBucket;
}

// VPC Endpoints: tutto il traffico verso servizi AWS resta dentro la VPC da
// qui (i task sono in subnet private senza IP pubblico). Il NAT serve solo
// per l'uscita verso GitHub. L'endpoint verso MongoDB Atlas non è qui: il
// suo `serviceName` è generato da Atlas, non è un servizio "com.amazonaws.*"
// come gli altri, quindi vive in atlas-stack.ts.
//
// Si usano i costruttori `new ec2.GatewayVpcEndpoint`/`InterfaceVpcEndpoint`
// invece delle scorciatoie `vpc.addGatewayEndpoint()`/`addInterfaceEndpoint
// ()`: quelle creano l'endpoint come figlio di `vpc`, cioè dentro Network,
// non qui. Passandogli sgVpce/sgBedrock (di SecurityGroups) si otterrebbe
// Network -> SecurityGroups, mentre SecurityGroups dipende già da Network
// per la VPC: un ciclo. Istanziando qui su `this`, la dipendenza resta a
// senso unico.
export class VpcEndpointsStack extends cdk.Stack {
  constructor(scope: Construct, id: string, props: VpcEndpointsStackProps) {
    super(scope, id, props);
    const { vpc, sgVpce, sgBedrock, artifactsBucket } = props;

    const privateSubnets = { subnets: vpc.privateSubnets };

    // Gateway Endpoint: agisce sulla route table, niente Private DNS o SG.
    const s3Endpoint = new ec2.GatewayVpcEndpoint(this, "S3Endpoint", {
      vpc,
      service: ec2.GatewayVpcEndpointAwsService.S3,
      subnets: [privateSubnets],
    });

    // Il bucket artefatti è raggiungibile solo da qui: nega le operazioni
    // sugli oggetti se non arrivano da questo endpoint. Volutamente non
    // copre azioni di controllo (PutBucketPolicy ecc.), che passano dal
    // control plane di CloudFormation, non da un VPC Endpoint -- altrimenti
    // un futuro deploy che tocca il bucket si bloccherebbe da solo.
    //
    // Costruita a mano come `s3.BucketPolicy` (non con
    // `artifactsBucket.addToResourcePolicy`, che la creerebbe in storage-
    // stack.ts referenziando `s3Endpoint` di qui -- stesso ciclo di prima,
    // via S3 invece che via EC2). Include anche il vincolo HTTPS-only che
    // normalmente arriverebbe da `enforceSSL: true` sul bucket, omesso in
    // storage-stack.ts per lo stesso motivo.
    new s3.BucketPolicy(this, "ArtifactsBucketPolicy", {
      bucket: artifactsBucket,
      document: new iam.PolicyDocument({
        statements: [
          new iam.PolicyStatement({
            sid: "RestrictObjectAccessToS3GatewayEndpoint",
            effect: iam.Effect.DENY,
            principals: [new iam.AnyPrincipal()],
            actions: ["s3:GetObject", "s3:PutObject", "s3:DeleteObject", "s3:ListBucket"],
            resources: [artifactsBucket.bucketArn, artifactsBucket.arnForObjects("*")],
            conditions: {
              StringNotEquals: { "aws:SourceVpce": s3Endpoint.vpcEndpointId },
            },
          }),
          new iam.PolicyStatement({
            sid: "DenyInsecureTransport",
            effect: iam.Effect.DENY,
            principals: [new iam.AnyPrincipal()],
            actions: ["s3:*"],
            resources: [artifactsBucket.bucketArn, artifactsBucket.arnForObjects("*")],
            conditions: {
              Bool: { "aws:SecureTransport": "false" },
            },
          }),
        ],
      }),
    });

    // Bedrock Runtime su un SG dedicato: solo agents lo raggiunge.
    new ec2.InterfaceVpcEndpoint(this, "BedrockRuntimeEndpoint", {
      vpc,
      service: ec2.InterfaceVpcEndpointAwsService.BEDROCK_RUNTIME,
      subnets: privateSubnets,
      securityGroups: [sgBedrock],
      privateDnsEnabled: true,
    });

    // Endpoint "generici", condivisi tra backend e agents: Secrets Manager,
    // ECR (api + dkr), CloudWatch Logs, SSM/SSM Messages/EC2 Messages.
    const genericInterfaceEndpoints: Array<[string, ec2.InterfaceVpcEndpointAwsService]> = [
      ["SecretsManagerEndpoint", ec2.InterfaceVpcEndpointAwsService.SECRETS_MANAGER],
      ["EcrApiEndpoint", ec2.InterfaceVpcEndpointAwsService.ECR],
      ["EcrDkrEndpoint", ec2.InterfaceVpcEndpointAwsService.ECR_DOCKER],
      ["CloudWatchLogsEndpoint", ec2.InterfaceVpcEndpointAwsService.CLOUDWATCH_LOGS],
      ["SsmEndpoint", ec2.InterfaceVpcEndpointAwsService.SSM],
      ["SsmMessagesEndpoint", ec2.InterfaceVpcEndpointAwsService.SSM_MESSAGES],
      ["Ec2MessagesEndpoint", ec2.InterfaceVpcEndpointAwsService.EC2_MESSAGES],
    ];

    for (const [id2, service] of genericInterfaceEndpoints) {
      new ec2.InterfaceVpcEndpoint(this, id2, {
        vpc,
        service,
        subnets: privateSubnets,
        securityGroups: [sgVpce],
        privateDnsEnabled: true,
      });
    }

    // 8 Interface Endpoint su 2 AZ = 16 ENI fatturati continuativamente (più
    // Atlas PrivateLink a parte): da tenere presente nella stima dei costi.
  }
}
