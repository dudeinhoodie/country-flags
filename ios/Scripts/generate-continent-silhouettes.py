#!/usr/bin/env python3
"""Builds the continent silhouettes the repeat queue decorates its rows with.

The shapes come from the same Natural Earth 1:110m set the country outlines
do, grouped by the source's own CONTINENT attribute and keyed by the region
deck codes the catalog publishes. Two decimals (~1 km) is far finer than a
40-point icon can show.

    curl -sL -o /tmp/ne110.geojson \
      https://raw.githubusercontent.com/nvkelso/natural-earth-vector/master/geojson/ne_110m_admin_0_countries.geojson
    python3 ios/Scripts/generate-continent-silhouettes.py /tmp/ne110.geojson

Editorial choices, made for legibility at icon size rather than for
geography, all visible here and nowhere else:

- Europe is drawn without Russia: a silhouette that runs to the Bering
  Strait is ten times wider than tall and reads as a smear, not a place.
  Russia's landmass joins the Asia silhouette instead, where it belongs
  visually. The decks themselves are untouched — this is decoration.
- Each continent clips to a generous box, which is what keeps French
  Guiana out of the Europe icon: Natural Earth draws it as part of the
  France feature. Rings are kept or dropped whole by their centroid;
  nothing is cut mid-shape.

The output is committed; rerun only when the source changes.
"""

import json
import pathlib
import sys

REPOSITORY = pathlib.Path(__file__).resolve().parents[2]
OUTPUT = (
    REPOSITORY
    / "ios/CountryFlagsKit/Sources/CountryFlagsFeatures/Resources/ContinentSilhouettes.json"
)

# Deck code -> (continents, (min lon, max lon, min lat, max lat)).
REGIONS = {
    "EUROPE": ({"Europe"}, (-25, 45, 34, 72)),
    "AFRICA": ({"Africa"}, (-20, 52, -36, 38)),
    "AMERICAS": ({"North America", "South America"}, (-170, -30, -56, 84)),
    "ASIA": ({"Asia"}, (25, 180, -12, 78)),
    "OCEANIA": ({"Oceania"}, (110, 180, -50, 0)),
}

# Features drawn under a different region than their attribute says.
REASSIGNED = {"Russia": "ASIA"}


def exterior_rings(geometry):
    if geometry["type"] == "Polygon":
        return [geometry["coordinates"][0]]
    if geometry["type"] == "MultiPolygon":
        return [polygon[0] for polygon in geometry["coordinates"]]
    return []


def rounded(ring):
    seen = []
    for lon, lat in ring:
        point = [round(lon, 2), round(lat, 2)]
        if not seen or seen[-1] != point:
            seen.append(point)
    return seen


def centroid(ring):
    lons = [point[0] for point in ring]
    lats = [point[1] for point in ring]
    return sum(lons) / len(lons), sum(lats) / len(lats)


def main() -> None:
    if len(sys.argv) != 2:
        raise SystemExit(__doc__)
    source = json.loads(pathlib.Path(sys.argv[1]).read_text())

    silhouettes = {code: [] for code in REGIONS}
    for feature in source["features"]:
        name = feature["properties"].get("NAME_EN") or feature["properties"].get("NAME")
        continent = feature["properties"].get("CONTINENT")
        code = REASSIGNED.get(name)
        if code is None:
            code = next(
                (key for key, (members, _) in REGIONS.items() if continent in members),
                None,
            )
        if code is None:
            continue
        _, (min_lon, max_lon, min_lat, max_lat) = REGIONS[code]
        for ring in exterior_rings(feature["geometry"]):
            cleaned = rounded(ring)
            if len(cleaned) < 4:
                continue
            lon, lat = centroid(cleaned)
            if min_lon <= lon <= max_lon and min_lat <= lat <= max_lat:
                silhouettes[code].append(cleaned)

    for code, rings in silhouettes.items():
        if not rings:
            raise SystemExit(f"{code} matched no landmass; the source changed shape")

    OUTPUT.write_text(json.dumps(silhouettes, separators=(",", ":")) + "\n")
    total = sum(len(rings) for rings in silhouettes.values())
    print(f"Wrote {total} rings for {len(silhouettes)} regions to {OUTPUT.name}")


if __name__ == "__main__":
    main()
