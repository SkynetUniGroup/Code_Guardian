import * as cdk from "aws-cdk-lib";
import * as cloudwatch from "aws-cdk-lib/aws-cloudwatch";
import { SnsAction } from "aws-cdk-lib/aws-cloudwatch-actions";
import * as ecs from "aws-cdk-lib/aws-ecs";
import * as elasticache from "aws-cdk-lib/aws-elasticache";
import * as elbv2 from "aws-cdk-lib/aws-elasticloadbalancingv2";
import * as iam from "aws-cdk-lib/aws-iam";
import * as sns from "aws-cdk-lib/aws-sns";
import * as subscriptions from "aws-cdk-lib/aws-sns-subscriptions";
import { Construct } from "constructs";
import { SNS_ALERTS_TOPIC_NAME } from "./config";

export interface ObservabilityStackProps extends cdk.StackProps {
  cluster: ecs.ICluster;
  backendService: ecs.FargateService;
  agentsService: ecs.FargateService;
  backendTargetGroup: elbv2.ApplicationTargetGroup;
  redis: elasticache.CfnReplicationGroup;
  alertEmail: string;
}

// Topic SNS e allarmi CloudWatch. Log Group e Container Insights sono in
// compute-stack.ts (sono proprietà di Task Definition e Cluster). La risorsa
// Budget vera e propria è in budget-stack.ts, vedi sotto perché.
//
// Le metriche del cluster MongoDB Atlas non arrivano su CloudWatch:
// l'alerting per quelle si configura lato Atlas (console -> Alerts).
export class ObservabilityStack extends cdk.Stack {
  public readonly alertsTopic: sns.Topic;

  constructor(scope: Construct, id: string, props: ObservabilityStackProps) {
    super(scope, id, props);
    const { cluster, backendService, agentsService, backendTargetGroup, redis, alertEmail } = props;

    this.alertsTopic = new sns.Topic(this, "AlertsTopic", {
      topicName: SNS_ALERTS_TOPIC_NAME,
      displayName: "Code Guardian -- allarmi infrastrutturali MVP",
    });
    this.alertsTopic.addSubscription(new subscriptions.EmailSubscription(alertEmail));
    // Richiede un click di conferma nella mail ricevuta -- verificare lo
    // stato "Confirmed" in console SNS, altrimenti gli allarmi non arrivano mai.

    const alarmAction = new SnsAction(this.alertsTopic);
    const fiveMinutes = cdk.Duration.minutes(5);

    for (const [name, service] of [
      ["Backend", backendService],
      ["Agents", agentsService],
    ] as const) {
      new cloudwatch.Alarm(this, `${name}RunningTaskCountAlarm`, {
        alarmName: `codeguardian-${name.toLowerCase()}-running-tasks-below-desired`,
        alarmDescription: `Task in esecuzione < 1 (Desired Count) per servizio ${name} per > 5 minuti`,
        metric: new cloudwatch.Metric({
          namespace: "ECS/ContainerInsights",
          metricName: "RunningTaskCount",
          dimensionsMap: { ClusterName: cluster.clusterName, ServiceName: service.serviceName },
          statistic: "Minimum",
          period: fiveMinutes,
        }),
        threshold: 1,
        comparisonOperator: cloudwatch.ComparisonOperator.LESS_THAN_THRESHOLD,
        evaluationPeriods: 1,
        treatMissingData: cloudwatch.TreatMissingData.BREACHING,
      }).addAlarmAction(alarmAction);

      new cloudwatch.Alarm(this, `${name}CpuAlarm`, {
        alarmName: `codeguardian-${name.toLowerCase()}-cpu-high`,
        alarmDescription: `Utilizzo CPU servizio ${name} > 80% per > 5 minuti`,
        metric: service.metricCpuUtilization({ period: fiveMinutes }),
        threshold: 80,
        comparisonOperator: cloudwatch.ComparisonOperator.GREATER_THAN_THRESHOLD,
        evaluationPeriods: 1,
        treatMissingData: cloudwatch.TreatMissingData.NOT_BREACHING,
      }).addAlarmAction(alarmAction);

      new cloudwatch.Alarm(this, `${name}MemoryAlarm`, {
        alarmName: `codeguardian-${name.toLowerCase()}-memory-high`,
        alarmDescription: `Utilizzo Memoria servizio ${name} > 80% per > 5 minuti`,
        metric: service.metricMemoryUtilization({ period: fiveMinutes }),
        threshold: 80,
        comparisonOperator: cloudwatch.ComparisonOperator.GREATER_THAN_THRESHOLD,
        evaluationPeriods: 1,
        treatMissingData: cloudwatch.TreatMissingData.NOT_BREACHING,
      }).addAlarmAction(alarmAction);
    }

    // Tasso di errore 5xx sul target group (non sull'ELB), per isolare gli
    // errori generati dal backend da quelli generati dall'edge.
    const target5xx = backendTargetGroup.metrics.httpCodeTarget(elbv2.HttpCodeTarget.TARGET_5XX_COUNT, {
      statistic: "Sum",
      period: fiveMinutes,
    });
    const requestCount = backendTargetGroup.metrics.requestCount({ statistic: "Sum", period: fiveMinutes });
    const errorRate = new cloudwatch.MathExpression({
      expression: "(errors / requests) * 100",
      usingMetrics: { errors: target5xx, requests: requestCount },
      period: fiveMinutes,
      label: "Tasso errore 5xx (%)",
    });
    new cloudwatch.Alarm(this, "Alb5xxErrorRateAlarm", {
      alarmName: "codeguardian-alb-5xx-rate-high",
      alarmDescription: "Tasso di errore HTTP 5xx > 5% su finestra di 5 minuti",
      metric: errorRate,
      threshold: 5,
      comparisonOperator: cloudwatch.ComparisonOperator.GREATER_THAN_THRESHOLD,
      evaluationPeriods: 1,
      treatMissingData: cloudwatch.TreatMissingData.NOT_BREACHING,
    }).addAlarmAction(alarmAction);

    // Per un Replication Group a nodo singolo, AWS assegna in automatico il
    // CacheClusterId `<replicationGroupId>-001`.
    const redisCacheClusterId = cdk.Fn.join("", [redis.ref, "-001"]);
    new cloudwatch.Alarm(this, "RedisCpuAlarm", {
      alarmName: "codeguardian-redis-cpu-high",
      alarmDescription: "Utilizzo CPU ElastiCache Redis > 80% per > 5 minuti",
      metric: new cloudwatch.Metric({
        namespace: "AWS/ElastiCache",
        metricName: "EngineCPUUtilization",
        dimensionsMap: { CacheClusterId: redisCacheClusterId },
        statistic: "Average",
        period: fiveMinutes,
      }),
      threshold: 80,
      comparisonOperator: cloudwatch.ComparisonOperator.GREATER_THAN_THRESHOLD,
      evaluationPeriods: 1,
      treatMissingData: cloudwatch.TreatMissingData.NOT_BREACHING,
    }).addAlarmAction(alarmAction);

    new cloudwatch.Alarm(this, "BedrockThrottleAlarm", {
      alarmName: "codeguardian-bedrock-invocation-throttling",
      alarmDescription: ">= 1 invocazione Bedrock limitata (throttled) in 5 minuti",
      metric: new cloudwatch.Metric({
        namespace: "AWS/Bedrock",
        metricName: "InvocationThrottles",
        statistic: "Sum",
        period: fiveMinutes,
      }),
      threshold: 1,
      comparisonOperator: cloudwatch.ComparisonOperator.GREATER_THAN_OR_EQUAL_TO_THRESHOLD,
      evaluationPeriods: 1,
      treatMissingData: cloudwatch.TreatMissingData.NOT_BREACHING,
    }).addAlarmAction(alarmAction);

    // AWS::Budgets::Budget esiste solo in us-east-1 (servizio globale): vive
    // a parte in budget-stack.ts e pubblica sull'ARN di questo topic. Qui
    // basta concedere il permesso di pubblicare.
    this.alertsTopic.grantPublish(new iam.ServicePrincipal("budgets.amazonaws.com"));

    new cdk.CfnOutput(this, "AlertsTopicArn", { value: this.alertsTopic.topicArn });
  }
}
