import * as budgets from "aws-cdk-lib/aws-budgets";
import * as cdk from "aws-cdk-lib";
import { Construct } from "constructs";
import { BUDGET_THRESHOLDS_PERCENT, PROJECT_TAGS } from "./config";

export interface BudgetStackProps extends cdk.StackProps {
  // ARN letterale, non l'oggetto Topic: quello vive in eu-south-1, questo
  // stack in us-east-1, e nome/account/regione sono già noti a synth-time.
  alertsTopicArn: string;
  monthlyBudgetUsd: number;
}

// AWS Budgets è un servizio globale: la risorsa CloudFormation
// `AWS::Budgets::Budget` esiste solo in us-east-1, quindi questo stack va
// deployato lì a prescindere da dove vive il resto (vedi bin/codeguardian.ts
// e RUNBOOK.md per il bootstrap separato). Notifica comunque il Topic SNS
// in eu-south-1 -- Budgets supporta nativamente l'invio cross-region.
export class BudgetStack extends cdk.Stack {
  constructor(scope: Construct, id: string, props: BudgetStackProps) {
    super(scope, id, props);
    const { alertsTopicArn, monthlyBudgetUsd } = props;

    const notificationsWithSubscribers: budgets.CfnBudget.NotificationWithSubscribersProperty[] =
      BUDGET_THRESHOLDS_PERCENT.map((thresholdPercent) => ({
        notification: {
          notificationType: "ACTUAL",
          comparisonOperator: "GREATER_THAN",
          threshold: thresholdPercent,
          thresholdType: "PERCENTAGE",
        },
        subscribers: [{ subscriptionType: "SNS", address: alertsTopicArn }],
      }));

    // Il cluster MongoDB Atlas è fatturato a parte da MongoDB, non compare
    // qui: va monitorato in console Atlas.
    new budgets.CfnBudget(this, "MonthlyBudget", {
      budget: {
        budgetName: "codeguardian-mvp-monthly",
        budgetType: "COST",
        timeUnit: "MONTHLY",
        budgetLimit: { amount: monthlyBudgetUsd, unit: "USD" },
        // Il tag "Project" va prima attivato come Cost Allocation Tag in
        // Billing -> Cost Allocation Tags (RUNBOOK.md), altrimenti questo
        // filtro non intercetta nulla.
        costFilters: {
          TagKeyValue: [`user:Project$${PROJECT_TAGS.Project}`],
        },
      },
      notificationsWithSubscribers,
    });
  }
}
