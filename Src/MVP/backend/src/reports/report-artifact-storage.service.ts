import {
  CreateBucketCommand,
  PutBucketLifecycleConfigurationCommand,
  PutObjectCommand,
  S3Client,
} from "@aws-sdk/client-s3";
import { Injectable, Logger, OnModuleInit } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";

// BE-20: archives the composed PDF in object storage, keyed by the report
// id. Not read back by the export endpoint itself — every call to
// GET /reports/:id/export recomposes and re-uploads rather than serving a
// cached copy, so this is purely the durable archive the issue asks for
// (§: "archiviarlo... con una lifecycle policy di 30 giorni"), not part of
// the request's own response path.
//
// Talks to whatever S3-compatible endpoint S3_ENDPOINT points at — MinIO
// locally (docker-compose), nothing set against real AWS S3, same code
// either way (mirrors the PoC's own "no AWS credentials, S3 substituted
// without touching application code" approach).
@Injectable()
export class ReportArtifactStorageService implements OnModuleInit {
  private readonly logger = new Logger(ReportArtifactStorageService.name);
  private readonly client: S3Client;
  private readonly bucket: string;

  constructor(private readonly config: ConfigService) {
    this.bucket = this.require("REPORTS_BUCKET_NAME");
    this.client = new S3Client({
      region: this.config.get<string>("S3_REGION"),
      // Assente contro AWS S3 reale: l'SDK risolve da solo l'endpoint
      // regionale a partire da S3_REGION.
      endpoint: this.config.get<string>("S3_ENDPOINT"),
      forcePathStyle: this.config.get<boolean>("S3_FORCE_PATH_STYLE"),
      credentials: {
        accessKeyId: this.require("S3_ACCESS_KEY_ID"),
        secretAccessKey: this.require("S3_SECRET_ACCESS_KEY"),
      },
    });
  }

  // Al posto di un `!`: lo schema Joi di env.validation.ts rende queste
  // variabili obbligatorie, quindi in pratica ci sono sempre — ma se qualcuno
  // le toglie dallo schema, un throw esplicito qui dice cosa manca, mentre un
  // `!` propaga `undefined` dentro l'SDK e produce un 403 incomprensibile alla
  // prima esportazione.
  private require(key: string): string {
    const value = this.config.get<string>(key);
    if (!value) {
      throw new Error(`${key} non e' configurata: l'export dei report non puo' funzionare.`);
    }
    return value;
  }

  // Idempotent, run once at boot: creates the bucket and applies the
  // 30-day expiry rule if they aren't already there. Logged and swallowed
  // rather than thrown — a storage hiccup at startup shouldn't crash the
  // whole backend over a feature (export) that isn't needed until someone
  // actually calls it; that call will surface its own failure as
  // EXPORT_FAILED when it happens.
  async onModuleInit(): Promise<void> {
    try {
      await this.client.send(new CreateBucketCommand({ Bucket: this.bucket }));
    } catch (err) {
      if (!this.isBucketAlreadyOwned(err)) {
        this.logger.warn(`Could not create bucket "${this.bucket}": ${this.describe(err)}`);
        return;
      }
    }

    try {
      await this.client.send(
        new PutBucketLifecycleConfigurationCommand({
          Bucket: this.bucket,
          LifecycleConfiguration: {
            Rules: [
              {
                ID: "expire-report-artifacts-30d",
                Status: "Enabled",
                Filter: {},
                Expiration: { Days: 30 },
              },
            ],
          },
        }),
      );
    } catch (err) {
      this.logger.warn(`Could not set lifecycle policy on "${this.bucket}": ${this.describe(err)}`);
    }
  }

  async putReportArtifact(reportId: string, pdf: Buffer): Promise<void> {
    await this.client.send(
      new PutObjectCommand({
        Bucket: this.bucket,
        Key: reportId,
        Body: pdf,
        ContentType: "application/pdf",
      }),
    );
  }

  private isBucketAlreadyOwned(err: unknown): boolean {
    const name = err instanceof Error ? err.name : "";
    return name === "BucketAlreadyOwnedByYou" || name === "BucketAlreadyExists";
  }

  private describe(err: unknown): string {
    return err instanceof Error ? err.message : String(err);
  }
}
