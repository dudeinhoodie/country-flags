// Canonical serialization of the editorial catalog: keys sorted by UTF-16
// code units, two-space indent, trailing newline. JSONB storage does not
// preserve key order, so canonical ordering is what makes "import → export"
// the identity function, and code-unit comparison (unlike the pipeline
// stable-json's localeCompare) does not depend on the ICU data of the Node
// runtime — the committed catalog.json is in exactly this order, and the
// parity spec pins that. ADM-008's shared core is where the two
// serializers get unified.

function compareCodeUnits(left: string, right: string): number {
  if (left < right) {
    return -1;
  }
  return left > right ? 1 : 0;
}

function canonicalize(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map(canonicalize);
  }
  if (value !== null && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value)
        .sort(([left], [right]) => compareCodeUnits(left, right))
        .map(([key, child]) => [key, canonicalize(child)]),
    );
  }
  return value;
}

export function stableJson(value: unknown): string {
  return `${JSON.stringify(canonicalize(value), null, 2)}\n`;
}
