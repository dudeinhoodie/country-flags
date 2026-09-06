import { JsonLoggerService } from "./json-logger.service";

/**
 * The logger reads its deployment fields when it is constructed, so each case
 * builds one under the environment it wants to describe and collects the lines
 * that environment produced.
 */
function loggerUnder(
  environment: NodeJS.ProcessEnv,
  write: (logger: JsonLoggerService) => void,
): Array<Record<string, unknown>> {
  const restore = { ...process.env };
  Object.assign(process.env, environment);
  const written: string[] = [];
  const capture = (chunk: unknown): boolean => {
    written.push(String(chunk));
    return true;
  };
  const stdout = jest
    .spyOn(process.stdout, "write")
    .mockImplementation(capture);
  const stderr = jest
    .spyOn(process.stderr, "write")
    .mockImplementation(capture);

  try {
    write(new JsonLoggerService());
  } finally {
    stdout.mockRestore();
    stderr.mockRestore();
    for (const key of Object.keys(environment)) {
      delete process.env[key];
    }
    Object.assign(process.env, restore);
  }

  return written.map((line) => JSON.parse(line) as Record<string, unknown>);
}

describe("JsonLoggerService", () => {
  it("stamps every line with the deployment a release SHA is searched by", () => {
    const [entry] = loggerUnder(
      {
        NODE_ENV: "production",
        DEPLOYMENT_ENV: "dev",
        SERVICE_NAME: "country-flags-api",
        SERVICE_RELEASE: "c7d7c42abc5b5d0364735beaa89ecec0e85a3d51",
        K_REVISION: "api-dev-00127-nmd",
        MIGRATION_VERSION: "20260901120000_add_entitlements",
      },
      (logger) => {
        logger.log({ message: "started", event: "application_started" });
      },
    );

    expect(entry).toMatchObject({
      service: "country-flags-api",
      environment: "dev",
      release: "c7d7c42abc5b5d0364735beaa89ecec0e85a3d51",
      deploymentId: "api-dev-00127-nmd",
      migrationVersion: "20260901120000_add_entitlements",
      event: "application_started",
    });
  });

  it("labels prod and dev differently on the same release build", () => {
    const shared = {
      NODE_ENV: "production",
      SERVICE_RELEASE: "c7d7c42abc5b5d0364735beaa89ecec0e85a3d51",
    };
    const emit = (logger: JsonLoggerService): void => {
      logger.warn({ message: "slow" });
    };

    const [dev] = loggerUnder({ ...shared, DEPLOYMENT_ENV: "dev" }, emit);
    const [prod] = loggerUnder({ ...shared, DEPLOYMENT_ENV: "prod" }, emit);

    expect(dev).toMatchObject({ environment: "dev" });
    expect(prod).toMatchObject({ environment: "prod" });
    expect(dev?.release).toBe(prod?.release);
  });

  it("omits deployment fields the platform never supplied", () => {
    const [entry] = loggerUnder({ NODE_ENV: "development" }, (logger) => {
      logger.log({ message: "started" });
    });

    expect(entry).toMatchObject({ environment: "local", release: "dev" });
    expect(entry !== undefined && "deploymentId" in entry).toBe(false);
    expect(entry !== undefined && "migrationVersion" in entry).toBe(false);
  });

  it("still redacts a secret smuggled in beside the deployment fields", () => {
    const [entry] = loggerUnder(
      {
        NODE_ENV: "production",
        DEPLOYMENT_ENV: "dev",
        SERVICE_RELEASE: "c7d7c42",
      },
      (logger) => {
        logger.error({
          message: "provider refused",
          event: "auth_failed",
          email: "someone@example.com",
          accessToken: "aaaaaaaaaaaa.bbbbbbbbbbbb.cccccccccccc",
        });
      },
    );

    expect(entry).toMatchObject({
      email: "[REDACTED]",
      accessToken: "[REDACTED]",
      release: "c7d7c42",
    });
  });
});
