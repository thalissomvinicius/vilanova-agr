"""Derive operational street centerlines from the official parcel gaps.

The parcel shapefile does not contain a street layer. This script identifies
nearby, substantially parallel parcel edges and builds the centerline of the
gap between each valid pair. Output coordinates are WGS84 GeoJSON.
"""

from __future__ import annotations

import json
import math
import statistics
from itertools import combinations
from pathlib import Path

from pyproj import Transformer
from shapely.geometry import LineString, MultiLineString, shape, mapping
from shapely.ops import nearest_points, transform


ROOT = Path(__file__).resolve().parents[1]
PARCELS_PATH = ROOT / "src" / "data" / "farm-parcels.json"
OUTPUT_PATH = ROOT / "src" / "data" / "interparcel-streets.json"

FARMS = {"vila-nova", "fe-em-deus"}
MAX_GAP_METERS = 42.0
MIN_PARALLEL_EDGE_METERS = 55.0
MIN_STREET_LENGTH_METERS = 45.0
SAMPLE_INTERVAL_METERS = 12.0

TO_UTM = Transformer.from_crs("EPSG:4326", "EPSG:31982", always_xy=True)
TO_WGS84 = Transformer.from_crs("EPSG:31982", "EPSG:4326", always_xy=True)


def line_parts(geometry):
    if geometry.is_empty:
        return []
    if isinstance(geometry, LineString):
        return [geometry]
    if isinstance(geometry, MultiLineString):
        return list(geometry.geoms)
    if hasattr(geometry, "geoms"):
        return [
            part
            for child in geometry.geoms
            for part in line_parts(child)
        ]
    return []


def normalized_label(value: str) -> str:
    return "".join(character.lower() for character in value if character.isalnum())


def midpoint(first, second):
    return (
        (first.x + second.x) / 2,
        (first.y + second.y) / 2,
    )


def derive_centerline(reference_edge, neighbor_boundary):
    sample_count = max(2, math.ceil(reference_edge.length / SAMPLE_INTERVAL_METERS))
    points = []
    gaps = []

    for index in range(sample_count + 1):
        distance = reference_edge.length * index / sample_count
        first = reference_edge.interpolate(distance)
        second = nearest_points(first, neighbor_boundary)[1]
        gap = first.distance(second)
        if gap <= MAX_GAP_METERS:
            points.append(midpoint(first, second))
            gaps.append(gap)

    if len(points) < 2:
        return None

    line = LineString(points).simplify(1.5, preserve_topology=True)
    if line.length < MIN_STREET_LENGTH_METERS:
        return None

    return line, gaps


def main():
    parcel_geojson = json.loads(PARCELS_PATH.read_text(encoding="utf-8"))
    parcels = []

    for feature in parcel_geojson["features"]:
        properties = feature["properties"]
        farm_id = properties.get("farmId")
        if farm_id not in FARMS:
            continue

        parcel_label = str(properties.get("ID_PARCELA") or properties.get("parcelId"))
        parcel_geometry = transform(TO_UTM.transform, shape(feature["geometry"]).buffer(0))
        parcels.append({
            "farmId": farm_id,
            "farmName": properties.get("farmName"),
            "label": parcel_label,
            "geometry": parcel_geometry,
        })

    features = []

    for first, second in combinations(parcels, 2):
        if first["farmId"] != second["farmId"]:
            continue

        first_geometry = first["geometry"]
        second_geometry = second["geometry"]
        if first_geometry.distance(second_geometry) > MAX_GAP_METERS:
            continue

        nearby_first_edges = line_parts(
            first_geometry.boundary.intersection(
                second_geometry.boundary.buffer(MAX_GAP_METERS, cap_style="flat"),
            ),
        )
        nearby_second_edges = line_parts(
            second_geometry.boundary.intersection(
                first_geometry.boundary.buffer(MAX_GAP_METERS, cap_style="flat"),
            ),
        )
        if not nearby_first_edges or not nearby_second_edges:
            continue

        reference_edge = max(nearby_first_edges, key=lambda line: line.length)
        neighbor_edge = max(nearby_second_edges, key=lambda line: line.length)
        if min(reference_edge.length, neighbor_edge.length) < MIN_PARALLEL_EDGE_METERS:
            continue

        derived = derive_centerline(reference_edge, second_geometry.boundary)
        if not derived:
            continue

        centerline, gaps = derived
        label_a, label_b = sorted(
            [first["label"], second["label"]],
            key=lambda label: normalized_label(label),
        )
        street_id = (
            f"{first['farmId']}-"
            f"{normalized_label(label_a)}-{normalized_label(label_b)}"
        )
        centerline_wgs84 = transform(TO_WGS84.transform, centerline)

        features.append({
            "type": "Feature",
            "id": street_id,
            "properties": {
                "streetId": street_id,
                "streetName": f"Rua {label_a} / {label_b}",
                "farmId": first["farmId"],
                "farmName": first["farmName"],
                "parcelA": label_a,
                "parcelB": label_b,
                "lengthMeters": round(centerline.length, 1),
                "estimatedGapMeters": round(statistics.median(gaps), 1),
                "source": "derived-from-official-parcel-gaps",
            },
            "geometry": mapping(centerline_wgs84),
        })

    features.sort(key=lambda feature: (
        feature["properties"]["farmId"],
        normalized_label(feature["properties"]["parcelA"]),
        normalized_label(feature["properties"]["parcelB"]),
    ))

    payload = {
        "type": "FeatureCollection",
        "metadata": {
            "description": "Operational streets derived from gaps between official parcels.",
            "maxGapMeters": MAX_GAP_METERS,
            "minimumParallelEdgeMeters": MIN_PARALLEL_EDGE_METERS,
            "featureCount": len(features),
        },
        "features": features,
    }
    OUTPUT_PATH.write_text(
        json.dumps(payload, ensure_ascii=False, separators=(",", ":")),
        encoding="utf-8",
    )

    by_farm = {
        farm_id: sum(1 for feature in features if feature["properties"]["farmId"] == farm_id)
        for farm_id in sorted(FARMS)
    }
    print(f"Generated {len(features)} interparcel streets: {by_farm}")


if __name__ == "__main__":
    main()
