import assert from "node:assert/strict";
import { test } from "node:test";

import {
  assertAspectRatioMatchesViewBox,
  renderRaster,
  sanitizeSvg,
  sha256,
  svgViewBoxRatio,
  UnsafeAssetError,
} from "../src/index.js";

const FLAG =
  '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 3 2">\n  <rect width="3" height="2" fill="#009C3B"/>\n</svg>';

void test("sanitizer rejects anything that could execute or reach out", () => {
  const rejected = [
    '<svg onload="steal()"><rect/></svg>',
    "<svg><script>steal()</script></svg>",
    '<svg><image href="https://example.test/a.png"/></svg>',
    '<svg><rect style="fill:url(https://example.test/a)"/></svg>',
    "<!DOCTYPE svg><svg><rect/></svg>",
    "<svg><foreignObject><div/></foreignObject></svg>",
    "<html><body/></html>",
  ];
  for (const svg of rejected) {
    assert.throws(() => sanitizeSvg(svg), UnsafeAssetError, svg);
  }
});

void test("sanitizer normalizes safe drawings deterministically", () => {
  const once = sanitizeSvg(FLAG);
  assert.equal(once, sanitizeSvg(FLAG));
  assert.ok(!once.includes("\n  <rect"));
  assert.ok(once.endsWith("\n"));
  assert.equal(sanitizeSvg(`${FLAG}\n<!-- a note -->`).includes("note"), false);
});

void test("viewBox ratio is read, and mismatches are refused", () => {
  assert.equal(svgViewBoxRatio(FLAG), 1.5);
  assert.equal(svgViewBoxRatio('<svg xmlns="x"><rect/></svg>'), null);
  assert.doesNotThrow(() =>
    assertAspectRatioMatchesViewBox(FLAG, 1.5, "the flag"),
  );
  assert.throws(
    () => assertAspectRatioMatchesViewBox(FLAG, 2, "the flag"),
    UnsafeAssetError,
  );
  assert.throws(
    () => assertAspectRatioMatchesViewBox(FLAG, 0, "the flag"),
    UnsafeAssetError,
  );
});

void test("raster rendering is deterministic and scales by height", () => {
  const svg = sanitizeSvg(FLAG);
  const first = renderRaster(svg, 2);
  const second = renderRaster(svg, 2);
  assert.equal(sha256(first.png), sha256(second.png));
  assert.equal(first.heightPx, 240);
  assert.equal(renderRaster(svg, 3).heightPx, 360);
});

void test("sha256 hashes both text and bytes", () => {
  assert.equal(sha256("a"), sha256(Buffer.from("a")));
  assert.match(sha256("a"), /^[0-9a-f]{64}$/);
});
