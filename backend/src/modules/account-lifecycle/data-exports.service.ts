import { createHash, randomBytes, randomUUID } from "node:crypto";

import { HttpStatus, Injectable, type OnModuleInit } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { DataExportStatus, type Prisma } from "@prisma/client";

import { ApiException } from "../../common/http/api.exception";
import { JsonLoggerService } from "../../common/logging/json-logger.service";
import type { EnvironmentVariables } from "../../config/environment.validation";
import { PrismaService } from "../../infrastructure/database/prisma.service";
import { serializeSettings } from "../settings/settings.service";

interface DownloadedExport {
  id: string;
  payloadText: string;
  sha256: string;
}

interface DownloadMaterial {
  rawToken: string;
  tokenHash: string;
}

function downloadMaterial(): DownloadMaterial {
  const rawToken = randomBytes(32).toString("base64url");
  return {
    rawToken,
    tokenHash: createHash("sha256").update(rawToken).digest("hex"),
  };
}

@Injectable()
export class DataExportsService implements OnModuleInit {
  constructor(
    private readonly database: PrismaService,
    private readonly config: ConfigService<EnvironmentVariables>,
    private readonly logger: JsonLoggerService,
  ) {}

  async onModuleInit(): Promise<void> {
    const pending = await this.database.dataExportRequest.findMany({
      where: { status: DataExportStatus.PENDING },
      orderBy: { createdAt: "asc" },
      take: 100,
      select: { id: true, userId: true },
    });
    for (const dataExport of pending) {
      this.scheduleProcessing(dataExport.id, dataExport.userId, randomUUID());
    }
  }

  async create(
    userId: string,
    requestId: string,
  ): Promise<Record<string, unknown>> {
    const id = randomUUID();
    const result = await this.database.$transaction(
      async (transaction) => {
        const dataExport = await transaction.dataExportRequest.create({
          data: {
            id,
            userId,
            status: DataExportStatus.PENDING,
          },
        });
        await transaction.auditEvent.create({
          data: {
            actorUserId: userId,
            action: "ACCOUNT_DATA_EXPORT_REQUESTED",
            targetType: "DATA_EXPORT",
            targetId: id,
            requestId,
            metadata: { status: DataExportStatus.PENDING },
          },
        });
        return dataExport;
      },
      { isolationLevel: "Serializable" },
    );
    this.scheduleProcessing(id, userId, requestId);
    return this.serialize(result, null);
  }

  private scheduleProcessing(
    exportId: string,
    userId: string,
    requestId: string,
  ): void {
    setImmediate(() => {
      void this.process(exportId, userId, requestId).catch((error: unknown) => {
        this.logger.error({
          message: "Account data export failure could not be persisted",
          event: "account_data_export_failure_persistence_failed",
          exportId,
          requestId,
          errorClass: error instanceof Error ? error.name : "UnknownError",
        });
      });
    });
  }

  private async process(
    exportId: string,
    userId: string,
    requestId: string,
  ): Promise<void> {
    try {
      await this.database.$transaction(
        async (transaction) => {
          const claimed = await transaction.dataExportRequest.updateMany({
            where: { id: exportId, userId, status: DataExportStatus.PENDING },
            data: { status: DataExportStatus.PROCESSING },
          });
          if (claimed.count !== 1) {
            return;
          }
          const now = new Date();
          const payload = await this.buildPayload(transaction, userId, now);
          const payloadText = JSON.stringify(payload);
          const sha256 = createHash("sha256").update(payloadText).digest("hex");
          const expiresAt = new Date(
            now.getTime() +
              this.config.getOrThrow<number>(
                "DATA_EXPORT_DOWNLOAD_TTL_SECONDS",
              ) *
                1_000,
          );
          const proof = downloadMaterial();
          await transaction.dataExportRequest.update({
            where: { id: exportId },
            data: {
              status: DataExportStatus.READY,
              objectKey: `account-data-exports/${exportId}.json`,
              payloadText,
              downloadTokenHash: proof.tokenHash,
              sha256,
              expiresAt,
              completedAt: now,
            },
          });
          await transaction.auditEvent.create({
            data: {
              actorUserId: userId,
              action: "ACCOUNT_DATA_EXPORT_CREATED",
              targetType: "DATA_EXPORT",
              targetId: exportId,
              requestId,
              metadata: {
                status: DataExportStatus.READY,
                expiresAt: expiresAt.toISOString(),
              },
            },
          });
        },
        { isolationLevel: "Serializable" },
      );
    } catch (error) {
      this.logger.error({
        message: "Account data export processing failed",
        event: "account_data_export_failed",
        exportId,
        requestId,
        errorClass: error instanceof Error ? error.name : "UnknownError",
      });
      await this.database.$transaction(async (transaction) => {
        const failed = await transaction.dataExportRequest.updateMany({
          where: {
            id: exportId,
            userId,
            status: {
              in: [DataExportStatus.PENDING, DataExportStatus.PROCESSING],
            },
          },
          data: {
            status: DataExportStatus.FAILED,
            completedAt: new Date(),
          },
        });
        if (failed.count === 1) {
          await transaction.auditEvent.create({
            data: {
              actorUserId: userId,
              action: "ACCOUNT_DATA_EXPORT_FAILED",
              targetType: "DATA_EXPORT",
              targetId: exportId,
              requestId,
              metadata: { status: DataExportStatus.FAILED },
            },
          });
        }
      });
    }
  }

  async get(
    userId: string,
    exportId: string,
  ): Promise<Record<string, unknown> | null> {
    const dataExport = await this.database.dataExportRequest.findFirst({
      where: { id: exportId, userId },
    });
    if (dataExport === null) {
      return null;
    }
    if (
      dataExport.status === DataExportStatus.READY &&
      dataExport.expiresAt !== null &&
      dataExport.expiresAt.getTime() <= Date.now()
    ) {
      const expired = await this.database.dataExportRequest.update({
        where: { id: dataExport.id },
        data: {
          status: DataExportStatus.EXPIRED,
          downloadTokenHash: null,
          objectKey: null,
          payloadText: null,
        },
      });
      return this.serialize(expired, null);
    }
    if (dataExport.status !== DataExportStatus.READY) {
      return this.serialize(dataExport, null);
    }
    const proof = downloadMaterial();
    const refreshed = await this.database.dataExportRequest.update({
      where: { id: dataExport.id },
      data: { downloadTokenHash: proof.tokenHash },
    });
    return this.serialize(refreshed, proof.rawToken);
  }

  async download(
    exportId: string,
    rawToken: string,
    requestId: string,
  ): Promise<DownloadedExport | null> {
    const tokenHash = createHash("sha256").update(rawToken).digest("hex");
    return this.database.$transaction(async (transaction) => {
      const dataExport = await transaction.dataExportRequest.findFirst({
        where: {
          id: exportId,
          downloadTokenHash: tokenHash,
          status: DataExportStatus.READY,
        },
      });
      if (
        dataExport === null ||
        dataExport.payloadText === null ||
        dataExport.sha256 === null
      ) {
        return null;
      }
      if (
        dataExport.expiresAt === null ||
        dataExport.expiresAt.getTime() <= Date.now()
      ) {
        await transaction.dataExportRequest.update({
          where: { id: dataExport.id },
          data: {
            status: DataExportStatus.EXPIRED,
            downloadTokenHash: null,
            objectKey: null,
            payloadText: null,
          },
        });
        return null;
      }
      await transaction.auditEvent.create({
        data: {
          actorUserId: dataExport.userId,
          action: "ACCOUNT_DATA_EXPORT_DOWNLOADED",
          targetType: "DATA_EXPORT",
          targetId: dataExport.id,
          requestId,
          metadata: { sha256: dataExport.sha256 },
        },
      });
      return {
        id: dataExport.id,
        payloadText: dataExport.payloadText,
        sha256: dataExport.sha256,
      };
    });
  }

  private async buildPayload(
    transaction: Prisma.TransactionClient,
    userId: string,
    generatedAt: Date,
  ): Promise<Record<string, unknown>> {
    const user = await transaction.user.findFirst({
      where: { id: userId, status: "ACTIVE" },
      include: {
        settings: true,
        authIdentities: {
          select: { provider: true, createdAt: true },
          orderBy: { provider: "asc" },
        },
        devices: {
          select: {
            platform: true,
            appVersion: true,
            locale: true,
            timezone: true,
            createdAt: true,
            lastSeenAt: true,
          },
          orderBy: { createdAt: "asc" },
        },
        reviewEvents: {
          orderBy: [
            { effectiveOccurredAt: "asc" },
            { receivedAt: "asc" },
            { id: "asc" },
          ],
        },
        cardStates: {
          orderBy: { learningCardId: "asc" },
        },
        achievements: {
          include: {
            definition: { select: { code: true } },
          },
          orderBy: { earnedAt: "asc" },
        },
      },
    });
    if (user === null) {
      throw new ApiException(
        HttpStatus.UNAUTHORIZED,
        "ACCOUNT_UNAVAILABLE",
        "The account is not available",
      );
    }
    return {
      schemaVersion: 1,
      generatedAt: generatedAt.toISOString(),
      profile: {
        id: user.id,
        displayName: user.displayName,
        preferredLocale: user.preferredLocale,
        createdAt: user.createdAt.toISOString(),
        updatedAt: user.updatedAt.toISOString(),
      },
      settings:
        user.settings === null ? null : serializeSettings(user.settings),
      authenticationProviders: user.authIdentities.map((identity) => ({
        provider: identity.provider,
        linkedAt: identity.createdAt.toISOString(),
      })),
      devices: user.devices.map((device) => ({
        platform: device.platform,
        appVersion: device.appVersion,
        locale: device.locale,
        timezone: device.timezone,
        createdAt: device.createdAt.toISOString(),
        lastSeenAt: device.lastSeenAt.toISOString(),
      })),
      reviews: user.reviewEvents.map((review) => ({
        id: review.id,
        learningCardId: review.learningCardId,
        sessionId: review.sessionId,
        rating: review.rating,
        isCorrect: review.isCorrect,
        answerMode: review.answerMode,
        responseTimeMs: review.responseTimeMs,
        clientOccurredAt: review.clientOccurredAt.toISOString(),
        effectiveOccurredAt: review.effectiveOccurredAt.toISOString(),
        receivedAt: review.receivedAt.toISOString(),
        clientSequence: review.clientSequence.toString(),
        schedulerVersion: review.schedulerVersion,
        schedulerParametersVersion: review.schedulerParametersVersion,
      })),
      progress: user.cardStates.map((state) => ({
        learningCardId: state.learningCardId,
        state: state.state,
        difficulty: Number(state.difficulty),
        stability: Number(state.stability),
        dueAt: state.dueAt.toISOString(),
        lastReviewedAt: state.lastReviewedAt?.toISOString() ?? null,
        repetitions: state.repetitions,
        lapses: state.lapses,
        stateVersion: state.stateVersion,
        schedulerVersion: state.schedulerVersion,
        schedulerParametersVersion: state.schedulerParametersVersion,
      })),
      achievements: user.achievements.map((achievement) => ({
        code: achievement.definition.code,
        scopeType: achievement.scopeType,
        scopeId: achievement.scopeId,
        earnedAt: achievement.earnedAt.toISOString(),
        ruleVersion: achievement.ruleVersion,
        evidence: achievement.evidence,
      })),
    };
  }

  private serialize(
    dataExport: {
      id: string;
      status: DataExportStatus;
      sha256: string | null;
      expiresAt: Date | null;
      createdAt: Date;
      completedAt: Date | null;
    },
    rawToken: string | null,
  ): Record<string, unknown> {
    return {
      id: dataExport.id,
      status: dataExport.status,
      downloadUrl:
        rawToken === null
          ? null
          : `${this.config.getOrThrow<string>(
              "PUBLIC_BASE_URL",
            )}/v1/data-exports/${dataExport.id}/download?token=${encodeURIComponent(
              rawToken,
            )}`,
      sha256: dataExport.sha256,
      expiresAt: dataExport.expiresAt?.toISOString() ?? null,
      createdAt: dataExport.createdAt.toISOString(),
      completedAt: dataExport.completedAt?.toISOString() ?? null,
    };
  }
}
