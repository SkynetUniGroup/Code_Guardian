import * as cdk from "aws-cdk-lib";
import * as ec2 from "aws-cdk-lib/aws-ec2";
import { Construct } from "constructs";
import { AZ_COUNT, VPC_CIDR } from "./config";

// VPC, subnet e NAT Gateway. Il NAT serve solo per uscire verso GitHub; il
// resto del traffico verso servizi AWS resta dentro la VPC via i VPC
// Endpoint di vpc-endpoints-stack.ts.
export class NetworkStack extends cdk.Stack {
  public readonly vpc: ec2.Vpc;

  constructor(scope: Construct, id: string, props?: cdk.StackProps) {
    super(scope, id, props);

    this.vpc = new ec2.Vpc(this, "CodeGuardianVpc", {
      vpcName: "codeguardian-vpc",
      ipAddresses: ec2.IpAddresses.cidr(VPC_CIDR),
      maxAzs: AZ_COUNT,
      natGateways: 1, // singolo NAT, rischio accettato per l'MVP
      subnetConfiguration: [
        { name: "public", subnetType: ec2.SubnetType.PUBLIC, cidrMask: 24 },
        { name: "private", subnetType: ec2.SubnetType.PRIVATE_WITH_EGRESS, cidrMask: 24 },
      ],
    });

    cdk.Tags.of(this.vpc).add("Name", "codeguardian-vpc");

    new cdk.CfnOutput(this, "VpcId", { value: this.vpc.vpcId });
    new cdk.CfnOutput(this, "PublicSubnetIds", {
      value: this.vpc.publicSubnets.map((s) => s.subnetId).join(","),
    });
    new cdk.CfnOutput(this, "PrivateSubnetIds", {
      value: this.vpc.privateSubnets.map((s) => s.subnetId).join(","),
    });
  }
}
