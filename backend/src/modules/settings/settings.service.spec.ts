import { HttpStatus } from "@nestjs/common";
import { Prisma } from "@prisma/client";

import { ApiException } from "../../common/http/api.exception";
import type { PrismaService } from "../../infrastructure/database/prisma.service";
import { SettingsService } from "./settings.service";

const USER_ID = "80000000-0000-4000-8000-000000000001";

function writeConflict(): Prisma.PrismaClientKnownRequestError {
  return new Prisma.PrismaClientKnownRequestError(
    "Transaction failed due to a write conflict or a deadlock. Please retry your transaction",
    { code: "P2034", clientVersion: "test" },
  );
}

describe("SettingsService.update", () => {
  const userSettings = {
    upsert: jest.fn(),
    updateMany: jest.fn(),
    findUniqueOrThrow: jest.fn(),
  };
  const auditEvent = { create: jest.fn() };
  const transaction = { userSettings, auditEvent };
  let attempts = 0;
  const database = {
    // The first attempt loses to the other device's save, the way Postgres
    // aborts one side of a serializable conflict; the second one runs.
    $transaction: jest.fn(
      async (run: (client: typeof transaction) => Promise<unknown>) => {
        attempts += 1;
        if (attempts === 1) throw writeConflict();
        return run(transaction);
      },
    ),
  } as unknown as PrismaService;
  const service = new SettingsService(database);

  beforeEach(() => {
    jest.clearAllMocks();
    attempts = 0;
    userSettings.upsert.mockResolvedValue({});
  });

  it("tries a save that lost a write conflict again and answers the version conflict", async () => {
    // By the second attempt the other device has committed version 2.
    userSettings.updateMany.mockResolvedValue({ count: 0 });
    userSettings.findUniqueOrThrow.mockResolvedValue({ version: 2 });

    const thrown = await service
      .update(USER_ID, 1, { sessionSize: 20 }, "request-1")
      .catch((error: unknown) => error);

    expect(attempts).toBe(2);
    expect(thrown).toBeInstanceOf(ApiException);
    const failure = thrown as ApiException;
    expect(failure.getStatus()).toBe(HttpStatus.CONFLICT);
    expect(failure.getResponse()).toMatchObject({
      error: {
        code: "SETTINGS_VERSION_CONFLICT",
        details: { currentVersion: 2 },
      },
    });
    expect(auditEvent.create).not.toHaveBeenCalled();
  });

  it("saves on the second attempt when nothing else moved the version", async () => {
    const saved = { userId: USER_ID, version: 2 };
    userSettings.updateMany.mockResolvedValue({ count: 1 });
    userSettings.findUniqueOrThrow.mockResolvedValue(saved);

    await expect(
      service.update(USER_ID, 1, { sessionSize: 20 }, "request-1"),
    ).resolves.toBe(saved);
    expect(attempts).toBe(2);
    expect(auditEvent.create).toHaveBeenCalledTimes(1);
  });
});
