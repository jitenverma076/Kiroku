"""Kiroku — FastAPI application entry point.

Serves the REST API and, in production, the built React SPA. Persistence is a
local SQLite database; text extraction uses pdfplumber with a Tesseract fallback.
"""

import os
import logging
from contextlib import asynccontextmanager

from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse
from fastapi.staticfiles import StaticFiles

from storage.database import init_db
from storage.file_store import FileStore
from commands import documents, processing, export, tags, settings as settings_router

# ── Logging configuration ────────────────────────────────────────────────────
# We deliberately do NOT log document content or financial values.
logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s %(levelname)-8s %(name)s  %(message)s",
)
log = logging.getLogger("kiroku")

# Local dev by default. Set KIROKU_CORS_ORIGINS (comma-separated) to allow a
# deployed frontend, e.g. "https://kiroku.vercel.app".
CORS_ORIGINS = [
    o.strip()
    for o in os.environ.get(
        "KIROKU_CORS_ORIGINS",
        "http://localhost:5173,http://127.0.0.1:5173,http://localhost:8000,http://127.0.0.1:8000",
    ).split(",")
    if o.strip()
]

# ── App lifecycle ─────────────────────────────────────────────────────────────
@asynccontextmanager
async def lifespan(app: FastAPI):
    """Initialize database and file storage on startup."""
    log.info("Kiroku starting up …")
    FileStore.ensure_directories()
    init_db()
    log.info("Database and file store initialized.")
    yield
    log.info("Kiroku shutting down.")


app = FastAPI(
    title="Kiroku API",
    version="1.0.0",
    description="Privacy-first local AI invoice & receipt manager",
    lifespan=lifespan,
)

# ── CORS — localhost only ─────────────────────────────────────────────────────
app.add_middleware(
    CORSMiddleware,
    allow_origins=CORS_ORIGINS,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# ── API routers ───────────────────────────────────────────────────────────────
app.include_router(documents.router,   prefix="/api/documents",  tags=["documents"])
app.include_router(processing.router,  prefix="/api/processing", tags=["processing"])
app.include_router(export.router,      prefix="/api/export",     tags=["export"])
app.include_router(tags.router,        prefix="/api/tags",       tags=["tags"])
app.include_router(settings_router.router, prefix="/api/settings", tags=["settings"])

# ── Static file serving (production: serve React build) ──────────────────────
PROJECT_ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", ".."))
FRONTEND_DIST = os.path.join(PROJECT_ROOT, "frontend", "dist")
# The landing page is one file, shared by the local app and GitHub Pages.
LANDING_DIR = os.path.join(PROJECT_ROOT, "docs")
LANDING_PAGE = os.path.join(LANDING_DIR, "index.html")

if os.path.isdir(FRONTEND_DIST):
    app.mount(
        "/assets",
        StaticFiles(directory=os.path.join(FRONTEND_DIST, "assets")),
        name="assets",
    )

    @app.get("/{spa_path:path}")
    async def serve_spa(spa_path: str):
        """Serve built files, falling back to index.html for client-side routes.

        The router owns /documents, /settings, and friends; without this fallback a
        refresh on any of them 404s instead of loading the app. Assets are looked up
        in the build first, then in docs/ so the landing page finds its screenshot.
        """
        if spa_path.startswith("api/"):
            raise HTTPException(status_code=404, detail="Not Found")

        # "/" is the landing page; the app itself starts at /documents.
        if not spa_path:
            if os.path.isfile(LANDING_PAGE):
                return FileResponse(LANDING_PAGE)
            return FileResponse(os.path.join(FRONTEND_DIST, "index.html"))

        for base in (FRONTEND_DIST, LANDING_DIR):
            candidate = os.path.join(base, spa_path)
            try:
                FileStore._validate_safe_path(candidate, base)
            except ValueError:
                raise HTTPException(status_code=404, detail="Not Found")
            if os.path.isfile(candidate):
                return FileResponse(candidate)

        return FileResponse(os.path.join(FRONTEND_DIST, "index.html"))

    log.info("Serving React SPA from %s", FRONTEND_DIST)
else:
    @app.get("/")
    async def api_root():
        return {
            "app": "Kiroku",
            "version": "1.0.0",
            "status": "running",
            "ui": "not built — see the README to build the frontend",
        }

if __name__ == "__main__":
    import uvicorn

    # Hosts such as Render inject $PORT and require binding all interfaces.
    uvicorn.run(
        "main:app",
        host=os.environ.get("HOST", "127.0.0.1"),
        port=int(os.environ.get("PORT", "8000")),
    )
