from functools import lru_cache
from pathlib import Path

from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    app_env: str = "development"
    database_url: str = "sqlite:///./energopulse.db"
    storage_root: Path = Path("./data")
    cors_allow_origins: str = "http://localhost:5173,http://127.0.0.1:5173,http://localhost:4173,http://127.0.0.1:4173"
    forecast_location_name: str = "Жанажол, Актюбинская область"
    forecast_latitude: float = 48.13
    forecast_longitude: float = 57.43
    forecast_timezone: str = "Asia/Aqtobe"
    openai_api_key: str | None = None

    model_config = SettingsConfigDict(
        env_file=".env",
        env_prefix="ENERGOPULSE_",
        extra="ignore",
    )


@lru_cache
def get_settings() -> Settings:
    return Settings()
