from functools import lru_cache
from pathlib import Path

from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    app_env: str = "development"
    database_url: str = "sqlite:///./energopulse.db"
    storage_root: Path = Path("./data")

    model_config = SettingsConfigDict(
        env_file=".env",
        env_prefix="ENERGOPULSE_",
        extra="ignore",
    )


@lru_cache
def get_settings() -> Settings:
    return Settings()
