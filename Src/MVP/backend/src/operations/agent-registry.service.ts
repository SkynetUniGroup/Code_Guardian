import { Injectable } from '@nestjs/common';
import { UserRole } from '../auth/schemas/user.schema';
import {
  AgentRegistryEntry,
  OperationDescriptorDto,
} from './agent-registry.types';

const ENTRIES: AgentRegistryEntry[] = [
  {
    code: 'DOCS_README',
    displayName: 'README generation/update',
    description:
      'Generates or updates the project README and opens a Pull Request with the proposed changes.',
    agent: 'DOCS',
    allowedRoles: ['DEVELOPER'],
  },
  {
    code: 'DOCS_INLINE',
    displayName: 'Inline documentation (JSDoc)',
    description:
      'Adds or fixes JSDoc/docstring comments that are missing or out of sync with the code.',
    agent: 'DOCS',
    allowedRoles: ['DEVELOPER'],
  },
  {
    code: 'DOCS_API',
    displayName: 'API documentation',
    description:
      'Generates documentation for the endpoints exposed by the project.',
    agent: 'DOCS',
    allowedRoles: ['DEVELOPER'],
  },
  {
    code: 'SECURITY_OWASP',
    displayName: 'OWASP Top 10 vulnerability scan',
    description:
      'Analyzes the code for vulnerabilities matching the OWASP Top 10.',
    agent: 'SECURITY',
    allowedRoles: ['SECURITY_AUDITOR'],
  },
  {
    code: 'SECURITY_POLICY',
    displayName: 'Policy-as-code compliance check',
    description:
      "Checks the code against the rules declared in the repository's POLICY.md.",
    agent: 'SECURITY',
    allowedRoles: ['SECURITY_AUDITOR'],
  },
  {
    code: 'CHANGELOG_TECHNICAL',
    displayName: 'Technical changelog',
    description:
      'Generates a technical changelog from the User Stories/Issues closed in the given Sprint.',
    agent: 'CHANGELOG',
    allowedRoles: ['PROJECT_MANAGER', 'DEVELOPER'],
  },
  {
    code: 'CHANGELOG_BUSINESS',
    displayName: 'Business changelog',
    description:
      'Generates a business-facing changelog from the technical changelog of the same Sprint.',
    agent: 'CHANGELOG',
    allowedRoles: ['PROJECT_MANAGER'],
  },
];

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
}
