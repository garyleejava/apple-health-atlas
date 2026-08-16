#!/usr/bin/env python3
"""Generate a small synthetic Apple Health export for tests and demos."""

from __future__ import annotations

import csv
import io
import math
import random
import zipfile
from datetime import datetime, timedelta, timezone
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
OUT = ROOT / "tests" / "fixtures" / "synthetic-health-export.zip"
START = datetime(2025, 6, 1, tzinfo=timezone.utc)
DAYS = 30
RNG = random.Random(20260601)


def iso(when: datetime) -> str:
    return when.astimezone(timezone.utc).strftime("%Y-%m-%d %H:%M:%S +0000")


def rows_for(kind: str, filename: str, columns: list[str]):
    rows = []
    for day in range(DAYS):
        date = START + timedelta(days=day)
        for hour in range(24):
            start = date + timedelta(hours=hour, minutes=RNG.randint(0, 59))
            end = start + timedelta(minutes=1)
            if kind == "StepCount":
                base = 180 + 14 * math.sin(hour / 24 * math.tau) + (day % 7) * 22
                value = round(max(1, RNG.gauss(base, 45)))
                rows.append(
                    [
                        "HKQuantityTypeIdentifierStepCount",
                        "Sample Watch",
                        "1.0",
                        "Watch1,1",
                        "",
                        iso(start),
                        iso(end),
                        "count",
                        value,
                    ]
                )
            elif kind == "ActiveEnergyBurned":
                value = round(max(0.01, RNG.gauss(3.2 + 0.12 * math.sin(hour / 24 * math.tau), 1.2)), 3)
                rows.append(
                    [
                        "HKQuantityTypeIdentifierActiveEnergyBurned",
                        "Sample Watch",
                        "1.0",
                        "Watch1,1",
                        "",
                        iso(start),
                        iso(end),
                        "kcal",
                        value,
                    ]
                )
            elif kind == "HeartRate":
                base = 66 + 12 * math.sin((hour - 5) / 24 * math.tau)
                value = round(max(45, min(140, RNG.gauss(base, 7))), 1)
                rows.append(
                    [
                        "HKQuantityTypeIdentifierHeartRate",
                        "Sample Watch",
                        "1.0",
                        "Watch1,1",
                        "",
                        iso(start),
                        iso(end),
                        "count/min",
                        value,
                    ]
                )
    return [columns, *rows]


def measurement_rows(metric: str, source: str, unit: str, values: list[float]):
    rows = [
        [
            f"HKQuantityTypeIdentifier{metric}",
            source,
            "1.0",
            "Sample Phone",
            "",
            iso(START + timedelta(days=index * 7, hours=8)),
            iso(START + timedelta(days=index * 7, hours=8)),
            unit,
            value,
        ]
        for index, value in enumerate(values)
    ]
    columns = [
        "type",
        "sourceName",
        "sourceVersion",
        "productType",
        "device",
        "startDate",
        "endDate",
        "unit",
        "value",
    ]
    return [columns, *rows]


def write_csv(zip_file: zipfile.ZipFile, name: str, rows: list[list]) -> None:
    buffer = io.StringIO(newline="")
    writer = csv.writer(buffer)
    writer.writerow(["sep=,"])
    for row in rows:
        writer.writerow(row)
    zip_file.writestr(name, buffer.getvalue().encode("utf-8"))


def sleep_rows():
    columns = [
        "type",
        "sourceName",
        "sourceVersion",
        "productType",
        "device",
        "startDate",
        "endDate",
        "value",
    ]
    rows = []
    for day in range(DAYS):
        bed = START + timedelta(days=day, hours=16, minutes=30)
        rows.append(
            [
                "HKCategoryTypeIdentifierSleepAnalysis",
                "Sample Watch",
                "1.0",
                "Watch1,1",
                "",
                iso(bed),
                iso(bed + timedelta(hours=8)),
                "inBed",
            ]
        )
        rows.append(
            [
                "HKCategoryTypeIdentifierSleepAnalysis",
                "Sample Watch",
                "1.0",
                "Watch1,1",
                "",
                iso(bed),
                iso(bed + timedelta(hours=7, minutes=45)),
                "asleep",
            ]
        )
        rows.append(
            [
                "HKCategoryTypeIdentifierSleepAnalysis",
                "Sample Watch",
                "1.0",
                "Watch1,1",
                "",
                iso(bed),
                iso(bed + timedelta(hours=5)),
                "asleepCore",
            ]
        )
        rows.append(
            [
                "HKCategoryTypeIdentifierSleepAnalysis",
                "Sample Watch",
                "1.0",
                "Watch1,1",
                "",
                iso(bed + timedelta(hours=5)),
                iso(bed + timedelta(hours=7, minutes=45)),
                "asleepREM",
            ]
        )
    return [columns, *rows]


def workout_rows():
    columns = [
        "type",
        "sourceName",
        "sourceVersion",
        "productType",
        "device",
        "startDate",
        "endDate",
        "activityType",
        "duration",
        "durationUnit",
        "totalEnergyBurned",
        "totalDistance",
    ]
    rows = []
    for index, day in enumerate([4, 8, 12, 16, 20, 24, 27]):
        start = START + timedelta(days=day, hours=10)
        rows.append(
            [
                "HKWorkoutTypeIdentifier",
                "Sample Watch",
                "1.0",
                "Watch1,1",
                "",
                iso(start),
                iso(start + timedelta(minutes=45 + index * 3)),
                "Badminton",
                2700 + index * 180,
                "sec",
                320 + index * 12,
                1800 + index * 90,
            ]
        )
    return [columns, *rows]


def main() -> None:
    OUT.parent.mkdir(parents=True, exist_ok=True)
    with zipfile.ZipFile(OUT, "w", zipfile.ZIP_DEFLATED) as zip_file:
        write_csv(
            zip_file,
            "HKQuantityTypeIdentifierStepCount_2025-01-01_00-00-00.csv",
            rows_for(
                "StepCount",
                "",
                [
                    "type",
                    "sourceName",
                    "sourceVersion",
                    "productType",
                    "device",
                    "startDate",
                    "endDate",
                    "unit",
                    "value",
                ],
            ),
        )
        write_csv(
            zip_file,
            "HKQuantityTypeIdentifierActiveEnergyBurned_2025-01-01_00-00-00.csv",
            rows_for(
                "ActiveEnergyBurned",
                "",
                [
                    "type",
                    "sourceName",
                    "sourceVersion",
                    "productType",
                    "device",
                    "startDate",
                    "endDate",
                    "unit",
                    "value",
                ],
            ),
        )
        write_csv(
            zip_file,
            "HKQuantityTypeIdentifierHeartRate_2025-01-01_00-00-00.csv",
            rows_for(
                "HeartRate",
                "",
                [
                    "type",
                    "sourceName",
                    "sourceVersion",
                    "productType",
                    "device",
                    "startDate",
                    "endDate",
                    "unit",
                    "value",
                ],
            ),
        )
        write_csv(
            zip_file,
            "HKQuantityTypeIdentifierRestingHeartRate_2025-01-01_00-00-00.csv",
            measurement_rows(
                "RestingHeartRate",
                "Sample Watch",
                "count/min",
                [61, 59, 58, 60, 57],
            ),
        )
        write_csv(
            zip_file,
            "HKQuantityTypeIdentifierHeartRateVariabilitySDNN_2025-01-01_00-00-00.csv",
            measurement_rows(
                "HeartRateVariabilitySDNN",
                "Sample Watch",
                "ms",
                [62, 68, 71, 75, 72],
            ),
        )
        write_csv(
            zip_file,
            "HKQuantityTypeIdentifierBodyMass_2025-01-01_00-00-00.csv",
            measurement_rows("BodyMass", "Sample Phone", "kg", [63.0, 63.2, 62.8, 63.4]),
        )
        write_csv(
            zip_file,
            "HKQuantityTypeIdentifierVO2Max_2025-01-01_00-00-00.csv",
            measurement_rows(
                "VO2Max",
                "Sample Watch",
                "mL/min·kg",
                [42.1, 43.0, 44.1, 45.0],
            ),
        )
        write_csv(
            zip_file,
            "HKQuantityTypeIdentifierWalkingSpeed_2025-01-01_00-00-00.csv",
            measurement_rows(
                "WalkingSpeed",
                "Sample Phone",
                "km/hr",
                [3.9, 4.0, 4.1, 4.05, 4.2],
            ),
        )
        write_csv(
            zip_file,
            "HKCategoryTypeIdentifierSleepAnalysis_2025-01-01_00-00-00.csv",
            sleep_rows(),
        )
        write_csv(
            zip_file,
            "HKWorkoutActivityTypeBadminton_2025-01-01_00-00-00.csv",
            workout_rows(),
        )
    print(OUT)


if __name__ == "__main__":
    main()
