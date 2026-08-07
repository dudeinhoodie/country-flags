import {
  defaultDeploymentEnvironment,
  isHostedDeploymentEnvironment,
  readDeploymentEnvironment,
} from "./deployment-environment";

describe("deployment environment", () => {
  describe("readDeploymentEnvironment", () => {
    it("uses an explicit value", () => {
      expect(readDeploymentEnvironment({ DEPLOYMENT_ENV: "prod" })).toBe(
        "prod",
      );
    });

    it("ignores surrounding whitespace", () => {
      expect(readDeploymentEnvironment({ DEPLOYMENT_ENV: " dev " })).toBe(
        "dev",
      );
    });

    it("derives local and ci from NODE_ENV", () => {
      expect(readDeploymentEnvironment({ NODE_ENV: "development" })).toBe(
        "local",
      );
      expect(readDeploymentEnvironment({ NODE_ENV: "test" })).toBe("ci");
    });

    it("labels an unusable production configuration as the most sensitive environment", () => {
      // validateEnvironment rejects both of these at startup; until it runs, logs
      // and telemetry must not understate which environment they came from.
      expect(readDeploymentEnvironment({ NODE_ENV: "production" })).toBe(
        "prod",
      );
      expect(
        readDeploymentEnvironment({
          NODE_ENV: "production",
          DEPLOYMENT_ENV: "staging",
        }),
      ).toBe("prod");
    });
  });

  describe("isHostedDeploymentEnvironment", () => {
    it("treats only dev and prod as hosted", () => {
      expect(isHostedDeploymentEnvironment("dev")).toBe(true);
      expect(isHostedDeploymentEnvironment("prod")).toBe(true);
      expect(isHostedDeploymentEnvironment("local")).toBe(false);
      expect(isHostedDeploymentEnvironment("ci")).toBe(false);
    });
  });

  describe("defaultDeploymentEnvironment", () => {
    it("offers no default for a production runtime", () => {
      expect(defaultDeploymentEnvironment("production")).toBeUndefined();
    });
  });
});
