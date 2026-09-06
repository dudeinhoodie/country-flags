import { readReleaseMetadata } from "./release-metadata";

describe("readReleaseMetadata", () => {
  const hosted = {
    NODE_ENV: "production",
    DEPLOYMENT_ENV: "dev",
    SERVICE_NAME: "country-flags-api",
    SERVICE_RELEASE: "c7d7c42abc5b5d0364735beaa89ecec0e85a3d51",
  };

  it("carries what a release SHA has to be found by", () => {
    expect(
      readReleaseMetadata({
        ...hosted,
        K_REVISION: "api-dev-00127-nmd",
        MIGRATION_VERSION: "20260901120000_add_entitlements",
      }),
    ).toEqual({
      service: "country-flags-api",
      environment: "dev",
      release: "c7d7c42abc5b5d0364735beaa89ecec0e85a3d51",
      deploymentId: "api-dev-00127-nmd",
      migrationVersion: "20260901120000_add_entitlements",
    });
  });

  it("keeps two deployments of one release build apart", () => {
    const dev = readReleaseMetadata({ ...hosted, K_REVISION: "api-dev-00127" });
    const prod = readReleaseMetadata({
      ...hosted,
      DEPLOYMENT_ENV: "prod",
      K_REVISION: "api-prod-00014",
    });

    expect(dev.release).toBe(prod.release);
    expect(dev.environment).not.toBe(prod.environment);
    expect(dev.deploymentId).not.toBe(prod.deploymentId);
  });

  it("omits what the platform did not supply rather than inventing it", () => {
    const metadata = readReleaseMetadata({ NODE_ENV: "development" });

    expect(metadata).toEqual({
      service: "country-flags-api",
      environment: "local",
      release: "dev",
    });
    expect("deploymentId" in metadata).toBe(false);
    expect("migrationVersion" in metadata).toBe(false);
  });

  it("prefers an explicit deployment id over the platform's own", () => {
    expect(
      readReleaseMetadata({
        ...hosted,
        DEPLOYMENT_ID: "manual-rollback-1",
        K_REVISION: "api-dev-00127-nmd",
      }).deploymentId,
    ).toBe("manual-rollback-1");
  });

  it("treats blank values as absent, so an unset variable cannot become a label", () => {
    const metadata = readReleaseMetadata({
      ...hosted,
      SERVICE_NAME: "   ",
      K_REVISION: "",
      MIGRATION_VERSION: "  ",
    });

    expect(metadata.service).toBe("country-flags-api");
    expect("deploymentId" in metadata).toBe(false);
    expect("migrationVersion" in metadata).toBe(false);
  });
});
