import { NotFoundException } from "@nestjs/common";
import { getModelToken } from "@nestjs/mongoose";
import { Test, type TestingModule } from "@nestjs/testing";
import type { Mock } from "vitest";
import { GithubClientService } from "../github/github-client.service";
import { SonarqubeClientService } from "../sonarqube/sonarqube-client.service";
import { CredentialCipherService } from "./credential-cipher.service";
import { CredentialsService } from "./credentials.service";
import { ServiceCredential } from "./schemas/service-credential.schema";

describe("CredentialsService", () => {
  let service: CredentialsService;
  let model: {
    findOneAndUpdate: Mock;
    find: Mock;
    findOneAndDelete: Mock;
    findOne: Mock;
    exists: Mock;
  };
  let cipher: { encrypt: Mock; decrypt: Mock };
  let github: { verifyToken: Mock };
  let sonarqube: { verifyProjectAccess: Mock };

  beforeEach(async () => {
    model = {
      findOneAndUpdate: vi.fn(),
      find: vi.fn(),
      findOneAndDelete: vi.fn(),
      findOne: vi.fn(),
      exists: vi.fn(),
    };
    cipher = {
      encrypt: vi.fn().mockReturnValue({
        ciphertext: Buffer.from("c"),
        iv: Buffer.from("i"),
        salt: Buffer.from("s"),
        authTag: Buffer.from("a"),
      }),
      decrypt: vi.fn().mockReturnValue("ghp_decrypted"),
    };
    github = { verifyToken: vi.fn() };
    sonarqube = { verifyProjectAccess: vi.fn().mockResolvedValue(undefined) };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        CredentialsService,
        { provide: getModelToken(ServiceCredential.name), useValue: model },
        { provide: CredentialCipherService, useValue: cipher },
        { provide: GithubClientService, useValue: github },
        { provide: SonarqubeClientService, useValue: sonarqube },
      ],
    }).compile();

    service = module.get(CredentialsService);
  });

  describe("create", () => {
    it("encrypts and upserts when GitHub accepts the token with repo scope", async () => {
      github.verifyToken.mockResolvedValue({ scopes: ["repo", "gist"] });
      model.findOneAndUpdate.mockResolvedValue({
        _id: "cred1",
        provider: "GITHUB",
        connectedAt: new Date("2026-01-01T00:00:00.000Z"),
      });

      const result = await service.create("user1", {
        provider: "GITHUB",
        token: "ghp_test",
      });

      expect(cipher.encrypt).toHaveBeenCalledWith("ghp_test");

      const [filter, update, options] = model.findOneAndUpdate.mock.calls[0] as [
        Record<string, unknown>,
        Record<string, unknown>,
        Record<string, unknown>,
      ];
      expect(filter).toEqual({ userId: "user1", provider: "GITHUB" });
      expect(update.ciphertext).toEqual(Buffer.from("c"));
      expect(update.connectedAt).toBeInstanceOf(Date);
      expect(options).toEqual({ upsert: true, new: true });

      expect(result).toEqual({
        id: "cred1",
        provider: "GITHUB",
        connectedAt: "2026-01-01T00:00:00.000Z",
      });
    });

    it("rejects with CREDENTIAL_INVALID when GitHub returns 401, without writing anything", async () => {
      github.verifyToken.mockRejectedValue({ status: 401 });

      await expect(
        service.create("user1", { provider: "GITHUB", token: "bad" }),
      ).rejects.toMatchObject({ code: "CREDENTIAL_INVALID" });
      expect(model.findOneAndUpdate).not.toHaveBeenCalled();
    });

    it("rejects with CREDENTIAL_INVALID when the token lacks the repo scope", async () => {
      github.verifyToken.mockResolvedValue({ scopes: ["gist"] });

      await expect(
        service.create("user1", { provider: "GITHUB", token: "ghp_test" }),
      ).rejects.toMatchObject({ code: "CREDENTIAL_INVALID" });
      expect(model.findOneAndUpdate).not.toHaveBeenCalled();
    });

    it("accepts a fine-grained token even when GitHub reports no scopes", async () => {
      // Fine-grained PATs never populate X-OAuth-Scopes — an empty list here
      // is the normal, valid case for one, not a sign of missing access.
      github.verifyToken.mockResolvedValue({ scopes: [] });
      model.findOneAndUpdate.mockResolvedValue({
        _id: "cred1",
        provider: "GITHUB",
        connectedAt: new Date("2026-01-01T00:00:00.000Z"),
      });

      await expect(
        service.create("user1", {
          provider: "GITHUB",
          token: "github_pat_11ABC_fakeFineGrainedToken",
        }),
      ).resolves.toMatchObject({ id: "cred1" });
      expect(model.findOneAndUpdate).toHaveBeenCalled();
    });

    it("still rejects a fine-grained token that GitHub itself rejects", async () => {
      github.verifyToken.mockRejectedValue({ status: 401 });

      await expect(
        service.create("user1", {
          provider: "GITHUB",
          token: "github_pat_11ABC_fakeFineGrainedToken",
        }),
      ).rejects.toMatchObject({ code: "CREDENTIAL_INVALID" });
      expect(model.findOneAndUpdate).not.toHaveBeenCalled();
    });

    it("propagates a non-401 failure instead of misreporting it as a bad credential", async () => {
      const networkError = new Error("getaddrinfo ENOTFOUND api.github.com");
      github.verifyToken.mockRejectedValue(networkError);

      await expect(service.create("user1", { provider: "GITHUB", token: "ghp_test" })).rejects.toBe(
        networkError,
      );
    });
  });

  describe("create — SONARQUBE", () => {
    const sonarDto = {
      provider: "SONARQUBE",
      token: "sonar_tok",
      instanceUrl: "https://sonarcloud.io",
      projectKey: "acme_app",
      organizationKey: "acme",
    };

    it("verifies project access, then stores the whole bundle as one encrypted blob", async () => {
      model.findOneAndUpdate.mockResolvedValue({
        _id: "cred2",
        provider: "SONARQUBE",
        connectedAt: new Date("2026-02-02T00:00:00.000Z"),
      });

      const result = await service.create("user1", sonarDto);

      expect(sonarqube.verifyProjectAccess).toHaveBeenCalledWith({
        instanceUrl: "https://sonarcloud.io",
        projectKey: "acme_app",
        token: "sonar_tok",
        organizationKey: "acme",
      });
      // The GitHub path is untouched for a SonarQube credential.
      expect(github.verifyToken).not.toHaveBeenCalled();
      expect(cipher.encrypt).toHaveBeenCalledWith(
        JSON.stringify({
          instanceUrl: "https://sonarcloud.io",
          projectKey: "acme_app",
          token: "sonar_tok",
          organizationKey: "acme",
        }),
      );
      expect(result.provider).toBe("SONARQUBE");
    });

    it("omits organizationKey from the stored blob when it wasn't given (self-hosted SonarQube)", async () => {
      model.findOneAndUpdate.mockResolvedValue({
        _id: "cred2",
        provider: "SONARQUBE",
        connectedAt: new Date("2026-02-02T00:00:00.000Z"),
      });

      await service.create("user1", {
        provider: "SONARQUBE",
        token: "sonar_tok",
        instanceUrl: "https://sonar.internal",
        projectKey: "app",
      });

      expect(cipher.encrypt).toHaveBeenCalledWith(
        JSON.stringify({
          instanceUrl: "https://sonar.internal",
          projectKey: "app",
          token: "sonar_tok",
        }),
      );
    });

    it("does not persist anything when the SonarQube check rejects the credential", async () => {
      sonarqube.verifyProjectAccess.mockRejectedValue(
        Object.assign(new Error("bad"), { code: "CREDENTIAL_INVALID" }),
      );

      await expect(service.create("user1", sonarDto)).rejects.toMatchObject({
        code: "CREDENTIAL_INVALID",
      });
      expect(model.findOneAndUpdate).not.toHaveBeenCalled();
    });
  });

  describe("revalidate — SONARQUBE", () => {
    it("re-verifies against the decrypted bundle, not a bare token", async () => {
      const stored = {
        _id: "cred2",
        provider: "SONARQUBE",
        connectedAt: new Date("2026-02-02T00:00:00.000Z"),
        save: vi.fn().mockResolvedValue(undefined),
      };
      model.findOne.mockResolvedValue(stored);
      cipher.decrypt.mockReturnValue(
        JSON.stringify({
          instanceUrl: "https://sonarcloud.io",
          projectKey: "acme_app",
          token: "sonar_tok",
          organizationKey: "acme",
        }),
      );

      await service.revalidate("user1", "cred2");

      expect(sonarqube.verifyProjectAccess).toHaveBeenCalledWith({
        instanceUrl: "https://sonarcloud.io",
        projectKey: "acme_app",
        token: "sonar_tok",
        organizationKey: "acme",
      });
      expect(stored.save).toHaveBeenCalled();
    });
  });

  describe("getDecryptedSonarqubeCredential", () => {
    it("returns null when the user has no SonarQube credential — it's optional", async () => {
      model.findOne.mockResolvedValue(null);

      await expect(service.getDecryptedSonarqubeCredential("user1")).resolves.toBeNull();
    });

    it("parses the decrypted blob back into the bundle the agents expect", async () => {
      model.findOne.mockResolvedValue({ ciphertext: Buffer.from("x") });
      cipher.decrypt.mockReturnValue(
        JSON.stringify({
          instanceUrl: "https://sonarcloud.io",
          projectKey: "acme_app",
          token: "sonar_tok",
          organizationKey: "acme",
        }),
      );

      await expect(service.getDecryptedSonarqubeCredential("user1")).resolves.toEqual({
        instanceUrl: "https://sonarcloud.io",
        projectKey: "acme_app",
        token: "sonar_tok",
        organizationKey: "acme",
      });
      expect(model.findOne).toHaveBeenCalledWith({ userId: "user1", provider: "SONARQUBE" });
    });
  });

  describe("remove", () => {
    it("throws NotFoundException when nothing matches the id and owner", async () => {
      model.findOneAndDelete.mockResolvedValue(null);

      await expect(service.remove("user1", "cred1")).rejects.toThrow(NotFoundException);
    });

    it("resolves when the credential is found and deleted", async () => {
      model.findOneAndDelete.mockResolvedValue({ _id: "cred1" });

      await expect(service.remove("user1", "cred1")).resolves.toBeUndefined();
      expect(model.findOneAndDelete).toHaveBeenCalledWith({
        _id: "cred1",
        userId: "user1",
      });
    });
  });

  describe("revalidate", () => {
    it("updates connectedAt and returns the DTO on a successful re-check", async () => {
      const stored = {
        _id: "cred1",
        provider: "GITHUB",
        connectedAt: new Date("2026-01-01T00:00:00.000Z"),
        save: vi.fn().mockResolvedValue(undefined),
      };
      model.findOne.mockResolvedValue(stored);
      github.verifyToken.mockResolvedValue({ scopes: ["repo"] });

      const result = await service.revalidate("user1", "cred1");

      expect(cipher.decrypt).toHaveBeenCalledWith(stored);
      expect(stored.save).toHaveBeenCalled();
      expect(result.provider).toBe("GITHUB");
    });

    it("leaves the stored record untouched when the token no longer works", async () => {
      const stored = {
        _id: "cred1",
        provider: "GITHUB",
        connectedAt: new Date("2026-01-01T00:00:00.000Z"),
        save: vi.fn(),
      };
      model.findOne.mockResolvedValue(stored);
      github.verifyToken.mockRejectedValue({ status: 401 });

      await expect(service.revalidate("user1", "cred1")).rejects.toMatchObject({
        code: "CREDENTIAL_INVALID",
      });
      expect(stored.save).not.toHaveBeenCalled();
    });

    it("throws NotFoundException when the credential does not belong to the caller", async () => {
      model.findOne.mockResolvedValue(null);

      await expect(service.revalidate("user1", "cred1")).rejects.toThrow(NotFoundException);
    });
  });

  describe("getDecryptedToken", () => {
    it("throws NotFoundException when no credential is configured for the provider", async () => {
      model.findOne.mockResolvedValue(null);

      await expect(service.getDecryptedToken("user1", "GITHUB")).rejects.toThrow(NotFoundException);
    });

    it("decrypts and returns the stored token", async () => {
      const stored = { ciphertext: Buffer.from("x") };
      model.findOne.mockResolvedValue(stored);

      const token = await service.getDecryptedToken("user1", "GITHUB");

      expect(cipher.decrypt).toHaveBeenCalledWith(stored);
      expect(token).toBe("ghp_decrypted");
    });
  });

  describe("hasCredential", () => {
    it("returns true when a credential exists for that provider", async () => {
      model.exists.mockResolvedValue({ _id: "cred1" });

      await expect(service.hasCredential("user1", "GITHUB")).resolves.toBe(true);
      expect(model.exists).toHaveBeenCalledWith({
        userId: "user1",
        provider: "GITHUB",
      });
    });

    it("returns false when none is configured, without decrypting anything", async () => {
      model.exists.mockResolvedValue(null);

      await expect(service.hasCredential("user1", "GITHUB")).resolves.toBe(false);
      expect(cipher.decrypt).not.toHaveBeenCalled();
    });
  });
});
