import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { stableJson } from "./stable-json";

describe("stableJson", () => {
  it("reproduces the committed editorial catalog byte for byte", () => {
    // The committed catalog is written by the pipeline's stable-json, so
    // parsing and re-serializing it through this copy must be the identity.
    // If this test fails, the two implementations have diverged and the
    // draft export would stop matching the file in git.
    const catalogPath = resolve(
      __dirname,
      "../../../../tools/content-pipeline/editorial/catalog.json",
    );
    const source = readFileSync(catalogPath, "utf8");
    expect(stableJson(JSON.parse(source))).toBe(source);
  });

  it("sorts keys recursively and keeps array order", () => {
    expect(stableJson({ b: [{ z: 1, a: 2 }], a: 1 })).toBe(
      `${JSON.stringify({ a: 1, b: [{ a: 2, z: 1 }] }, null, 2)}\n`,
    );
  });
});
