import * as cdk from "aws-cdk-lib";
import * as cloudfront from "aws-cdk-lib/aws-cloudfront";
import * as origins from "aws-cdk-lib/aws-cloudfront-origins";
import * as elbv2 from "aws-cdk-lib/aws-elasticloadbalancingv2";
import * as iam from "aws-cdk-lib/aws-iam";
import * as s3 from "aws-cdk-lib/aws-s3";
import { Construct } from "constructs";

export interface CloudFrontStackProps extends cdk.StackProps {
  alb: elbv2.IApplicationLoadBalancer;
  ciRole: iam.IRole;
}

// Bucket frontend statico + distribuzione CloudFront con Origin Access
// Control. Il bucket è creato QUI, non in storage-stack.ts: la scorciatoia
// `S3BucketOrigin.withOriginAccessControl()` allega da sola la bucket policy
// con l'ARN della distribuzione mentre costruisce l'origin, cioè prima che
// la distribuzione esista -- se bucket e distribuzione vivono in stack
// diversi genera una dipendenza ciclica nota (aws/aws-cdk#31462). Stesso
// stack, problema eliminato alla radice.
export class CloudFrontStack extends cdk.Stack {
  public readonly frontendBucket: s3.Bucket;
  public readonly distribution: cloudfront.Distribution;

  constructor(scope: Construct, id: string, props: CloudFrontStackProps) {
    super(scope, id, props);
    const { alb, ciRole } = props;

    // Nessun hosting statico nativo: il routing SPA (403/404 -> index.html)
    // è gestito da CloudFront (errorResponses sotto).
    this.frontendBucket = new s3.Bucket(this, "FrontendBucket", {
      bucketName: undefined, // nome generato da CloudFormation, evita collisioni globali
      blockPublicAccess: s3.BlockPublicAccess.BLOCK_ALL,
      encryption: s3.BucketEncryption.S3_MANAGED,
      enforceSSL: true,
      versioned: false,
      removalPolicy: cdk.RemovalPolicy.RETAIN,
    });

    const s3Origin = origins.S3BucketOrigin.withOriginAccessControl(this.frontendBucket);

    // Origin in HTTP: l'ALB non ha certificato TLS, il viewer parla
    // comunque HTTPS con CloudFront.
    const albOrigin = new origins.HttpOrigin(alb.loadBalancerDnsName, {
      protocolPolicy: cloudfront.OriginProtocolPolicy.HTTP_ONLY,
    });

    const apiBehavior: cloudfront.BehaviorOptions = {
      origin: albOrigin,
      viewerProtocolPolicy: cloudfront.ViewerProtocolPolicy.REDIRECT_TO_HTTPS,
      cachePolicy: cloudfront.CachePolicy.CACHING_DISABLED,
      originRequestPolicy: cloudfront.OriginRequestPolicy.ALL_VIEWER,
      allowedMethods: cloudfront.AllowedMethods.ALLOW_ALL,
    };

    this.distribution = new cloudfront.Distribution(this, "Distribution", {
      comment: "Code Guardian MVP -- distribuzione condivisa Frontend + API + WebSocket",
      defaultBehavior: {
        origin: s3Origin,
        viewerProtocolPolicy: cloudfront.ViewerProtocolPolicy.REDIRECT_TO_HTTPS,
        cachePolicy: cloudfront.CachePolicy.CACHING_OPTIMIZED,
      },
      additionalBehaviors: {
        "/api/*": apiBehavior,
        "/socket.io/*": apiBehavior,
      },
      // Routing SPA: i 403/404 che genera S3 (bucket privato) vanno
      // reindirizzati a index.html con status 200, altrimenti il router
      // lato client non funziona su un refresh di pagina.
      errorResponses: [
        { httpStatus: 403, responseHttpStatus: 200, responsePagePath: "/index.html", ttl: cdk.Duration.seconds(0) },
        { httpStatus: 404, responseHttpStatus: 200, responsePagePath: "/index.html", ttl: cdk.Duration.seconds(0) },
      ],
      defaultRootObject: "index.html",
      priceClass: cloudfront.PriceClass.PRICE_CLASS_100,
    });

    // Permessi di invalidazione cache e sync del bucket per la pipeline CI/CD.
    ciRole.attachInlinePolicy(
      new iam.Policy(this, "CiInvalidationPolicy", {
        statements: [
          new iam.PolicyStatement({
            sid: "CloudFrontInvalidate",
            actions: ["cloudfront:CreateInvalidation"],
            resources: [this.distribution.distributionArn],
          }),
          new iam.PolicyStatement({
            sid: "SyncFrontendBucket",
            actions: ["s3:PutObject", "s3:DeleteObject", "s3:ListBucket"],
            resources: [this.frontendBucket.bucketArn, this.frontendBucket.arnForObjects("*")],
          }),
        ],
      }),
    );

    new cdk.CfnOutput(this, "FrontendBucketName", { value: this.frontendBucket.bucketName });
    new cdk.CfnOutput(this, "DistributionDomainName", { value: this.distribution.distributionDomainName });
    new cdk.CfnOutput(this, "DistributionId", { value: this.distribution.distributionId });
  }
}
