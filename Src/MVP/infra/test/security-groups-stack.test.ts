import * as cdk from "aws-cdk-lib";
import * as ec2 from "aws-cdk-lib/aws-ec2";
import { Template } from "aws-cdk-lib/assertions";
import { SecurityGroupsStack } from "../lib/security-groups-stack";

/**
 * TU_16 (RS.3, RV.15) — il Security Group del servizio agenti non ha alcuna
 * regola di egress verso 0.0.0.0/0.
 *
 * E' la garanzia infrastrutturale del divieto di accesso a Internet per gli
 * agenti, indipendente dal codice applicativo: TU_14 verifica che la facade
 * GitHub del backend non scriva, questo verifica che il container degli
 * agenti non possa nemmeno provare a uscire, qualunque cosa il codice Python
 * decida di fare. Le due garanzie sono complementari e nessuna sostituisce
 * l'altra.
 *
 * Si asserisce sul template CloudFormation sintetizzato, non sul sorgente
 * TypeScript: e' il template che viene schierato, ed e' l'unico posto dove
 * si vede l'effetto combinato di `allowAllOutbound: false` e delle regole
 * aggiunte dopo la costruzione.
 *
 * Nota per il gruppo: `infra/` non compare in `pnpm test:unit`, che esegue
 * solo backend e frontend, quindi questo test non gira in CI. Aggiungerlo
 * alla pipeline e' una decisione di progetto e non e' stata presa qui.
 */
describe("TU_16 (RS.3, RV.15) — nessun egress verso Internet dal Security Group degli agenti", () => {
  const ENV = { account: "111111111111", region: "eu-south-1" };
  const APERTO_IPV4 = "0.0.0.0/0";
  const APERTO_IPV6 = "::/0";

  interface RegolaDiEgress {
    CidrIp?: string;
    CidrIpv6?: string;
    IpProtocol?: string;
    DestinationSecurityGroupId?: unknown;
    Description?: string;
  }

  function sintetizza(): Template {
    const app = new cdk.App();

    // Lo stack e' costruito con una VPC importata per attributi, non
    // cercata su AWS: il test non deve avere credenziali per girare.
    const supporto = new cdk.Stack(app, "Supporto", { env: ENV });
    new cdk.CfnResource(supporto, "Segnaposto", {
      // Uno stack CloudFormation senza risorse non e' valido, e la
      // validazione lo segnala a ogni sintesi: questa e' la risorsa piu'
      // innocua che esista, non fa nulla e non costa nulla.
      type: "AWS::CloudFormation::WaitConditionHandle",
    });
    const vpc = ec2.Vpc.fromVpcAttributes(supporto, "VpcDiProva", {
      vpcId: "vpc-0123456789abcdef0",
      availabilityZones: ["eu-south-1a", "eu-south-1b"],
    });

    return Template.fromStack(
      new SecurityGroupsStack(app, "SecurityGroups", { env: ENV, vpc }),
    );
  }

  const template = sintetizza();
  const risorse = template.toJSON().Resources as Record<
    string,
    { Type: string; Properties?: Record<string, unknown> }
  >;

  /** L'id logico del Security Group che porta il nome indicato. */
  function idLogicoDi(nomeDelGruppo: string): string {
    const trovati = Object.entries(risorse).filter(
      ([, risorsa]) =>
        risorsa.Type === "AWS::EC2::SecurityGroup" &&
        risorsa.Properties?.GroupName === nomeDelGruppo,
    );
    expect(trovati).toHaveLength(1);
    return trovati[0][0];
  }

  /**
   * Tutte le regole di egress di un Security Group, comunque siano espresse
   * nel template: inline nella proprieta' SecurityGroupEgress quando la
   * destinazione e' un CIDR, e come risorse AWS::EC2::SecurityGroupEgress
   * separate quando e' un altro Security Group. Guardarne una sola delle due
   * forme lascerebbe scoperta esattamente l'altra.
   */
  function egressDi(nomeDelGruppo: string): RegolaDiEgress[] {
    const idLogico = idLogicoDi(nomeDelGruppo);

    const inline = (risorse[idLogico].Properties?.SecurityGroupEgress ??
      []) as RegolaDiEgress[];

    const separate = Object.values(risorse)
      .filter((risorsa) => risorsa.Type === "AWS::EC2::SecurityGroupEgress")
      .filter((risorsa) => {
        const proprietario = risorsa.Properties?.GroupId as
          | { "Fn::GetAtt"?: [string, string] }
          | undefined;
        return proprietario?.["Fn::GetAtt"]?.[0] === idLogico;
      })
      .map((risorsa) => risorsa.Properties as RegolaDiEgress);

    return [...inline, ...separate];
  }

  /** Le regole che aprono verso qualunque destinazione su Internet. */
  function versoInternet(regole: RegolaDiEgress[]): RegolaDiEgress[] {
    return regole.filter(
      (regola) =>
        regola.CidrIp === APERTO_IPV4 || regola.CidrIpv6 === APERTO_IPV6,
    );
  }

  it("il template contiene i sette Security Group dichiarati dallo stack", () => {
    // Il presupposto di tutto il resto: se la sintesi producesse uno stack
    // vuoto, "nessuna regola verso 0.0.0.0/0" sarebbe vero e senza significato.
    template.resourceCountIs("AWS::EC2::SecurityGroup", 7);
    for (const nome of [
      "sg-alb",
      "sg-backend",
      "sg-agents",
      "sg-atlas",
      "sg-redis",
      "sg-vpce",
      "sg-bedrock",
    ]) {
      expect(() => idLogicoDi(nome)).not.toThrow();
    }
  });

  it("sg-agents non ha alcuna regola di egress verso 0.0.0.0/0", () => {
    expect(versoInternet(egressDi("sg-agents"))).toEqual([]);
  });

  it("sg-agents non ha alcuna regola di egress verso un CIDR, qualunque esso sia", () => {
    // Piu' stretto di RS.3 alla lettera, e deliberatamente: una rotta verso
    // un CIDR arbitrario e' un canale verso l'esterno anche se non e'
    // 0.0.0.0/0, e riconoscerla come tale e' meno fragile che inseguire la
    // notazione con cui viene scritta.
    const versoCidr = egressDi("sg-agents").filter(
      (regola) => regola.CidrIp !== undefined || regola.CidrIpv6 !== undefined,
    );
    expect(versoCidr).toEqual([]);
  });

  it("sg-agents non apre l'egress a tutti i protocolli", () => {
    // La firma di `allowAllOutbound: true`: una regola con IpProtocol "-1".
    // Cambiare quel flag nel costruttore ricomparirebbe qui.
    const tuttiIProtocolli = egressDi("sg-agents").filter(
      (regola) => regola.IpProtocol === "-1",
    );
    expect(tuttiIProtocolli).toEqual([]);
  });

  it("sg-agents esce comunque verso i servizi interni che gli servono", () => {
    // "Nessun egress verso Internet" sarebbe soddisfatto anche da "nessun
    // egress affatto", che pero' e' un servizio che non parte: gli agenti
    // devono raggiungere gli endpoint VPC, Bedrock e il backend.
    const regole = egressDi("sg-agents");
    expect(regole.length).toBeGreaterThanOrEqual(3);
    for (const regola of regole) {
      expect(regola.DestinationSecurityGroupId).toBeDefined();
    }
  });

  it("sg-backend invece ce l'ha, ed e' cosi' che si vede che il controllo funziona", () => {
    // Controllo positivo. Senza, un errore nell'estrazione delle regole
    // renderebbe verde il test su sg-agents per il motivo sbagliato: qui la
    // stessa funzione, sullo stesso template, trova la regola aperta che il
    // backend ha davvero (HTTPS verso api.github.com via NAT).
    const aperte = versoInternet(egressDi("sg-backend"));
    expect(aperte).toHaveLength(1);
    expect(aperte[0]).toMatchObject({
      CidrIp: APERTO_IPV4,
      IpProtocol: "tcp",
      FromPort: 443,
      ToPort: 443,
    } as RegolaDiEgress);
  });

  it("nessun altro Security Group dello stack esce verso Internet, a parte il backend", () => {
    const conUscita = [
      "sg-alb",
      "sg-agents",
      "sg-atlas",
      "sg-redis",
      "sg-vpce",
      "sg-bedrock",
    ].filter((nome) => versoInternet(egressDi(nome)).length > 0);

    expect(conUscita).toEqual([]);
  });
});
