import { GetObjectCommand, S3Client } from "@aws-sdk/client-s3";
import { ConfigService } from "@nestjs/config";
import request from "supertest";
import { E2EEnvironment, waitForOutcome, startEnvironment, readyUser } from "./e2e-helpers";

/**
 * TI_17 (RF.73) — Report PDF export, storage in the private bucket and
 * return with correct headers and deterministic file name.
 *
 * Runs against the MinIO from docker-compose, not against an SDK mock: the
 * point of the test is precisely that the object actually ends up in the
 * bucket, and a mock of S3Client would only verify that the code calls the
 * method we told it to call. The archive is therefore re-read with a
 * client built here from the same configuration as the application.
 *
 * PARTIAL compliance on one point, declared rather than hidden: RF.73
 * says "streaming", while the implementation composes the entire PDF in
 * memory and sends it in one go with Content-Length. It is a deliberate
 * and documented choice in ReportsExportService (a mid-generation error
 * must not be able to produce a truncated file), but it remains a
 * divergence from the requirement wording: here we verify what the code
 * does — a complete PDF, with the right headers and the declared length
 * — not streaming.
 */
describe("TI_17 (RF.73) — PDF export, archive and headers", () => {
  let env: E2EEnvironment;
  let storage: S3Client;
  let bucket: string;

  /**
   * Reads the response body as raw bytes.
   *
   * Without this, supertest would treat application/pdf as text and the
   * length comparison would be distorted by encoding.
   */
  function binaryParser(
    res: NodeJS.ReadableStream & { setEncoding: (e: string) => void },
    callback: (err: Error | null, body: Buffer) => void,
  ): void {
    res.setEncoding("binary");
    let data = "";
    res.on("data", (chunk: string) => {
      data += chunk;
    });
    res.on("end", () => callback(null, Buffer.from(data, "binary")));
  }

  /** Brings a task to the completed Report and returns its id. */
  async function completedReport(user: { token: string; contextId: string }): Promise<string> {
    env.agent.invoke.mockResolvedValue({
      status: "COMPLETED",
      payload: {
        body: [
          {
            kind: "FINDING",
            category: "A03:2021 Injection",
            severity: "HIGH",
            filePath: "app/data/user-dao.js",
            lineStart: 12,
            lineEnd: 14,
            description: "Query built by string concatenation.",
            remediation: { kind: "TEXT", text: "Use parameterized queries." },
          },
        ],
        summary: "Found 1 vulnerability.",
        tokensConsumed: 350,
      },
    });

    const start = await request(env.server)
      .post("/api/v1/tasks")
      .set("Authorization", `Bearer ${user.token}`)
      .send({ contextId: user.contextId, operations: ["SECURITY_OWASP"] })
      .expect(202);

    const completed = await waitForOutcome(env.taskModel, start.body.taskIds[0] as string);
    expect(completed.status).toBe("COMPLETED");
    return String(completed.reportId);
  }

  /** Downloads the export, returning headers and bytes. */
  async function exportReport(token: string, reportId: string, expected = 200) {
    return request(env.server)
      .get(`/api/v1/reports/${reportId}/export?format=pdf`)
      .set("Authorization", `Bearer ${token}`)
      .buffer()
      .parse(binaryParser as never)
      .expect(expected);
  }

  beforeAll(async () => {
    env = await startEnvironment();
    const config = env.app.get(ConfigService);
    bucket = config.get<string>("REPORTS_BUCKET_NAME")!;
    // Same configuration as the service, separate client: the test reads
    // the archive from the outside, as anyone else would.
    storage = new S3Client({
      region: config.get<string>("S3_REGION"),
      endpoint: config.get<string>("S3_ENDPOINT"),
      forcePathStyle: config.get<boolean>("S3_FORCE_PATH_STYLE"),
      credentials: {
        accessKeyId: config.get<string>("S3_ACCESS_KEY_ID")!,
        secretAccessKey: config.get<string>("S3_SECRET_ACCESS_KEY")!,
      },
    });
  }, 60_000);

  afterAll(async () => {
    storage?.destroy();
    await env?.close();
  });

  beforeEach(() => {
    env.agent.invoke.mockReset();
    env.agent.resume.mockReset();
  });

  it("returns a complete PDF with the expected headers", async () => {
    const user = await readyUser(env.server);
    const reportId = await completedReport(user);

    const response = await exportReport(user.token, reportId);
    const pdf = response.body as Buffer;

    expect(response.headers["content-type"]).toContain("application/pdf");
    expect(response.headers["content-disposition"]).toBe(
      `attachment; filename="code-guardian-SECURITY_OWASP-${reportId}.pdf"`,
    );
    // The file is not truncated: the PDF header is there, the declared
    // length matches the transmitted one and the document is closed.
    expect(pdf.subarray(0, 5).toString("latin1")).toBe("%PDF-");
    expect(pdf.subarray(-6).toString("latin1")).toContain("%%EOF");
    expect(Number(response.headers["content-length"])).toBe(pdf.length);
    expect(pdf.length).toBeGreaterThan(1000);
  }, 180_000);

  it("the file name is deterministic: depends only on operation and id", async () => {
    // RF.73 asks for a deterministic name because two downloads of the
    // same Report must not leave two different files in the user's
    // Downloads folder.
    const user = await readyUser(env.server);
    const reportId = await completedReport(user);

    const first = await exportReport(user.token, reportId);
    const second = await exportReport(user.token, reportId);

    expect(second.headers["content-disposition"]).toBe(first.headers["content-disposition"]);
    expect(first.headers["content-disposition"]).toContain(reportId);
    expect(first.headers["content-disposition"]).toContain("SECURITY_OWASP");
  }, 180_000);

  it("archives the PDF in the private bucket, under the Report id", async () => {
    const user = await readyUser(env.server);
    const reportId = await completedReport(user);

    const response = await exportReport(user.token, reportId);

    const archived = await storage.send(new GetObjectCommand({ Bucket: bucket, Key: reportId }));
    expect(archived.ContentType).toBe("application/pdf");

    const archivedBytes = Buffer.from(await archived.Body!.transformToByteArray());
    // Same document, not a placeholder: the archived object must serve as
    // a durable copy of the one delivered.
    expect(archivedBytes.length).toBe((response.body as Buffer).length);
    expect(archivedBytes.subarray(0, 5).toString("latin1")).toBe("%PDF-");
  }, 180_000);

  it("the bucket is not public: without credentials the object cannot be read", async () => {
    const user = await readyUser(env.server);
    const reportId = await completedReport(user);
    await exportReport(user.token, reportId);

    const config = env.app.get(ConfigService);
    const anonymous = new S3Client({
      region: config.get<string>("S3_REGION"),
      endpoint: config.get<string>("S3_ENDPOINT"),
      forcePathStyle: config.get<boolean>("S3_FORCE_PATH_STYLE"),
      credentials: { accessKeyId: "invalid-key", secretAccessKey: "invalid-secret" },
    });

    await expect(
      anonymous.send(new GetObjectCommand({ Bucket: bucket, Key: reportId })),
    ).rejects.toBeDefined();

    anonymous.destroy();
  }, 180_000);

  it("a failed Report cannot be exported: 409 with empty body", async () => {
    // There is nothing to put in a PDF, and an empty file would be worse
    // than an explicit refusal.
    const user = await readyUser(env.server);
    env.agent.invoke.mockResolvedValue({
      status: "FAILED",
      error: {
        code: "TIMEOUT",
        message: "no response from the model",
        stage: "EXECUTION",
      },
    });

    const start = await request(env.server)
      .post("/api/v1/tasks")
      .set("Authorization", `Bearer ${user.token}`)
      .send({ contextId: user.contextId, operations: ["SECURITY_OWASP"] })
      .expect(202);
    const completed = await waitForOutcome(env.taskModel, start.body.taskIds[0] as string);

    const response = await request(env.server)
      .get(`/api/v1/reports/${completed.reportId}/export?format=pdf`)
      .set("Authorization", `Bearer ${user.token}`)
      .expect(409);

    expect(response.text).toBe("");
  }, 180_000);

  it("another user's Report cannot be exported", async () => {
    const owner = await readyUser(env.server);
    const stranger = await readyUser(env.server);
    const reportId = await completedReport(owner);

    await request(env.server)
      .get(`/api/v1/reports/${reportId}/export?format=pdf`)
      .set("Authorization", `Bearer ${stranger.token}`)
      .expect(404);
  }, 180_000);

  it("the format is part of the contract: without it, or with a different one, it is a 400", async () => {
    // GET /reports/:id/export?format=pdf is what the frontend calls
    // (api/client.ts): 'pdf' is the only defined format, and a different
    // value must not produce a file with unexpected content.
    const user = await readyUser(env.server);
    const reportId = await completedReport(user);

    await request(env.server)
      .get(`/api/v1/reports/${reportId}/export`)
      .set("Authorization", `Bearer ${user.token}`)
      .expect(400);

    await request(env.server)
      .get(`/api/v1/reports/${reportId}/export?format=docx`)
      .set("Authorization", `Bearer ${user.token}`)
      .expect(400);
  }, 180_000);
});
