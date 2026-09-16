import * as cdk from "aws-cdk-lib";
import * as budgets from "aws-cdk-lib/aws-budgets";
import type { Construct } from "constructs";
import { BUDGET_THRESHOLDS_PERCENT, PROJECT_TAGS } from "./config";

export interface BudgetStackProps extends cdk.StackProps {
  // Literal ARN, not the Topic object: that lives in eu-south-1, this
  // stack in us-east-1, and name/account/region are already known at synth-time.
  alertsTopicArn: string;
  monthlyBudgetUsd: number;
}

// AWS Budgets is a global service: the CloudFormation resource
// `AWS::Budgets::Budget` exists only in us-east-1, so this stack must be
// deployed there regardless of where the rest lives (see bin/codeguardian.ts
// and RUNBOOK.md for the separate bootstrap). It still notifies the SNS
// Topic in eu-south-1 -- Budgets natively supports cross-region delivery.
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

    // The MongoDB Atlas cluster is billed separately by MongoDB, it does
    // not appear here: monitor it in the Atlas console.
    new budgets.CfnBudget(this, "MonthlyBudget", {
      budget: {
        budgetName: "codeguardian-mvp-monthly",
        budgetType: "COST",
        timeUnit: "MONTHLY",
        budgetLimit: { amount: monthlyBudgetUsd, unit: "USD" },
        // The "Project" tag must first be activated as a Cost Allocation
        // Tag in Billing -> Cost Allocation Tags (RUNBOOK.md), otherwise
        // this filter intercepts nothing.
        costFilters: {
          TagKeyValue: [`user:Project$${PROJECT_TAGS.Project}`],
        },
      },
      notificationsWithSubscribers,
    });
  }
}
