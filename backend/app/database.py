import os

from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker, create_async_engine

DB_PATH = os.environ.get("SPREADDESK_DB", os.path.join(os.path.dirname(__file__), "..", "spreaddesk.db"))
DATABASE_URL = f"sqlite+aiosqlite:///{os.path.abspath(DB_PATH)}"

engine = create_async_engine(DATABASE_URL, echo=False)
SessionLocal = async_sessionmaker(engine, class_=AsyncSession, expire_on_commit=False)


async def init_db() -> None:
    from . import models

    async with engine.begin() as conn:
        await conn.run_sync(models.Base.metadata.create_all)


async def get_session():
    async with SessionLocal() as session:
        yield session
