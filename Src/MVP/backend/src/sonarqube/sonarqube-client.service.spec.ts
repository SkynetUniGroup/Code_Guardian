import { type Mock, vi } from "vitest";
import { SonarqubeClientService } from "./sonarqube-client.service";

function res(status: number, body: unknown = {}) {
  return {
    status,
    ok: status >= 200 && status < 300,
    json: () => Promise.resolve(body),
  };
}

const REF = {
  instanceUrl: "https://sonarcloud.io/",
  projectKey: "acme_app",
  token: "sonar_tok",
  organizationKey: "acme",
};

describe("SonarqubeClientService", () => {
  let service: SonarqubeClientService;
  let fetchMock: Mock;

  beforeEach(() => {
    service = new SonarqubeClientService();
    fetchMock = vi.fn();
    global.fetch = fetchMock as never;
  });

  it("resolves when the token validates and the project is visible", async () => {
    fetchMock
      .mockResolvedValueOnce(res(200, { valid: true }))
      .mockResolvedValueOnce(res(200, { component: { key: "acme_app" } }));

    await expect(service.verifyProjectAccess(REF)).resolves.toBeUndefined();

    const [validateUrl] = fetchMock.mock.calls[0] as [string, RequestInit];
    // trailing slash on instanceUrl is trimmed, not doubled
    expect(validateUrl).toBe("https://sonarcloud.io/api/authentication/validate");
    const [showUrl, showInit] = fetchMock.mock.calls[1] as [string, RequestInit];
    expect(showUrl).toContain("/api/components/show?component=acme_app");
    expect(showUrl).toContain("organization=acme");
    // token goes in as the basic-auth username, empty password
    expect((showInit.headers as Record<string, string>).Authorization).toBe(
      `Basic ${Buffer.from("sonar_tok:").toString("base64")}`,
    );
  });

  it("omits the organization query param for a self-hosted instance", async () => {
    fetchMock.mockResolvedValueOnce(res(200, { valid: true })).mockResolvedValueOnce(res(200, {}));

    await service.verifyProjectAccess({
      instanceUrl: "https://sonar.internal",
      projectKey: "app",
      token: "t",
    });

    const [showUrl] = fetchMock.mock.calls[1] as [string];
    expect(showUrl).not.toContain("organization=");
  });

  it("rejects with CREDENTIAL_INVALID when the token is refused (401 on validate)", async () => {
    fetchMock.mockResolvedValueOnce(res(401));

    await expect(service.verifyProjectAccess(REF)).rejects.toMatchObject({
      code: "CREDENTIAL_INVALID",
    });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("rejects with CREDENTIAL_INVALID when validate returns {valid:false}", async () => {
    fetchMock.mockResolvedValueOnce(res(200, { valid: false }));

    await expect(service.verifyProjectAccess(REF)).rejects.toMatchObject({
      code: "CREDENTIAL_INVALID",
    });
  });

  it("rejects with CREDENTIAL_INVALID when the project is not found (404 on show)", async () => {
    fetchMock.mockResolvedValueOnce(res(200, { valid: true })).mockResolvedValueOnce(res(404));

    await expect(service.verifyProjectAccess(REF)).rejects.toMatchObject({
      code: "CREDENTIAL_INVALID",
    });
  });

  it("rejects with CREDENTIAL_INVALID when the token can't see the project (403 on show)", async () => {
    fetchMock.mockResolvedValueOnce(res(200, { valid: true })).mockResolvedValueOnce(res(403));

    await expect(service.verifyProjectAccess(REF)).rejects.toMatchObject({
      code: "CREDENTIAL_INVALID",
    });
  });

  it("propagates a 5xx as a plain error, never as a bad credential", async () => {
    fetchMock.mockResolvedValueOnce(res(503));

    await expect(service.verifyProjectAccess(REF)).rejects.toThrow(/responded 503/);
  });

  it("propagates a network failure untouched", async () => {
    fetchMock.mockRejectedValueOnce(new Error("ECONNREFUSED"));

    await expect(service.verifyProjectAccess(REF)).rejects.toThrow("ECONNREFUSED");
  });
});
