import * as cdk from "aws-cdk-lib";
import * as ec2 from "aws-cdk-lib/aws-ec2";
import type { Construct } from "constructs";

export interface AtlasStackProps extends cdk.StackProps {
  vpc: ec2.IVpc;
  sgAtlas: ec2.ISecurityGroup;
}

// The Atlas M10 project, cluster, and Private Endpoint Service are managed
// manually in the Atlas console (Alessandro's org): the team does not have
// an API key with write permissions on the project. This stack creates only
// the AWS side of the PrivateLink, i.e. the Interface VPC Endpoint pointing
// to the service name that Atlas generates when the Private Endpoint is
// created in the console.
//
// Manual handshake (see RUNBOOK.md):
// 1. Alessandro creates the Private Endpoint on Atlas (AWS region eu-south-1),
//    obtains a service name (com.amazonaws.vpce...).
// 2. `cdk deploy CodeGuardian-Atlas --context atlasPrivateEndpointServiceName=<...>`
//    creates the Interface VPC Endpoint below.
// 3. The endpoint ID (output AtlasPrivateEndpointId) must be pasted in Atlas
//    to complete the connection and unlock the connection string.
export class AtlasStack extends cdk.Stack {
  constructor(scope: Construct, id: string, props: AtlasStackProps) {
    super(scope, id, props);
    const { vpc, sgAtlas } = props;

    const serviceName = this.node.tryGetContext("atlasPrivateEndpointServiceName");
    if (!serviceName) {
      throw new Error(
        "Context 'atlasPrivateEndpointServiceName' not set: retrieve the Private Endpoint service name from Atlas (created manually) and pass it with --context (see RUNBOOK.md).",
      );
    }

    const awsPrivateEndpoint = new ec2.CfnVPCEndpoint(this, "AtlasAwsPrivateEndpoint", {
      serviceName,
      vpcId: vpc.vpcId,
      subnetIds: vpc.privateSubnets.map((s) => s.subnetId),
      vpcEndpointType: "Interface",
      securityGroupIds: [sgAtlas.securityGroupId],
      privateDnsEnabled: false, // resolution goes through the connection string provided by Atlas
    });

    new cdk.CfnOutput(this, "AtlasPrivateEndpointId", {
      value: awsPrivateEndpoint.ref,
      description:
        "Paste in Atlas (Private Endpoint -> AWS) to complete the connection, then retrieve the connection string for the codeguardian/mongo-uri secret",
    });
  }
}
