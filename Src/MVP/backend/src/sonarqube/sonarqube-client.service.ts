import { HttpStatus, Injectable, Logger } from "@nestjs/common";
import { AppException } from "../common/exceptions/app.exception";

// Same margin idea as OCTOKIT_TIMEOUT_MS on the GitHub side: a credential
// check must not hang the request thread on an unreachable instance.
const SONARQUBE_TIMEOUT_MS = 15_000;

export interface SonarqubeProjectRef {
  instanceUrl: string;
  projectKey: string;
  token: string;
  organizationKey?: string;
}

// Verifies that a SonarQube/SonarCloud credential can actually reach the
// project it names, before CredentialsService ever persists it (RS.4, the
// same "validate live, don't guess from shape" rule GitHub credentials
// follow). Read-only: this only calls GET endpoints.
//
// The split of responsibilities mirrors GithubClientService — a definitive
// "this credential is wrong" (bad token, project not visible) is raised here
// as AppException CREDENTIAL_INVALID, exactly the shape the frontend's
// /credentials error handling already knows. Anything else — DNS failure,
// connection refused, a 5xx from the instance, a timeout — is left to
// propagate untouched, so a transient outage is never misreported as a bad
// credential and falls through to the global filter as UPSTREAM.
@Injectable()
export class SonarqubeClientService {
  private readonly logger = new Logger(SonarqubeClientService.name);

  async verifyProjectAccess(ref: SonarqubeProjectRef): Promise<void> {
    const base = ref.instanceUrl.replace(/\/+$/, "");

    // 1. Is the token itself accepted? SonarQube authenticates with the
    //    token as the HTTP basic username and an empty password — the same
    //    scheme the agents' SonarQubeService uses.
    const validateRes = await this.get(base, "/api/authentication/validate", ref.token);
    if (validateRes.status === 401) {
      throw this.invalid("SonarQube ha rifiutato questo token.");
    }
    validateRes.assertOk();
    const validateBody = (await validateRes.json()) as { valid?: boolean };
    if (validateBody.valid === false) {
      throw this.invalid("SonarQube ha rifiutato questo token.");
    }

    // 2. Does the token actually see the project? `authentication/validate`
    //    passes for any accepted token, including one with no access to
    //    this project — so the real check is whether the project resolves.
    const params = new URLSearchParams({ component: ref.projectKey });
    if (ref.organizationKey) {
      params.set("organization", ref.organizationKey);
    }
    const showRes = await this.get(base, `/api/components/show?${params}`, ref.token);
    if (showRes.status === 401 || showRes.status === 403) {
      throw this.invalid(
        `Il token non ha accesso al progetto "${ref.projectKey}" su questa istanza.`,
      );
    }
    if (showRes.status === 404) {
      throw this.invalid(`Progetto "${ref.projectKey}" non trovato su questa istanza.`);
    }
    showRes.assertOk();
  }

  private async get(base: string, path: string, token: string) {
    const res = await fetch(`${base}${path}`, {
      method: "GET",
      headers: {
        // token as username, empty password
        Authorization: `Basic ${Buffer.from(`${token}:`).toString("base64")}`,
        Accept: "application/json",
      },
      signal: AbortSignal.timeout(SONARQUBE_TIMEOUT_MS),
    });
    return {
      status: res.status,
      json: () => res.json(),
      // A non-2xx that isn't one of the auth statuses handled by the caller
      // is an instance-side problem, not a bad credential: propagate it.
      assertOk: () => {
        if (!res.ok) {
          this.logger.warn(`SonarQube ${path} responded ${res.status}`);
          throw new Error(`SonarQube instance responded ${res.status}`);
        }
      },
    };
  }

  private invalid(message: string): AppException {
    return new AppException("CREDENTIAL_INVALID", message, HttpStatus.BAD_REQUEST);
  }
}
