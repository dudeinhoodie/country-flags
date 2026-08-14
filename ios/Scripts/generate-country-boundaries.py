#!/usr/bin/env python3
"""Builds the country-outline index the details map draws from.

Boundaries come from Natural Earth (1:110m, public domain), matched to the
bundled flag set by the asset slug — the same identifier the flags themselves
are keyed by, which is what makes the match survive a localised display name.
Coordinates are rounded to three decimals (~100 m), which is finer than the
1:110m source itself.

    curl -sL -o /tmp/ne110.geojson \
      https://raw.githubusercontent.com/nvkelso/natural-earth-vector/master/geojson/ne_110m_admin_0_countries.geojson
    curl -sL -o /tmp/ne50.geojson \
      https://raw.githubusercontent.com/nvkelso/natural-earth-vector/master/geojson/ne_50m_admin_0_countries.geojson
    python3 ios/Scripts/generate-country-boundaries.py /tmp/ne110.geojson /tmp/ne50.geojson

The 1:110m set is the base — coarse and small. The optional 1:50m set fills
in only the countries 1:110m does not carry at all: Barbados, Malta, the
microstates. Their landmasses are tiny, so the finer scale adds little
weight while adding most of the missing map.

The output is committed; rerun only when the flag set or the source changes.
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
}


def slugify(name: str) -> str:
    folded = unicodedata.normalize("NFKD", name).encode("ascii", "ignore").decode()
    return re.sub(r"-+", "-", re.sub(r"[^a-z0-9]+", "-", folded.lower())).strip("-")


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


def main() -> None:
    slugs = sorted(
        entry.name.removeprefix("flag-").removesuffix(".imageset")
        for entry in CATALOG.iterdir()
        if entry.name.endswith(".imageset")
    )

    # The base scale first, the finer one only where the base has nothing:
    # the coarse outlines stay light, the missing islands arrive.
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
        index[slug] = rings(feature["geometry"])

    OUTPUT.write_text(json.dumps(index, separators=(",", ":")) + "\n")
    print(f"matched {len(index)} of {len(slugs)} flags -> {OUTPUT.name}")
    if filled:
        print(f"filled from the finer scale ({len(filled)}):", ", ".join(filled))
    if unmatched:
        print("no boundary (drawn without an outline):", ", ".join(unmatched))


if __name__ == "__main__":
    main()
