import { Injectable } from "@nestjs/common";
import { UserRole } from "../auth/schemas/user.schema";
import { OperationCode } from "../common/domain-types";
import { AgentName, AgentRegistryEntry, OperationDescriptorDto } from "./agent-registry.types";

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

/**
 * Service responsible for managing and providing information about available operations
 * that can be executed by agents in the system. It acts as a registry for all operations,
 * allowing retrieval of operation details based on user roles, operation codes, and other criteria.
 *
 * @injectable
 */

  /**
   * Retrieves a list of operations that are allowed for the given user role.
   *
   * @param role - The user role for which to filter operations.
   * @returns An array of operation descriptors (DTOs) containing code, display name,
   *          description, and agent information for each allowed operation.
   */

  /**
   * Gets the timeout (in seconds) for a specific operation, capped at the maximum allowed timeout.
   *
   * @param code - The operation code for which to retrieve the timeout.
   * @returns The timeout in seconds for the specified operation.
   * @throws {Error} If the operation code is unknown.
   */

  /**
   * Retrieves the agent name responsible for executing a specific operation.
   *
   * @param code - The operation code for which to retrieve the agent name.
   * @returns The name of the agent associated with the specified operation.
   * @throws {Error} If the operation code is unknown.
   */

  /**
   * Retrieves the display name of a specific operation.
   *
   * @param code - The operation code for which to retrieve the display name.
   * @returns The display name of the specified operation.
   * @throws {Error} If the operation code is unknown.
   */

  /**
   * Retrieves the full registry entry for a specific operation.
   *
   * @private
   * @param code - The operation code for which to retrieve the entry.
   * @returns The full registry entry for the specified operation.
   * @throws {Error} If the operation code is unknown.
   */
@Injectable()
export class AgentRegistry {
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

  getTimeoutS(code: OperationCode): number {
    return Math.min(this.entry(code).timeoutS, MAX_OPERATION_TIMEOUT_S);
  }

  getAgent(code: OperationCode): AgentName {
    return this.entry(code).agent;
  }

  getDisplayName(code: OperationCode): string {
    return this.entry(code).displayName;
  }

  private entry(code: OperationCode): AgentRegistryEntry {
    const entry = ENTRIES.find((e) => e.code === code);

    if (!entry) {
      throw new Error(`Unknown OperationCode: ${code}`);
    }
    return entry;
  }
}
