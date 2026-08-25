"""Fixtures voor de testsuite.

Bewuste keuze: app.py wordt ongewijzigd getest, als losse subprocess in een
eigen werkmap (kopie van app.py + minimale static-placeholders in tmp_path).
Zo landt chat.db van een testrun nooit in de echte projectmap — geen wijziging
in app.py nodig om dat te garanderen. Nadeel: subprocess-opstarttijd (~1-2s
per fixture), vandaar sessie-scope voor de meeste tests.
"""
import importlib.util
import shutil
import socket
import subprocess
import sys
import time
from pathlib import Path

import httpx
import pytest

from fake_ollama import FakeOllama

REPO_ROOT = Path(__file__).parent.parent
AUTH = ("testuser", "testpass123")

# Placeholders zodat routes die static-bestanden serveren niet crashen —
# de inhoud is voor deze tests irrelevant, alleen auth/security-gedrag telt.
_STATIC_PLACEHOLDERS = {
    "static/index.html": "<html></html>",
    "static/app.js": "",
    "static/app.css": "",
    "static/vendor/marked.min.js": "",
    "static/vendor/highlight.min.js": "",
    "static/vendor/purify.min.js": "",
    "static/vendor/hljs-theme.css": "",
}


def _free_port() -> int:
    with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as s:
        s.bind(("127.0.0.1", 0))
        return s.getsockname()[1]


def make_isolated_app_dir(tmp_path: Path) -> Path:
    """Kopieert app.py + minimale static-placeholders naar tmp_path. BASE_DIR
    in app.py is relatief aan het scriptbestand, dus chat.db/certs landen
    hierdoor automatisch in tmp_path i.p.v. de echte projectmap."""
    shutil.copy(REPO_ROOT / "app.py", tmp_path / "app.py")
    for rel, content in _STATIC_PLACEHOLDERS.items():
        p = tmp_path / rel
        p.parent.mkdir(parents=True, exist_ok=True)
        p.write_text(content)
    return tmp_path


def import_app_module(app_dir: Path):
    """Importeert de gekopieerde app.py als los modul-object (niet via
    'import app', dat zou de echte projectmap kunnen raken als die toevallig
    op sys.path staat). Gebruikt voor de directe unit-tests van pure functies."""
    spec = importlib.util.spec_from_file_location("app_under_test", app_dir / "app.py")
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


@pytest.fixture(scope="session")
def fake_ollama():
    server = FakeOllama()
    server.start()
    yield server
    server.stop()


class AppServer:
    def __init__(self, base_url: str, process: subprocess.Popen, log_path: Path):
        self.base_url = base_url
        self.process = process
        self.log_path = log_path

    def client(self, auth: tuple[str, str] | None = AUTH) -> httpx.Client:
        return httpx.Client(base_url=self.base_url, auth=auth, timeout=15)


def _spawn_app_server(tmp_path: Path, fake_ollama: FakeOllama, extra_env: dict | None = None) -> AppServer:
    app_dir = make_isolated_app_dir(tmp_path)
    port = _free_port()
    log_path = tmp_path / "uvicorn.log"

    env = {
        "PATH": __import__("os").environ.get("PATH", ""),
        "OLLAMA_UI_USER": AUTH[0],
        "OLLAMA_UI_PASS": AUTH[1],
        "OLLAMA_HOST": fake_ollama.base_url,
    }
    if extra_env:
        env.update(extra_env)

    log_file = open(log_path, "w")
    process = subprocess.Popen(
        [sys.executable, "-m", "uvicorn", "app:app", "--host", "127.0.0.1", "--port", str(port)],
        cwd=app_dir,
        env=env,
        stdout=log_file,
        stderr=subprocess.STDOUT,
    )
    base_url = f"http://127.0.0.1:{port}"

    deadline = time.monotonic() + 15
    last_error = None
    with httpx.Client(base_url=base_url, auth=AUTH, timeout=2) as probe:
        while time.monotonic() < deadline:
            if process.poll() is not None:
                log_file.close()
                raise RuntimeError(
                    f"app-subprocess stopte vroegtijdig (exit {process.returncode}); log:\n"
                    + log_path.read_text()
                )
            try:
                r = probe.get("/api/health")
                if r.status_code == 200:
                    break
                last_error = f"status {r.status_code}: {r.text}"
            except httpx.TransportError as e:
                last_error = str(e)
            time.sleep(0.2)
        else:
            process.terminate()
            log_file.close()
            raise RuntimeError(f"app-subprocess werd niet op tijd gereed ({last_error}); log:\n{log_path.read_text()}")

    return AppServer(base_url, process, log_path)


def _teardown_app_server(server: AppServer) -> None:
    server.process.terminate()
    try:
        server.process.wait(timeout=5)
    except subprocess.TimeoutExpired:
        server.process.kill()
        server.process.wait(timeout=5)


@pytest.fixture(scope="session")
def app_server(tmp_path_factory, fake_ollama):
    """Eén gedeelde app-subprocess voor de meeste tests (snel). Elke test
    maakt zijn eigen conversatie aan (uniek conv_id), dus gedeelde DB-state
    binnen de sessie geeft geen interferentie."""
    tmp_path = tmp_path_factory.mktemp("app-session")
    server = _spawn_app_server(tmp_path, fake_ollama)
    yield server
    _teardown_app_server(server)


@pytest.fixture()
def isolated_app_server(tmp_path, fake_ollama):
    """Losse, verse app-subprocess — voor tests die bewust de auth-lockout-
    state van de gedeelde sessie-server niet mogen beïnvloeden."""
    server = _spawn_app_server(tmp_path, fake_ollama)
    yield server
    _teardown_app_server(server)


@pytest.fixture()
def client(app_server):
    with app_server.client() as c:
        yield c


@pytest.fixture()
def new_conversation_id(client):
    r = client.post("/api/conversations", json={})
    assert r.status_code == 200
    return r.json()["id"]
