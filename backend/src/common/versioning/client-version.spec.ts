import {
  compareClientVersions,
  formatClientVersion,
  isAtLeast,
  parseClientVersion,
} from "./client-version";

describe("parseClientVersion", () => {
  it("reads the three numbers a release is named by", () => {
    expect(parseClientVersion("1.4.2")).toEqual({
      major: 1,
      minor: 4,
      patch: 2,
    });
  });

  it("fills in the components a marketing version leaves out", () => {
    expect(parseClientVersion("2")).toEqual({ major: 2, minor: 0, patch: 0 });
    expect(parseClientVersion("2.1")).toEqual({ major: 2, minor: 1, patch: 0 });
  });

  it("reads the release a TestFlight build belongs to, suffix and all", () => {
    // A gate that ordered the suffix the way semantic versioning does would
    // shut out the builds sent to test the feature it guards.
    expect(parseClientVersion("1.4.0-beta.1")).toEqual(
      parseClientVersion("1.4.0"),
    );
    expect(parseClientVersion("0.1.0-test")).toEqual({
      major: 0,
      minor: 1,
      patch: 0,
    });
    expect(parseClientVersion("1.4.0+2026090401")).toEqual(
      parseClientVersion("1.4.0"),
    );
  });

  it("tolerates the whitespace a header may arrive with", () => {
    expect(parseClientVersion("  1.4.0 ")).toEqual(parseClientVersion("1.4.0"));
  });

  it("reads nothing out of what is not a version", () => {
    for (const value of [
      undefined,
      null,
      "",
      "   ",
      "v1.4.0",
      "1.4.0.1",
      "1..0",
      "latest",
      "1.4.0; drop table decks",
      "1234567890.0.0",
      `1.4.0-${"a".repeat(64)}`,
      "9".repeat(65),
    ]) {
      expect(parseClientVersion(value)).toBeNull();
    }
  });
});

describe("compareClientVersions", () => {
  const version = (raw: string): ReturnType<typeof parseClientVersion> =>
    parseClientVersion(raw);

  it("orders by major, then minor, then patch", () => {
    const ordered = ["0.9.9", "1.0.0", "1.0.10", "1.2.0", "2.0.0"];
    const shuffled = ["1.2.0", "1.0.10", "2.0.0", "0.9.9", "1.0.0"];

    expect(
      shuffled
        .map((raw) => version(raw)!)
        .sort(compareClientVersions)
        .map(formatClientVersion),
    ).toEqual(ordered);
  });

  it("counts the named release itself as new enough", () => {
    expect(isAtLeast(version("1.4.0")!, version("1.4.0")!)).toBe(true);
    expect(isAtLeast(version("1.4.1")!, version("1.4.0")!)).toBe(true);
    expect(isAtLeast(version("1.3.9")!, version("1.4.0")!)).toBe(false);
  });

  it("does not compare the components as text", () => {
    // "10" sorts before "9" as a string, and a gate that read it that way
    // would lock out every build after the ninth patch.
    expect(isAtLeast(version("1.0.10")!, version("1.0.9")!)).toBe(true);
  });
});
