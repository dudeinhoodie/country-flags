#!/usr/bin/env python3
"""Builds the country-outline index the details map draws from.

Boundaries come from Natural Earth (public domain), matched to the bundled
flag set by the asset slug — the same identifier the flags are keyed by,
which is what makes the match survive a localised display name. Coordinates
are rounded to three decimals (~100 m).

    curl -sL -o /tmp/ne10.geojson \
      https://raw.githubusercontent.com/nvkelso/natural-earth-vector/master/geojson/ne_10m_admin_0_countries.geojson
    curl -sL -o /tmp/ne10units.geojson \
      https://raw.githubusercontent.com/nvkelso/natural-earth-vector/master/geojson/ne_10m_admin_0_map_units.geojson
    curl -sL -o /tmp/ne10subunits.geojson \
      https://raw.githubusercontent.com/nvkelso/natural-earth-vector/master/geojson/ne_10m_admin_0_map_subunits.geojson
    python3 ios/Scripts/generate-country-boundaries.py \
      /tmp/ne10.geojson /tmp/ne10units.geojson /tmp/ne10subunits.geojson

Every country comes from the finest scale Natural Earth publishes, 1:10m —
the coarse sets cut corners and drifted small coasts by whole degrees. The
map-units and map-subunits sets fill in the territories the country set
merges into their sovereign — the French overseas departments, Tokelau,
Svalbard, the Caribbean Netherlands. Size is held not by a coarser source
but by Douglas–Peucker simplification with a tolerance tied to each ring's
own span: a continent keeps ~5 km fidelity, an islet ~200 m — everything far
finer than the coarse scales were, at a fraction of the raw weight.

Every country carries two geometries, because MapKit's fill and stroke have
different limits and one closed ring cannot serve both:

- ``coast``: the real coastlines, drawn as lines. An artificial edge — a
  clip chord, an antimeridian seam — never enters a coast, by construction.
- ``fill``: closed polygons for the tint, clipped to web-Mercator's latitude
  range and split into longitude bands when wider than a hemisphere — MapKit
  refuses a polygon closed across the whole world's width. The split seams
  are invisible: the fill is never stroked.

For every country but Antarctica the two are the same rings. The output is
committed; rerun only when the flag set or the source changes.
"""

import json
import pathlib
import re
import sys
import unicodedata

REPOSITORY = pathlib.Path(__file__).resolve().parents[2]
CATALOG = REPOSITORY / "ios/CountryFlagsKit/Sources/CountryFlagsFeatures/Resources/Flags.xcassets"
OUTPUT = REPOSITORY / "ios/CountryFlagsKit/Sources/CountryFlagsFeatures/Resources/CountryBoundaries.json"

# Slugs whose Natural Earth name differs beyond slugification.
ALIASES = {
    "cote-d-ivoire": "ivory-coast",
    "democratic-republic-of-the-congo": "democratic-republic-of-the-congo",
    "congo": "republic-of-the-congo",
    "united-republic-of-tanzania": "united-republic-of-tanzania",
    "czechia": "czech-republic",
    "eswatini": "eswatini",
    "north-macedonia": "north-macedonia",
    "timor-leste": "east-timor",
    "cabo-verde": "cape-verde",
    "holy-see": "vatican",
    "state-of-palestine": "palestine",
    "brunei-darussalam": "brunei",
    "viet-nam": "vietnam",
    "lao-people-s-democratic-republic": "laos",
    "syrian-arab-republic": "syria",
    "russian-federation": "russia",
    "republic-of-korea": "south-korea",
    "democratic-people-s-republic-of-korea": "north-korea",
    "iran-islamic-republic-of": "iran",
    "bolivia-plurinational-state-of": "bolivia",
    "venezuela-bolivarian-republic-of": "venezuela",
    "republic-of-moldova": "moldova",
    "united-kingdom-of-great-britain-and-northern-ireland": "united-kingdom",
    "united_states": "united-states-of-america",
    "turkiye": "turkey",
    "netherlands-kingdom-of-the": "netherlands",
    "micronesia-federated-states-of": "federated-states-of-micronesia",
    "china-hong-kong-special-administrative-region": "hong-kong",
    "china-macao-special-administrative-region": "macao",
    "pitcairn": "pitcairn-islands",
    "french-southern-territories": "french-southern-and-antarctic-lands",
    "saint-martin-french-part": "saint-martin",
    "sint-maarten-dutch-part": "sint-maarten",
    "cocos-keeling-islands": "cocos-islands",
    # The flag covers both; the outline is the main landmass alone.
    "svalbard-and-jan-mayen-islands": "svalbard-islands",
    # Only the map-subunits set knows the Caribbean Netherlands as one thing.
    "bonaire-sint-eustatius-and-saba": "caribbean-netherlands",
}

# Web Mercator ends at ±85.051°; nothing past it can be drawn.
MERCATOR_LIMIT = 85.0
EPSILON = 1e-9


def slugify(name: str) -> str:
    folded = unicodedata.normalize("NFKD", name).encode("ascii", "ignore").decode()
    return re.sub(r"-+", "-", re.sub(r"[^a-z0-9]+", "-", folded.lower())).strip("-")


def clip(ring: list, keeps, cross) -> list:
    """One Sutherland–Hodgman pass against a half-plane."""
    clipped = []
    for index in range(len(ring)):
        first = ring[index]
        second = ring[(index + 1) % len(ring)]
        if keeps(first):
            clipped.append(first)
        if keeps(first) != keeps(second):
            clipped.append(cross(first, second))
    return clipped if len(clipped) >= 3 else []


def clip_latitude(ring: list, floor: float, ceiling: float) -> list:
    def cross_at(level):
        def cross(first, second):
            t = (level - first[1]) / (second[1] - first[1])
            return [round(first[0] + (second[0] - first[0]) * t, 3), level]

        return cross

    lowered = clip(ring, lambda p: p[1] >= floor - EPSILON, cross_at(floor))
    if not lowered:
        return []
    return clip(lowered, lambda p: p[1] <= ceiling + EPSILON, cross_at(ceiling))


def clip_longitude(ring: list, low: float, high: float) -> list:
    def cross_at(level):
        def cross(first, second):
            t = (level - first[0]) / (second[0] - first[0])
            return [level, round(first[1] + (second[1] - first[1]) * t, 3)]

        return cross

    left = clip(ring, lambda p: p[0] >= low - EPSILON, cross_at(low))
    if not left:
        return []
    return clip(left, lambda p: p[0] <= high + EPSILON, cross_at(high))


def simplify(ring: list, tolerance: float) -> list:
    """Douglas–Peucker, iterative. Endpoints always survive."""
    if tolerance <= 0 or len(ring) <= 4:
        return ring
    keep = [False] * len(ring)
    keep[0] = keep[-1] = True
    stack = [(0, len(ring) - 1)]
    while stack:
        start, end = stack.pop()
        if end - start < 2:
            continue
        ax, ay = ring[start]
        bx, by = ring[end]
        dx, dy = bx - ax, by - ay
        norm = (dx * dx + dy * dy) ** 0.5
        far, at = -1.0, None
        for index in range(start + 1, end):
            px, py = ring[index]
            if norm < 1e-12:
                distance = ((px - ax) ** 2 + (py - ay) ** 2) ** 0.5
            else:
                distance = abs(dx * (ay - py) - (ax - px) * dy) / norm
            if distance > far:
                far, at = distance, index
        if far > tolerance:
            keep[at] = True
            stack.append((start, at))
            stack.append((at, end))
    return [point for point, kept in zip(ring, keep) if kept]


def ring_span(ring: list) -> float:
    lons = [point[0] for point in ring]
    lats = [point[1] for point in ring]
    return max(max(lons) - min(lons), max(lats) - min(lats))


def ring_tolerance(ring: list) -> float:
    """Finer for the small, coarser for the vast — metres to ~12 km.

    The floor prunes dense mid-size coasts, but must never exceed a fraction
    of the ring's own size: a flat 0.003° floor simplified the Vatican out
    of existence.
    """
    span = ring_span(ring)
    return min(max(span / 600, min(0.003, span / 8)), 0.12)


def longitude_span(ring: list) -> float:
    lons = [point[0] for point in ring]
    return max(lons) - min(lons)


def fill_polygons(ring: list) -> list:
    """The ring as MapKit-drawable fill: banded when wider than a hemisphere."""
    if longitude_span(ring) <= 170:
        return [ring]
    bands = [(-180, -90), (-90, 0), (0, 90), (90, 180)]
    return [
        banded for low, high in bands if (banded := clip_longitude(ring, low, high))
    ]


def coastline(ring: list, was_clipped: bool, floor: float) -> list:
    """The ring's real coast: opened where the clip chord replaced the pole.

    The clip closes the ring along the floor; those points and the seam run
    they join are chart-making, not coast. Dropping them leaves one open run
    of genuine shoreline — the map draws an open ring as a line, so nothing
    artificial is ever stroked.
    """
    if not was_clipped:
        return ring
    total = len(ring)
    on_floor = [
        index for index, point in enumerate(ring) if point[1] <= floor + 1e-6
    ]
    if not on_floor:
        return ring
    boundary = next(
        index for index in on_floor if ring[(index + 1) % total][1] > floor + 1e-6
    )
    rotated = [ring[(boundary + 1 + offset) % total] for offset in range(total)]
    return [point for point in rotated if point[1] > floor + 1e-6]


def rings(geometry) -> list:
    """Outer rings only, rounded. Holes are invisible at outline width."""
    polygons = (
        [geometry["coordinates"]] if geometry["type"] == "Polygon" else geometry["coordinates"]
    )
    return [
        [[round(lon, 3), round(lat, 3)] for lon, lat in polygon[0]]
        for polygon in polygons
    ]


def name_index(source) -> dict:
    by_name = {}
    for feature in source["features"]:
        properties = feature["properties"]
        for key in ("ADMIN", "NAME", "NAME_LONG", "NAME_EN", "BRK_NAME"):
            name = properties.get(key)
            if name:
                by_name.setdefault(slugify(name), feature)
    return by_name


def validate(slug: str, shape: dict) -> None:
    """The classes of failure MapKit taught us, checked before they ship."""
    assert shape["fill"], f"{slug}: no fill survived the pipeline"
    assert shape["coast"], f"{slug}: no coast survived the pipeline"
    for ring in shape["fill"]:
        assert len(ring) >= 3, f"{slug}: degenerate fill ring"
        assert longitude_span(ring) <= 180 + EPSILON, f"{slug}: fill wider than a hemisphere"
        for _, lat in ring:
            assert abs(lat) <= MERCATOR_LIMIT + EPSILON, f"{slug}: fill outside Mercator"
    for line in shape["coast"]:
        assert len(line) >= 2, f"{slug}: degenerate coast"
        for _, lat in line:
            assert abs(lat) <= MERCATOR_LIMIT + EPSILON, f"{slug}: coast outside Mercator"


def main() -> None:
    slugs = sorted(
        entry.name.removeprefix("flag-").removesuffix(".imageset")
        for entry in CATALOG.iterdir()
        if entry.name.endswith(".imageset")
    )

    # The base scale first, the finer ones only where the base has nothing.
    sources = [name_index(json.load(open(path))) for path in sys.argv[1:]]

    index = {}
    unmatched = []
    filled = []
    for slug in slugs:
        feature = None
        for tier, by_name in enumerate(sources):
            feature = by_name.get(slug) or by_name.get(slugify(ALIASES.get(slug, "")))
            if feature is not None:
                if tier > 0:
                    filled.append(slug)
                break
        if feature is None:
            unmatched.append(slug)
            continue
        shape = rings(feature["geometry"])
        # The 1:10m source names every islet a large country owns, and the
        # thousands of them are what the outline does not need: a ring far
        # smaller than the country reads as noise at the map's framing. A
        # small country keeps everything it has.
        largest = max(ring_span(ring) for ring in shape)
        shape = [
            ring for ring in shape if ring_span(ring) >= min(0.12, largest / 15)
        ]
        # However fractal the archipelago, the outline is a sketch: the
        # largest landmasses carry the answer, the long tail carries bytes.
        shape = sorted(shape, key=ring_span, reverse=True)[:80]

        fill = []
        coast = []
        for ring in shape:
            ring = simplify(ring, ring_tolerance(ring))
            if len(ring) < 3:
                continue
            clipped = clip_latitude(ring, -MERCATOR_LIMIT, MERCATOR_LIMIT)
            if not clipped:
                continue
            was_clipped = any(point[1] <= -MERCATOR_LIMIT + 1e-6 for point in clipped)
            fill.extend(fill_polygons(clipped))
            line = coastline(clipped, was_clipped, -MERCATOR_LIMIT)
            if len(line) >= 2:
                coast.append(line)
        entry = {"fill": fill, "coast": coast}
        validate(slug, entry)
        # For every country but Antarctica the coast IS the fill; writing it
        # twice doubled the bundled file for nothing. An absent coast means
        # "stroke the fill rings", which the app reads as the default.
        if coast == fill:
            del entry["coast"]
        index[slug] = entry

    OUTPUT.write_text(json.dumps(index, separators=(",", ":")) + "\n")
    print(f"matched {len(index)} of {len(slugs)} flags -> {OUTPUT.name}")
    if filled:
        print(f"filled from the finer scale ({len(filled)}):", ", ".join(filled))
    if unmatched:
        print("no boundary (drawn without an outline):", ", ".join(unmatched))


if __name__ == "__main__":
    main()
