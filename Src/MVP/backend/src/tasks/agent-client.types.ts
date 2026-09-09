import type { OperationCode } from "../common/domain-types";
import type { Block, Proposal } from "../reports/report.types";
import type { PendingInput } from "./task.types";

// POST /internal/agent/start body.
export interface ContextRef {
  repoOwner: string;
  repoName: string;
  repoUrl: string;
  branch: string;
  resolvedSha: string;
  scopeType: string;
  paths?: string[];
}

export interface AgentStartRequest {
  taskId: string;
  threadId: string;
  operationCode: OperationCode;
  payload: {
    userId: string;
    context_ref: ContextRef;
    // Solo per le operazioni Changelog, e solo dopo che
    // POST /tasks/:id/input l'ha raccolto (BE-17). Viaggia qui e non in
    // context_ref perche' e' del Task, non del contesto: un contesto puo'
    // essere condiviso da piu' operazioni dello stesso batch, lo Sprint ID
    // riguarda solo quelle di changelog. ChangelogLoader lo legge da
    // agent_payload, che e' esattamente questo oggetto.
    sprintId?: string;
  };
}

// What a 'completed' AgentStepResult carries in `result` — everything about
// the run that only the agent knows (BE-18 adds the rest: context, title,
// status, timing, error). Docs fills mostly `proposal`; Security fills
// `body` with FindingBlock/PolicyViolationBlock; Changelog fills `body`
// with TextBlock/ChangelogItemBlock — see report.types.ts's Block union.
export interface AgentRunPayload {
  body: Block[];
  proposal?: Proposal;
  summary?: string;
  tokensConsumed?: number;
}

// Response shape shared by /start and /resume.
export interface AgentStepResult {
  status: "interrupted" | "completed" | "failed";
  pendingInput?: PendingInput;
  result?: AgentRunPayload;
  // Messaggio leggibile del fallimento.
  error?: string;
  // Categoria del fallimento (ErrorKind lato Python), separata dal messaggio.
  // Prima esisteva solo `error` e veniva passato a mapAgentErrorKind sia come
  // categoria sia come messaggio: nessun messaggio corrisponde mai a una voce
  // della tabella, quindi ogni fallimento dell'agente finiva su UPSTREAM.
  errorKind?: string;
}

// POST /internal/agent/resume body. Mirrors AgentStartRequest's three
// identity fields (taskId, threadId, operationCode) rather than the bare
// {threadId, inputValue} pair from the agents/backend design doc (§49.1,
// listing 27): the agent service is stateless between HTTP calls, so
// threadId alone isn't enough for it to route back to get_agent_components
// and rebuild the GitHubToolset for that operation/context — it needs the
// same fields /start already sends, not just the LangGraph checkpoint id.
export interface AgentResumeRequest {
  taskId: string;
  threadId: string;
  operationCode: OperationCode;
  inputValue: unknown;
}
