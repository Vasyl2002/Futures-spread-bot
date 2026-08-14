import logging
import os
from contextlib import asynccontextmanager

from fastapi import FastAPI, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse, JSONResponse
from fastapi.staticfiles import StaticFiles

from . import auth
from .api import router
from .database import init_db
from .exchange_manager import manager
from .scanner import scanner
from .settings_store import load_settings
from .spread_engine import engine
from .telegram_bot import notifier

logging.basicConfig(level=logging.INFO, format="%(asctime)s %(name)s %(levelname)s %(message)s")

FRONTEND_DIST = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", "..", "frontend", "dist"))


@asynccontextmanager
async def lifespan(app: FastAPI):
    await init_db()
    settings = await load_settings()
    manager.configure(settings)
    notifier.configure(settings)
    engine.configure(settings)
    scanner.configure(settings)
    engine.start()
    scanner.start()
    yield
    await engine.stop()
    await scanner.stop()
    await manager.close()


app = FastAPI(title="SpreadDesk", lifespan=lifespan)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

AUTH_EXEMPT = {"/api/login", "/api/auth-info"}


@app.middleware("http")
async def auth_middleware(request: Request, call_next):
    path = request.url.path
    if auth.required() and path.startswith("/api") and path not in AUTH_EXEMPT:
        token = request.headers.get("x-auth-token")
        if not auth.check_token(token):
            return JSONResponse({"detail": "Требуется вход"}, status_code=401)
    return await call_next(request)


app.include_router(router)

# Продакшен: отдаём собранный фронтенд
if os.path.isdir(FRONTEND_DIST):
    app.mount("/assets", StaticFiles(directory=os.path.join(FRONTEND_DIST, "assets")), name="assets")

    @app.get("/{full_path:path}")
    async def spa(full_path: str):
        file_path = os.path.join(FRONTEND_DIST, full_path)
        if full_path and os.path.isfile(file_path):
            return FileResponse(file_path)
        return FileResponse(os.path.join(FRONTEND_DIST, "index.html"))
