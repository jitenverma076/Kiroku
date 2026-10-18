#!/usr/bin/env python3
"""
Kiroku — Application Launcher

Starts the FastAPI backend server.
The React frontend is served either by Vite (dev) or built into dist/ (prod).
"""

import os
import subprocess
import sys
import webbrowser
import time

# Auto-switch to local venv if available and not already inside it
venv_python = os.path.join(os.path.dirname(__file__), "venv", "bin", "python")
if os.path.exists(venv_python) and sys.executable != os.path.abspath(venv_python):
    os.execv(venv_python, [venv_python] + sys.argv)

def check_dependencies():
    """Check that required Python packages are installed."""
    required = ["fastapi", "uvicorn", "sqlalchemy", "pdfplumber", "pydantic"]
    missing = []
    for pkg in required:
        try:
            __import__(pkg.replace("-", "_"))
        except ImportError:
            missing.append(pkg)
    
    if missing:
        print(f"[ERROR] Missing Python packages: {', '.join(missing)}")
        print("Run: pip install -r backend/requirements.txt")
        sys.exit(1)

def check_tesseract():
    """Check if Tesseract OCR is available (optional but recommended)."""
    try:
        result = subprocess.run(
            ["tesseract", "--version"],
            capture_output=True, text=True, timeout=5
        )
        if result.returncode == 0:
            version = result.stdout.split('\n')[0]
            print(f"[OK] Tesseract OCR: {version}")
        else:
            print("[WARN] Tesseract OCR not found. Scanned documents and images won't have OCR.")
            print("       Install: brew install tesseract (macOS) or apt-get install tesseract-ocr (Linux)")
    except (FileNotFoundError, subprocess.TimeoutExpired):
        print("[WARN] Tesseract OCR not found. OCR disabled for scanned/image documents.")

def main():
    print("\n" + "="*60)
    print("  Kiroku (記録) — Local AI Financial Intelligence")
    print("="*60 + "\n")

    check_dependencies()
    check_tesseract()

    # Set Python path to backend/src
    backend_src = os.path.join(os.path.dirname(__file__), "backend", "src")
    env = os.environ.copy()
    env["PYTHONPATH"] = backend_src

    print("\n[INFO] Starting Kiroku server at http://127.0.0.1:8000")
    print("[INFO] Press Ctrl+C to stop\n")

    # Open browser after a short delay
    def open_browser():
        time.sleep(2)
        webbrowser.open("http://127.0.0.1:8000")

    import threading
    threading.Thread(target=open_browser, daemon=True).start()

    # Start uvicorn
    cmd = [
        sys.executable, "-m", "uvicorn",
        "main:app",
        "--host", "127.0.0.1",
        "--port", "8000",
        "--app-dir", backend_src,
    ]
    os.execve(sys.executable, cmd, env)

if __name__ == "__main__":
    main()
