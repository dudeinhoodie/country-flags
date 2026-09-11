// Rasterises the app icon from its one drawing.
//
// The icon is drawn once, as design/app-icon/AppIcon.svg, and the asset
// catalogue carries pixels rendered from it rather than a PNG somebody
// exported by hand: the drawing is the source, the catalogue is derived, and
// --check fails when the committed pixels drift from the drawing (#300). The
// drawing lives outside the app folder on purpose: that folder is the
// target's, synchronised whole, and a source kept in it ships as a resource.
//
// Three sets come out of it. The App Store build gets the icon as drawn; the
// Dev and Mock builds get the same icon with a corner cut in a colour of their
// own, so three builds on one phone are told apart at a glance. A cut rather
// than a word: the renderer loads no fonts, and text would render
// differently on every machine that checks these bytes.
//
// The PNG is written here rather than taken from the renderer, because the
// renderer writes RGBA and App Store Connect refuses a marketing icon with an
// alpha channel (ITMS-90717), opaque or not. Writing a PNG is small: one
// filter byte per row and a zlib stream. The check compares decoded pixels
// rather than file bytes, so a zlib that packs the same rows differently
// after a Node upgrade does not read as a stale icon.
//
//   node ios/Scripts/render-app-icon.mjs           render the three sets
//   node ios/Scripts/render-app-icon.mjs --check   fail when they are stale (CI)
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { deflateSync, inflateSync } from "node:zlib";

import { Resvg } from "@resvg/resvg-js";

import { repositoryRoot, stableJson } from "./lib/content-release.mjs";

const SIZE = 1024;
const source = join(repositoryRoot, "design/app-icon/AppIcon.svg");
const catalogue = join(repositoryRoot, "ios/CountryFlagsApp/Assets.xcassets");

/// One set per configuration. The name is what `ASSETCATALOG_COMPILER_APPICON_NAME`
/// resolves to: `AppIcon` plus the configuration's `CF_APPICON_SUFFIX`.
const SETS = [
  { name: "AppIcon", badge: null },
  // Amber for the build that talks to dev, magenta for the one that talks to
  // nobody: neither is a colour the icon itself uses, so the cut reads as a
  // label rather than as part of the drawing.
  { name: "AppIcon-Dev", badge: "#F5A623" },
  { name: "AppIcon-Mock", badge: "#D63384" },
];

/// A triangle across the bottom-right corner, drawn into the SVG before it is
/// rasterised so it takes the same rounding as everything else.
function withBadge(svg, colour) {
  if (colour === null) return svg;
  const badge =
    `<path d="M ${SIZE} ${SIZE - 300} L ${SIZE} ${SIZE} L ${SIZE - 300} ${SIZE} Z" ` +
    `fill="${colour}"/>` +
    `<path d="M ${SIZE} ${SIZE - 300} L ${SIZE} ${SIZE - 260} L ${SIZE - 260} ${SIZE} L ${SIZE - 300} ${SIZE} Z" ` +
    `fill="#FFFFFF" fill-opacity="0.35"/>`;
  return svg.replace("</svg>", `${badge}</svg>`);
}

/// The drawing as opaque RGB rows, alpha dropped.
function rasterize(svg) {
  const rendered = new Resvg(svg, {
    fitTo: { mode: "width", value: SIZE },
    // Opaque: iOS applies its own mask to the icon and the store refuses one
    // with an alpha channel, so nothing may be left for alpha to say.
    background: "#080B18",
    // Deterministic output: the check mode re-renders and compares pixels,
    // so nothing machine-local may leak into them. The drawing has no text.
    font: { loadSystemFonts: false },
  }).render();
  const { width, height, pixels } = rendered;
  const rgb = Buffer.alloc(width * height * 3);
  for (let i = 0, o = 0; i < pixels.length; i += 4, o += 3) {
    rgb[o] = pixels[i];
    rgb[o + 1] = pixels[i + 1];
    rgb[o + 2] = pixels[i + 2];
  }
  return { width, height, rgb };
}

// --- A PNG writer and reader for exactly the file this script produces:
// 8-bit RGB, no interlace, filter type 0 on every row.

const PNG_SIGNATURE = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
const CRC_TABLE = new Uint32Array(256).map((_, n) => {
  let c = n;
  for (let k = 0; k < 8; k += 1) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c >>> 0;
});

function crc32(bytes) {
  let c = 0xffffffff;
  for (const byte of bytes) c = CRC_TABLE[(c ^ byte) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function chunk(type, data) {
  const length = Buffer.alloc(4);
  length.writeUInt32BE(data.length);
  const typed = Buffer.concat([Buffer.from(type, "ascii"), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(typed));
  return Buffer.concat([length, typed, crc]);
}

function encodePng({ width, height, rgb }) {
  const header = Buffer.alloc(13);
  header.writeUInt32BE(width, 0);
  header.writeUInt32BE(height, 4);
  header[8] = 8; // bit depth
  header[9] = 2; // colour type: truecolour, no alpha
  header[10] = 0; // compression
  header[11] = 0; // filter method
  header[12] = 0; // no interlace
  const stride = width * 3;
  const filtered = Buffer.alloc((stride + 1) * height);
  for (let row = 0; row < height; row += 1) {
    filtered[row * (stride + 1)] = 0;
    rgb.copy(filtered, row * (stride + 1) + 1, row * stride, (row + 1) * stride);
  }
  return Buffer.concat([
    PNG_SIGNATURE,
    chunk("IHDR", header),
    chunk("IDAT", deflateSync(filtered, { level: 9 })),
    chunk("IEND", Buffer.alloc(0)),
  ]);
}

/// The rows of a PNG this script wrote, or null for anything else — a file
/// with alpha, a different filter, a different size — which the check then
/// reports as stale rather than trying to understand.
function decodePng(file) {
  if (file === null || !file.subarray(0, 8).equals(PNG_SIGNATURE)) return null;
  let offset = 8;
  let width = 0;
  let height = 0;
  const idat = [];
  while (offset + 8 <= file.length) {
    const length = file.readUInt32BE(offset);
    const type = file.toString("ascii", offset + 4, offset + 8);
    const data = file.subarray(offset + 8, offset + 8 + length);
    if (type === "IHDR") {
      width = data.readUInt32BE(0);
      height = data.readUInt32BE(4);
      if (data[8] !== 8 || data[9] !== 2 || data[12] !== 0) return null;
    } else if (type === "IDAT") {
      idat.push(data);
    }
    offset += 12 + length;
  }
  if (width === 0 || idat.length === 0) return null;
  const filtered = inflateSync(Buffer.concat(idat));
  const stride = width * 3;
  const rgb = Buffer.alloc(stride * height);
  for (let row = 0; row < height; row += 1) {
    if (filtered[row * (stride + 1)] !== 0) return null;
    filtered.copy(rgb, row * stride, row * (stride + 1) + 1, (row + 1) * (stride + 1));
  }
  return { width, height, rgb };
}

function contents(fileName) {
  return stableJson({
    images: [
      {
        filename: fileName,
        idiom: "universal",
        platform: "ios",
        size: "1024x1024",
      },
    ],
    info: { author: "xcode", version: 1 },
  });
}

const checkOnly = process.argv.includes("--check");
const drawing = await readFile(source, "utf8");
const stale = [];

for (const set of SETS) {
  const directory = join(catalogue, `${set.name}.appiconset`);
  const fileName = `${set.name}.png`;
  const image = rasterize(withBadge(drawing, set.badge));
  const manifest = Buffer.from(contents(fileName), "utf8");

  if (checkOnly) {
    const committed = decodePng(await readFile(join(directory, fileName)).catch(() => null));
    if (
      committed === null ||
      committed.width !== image.width ||
      committed.height !== image.height ||
      !committed.rgb.equals(image.rgb)
    ) {
      stale.push(join(`${set.name}.appiconset`, fileName));
    }
    const current = await readFile(join(directory, "Contents.json")).catch(() => null);
    if (current === null || !current.equals(manifest)) {
      stale.push(join(`${set.name}.appiconset`, "Contents.json"));
    }
    continue;
  }

  await mkdir(directory, { recursive: true });
  await writeFile(join(directory, fileName), encodePng(image));
  await writeFile(join(directory, "Contents.json"), manifest);
  console.log(`${set.name}: ${image.width}×${image.height}, RGB`);
}

if (checkOnly && stale.length > 0) {
  console.error(
    `The app icon is stale; run \`node ios/Scripts/render-app-icon.mjs\`:\n  ${stale.join("\n  ")}`,
  );
  process.exitCode = 1;
}
