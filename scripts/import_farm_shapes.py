"""Converte os shapefiles oficiais das fazendas VNA para GeoJSON do dashboard."""

from __future__ import annotations

import argparse
import json
import re
import unicodedata
import warnings
from pathlib import Path
from typing import Any

import shapefile
from pyproj import Transformer


FARM_IDS = {
    "FE EM DEUS": "fe-em-deus",
    "NOVA CONCEICAO": "nova-conceicao",
    "VILA NOVA": "vila-nova",
}


def normalize_text(value: Any) -> str:
    text = unicodedata.normalize("NFD", str(value or ""))
    return "".join(character for character in text if unicodedata.category(character) != "Mn").strip().upper()


def slugify(value: Any) -> str:
    normalized = normalize_text(value).lower()
    return re.sub(r"[^a-z0-9]+", "-", normalized).strip("-")


def repair_dbf_value(value: Any) -> Any:
    if not isinstance(value, str):
        return value
    try:
        return value.encode("cp1252").decode("utf-8")
    except (UnicodeEncodeError, UnicodeDecodeError):
        return value


def farm_id(value: Any) -> str:
    normalized = normalize_text(value)
    if normalized not in FARM_IDS:
        raise ValueError(f"Fazenda não reconhecida: {value!r}")
    return FARM_IDS[normalized]


def rounded_coordinates(value: Any, transformer: Transformer | None = None) -> Any:
    if isinstance(value, (list, tuple)) and len(value) >= 2 and all(
        isinstance(item, (int, float)) for item in value[:2]
    ):
        longitude, latitude = value[:2]
        if transformer:
            longitude, latitude = transformer.transform(longitude, latitude)
        return [round(float(longitude), 7), round(float(latitude), 7)]
    if isinstance(value, (list, tuple)):
        return [rounded_coordinates(item, transformer) for item in value]
    return value


def shape_geometry(shape: shapefile.Shape, transformer: Transformer | None = None) -> dict[str, Any]:
    geometry = dict(shape.__geo_interface__)
    return {
        "type": geometry["type"],
        "coordinates": rounded_coordinates(geometry["coordinates"], transformer),
    }


def read_shapefile(path: Path) -> shapefile.Reader:
    # Os arquivos informam UTF-8 no .cpg, porém os registros do DBF estão em Windows-1252.
    with warnings.catch_warnings():
        warnings.simplefilter("ignore")
        return shapefile.Reader(str(path), encoding="cp1252")


def build_parcels(source_dir: Path) -> dict[str, Any]:
    reader = read_shapefile(source_dir / "Parcelas WGS84.shp")
    features: list[dict[str, Any]] = []

    for shape_record in reader.iterShapeRecords():
        record = {
            key: repair_dbf_value(value)
            for key, value in shape_record.record.as_dict().items()
        }
        current_farm_id = farm_id(record["FAZENDA"])
        parcel_label = str(record["ID_PARCELA"]).strip()
        properties = {
            "farmId": current_farm_id,
            "farmName": str(record["FAZENDA"]).strip().title(),
            "parcelId": f"{current_farm_id}-{slugify(parcel_label)}",
            "sourceDataset": "Parcelas WGS84.shp",
            **record,
        }
        features.append(
            {
                "type": "Feature",
                "id": properties["parcelId"],
                "properties": properties,
                "geometry": shape_geometry(shape_record.shape),
            }
        )

    return {
        "type": "FeatureCollection",
        "name": "farm-parcels",
        "crs": {"type": "name", "properties": {"name": "EPSG:4326"}},
        "features": features,
    }


def build_boundaries(source_dir: Path) -> dict[str, Any]:
    reader = read_shapefile(source_dir / "Fazendas WGS84.shp")
    transformer = Transformer.from_crs("EPSG:31982", "EPSG:4326", always_xy=True)
    features: list[dict[str, Any]] = []

    for shape_record in reader.iterShapeRecords():
        record = {
            key: repair_dbf_value(value)
            for key, value in shape_record.record.as_dict().items()
        }
        current_farm_id = farm_id(record["NOME"])
        properties = {
            "farmId": current_farm_id,
            "farmName": str(record["NOME"]).strip().title(),
            "farmCode": str(record["ID"]).strip(),
            "hectares": float(record["HECTARES"]),
            "sourceDataset": "Fazendas WGS84.shp",
            **record,
        }
        features.append(
            {
                "type": "Feature",
                "id": current_farm_id,
                "properties": properties,
                "geometry": shape_geometry(shape_record.shape, transformer),
            }
        )

    return {
        "type": "FeatureCollection",
        "name": "farm-boundaries",
        "crs": {"type": "name", "properties": {"name": "EPSG:4326"}},
        "features": features,
    }


def validate(parcels: dict[str, Any], boundaries: dict[str, Any]) -> None:
    parcel_counts: dict[str, int] = {}
    for feature in parcels["features"]:
        current_farm_id = feature["properties"]["farmId"]
        parcel_counts[current_farm_id] = parcel_counts.get(current_farm_id, 0) + 1

    expected_counts = {"vila-nova": 83, "fe-em-deus": 35, "nova-conceicao": 54}
    if parcel_counts != expected_counts:
        raise ValueError(f"Contagem de parcelas inesperada: {parcel_counts}")

    boundary_ids = {feature["properties"]["farmId"] for feature in boundaries["features"]}
    if boundary_ids != set(expected_counts):
        raise ValueError(f"Limites de fazenda inesperados: {sorted(boundary_ids)}")


def write_geojson(path: Path, content: dict[str, Any]) -> None:
    path.write_text(
        json.dumps(content, ensure_ascii=False, separators=(",", ":")),
        encoding="utf-8",
    )


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--source-dir", required=True, type=Path)
    parser.add_argument("--output-dir", default=Path("src/data"), type=Path)
    args = parser.parse_args()

    parcels = build_parcels(args.source_dir)
    boundaries = build_boundaries(args.source_dir)
    validate(parcels, boundaries)

    args.output_dir.mkdir(parents=True, exist_ok=True)
    write_geojson(args.output_dir / "farm-parcels.json", parcels)
    write_geojson(args.output_dir / "farm-boundaries.json", boundaries)

    print("Importação concluída:")
    print(f"  Parcelas: {len(parcels['features'])}")
    print(f"  Fazendas: {len(boundaries['features'])}")


if __name__ == "__main__":
    main()
