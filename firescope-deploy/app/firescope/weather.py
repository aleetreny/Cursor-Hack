"""Historical weather at the burn site: ERA5 reanalysis via Open-Meteo archive (free, no key). Run: python -m firescope.weather"""
from __future__ import annotations

import json

import httpx

from .common import OUT
from .config import POSE

VARS = "temperature_2m,relative_humidity_2m,wind_speed_10m,wind_direction_10m,wind_gusts_10m,soil_moisture_0_to_7cm,vapour_pressure_deficit"


def fetch(date: str = "2019-03-01") -> dict:
    url = (f"https://archive-api.open-meteo.com/v1/archive?latitude={POSE.lat}&longitude={POSE.lon}&start_date={date}&end_date={date}"
           f"&hourly={VARS}&wind_speed_unit=kmh&timezone=GMT")
    d = httpx.get(url, timeout=30).json()
    h = d["hourly"]
    rows = [{"timestamp": t + ":00Z", "temp_c": h["temperature_2m"][i], "rh_pct": h["relative_humidity_2m"][i], "wind_kmh": h["wind_speed_10m"][i],
             "wind_dir_deg": h["wind_direction_10m"][i], "gust_kmh": h["wind_gusts_10m"][i], "soil_moisture_m3m3": h["soil_moisture_0_to_7cm"][i],
             "vpd_kpa": h["vapour_pressure_deficit"][i]} for i, t in enumerate(h["time"])]
    out = {"source": "ERA5 reanalysis via Open-Meteo archive API", "grid": "~25 km cell, hourly", "provenance": "external",
           "elevation_m": d.get("elevation"), "location": [POSE.lon, POSE.lat], "hourly": rows}
    (OUT / "weather.json").write_text(json.dumps(out))
    return out


if __name__ == "__main__":
    print(len(fetch()["hourly"]), "hours")
