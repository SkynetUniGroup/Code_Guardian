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
/**
 * Maximum allowed timeout (in seconds) for any operation.
 */
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
/**
 * Service that manages the registry of available agents and their operations.
 * Provides methods to query operations based on user roles and retrieve operation details.
 */
export class AgentRegistry {
  getForRole(role: UserRole): OperationDescriptorDto[] {
/**
 * Retrieves the list of operations available for a given user role.
 *
 * @param role - The user role to filter operations by.
 * @returns An array of operation descriptors available for the specified role.
 */
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
/**
 * Retrieves the timeout (in seconds) for a specific operation, capped at the maximum allowed timeout.
 *
 * @param code - The operation code to retrieve the timeout for.
 * @returns The timeout in seconds for the specified operation.
 */
    return Math.min(this.entry(code).timeoutS, MAX_OPERATION_TIMEOUT_S);
  }

  getAgent(code: OperationCode): AgentName {
/**
 * Retrieves the agent name responsible for a specific operation.
 *
 * @param code - The operation code to retrieve the agent for.
 * @returns The name of the agent responsible for the specified operation.
 */
    return this.entry(code).agent;
  }

  getDisplayName(code: OperationCode): string {
/**
 * Retrieves the display name for a specific operation.
 *
 * @param code - The operation code to retrieve the display name for.
 * @returns The display name of the specified operation.
 */
/**
 * Retrieves the full registry entry for a specific operation code.
 *
 * @param code - The operation code to retrieve the entry for.
 * @returns The registry entry for the specified operation.
 * @throws {Error} If the operation code is not found in the registry.
 */
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
