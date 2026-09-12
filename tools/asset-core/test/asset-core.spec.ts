import assert from "node:assert/strict";
import { test } from "node:test";

import {
  assertAspectRatioMatchesViewBox,
  inspectImage,
  inspectPng,
  renderRaster,
  sanitizeSvg,
  sha256,
  svgAspectRatio,
  svgIntrinsicRatio,
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

void test("PNG bytes are recognized and measured, other bytes are not", () => {
  const png = renderRaster(sanitizeSvg(FLAG), 2).png;
  const inspected = inspectPng(png);
  assert.equal(inspected.mimeType, "image/png");
  assert.equal(inspected.heightPx, 240);
  assert.equal(inspected.widthPx, 360);
  assert.equal(inspected.aspectRatio, 1.5);
  assert.throws(
    () => inspectPng(Buffer.from("GIF89a and then some")),
    UnsafeAssetError,
  );
});

void test("image inspection trusts bytes, never the claimed type", () => {
  const png = renderRaster(sanitizeSvg(FLAG), 2).png;
  assert.equal(inspectImage(png).mimeType, "image/png");

  const svg = inspectImage(Buffer.from(FLAG, "utf8"));
  assert.equal(svg.mimeType, "image/svg+xml");
  assert.equal(svg.aspectRatio, 1.5);
  assert.ok(svg.svg?.startsWith("<svg"));

  // A hostile drawing renamed to look like a flag is still refused.
  assert.throws(
    () =>
      inspectImage(Buffer.from('<svg onload="steal()"><rect/></svg>', "utf8")),
    UnsafeAssetError,
  );
  assert.throws(
    () => inspectImage(Buffer.from("just text", "utf8")),
    UnsafeAssetError,
  );
});

void test("a drawing declares its shape with width and height too", () => {
  // Twenty-seven of the forty-nine U.S. state flags on Wikimedia carry no
  // viewBox and all but three carry these, so reading only the viewBox
  // refused more than half of them for proportions stated one attribute over.
  const svg =
    '<svg xmlns="http://www.w3.org/2000/svg" width="640" height="480"><rect/></svg>';

  assert.equal(svgViewBoxRatio(svg), null);
  assert.equal(svgIntrinsicRatio(svg), 640 / 480);
  assert.equal(svgAspectRatio(svg), 640 / 480);
});

void test("the viewBox wins when a drawing carries both", () => {
  // It is the box aspect-fit fits to, and a drawing can disagree with itself.
  const svg =
    '<svg xmlns="http://www.w3.org/2000/svg" width="100" height="100" viewBox="0 0 3 2"><rect/></svg>';

  assert.equal(svgAspectRatio(svg), 1.5);
});

void test("absolute units are converted rather than cancelled", () => {
  // `width="10cm" height="200"` is legal, and the unit only cancels when both
  // sides carry the same one.
  const svg =
    '<svg xmlns="http://www.w3.org/2000/svg" width="1in" height="96"><rect/></svg>';

  assert.equal(svgIntrinsicRatio(svg), 1);
});

void test("a share of a viewport is not a proportion", () => {
  for (const attributes of [
    'width="100%" height="50%"',
    'width="100%" height="480"',
    'width="640" height="auto"',
    'width="0" height="480"',
    'width="-3" height="2"',
  ]) {
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" ${attributes}><rect/></svg>`;
    assert.equal(svgIntrinsicRatio(svg), null, attributes);
  }
});

void test("a drawing that declares nothing still declares nothing", () => {
  const svg = '<svg xmlns="http://www.w3.org/2000/svg"><rect/></svg>';

  assert.equal(svgAspectRatio(svg), null);
  assert.equal(inspectImage(Buffer.from(svg, "utf8")).aspectRatio, null);
});

void test("an inspected drawing reports the shape it declares either way", () => {
  const svg =
    '<svg xmlns="http://www.w3.org/2000/svg" width="640" height="480"><rect/></svg>';
  const inspection = inspectImage(Buffer.from(svg, "utf8"));

  assert.equal(inspection.aspectRatio, 640 / 480);
  // Pixel counts stay a raster fact: a minimum-height rule keyed off them has
  // never applied to vector uploads, and filling them here would start
  // refusing drawings for a reason nobody changed.
  assert.equal(inspection.widthPx, null);
  assert.equal(inspection.heightPx, null);
});

void test("the metadata ratio is checked against whichever shape is declared", () => {
  const svg =
    '<svg xmlns="http://www.w3.org/2000/svg" width="640" height="480"><rect/></svg>';

  assert.throws(
    () => {
      assertAspectRatioMatchesViewBox(svg, 1.5, "a state flag");
    },
    (error: unknown) => error instanceof UnsafeAssetError,
  );
  assertAspectRatioMatchesViewBox(svg, 640 / 480, "a state flag");
});

void test("an XML declaration is a prolog, not a reason to refuse", () => {
  // Four of the forty-nine U.S. state flags on Wikimedia open with one, and
  // every one of them was refused for it.
  const svg =
    '<?xml version="1.0" encoding="UTF-8"?>\n<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 3 2"><rect/></svg>';
  const clean = sanitizeSvg(svg);

  assert.ok(clean.startsWith("<svg"));
  assert.equal(svgAspectRatio(clean), 1.5);
});

void test('standalone="no" is not an event handler', () => {
  // `on[a-z]+=` finds the `one=` in `standalone=`. Two state flags were
  // refused as unsafe for declaring their encoding.
  const svg =
    '<?xml version="1.0" encoding="UTF-8" standalone="no"?>\n<svg xmlns="http://www.w3.org/2000/svg" width="750" height="450"><rect/></svg>';
  const clean = sanitizeSvg(svg);

  assert.equal(svgAspectRatio(clean), 750 / 450);
});

void test("the prolog buys nothing past the rules it was hiding behind", () => {
  // What the prolog must not become is a way in. Each of these carries one
  // and is still refused for what follows it.
  const refused = [
    '<?xml version="1.0"?><svg onload="steal()"><rect/></svg>',
    '<?xml version="1.0"?><svg><script>steal()</script></svg>',
    '<?xml version="1.0"?><!DOCTYPE svg><svg><rect/></svg>',
    '<?xml version="1.0"?><svg><image href="https://example.test/a.png"/></svg>',
    '<?xml version="1.0"?><html><body/></html>',
  ];
  for (const svg of refused) {
    assert.throws(
      () => sanitizeSvg(svg),
      (error: unknown) => error instanceof UnsafeAssetError,
      svg,
    );
  }
});

void test("a marker's own box is not the drawing's", () => {
  // Nebraska defines two arrowhead markers, each `viewBox="0 0 10 10"`, and
  // carries its own shape in width and height. Reading the first viewBox in
  // the file called a 5:3 flag square.
  const svg =
    '<svg xmlns="http://www.w3.org/2000/svg" width="750" height="450">' +
    '<defs><marker viewBox="0 0 10 10"><path/></marker></defs><rect/></svg>';

  assert.equal(svgViewBoxRatio(svg), null);
  assert.equal(svgAspectRatio(svg), 750 / 450);
});
