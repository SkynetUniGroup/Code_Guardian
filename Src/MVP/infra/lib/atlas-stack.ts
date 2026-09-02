import * as cdk from "aws-cdk-lib";
import * as ec2 from "aws-cdk-lib/aws-ec2";
import { Construct } from "constructs";
import {
  CfnCluster,
  CfnPrivateEndpointAws,
  CfnPrivateEndpointService,
  CfnPrivateEndpointServicePropsCloudProvider,
  CfnProject,
} from "awscdk-resources-mongodbatlas";
import { ATLAS_INSTANCE_SIZE, ATLAS_REGION } from "./config";

export interface AtlasStackProps extends cdk.StackProps {
  vpc: ec2.IVpc;
  sgAtlas: ec2.ISecurityGroup;
}

// MongoDB Atlas: Project, Cluster M10, PrivateLink. Prerequisiti manuali
// (vedi RUNBOOK.md): CloudFormation Public Extensions "MongoDB::Atlas::*"
// attivate in eu-south-1, una Atlas API Key salvata come profilo in Secrets
// Manager, l'Org ID passato via --context atlasOrgId=<ID>.
//
// Il Private Endpoint richiede tre risorse in ordine: l'Atlas Private
// Endpoint Service, l'Interface VPC Endpoint AWS che punta al suo service
// name, poi l'Atlas Private Endpoint che conferma la connessione.
//
// Nessuna entry pubblica nella Network Access List: è proprio la loro
// assenza, insieme al Private Endpoint attivo, a rendere il cluster
// raggiungibile solo dalla VPC.
export class AtlasStack extends cdk.Stack {
  public readonly project: CfnProject;
  public readonly cluster: CfnCluster;

  constructor(scope: Construct, id: string, props: AtlasStackProps) {
    super(scope, id, props);
    const { vpc, sgAtlas } = props;

    const atlasProfile = this.node.tryGetContext("atlasProfile") ?? "codeguardian-atlas";
    const atlasOrgId = this.node.tryGetContext("atlasOrgId");
    if (!atlasOrgId || atlasOrgId === "REPLACE_WITH_ATLAS_ORG_ID") {
      throw new Error(
        "Contesto 'atlasOrgId' non impostato. Eseguire: cdk deploy CodeGuardian-Atlas --context atlasOrgId=<ORG_ID> (vedi RUNBOOK.md).",
      );
    }
    const atlasProjectName = this.node.tryGetContext("atlasProjectName") ?? "code-guardian-mvp";

    this.project = new CfnProject(this, "AtlasProject", {
      name: atlasProjectName,
      orgId: atlasOrgId,
      profile: atlasProfile,
    });

    this.cluster = new CfnCluster(this, "AtlasCluster", {
      name: "codeguardian-mvp",
      projectId: this.project.attrId,
      profile: atlasProfile,
      clusterType: "REPLICASET",
      backupEnabled: true, // Atlas Cloud Backup, non AWS Backup
      pitEnabled: false,
      replicationSpecs: [
        {
          numShards: 1,
          advancedRegionConfigs: [
            {
              regionName: ATLAS_REGION,
              priority: 7,
              electableSpecs: {
                instanceSize: ATLAS_INSTANCE_SIZE, // M10, il minimo che abilita PrivateLink
                nodeCount: 3, // replica set a 3 nodi
                ebsVolumeType: "STANDARD",
              },
              autoScaling: {
                diskGb: { enabled: true },
                compute: { enabled: false, scaleDownEnabled: false },
              },
            },
          ],
        },
      ],
    });

    const endpointService = new CfnPrivateEndpointService(this, "AtlasPrivateEndpointService", {
      projectId: this.project.attrId,
      profile: atlasProfile,
      region: ATLAS_REGION,
      cloudProvider: CfnPrivateEndpointServicePropsCloudProvider.AWS,
    });
    endpointService.addResourceDependency(this.cluster);

    const awsPrivateEndpoint = new ec2.CfnVPCEndpoint(this, "AtlasAwsPrivateEndpoint", {
      serviceName: endpointService.attrEndpointServiceName,
      vpcId: vpc.vpcId,
      subnetIds: vpc.privateSubnets.map((s) => s.subnetId),
      vpcEndpointType: "Interface",
      securityGroupIds: [sgAtlas.securityGroupId],
      privateDnsEnabled: false, // la risoluzione passa dalla connection string fornita da Atlas
    });
    awsPrivateEndpoint.addResourceDependency(endpointService);

    const atlasPrivateEndpoint = new CfnPrivateEndpointAws(this, "AtlasPrivateEndpoint", {
      projectId: this.project.attrId,
      profile: atlasProfile,
      endpointServiceId: endpointService.attrId,
      id: awsPrivateEndpoint.ref,
      enforceConnectionSuccess: true,
    });
    atlasPrivateEndpoint.addResourceDependency(awsPrivateEndpoint);

    new cdk.CfnOutput(this, "AtlasProjectId", { value: this.project.attrId });
    new cdk.CfnOutput(this, "AtlasClusterName", { value: "codeguardian-mvp" });
    new cdk.CfnOutput(this, "AtlasPrivateEndpointId", {
      value: awsPrivateEndpoint.ref,
      description: "Recuperare da Atlas (Connect -> Private Endpoint) la connection string e aggiornare il secret codeguardian/mongo-uri",
    });
  }
}
