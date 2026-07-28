import json
from datetime import date, timedelta
from functools import lru_cache
from urllib.parse import urlencode
from urllib.request import Request, urlopen


DAILY_FIELDS = (
    "weather_code",
    "temperature_2m_mean",
    "temperature_2m_min",
    "temperature_2m_max",
    "precipitation_sum",
    "wind_speed_10m_max",
)


def _daterange(start: date, end: date):
    current = start
    while current <= end:
        yield current
        current += timedelta(days=1)


@lru_cache(maxsize=32)
def _fetch_daily(
    endpoint: str,
    latitude: float,
    longitude: float,
    start_date: str,
    end_date: str,
    timezone: str,
) -> dict[str, dict[str, object]]:
    params = {
        "latitude": latitude,
        "longitude": longitude,
        "daily": ",".join(DAILY_FIELDS),
        "timezone": timezone,
        "start_date": start_date,
        "end_date": end_date,
    }
    request = Request(
        f"{endpoint}?{urlencode(params)}",
        headers={"User-Agent": "EnergoPulse/0.1 energy-forecast"},
    )
    with urlopen(request, timeout=12) as response:
        payload = json.load(response)

    daily = payload.get("daily") or {}
    times = daily.get("time") or []
    result: dict[str, dict[str, object]] = {}
    for index, day in enumerate(times):
        result[str(day)] = {
            field: (daily.get(field) or [None] * len(times))[index]
            for field in DAILY_FIELDS
        }
    return result


@lru_cache(maxsize=16)
def _fetch_model_run(
    latitude: float,
    longitude: float,
    run: str,
) -> dict[str, dict[str, object]]:
    params = {
        "latitude": latitude,
        "longitude": longitude,
        "daily": ",".join(DAILY_FIELDS),
        "timezone": "UTC",
        "forecast_days": 16,
        "run": run,
        "models": "ecmwf_ifs",
    }
    request = Request(
        f"https://single-runs-api.open-meteo.com/v1/forecast?{urlencode(params)}",
        headers={"User-Agent": "EnergoPulse/0.1 energy-forecast"},
    )
    with urlopen(request, timeout=12) as response:
        payload = json.load(response)
    daily = payload.get("daily") or {}
    times = daily.get("time") or []
    return {
        str(day): {
            field: (daily.get(field) or [None] * len(times))[index]
            for field in DAILY_FIELDS
        }
        for index, day in enumerate(times)
    }


def _merge_weather(
    target: dict[str, dict[str, object]],
    source: dict[str, dict[str, object]],
    source_name: str,
) -> None:
    for day, values in source.items():
        target[day] = {**values, "source": source_name}


def _month_normals(history: dict[str, dict[str, object]]) -> dict[int, dict[str, float]]:
    monthly: dict[int, list[dict[str, object]]] = {}
    for day, values in history.items():
        monthly.setdefault(date.fromisoformat(day).month, []).append(values)

    result: dict[int, dict[str, float]] = {}
    for month, rows in monthly.items():
        temperatures = [
            float(row["temperature_2m_mean"])
            for row in rows
            if row.get("temperature_2m_mean") is not None
        ]
        if not temperatures:
            continue
        average = sum(temperatures) / len(temperatures)
        variance = sum((value - average) ** 2 for value in temperatures) / max(1, len(temperatures) - 1)
        result[month] = {
            "temperature_mean": average,
            "temperature_stdev": variance**0.5,
        }
    return result


def _classify_anomaly(values: dict[str, object], normal: dict[str, float] | None) -> tuple[bool, str | None]:
    mean_temp = values.get("temperature_2m_mean")
    min_temp = values.get("temperature_2m_min")
    max_temp = values.get("temperature_2m_max")
    precipitation = float(values.get("precipitation_sum") or 0)
    wind = float(values.get("wind_speed_10m_max") or 0)

    if max_temp is not None and float(max_temp) >= 38:
        return True, "Экстремальная жара"
    if min_temp is not None and float(min_temp) <= -30:
        return True, "Экстремальный мороз"
    if precipitation >= 12:
        return True, "Сильные осадки"
    if wind >= 45:
        return True, "Сильный ветер"
    if mean_temp is not None and normal:
        stdev = max(2.5, float(normal.get("temperature_stdev") or 0))
        anomaly = float(mean_temp) - float(normal["temperature_mean"])
        if abs(anomaly) >= max(6.0, 1.7 * stdev):
            return True, "Аномально тепло" if anomaly > 0 else "Аномально холодно"
    return False, None


def load_weather_context(
    history_start: date,
    history_end: date,
    forecast_start: date,
    forecast_end: date,
    *,
    latitude: float,
    longitude: float,
    timezone: str,
    location_name: str,
) -> dict[str, object]:
    climate_start = history_start.replace(year=max(1940, history_start.year - 2))
    archive_endpoint = "https://archive-api.open-meteo.com/v1/archive"
    live_endpoint = "https://api.open-meteo.com/v1/forecast"
    seasonal_endpoint = "https://seasonal-api.open-meteo.com/v1/seasonal"
    today = date.today()

    try:
        history = _fetch_daily(
            archive_endpoint,
            latitude,
            longitude,
            climate_start.isoformat(),
            history_end.isoformat(),
            timezone,
        )
        forecast: dict[str, dict[str, object]] = {}

        if forecast_start < today:
            historical_run = _fetch_model_run(
                latitude,
                longitude,
                f"{history_end.isoformat()}T00:00",
            )
            _merge_weather(
                forecast,
                {
                    day: values
                    for day, values in historical_run.items()
                    if forecast_start.isoformat() <= day <= forecast_end.isoformat()
                },
                f"ECMWF IFS 9 км · прогон {history_end.isoformat()}",
            )

        live_start = max(forecast_start, today)
        live_end = min(forecast_end, today + timedelta(days=15))
        if live_start <= live_end:
            _merge_weather(
                forecast,
                _fetch_daily(
                    live_endpoint,
                    latitude,
                    longitude,
                    live_start.isoformat(),
                    live_end.isoformat(),
                    timezone,
                ),
                "Open-Meteo Best Match",
            )

        seasonal_start = max(forecast_start, today + timedelta(days=16))
        if seasonal_start <= forecast_end:
            _merge_weather(
                forecast,
                _fetch_daily(
                    seasonal_endpoint,
                    latitude,
                    longitude,
                    seasonal_start.isoformat(),
                    forecast_end.isoformat(),
                    timezone,
                ),
                "ECMWF EC46 / SEAS5",
            )

        normals = _month_normals(history)
        for day, values in history.items():
            normal = normals.get(date.fromisoformat(day).month)
            is_anomaly, label = _classify_anomaly(values, normal)
            values["source"] = "ERA5 / исторические условия"
            values["is_anomaly"] = is_anomaly
            values["anomaly_label"] = label
            values["temperature_normal"] = normal["temperature_mean"] if normal else None

        for current in _daterange(forecast_start, forecast_end):
            key = current.isoformat()
            normal = normals.get(current.month)
            if key not in forecast and normal:
                forecast[key] = {
                    "weather_code": 3,
                    "temperature_2m_mean": normal["temperature_mean"],
                    "temperature_2m_min": None,
                    "temperature_2m_max": None,
                    "precipitation_sum": 0,
                    "wind_speed_10m_max": 0,
                    "source": "Климатическая норма ERA5",
                }
            if key in forecast:
                if forecast[key].get("temperature_2m_mean") is None and normal:
                    forecast[key]["temperature_2m_mean"] = normal["temperature_mean"]
                    forecast[key]["source"] = "Климатическая норма ERA5"
                if forecast[key].get("weather_code") is None:
                    precipitation = float(forecast[key].get("precipitation_sum") or 0)
                    minimum = forecast[key].get("temperature_2m_min")
                    if precipitation > 0 and minimum is not None and float(minimum) <= 0:
                        forecast[key]["weather_code"] = 71
                    elif precipitation >= 10:
                        forecast[key]["weather_code"] = 65
                    elif precipitation >= 1:
                        forecast[key]["weather_code"] = 61
                    else:
                        forecast[key]["weather_code"] = 1
                is_anomaly, label = _classify_anomaly(forecast[key], normal)
                forecast[key]["is_anomaly"] = is_anomaly
                forecast[key]["anomaly_label"] = label
                forecast[key]["temperature_normal"] = normal["temperature_mean"] if normal else None

        return {
            "status": "ready",
            "provider": "Open-Meteo",
            "location": {
                "name": location_name,
                "latitude": latitude,
                "longitude": longitude,
                "timezone": timezone,
            },
            "history": history,
            "forecast": forecast,
            "normals": normals,
        }
    except (OSError, ValueError, KeyError, json.JSONDecodeError):
        return {
            "status": "unavailable",
            "provider": "Open-Meteo",
            "message": "Погодный источник временно недоступен.",
            "history": {},
            "forecast": {},
            "normals": {},
            "location": {
                "name": location_name,
                "latitude": latitude,
                "longitude": longitude,
                "timezone": timezone,
            },
        }
