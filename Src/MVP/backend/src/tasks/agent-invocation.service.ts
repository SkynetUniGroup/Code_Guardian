import { randomUUID } from "node:crypto";
import { Injectable } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { InjectModel } from "@nestjs/mongoose";
import { Model } from "mongoose";
import {
  AnalysisContext,
  AnalysisContextDocument,
} from "../contexts/schemas/analysis-context.schema";
import { CredentialsService } from "../credentials/credentials.service";
import { AgentRegistry } from "../operations/agent-registry.service";
import {
  AgentResumeRequest,
  AgentRunPayload,
  AgentStartRequest,
  AgentStepResult,
} from "./agent-client.types";
import { mapAgentErrorKind } from "./agent-error-mapping";
import { TaskDocument } from "./schemas/task.schema";
import { PendingInput, TaskError, TaskStatus } from "./task.types";

// A third outcome alongside the Task-terminal COMPLETED/FAILED: the agent
// paused mid-run (or, for Changelog, was never started at all — see
// TaskProcessor.startOrPause) and needs a human answer before it can
// continue. Task itself stays RUNNING for this (BE-13's five states are
// unchanged); INTERRUPTED only exists here, as the signal TaskProcessor
// uses to set pendingInput instead of a terminal status.
export type AgentInvocationResult =
  | { status: Extract<TaskStatus, "COMPLETED">; payload: AgentRunPayload }
  | { status: Extract<TaskStatus, "FAILED">; error: TaskError }
  | { status: "INTERRUPTED"; pendingInput: Exclude<PendingInput, null> };

// HTTP margin added on top of the agent's own timeout budget (Tabella 45),
// so the gateway never times out before the agent itself would.
const HTTP_TIMEOUT_MARGIN_S = 5;

@Injectable()
export class AgentInvocationService {
  constructor(
    private readonly config: ConfigService,
    private readonly agentRegistry: AgentRegistry,
    @InjectModel(AnalysisContext.name)
    private readonly contextModel: Model<AnalysisContextDocument>,
    private readonly credentials: CredentialsService,
  ) {}

  async invoke(task: TaskDocument): Promise<AgentInvocationResult> {
    const threadId = task.lgThreadId ?? randomUUID();
    if (!task.lgThreadId) {
      task.lgThreadId = threadId;
      await task.save();
    }

    // Fetch the context to populate the payload
    const context = await this.contextModel.findById(task.contextId);
    if (!context) {
      return this.failure("UPSTREAM", "Context not found for task");
    }

    // Solo le operazioni DOCS_* leggono le metriche SonarQube (DocsLoader).
    // La credenziale e' opzionale: se l'utente non ne ha una, o se la
    // lettura fallisse, l'operazione gira comunque — quindi qui un errore
    // non blocca l'avvio del task, al massimo lascia il prompt senza metriche.
    const sonarqubeCredentials = task.operation.startsWith("DOCS")
      ? await this.loadSonarqubeCredentials(task.userId)
      : undefined;

    const body: AgentStartRequest = {
      taskId: task.id,
      threadId,
      operationCode: task.operation,
      payload: {
        userId: task.userId,
        // Presente solo quando il Task ne ha uno: startOrPause mette in pausa
        // le operazioni Changelog finche' non arriva, quindi qui o c'e' o
        // l'operazione non e' una di quelle che lo richiedono.
        ...(task.sprintId ? { sprintId: task.sprintId } : {}),
        ...(sonarqubeCredentials ? { sonarqube_credentials: sonarqubeCredentials } : {}),
        context_ref: {
          repoOwner: context.repoOwner,
          repoName: context.repoName,
          repoUrl: context.repoUrl,
          branch: context.branch,
          resolvedSha: context.resolvedSha,
          scopeType: context.scopeType,
          paths: context.paths || [],
        },
      },
    };

    return this.call(task, "/internal/agent/start", body);
  }

  // SonarQube is a nice-to-have on the DOCS prompt, never a prerequisite:
  // most users won't have a credential, and the ones who do may hit a
  // temporarily unreachable instance. Either way the task must still start,
  // so this swallows every failure and returns undefined — DocsLoader then
  // generates documentation exactly as it did before SonarQube existed.
  private async loadSonarqubeCredentials(userId: string) {
    try {
      return (await this.credentials.getDecryptedSonarqubeCredential(userId)) ?? undefined;
    } catch {
      return undefined;
    }
  }

  // BE-17: called after POST /tasks/:id/input clears an INCOMPLETE_TASKS or
  // BUSINESS_CONFIRMATION pendingInput — both only ever happen once the
  // agent has already produced a threadId via a prior invoke(). A missing
  // lgThreadId here means TaskProcessor routed a resume-task job at a Task
  // that was never actually started, which is a caller bug (see
  // TaskProcessor's job-shape comment), not a runtime condition worth
  // degrading gracefully from.
  async resume(task: TaskDocument, inputValue: unknown): Promise<AgentInvocationResult> {
    if (!task.lgThreadId) {
      throw new Error(
        `Task ${task.id} has no lgThreadId — cannot resume an agent run that never started`,
      );
    }

    const body: AgentResumeRequest = {
      taskId: task.id,
      threadId: task.lgThreadId,
      operationCode: task.operation,
      inputValue,
    };

    return this.call(task, "/internal/agent/resume", body);
  }

  private async call(
    task: TaskDocument,
    path: string,
    body: AgentStartRequest | AgentResumeRequest,
  ): Promise<AgentInvocationResult> {
    const timeoutMs =
      (this.agentRegistry.getTimeoutS(task.operation) + HTTP_TIMEOUT_MARGIN_S) * 1000;
    const baseUrl = this.config.get<string>("AGENTS_SERVICE_URL");

    let result: AgentStepResult;
    try {
      const res = await fetch(`${baseUrl}${path}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(timeoutMs),
      });
      if (!res.ok) {
        return this.failure("UPSTREAM", `Agent service responded ${res.status}`);
      }
      result = (await res.json()) as AgentStepResult;
    } catch (err) {
      // The agent didn't respond at all within our budget — we don't know
      // why, so this is UPSTREAM, not TIMEOUT. TIMEOUT is reserved for the
      // agent itself reporting that its own model call timed out (handled
      // below via mapAgentErrorKind).
      if (err instanceof Error && err.name === "TimeoutError") {
        return this.failure("UPSTREAM", "Agent invocation timed out");
      }
      return this.failure(
        "UPSTREAM",
        err instanceof Error ? err.message : "Agent invocation failed",
      );
    }

    return this.toResult(result);
  }

  private toResult(result: AgentStepResult): AgentInvocationResult {
    if (result.status === "completed") {
      if (!result.result) {
        // Same reasoning as the interrupted-without-pendingInput case below:
        // BE-18 needs a payload to build a Report from, so a 'completed'
        // response with nothing in it can't actually complete the Task.
        return this.failure("PARSING", "Agent reported completed without a result payload");
      }
      return { status: "COMPLETED", payload: result.result };
    }

    if (result.status === "interrupted") {
      if (!result.pendingInput) {
        // The agent said it paused but didn't say what it's waiting for —
        // can't route this to the right modal on the frontend, and leaving
        // the Task RUNNING with pendingInput still null would be
        // indistinguishable from "not paused" to every other code path that
        // checks that field. Treated as a failure instead.
        return this.failure("PARSING", "Agent reported interrupted without a pendingInput");
      }
      return { status: "INTERRUPTED", pendingInput: result.pendingInput };
    }

    return this.failure(
      mapAgentErrorKind(result.errorKind),
      result.error ?? "Agent execution failed",
    );
  }

  private failure(code: TaskError["code"], message: string): AgentInvocationResult {
    return { status: "FAILED", error: { code, message, stage: "EXECUTION" } };
  }
}
