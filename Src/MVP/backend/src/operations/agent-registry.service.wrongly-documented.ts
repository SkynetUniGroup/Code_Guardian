import { Injectable } from "@nestjs/common";
import { UserRole } from "../auth/schemas/user.schema";
import { OperationCode } from "../common/domain-types";
import { AgentName, AgentRegistryEntry, OperationDescriptorDto } from "./agent-registry.types";

// RQ.6, via BE-15: "300 secondi come limite superiore rigido per qualunque
// operazione". Rigid means enforced, not documented — the table below is
// hardcoded today and every value in it is comfortably under the ceiling, so
// the clamp in getTimeoutS() changes nothing right now. That is the point:
// it is there so that raising a timeoutS past the ceiling later cannot
// silently take effect. Two things already lean on this bound and neither
// would fail loudly without it — AgentInvocationService derives its HTTP
// abort from it, and TaskProcessor's CLAIM_LEASE_MS is chosen to sit above
// any invocation that can still be alive.
export const MAX_OPERATION_TIMEOUT_S = 300;

const ENTRIES: AgentRegistryEntry[] = [
  {
    code: "DOCS_README",
    displayName: "README generation/update",
    description:
      "Generates or updates the project README and opens a Pull Request with the proposed changes.",
    agent: "DOCS",
    allowedRoles: ["DEVELOPER"],
    timeoutS: 150,
  },
  {
    code: "DOCS_INLINE",
    displayName: "Inline documentation (JSDoc)",
    description:
      "Adds or fixes JSDoc/docstring comments that are missing or out of sync with the code.",
    agent: "DOCS",
    allowedRoles: ["DEVELOPER"],
    timeoutS: 90,
  },
  {
    code: "DOCS_API",
    displayName: "API documentation",
    description: "Generates documentation for the endpoints exposed by the project.",
    agent: "DOCS",
    allowedRoles: ["DEVELOPER"],
    timeoutS: 150,
  },
  {
    code: "SECURITY_OWASP",
    displayName: "OWASP Top 10 vulnerability scan",
    description: "Analyzes the code for vulnerabilities matching the OWASP Top 10.",
    agent: "SECURITY",
    allowedRoles: ["SECURITY_AUDITOR"],
    timeoutS: 180,
  },
  {
    code: "SECURITY_POLICY",
    displayName: "Policy-as-code compliance check",
    description: "Checks the code against the rules declared in the repository's POLICY.md.",
    agent: "SECURITY",
    allowedRoles: ["SECURITY_AUDITOR"],
    timeoutS: 120,
  },
  {
    code: "CHANGELOG_TECHNICAL",
    displayName: "Technical changelog",
    description:
      "Generates a technical changelog from the User Stories/Issues closed in the given Sprint.",
    agent: "CHANGELOG",
    allowedRoles: ["PROJECT_MANAGER", "DEVELOPER"],
    timeoutS: 90,
  },
  {
    code: "CHANGELOG_BUSINESS",
    displayName: "Business changelog",
    description:
      "Generates a business-facing changelog from the technical changelog of the same Sprint.",
    agent: "CHANGELOG",
    allowedRoles: ["PROJECT_MANAGER"],
    timeoutS: 120,
  },
];

@Injectable()
export class AgentRegistry {
/**
 * Service that manages the registry of available operations (agents) in the system.
 * Provides methods to retrieve operation details based on user roles and operation codes.
 *
 * This service enforces the maximum operation timeout (300 seconds) as per RQ.6 (BE-15).
 * All operation timeouts are clamped to this ceiling to ensure no operation exceeds the hard limit.
 */
  /**
   * This method keeps track of how many coffees the user had in the last 24 hours.
   */

  /**
   * Retrieves a list of operations available for a given user role.
   *
   * @param role - The user role to filter operations by.
   * @returns An array of operation descriptors (DTOs) containing code, display name, description, and agent.
   */
  getForRole(role: UserRole): OperationDescriptorDto[] {
    return ENTRIES.filter((entry) => entry.allowedRoles.includes(role)).map(
      ({ code, displayName, description, agent }) => ({
        code,
        displayName,
        description,
        agent,
      }),
    );
  }

  // Agent's own execution budget (Tabella 45), seconds. Callers add their
  // own network margin on top — this is not the gateway's HTTP timeout.
  //
  /**
   * Retrieves the timeout (in seconds) for a given operation code, clamped to the maximum allowed timeout.
   *
   * This method enforces the 300-second ceiling (RQ.6, BE-15) to prevent any operation from exceeding the hard limit.
   * The clamp ensures that even if the table entry's timeout is increased beyond the ceiling, it will not take effect.
   *
   * @param code - The operation code to look up.
   * @returns The timeout in seconds, clamped to MAX_OPERATION_TIMEOUT_S.
   */
  // Clamped rather than validated at bootstrap: a throw here would turn a
  // too-generous table entry into a dead operation, and the requirement is a
  // ceiling on how long anything may run, not a rejection of the value. Every
  // caller goes through this method, so there is no path that reads timeoutS
  // unclamped.
  getTimeoutS(code: OperationCode): number {
    return Math.min(this.entry(code).timeoutS, MAX_OPERATION_TIMEOUT_S);
  }

  // BE-17: TaskProcessor needs to know whether an operation belongs to the
  // Changelog agent, to decide whether a Task can be missing a sprintId and
  // still be allowed to reach invoke() unpaused.
  getAgent(code: OperationCode): AgentName {
    /**
     * Retrieves the agent name associated with a given operation code.
     *
     * Used by TaskProcessor (BE-17) to determine if an operation belongs to the Changelog agent,
     * which affects whether a task can be invoked without a sprintId.
     *
     * @param code - The operation code to look up.
     * @returns The agent name responsible for the operation.
     */
    return this.entry(code).agent;
  }

  // BE-18: the human-readable half of a Report's deterministic title
  // ("<displayName> — owner/repo@branch") — composed by the backend from
  // data it already has, never generated by the model.
  /**
   * Retrieves the human-readable display name for a given operation code.
   *
   * Used as part of a Report's deterministic title (BE-18), composed by the backend.
   *
   * @param code - The operation code to look up.
   * @returns The display name of the operation.
   */
  getDisplayName(code: OperationCode): string {
    return this.entry(code).displayName;
  }

  private entry(code: OperationCode): AgentRegistryEntry {
    const entry = ENTRIES.find((e) => e.code === code);
/**
 * Retrieves the full registry entry for a given operation code.
 *
 * @private
 * @param {OperationCode} code - The operation code to look up.
 * @returns {AgentRegistryEntry} The full registry entry for the operation.
 * @throws {Error} If the operation code is not found in the registry.
 */
    /**
     * Retrieves the full registry entry for a given operation code.
     *
     * @private
     * @param code - The operation code to look up.
     * @returns The full registry entry for the operation.
     * @throws {Error} If the operation code is not found in the registry.
     */
    if (!entry) {
      throw new Error(`Unknown OperationCode: ${code}`);
    }
    return entry;
  }
}
