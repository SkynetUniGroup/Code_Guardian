import * as cdk from "aws-cdk-lib";
import * as ec2 from "aws-cdk-lib/aws-ec2";
import type { Construct } from "constructs";
import { ATLAS_MONGO_PORT, ECS_SIZING, REDIS_PORT, REGION } from "./config";

export interface SecurityGroupsStackProps extends cdk.StackProps {
  vpc: ec2.IVpc;
}

// Un SG per componente. sg-backend e sg-agents si parlano in entrambe le
// direzioni: dichiarare quelle regole inline nei costruttori fa lamentare
// CloudFormation di un ciclo tra i due SG, quindi si creano vuoti e le
// regole reciproche si aggiungono dopo (sezione 3).
//
// sg-agents non ha mai una regola di egress verso 0.0.0.0/0: è così che
// il divieto per gli agenti di accedere a Internet è garantito a livello
// di rete, non solo nel codice Python.
export class SecurityGroupsStack extends cdk.Stack {
  public readonly sgAlb: ec2.SecurityGroup;
  public readonly sgBackend: ec2.SecurityGroup;
  public readonly sgAgents: ec2.SecurityGroup;
  public readonly sgAtlas: ec2.SecurityGroup; // sull'Interface VPC Endpoint di Atlas PrivateLink
  public readonly sgRedis: ec2.SecurityGroup;
  public readonly sgVpce: ec2.SecurityGroup; // endpoint Interface generici
  public readonly sgBedrock: ec2.SecurityGroup; // endpoint Bedrock, solo da sg-agents

  constructor(scope: Construct, id: string, props: SecurityGroupsStackProps) {
    super(scope, id, props);
    const { vpc } = props;

    this.sgAlb = new ec2.SecurityGroup(this, "SgAlb", {
      vpc,
      securityGroupName: "codeguardian-alb",
      description: "ALB pubblico dietro CloudFront",
      allowAllOutbound: false,
    });

    this.sgBackend = new ec2.SecurityGroup(this, "SgBackend", {
      vpc,
      securityGroupName: "codeguardian-backend",
      description: "Servizio ECS backend (NestJS)",
      allowAllOutbound: false,
    });

    this.sgAgents = new ec2.SecurityGroup(this, "SgAgents", {
      vpc,
      securityGroupName: "codeguardian-agents",
      description: "Servizio ECS agents (Python/LangGraph) -- zero egress verso Internet",
      allowAllOutbound: false,
    });

    this.sgAtlas = new ec2.SecurityGroup(this, "SgAtlas", {
      vpc,
      securityGroupName: "codeguardian-atlas",
      description: "Interface VPC Endpoint verso MongoDB Atlas PrivateLink",
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
      description: "VPC Endpoints Interface generici (Secrets Manager, ECR, CloudWatch Logs, SSM)",
      allowAllOutbound: false,
    });

    this.sgBedrock = new ec2.SecurityGroup(this, "SgBedrock", {
      vpc,
      securityGroupName: "codeguardian-bedrock",
      description: "VPC Endpoint Interface Bedrock Runtime -- ingress solo da sg-agents",
      allowAllOutbound: false,
    });

    // L'ID del prefix list di CloudFront cambia per account/regione: va
    // risolto a synth-time (serve una sessione AWS valida per `cdk synth`).
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
      "HTTP da CloudFront origin-facing (edge)",
    );
    this.sgAlb.addEgressRule(this.sgBackend, ec2.Port.tcp(ECS_SIZING.backend.port), "To backend");

    this.sgBackend.addIngressRule(this.sgAlb, ec2.Port.tcp(ECS_SIZING.backend.port), "From ALB");

        this.sgBackend.addEgressRule(
      this.sgAtlas,
      ec2.Port.tcp(ATLAS_MONGO_PORT),
      "To Atlas PrivateLink",
    );
    this.sgAtlas.addIngressRule(this.sgBackend, ec2.Port.tcp(ATLAS_MONGO_PORT), "From backend");

    // TEMPORANEO: il cluster Atlas vive in eu-central-1 (Frankfurt), non in
    // eu-south-1 come questa infrastruttura — PrivateLink funziona solo
    // dentro la stessa region, quindi l'endpoint sopra non è mai
    // utilizzabile per questo cluster. Finché il cluster non viene spostato
    // in eu-south-1 (o si abbandona l'idea del PrivateLink), il backend
    // raggiunge Atlas via Internet pubblico attraverso il NAT Gateway,
    // autenticato dalla IP Access List su Atlas (IP del NAT Gateway
    // whitelisted a mano). Va tolta quando si risolve il disallineamento
    // di region.
    this.sgBackend.addEgressRule(
      ec2.Peer.anyIpv4(),
      ec2.Port.tcp(ATLAS_MONGO_PORT),
      "To Atlas via Internet pubblico (region mismatch col Private Endpoint)",
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

        // I livelli delle immagini ECR sono fisicamente su S3: anche con gli
    // endpoint Interface ecr.api/ecr.dkr coperti da sgVpce sopra, il pull
    // effettivo di un livello puo' reindirizzare a un URL S3 il cui IP di
    // destinazione resta quello pubblico di S3 (il Gateway Endpoint lo
    // instrada privatamente sotto banco, ma il security group valuta
    // comunque l'IP di destinazione apparente). Un Gateway Endpoint non ha
    // una ENI/SG propria da referenziare: serve la prefix list di S3. Non
    // e' un buco verso Internet generico (non viola il divieto di riga
    // 15-17): la prefix list copre solo gli IP di S3 di questa region,
    // sempre instradati via il Gateway Endpoint gia' esistente.
    const s3PrefixListId = ec2.PrefixList.fromLookup(this, "S3PrefixList", {
      prefixListName: `com.amazonaws.${REGION}.s3`,
    }).prefixListId;
    this.sgAgents.addEgressRule(
      ec2.Peer.prefixList(s3PrefixListId),
      ec2.Port.tcp(443),
      "To S3 (livelli immagine ECR, via Gateway Endpoint)",
    );

    this.sgAgents.addEgressRule(this.sgBedrock, ec2.Port.tcp(443), "To Bedrock Runtime endpoint");
    this.sgBedrock.addIngressRule(
      this.sgAgents,
      ec2.Port.tcp(443),
      "From agents (solo agents invoca Bedrock)",
    );

        // TEMPORANEO, stesso motivo del backend (vedi sopra): il cluster Atlas
    // e' in eu-central-1, non eu-south-1, quindi il Private Endpoint non e'
    // mai utilizzabile. Nota bene: questa riga viola deliberatamente la
    // garanzia di riga 15-17 ("sg-agents non ha mai egress verso
    // 0.0.0.0/0") -- e' un compromesso di sicurezza consapevole, non un
    // errore. Va tolta quando si risolve il disallineamento di region.
    this.sgAgents.addEgressRule(
      ec2.Peer.anyIpv4(),
      ec2.Port.tcp(ATLAS_MONGO_PORT),
      "To Atlas via Internet pubblico (region mismatch col Private Endpoint) -- TEMPORANEO, viola il divieto di riga 15-17",
    );

    // Unico egress verso Internet di tutto lo stack: il backend che chiama
    // l'API REST di GitHub via NAT.
    this.sgBackend.addEgressRule(
      ec2.Peer.anyIpv4(),
      ec2.Port.tcp(443),
      "HTTPS verso api.github.com (via NAT Gateway) -- unico canale esterno oltre a Bedrock",
    );

    // Regole reciproche backend <-> agents, aggiunte ora (vedi commento in cima al file).
    this.sgBackend.addEgressRule(this.sgAgents, ec2.Port.tcp(ECS_SIZING.agents.port), "To agents");
    this.sgAgents.addIngressRule(
      this.sgBackend,
      ec2.Port.tcp(ECS_SIZING.agents.port),
      "From backend",
    );

    this.sgAgents.addEgressRule(
      this.sgBackend,
      ec2.Port.tcp(ECS_SIZING.backend.port),
      "To backend (tool-calls GitHub read-only + callback progresso)",
    );
    this.sgBackend.addIngressRule(
      this.sgAgents,
      ec2.Port.tcp(ECS_SIZING.backend.port),
      "From agents",
    );

    // sg-atlas, sg-redis, sg-vpce, sg-bedrock non hanno regole di egress:
    // sono endpoint/servizi terminali, non aprono connessioni verso altro.

    new cdk.CfnOutput(this, "SgAgentsId", { value: this.sgAgents.securityGroupId });
    new cdk.CfnOutput(this, "SgBackendId", { value: this.sgBackend.securityGroupId });
  }
}
