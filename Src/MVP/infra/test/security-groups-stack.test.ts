import * as cdk from "aws-cdk-lib";
import { Template } from "aws-cdk-lib/assertions";
import * as ec2 from "aws-cdk-lib/aws-ec2";
import { beforeAll, describe, expect, it } from "vitest";
import { ATLAS_MONGO_PORT, REGION, VPC_CIDR } from "../lib/config";
import { SecurityGroupsStack } from "../lib/security-groups-stack";

/**
 * TU_16 (RS.3, RV.15) — il divieto di uscita verso Internet per gli agenti,
 * verificato sul template CloudFormation e non sul codice sorgente.
 *
 * La distinzione conta: RS.3 vieta agli agenti autonomi di raggiungere la rete
 * pubblica, e una garanzia del genere scritta solo nel codice Python la si
 * aggira con un import. Qui si guarda quello che AWS riceverà davvero, cioè
 * l'unico livello a cui il divieto è strutturale.
 *
 * Lo stack si sintetizza con una VPC costruita apposta invece che con quella di
 * NetworkStack: a questi test interessano le regole dei Security Group, non
 * come la rete sotto è disegnata, e una dipendenza in meno è un motivo in meno
 * per cui possano rompersi senza che sia cambiato niente di rilevante.
 *
 * Nota sulla forma del template: le regole verso un altro Security Group
 * diventano risorse AWS::EC2::SecurityGroupEgress a sé stanti, mentre quelle
 * verso un CIDR restano dentro la proprietà SecurityGroupEgress del gruppo.
 * È proprio questa seconda lista che interessa qui — un egress verso Internet
 * non può che essere un CIDR.
 */

const CIDR_INTERNET = "0.0.0.0/0";

interface RegolaEgress {
  CidrIp?: string;
  FromPort?: number;
  ToPort?: number;
  IpProtocol?: string;
  Description?: string;
}

describe("TU_16 — SecurityGroupsStack, egress del servizio agenti", () => {
  let template: Template;

  beforeAll(() => {
    const app = new cdk.App();
    const env = { account: "123456789012", region: REGION };

    const reteDiProva = new cdk.Stack(app, "ReteDiProva", { env });
    const vpc = new ec2.Vpc(reteDiProva, "Vpc", {
      ipAddresses: ec2.IpAddresses.cidr(VPC_CIDR),
      maxAzs: 2,
    });

    template = Template.fromStack(new SecurityGroupsStack(app, "SgDiProva", { env, vpc }));
  });

  /** Le regole di egress verso un CIDR dichiarate dentro il gruppo agenti. */
  function egressVersoCidr(): RegolaEgress[] {
    const gruppi = template.findResources("AWS::EC2::SecurityGroup", {
      Properties: { GroupName: "codeguardian-agents" },
    });
    const chiavi = Object.keys(gruppi);
    expect(chiavi, "atteso esattamente un SG codeguardian-agents").toHaveLength(1);
    return (gruppi[chiavi[0]].Properties.SecurityGroupEgress ?? []) as RegolaEgress[];
  }

  it("il gruppo degli agenti è dichiarato senza uscita libera", () => {
    // allowAllOutbound: false è il presupposto di tutto il resto. Con true,
    // CDK aggiungerebbe da sé una regola verso 0.0.0.0/0 su ogni protocollo e
    // ogni altra asserzione qui sotto perderebbe significato.
    const gruppi = template.findResources("AWS::EC2::SecurityGroup", {
      Properties: { GroupName: "codeguardian-agents" },
    });
    const proprieta = gruppi[Object.keys(gruppi)[0]].Properties;

    expect(proprieta.GroupDescription).toContain("zero egress");
    expect(
      (proprieta.SecurityGroupEgress as RegolaEgress[]).some(
        (regola) => regola.IpProtocol === "-1",
      ),
      "nessuna regola deve aprire tutti i protocolli",
    ).toBe(false);
  });

  it("gli agenti non raggiungono Internet sulle porte di servizio", () => {
    // La parte del divieto che regge davvero: tutto quello che gli agenti
    // usano per lavorare — endpoint VPC, Bedrock, Redis, backend — passa per
    // un security group di destinazione, mai per un CIDR pubblico.
    const porteVersoInternet = egressVersoCidr()
      .filter((regola) => regola.CidrIp === CIDR_INTERNET)
      .map((regola) => regola.FromPort);

    expect(porteVersoInternet).not.toContain(443);
    expect(porteVersoInternet).not.toContain(6379);
  });

  it("l'unica uscita verso Internet è quella dichiarata, e riguarda solo la porta di Atlas", () => {
    // security-groups-stack.ts apre esplicitamente la porta di Atlas verso
    // l'Internet pubblico, perché il cluster vive in eu-central-1 mentre la VPC
    // è in eu-south-1 e il Private Endpoint non è utilizzabile; il commento nel
    // sorgente la dichiara temporanea. Questo test la fissa: finché c'è, resta
    // una sola e circoscritta. Se qualcuno ne aggiungesse un'altra, o
    // allargasse questa a un'altra porta, il conto non tornerebbe più.
    const versoInternet = egressVersoCidr().filter((regola) => regola.CidrIp === CIDR_INTERNET);

    expect(versoInternet).toHaveLength(1);
    expect(versoInternet[0].FromPort).toBe(ATLAS_MONGO_PORT);
    expect(versoInternet[0].ToPort).toBe(ATLAS_MONGO_PORT);
    expect(String(versoInternet[0].Description)).toContain("TEMPORANEO");
  });
});
