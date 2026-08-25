"""Directe tests van de SSRF-kernlogica (_is_safe_host, redirect-resolutie in
fetch_url_text) via een geïsoleerde kopie van app.py — geen subprocess nodig
voor pure functietests, wél nodig om te voorkomen dat importeren van app.py
de echte chat.db aanraakt (BASE_DIR is relatief aan het scriptbestand)."""
import socket
import threading
from http.server import BaseHTTPRequestHandler, HTTPServer
from unittest.mock import patch

import pytest

from conftest import import_app_module, make_isolated_app_dir


@pytest.fixture()
def app_module(tmp_path):
    return import_app_module(make_isolated_app_dir(tmp_path))


@pytest.mark.asyncio
@pytest.mark.parametrize(
    "ip,verwacht_veilig",
    [
        ("1.1.1.1", True),  # publiek
        ("8.8.8.8", True),  # publiek
        ("127.0.0.1", False),  # loopback
        ("192.168.1.1", False),  # privé
        ("10.0.0.1", False),  # privé
        ("169.254.1.1", False),  # link-local
        ("100.64.0.1", False),  # CGNAT — het hele punt van de is_global-allowlist
        ("224.0.0.1", False),  # multicast — is_global rekent dit fout tot 'global'
        ("0.0.0.0", False),  # unspecified
        ("::1", False),  # loopback IPv6
        ("fe80::1", False),  # link-local IPv6
        ("ff02::1", False),  # multicast IPv6
    ],
)
async def test_is_safe_host(app_module, ip, verwacht_veilig):
    assert await app_module._is_safe_host(ip) is verwacht_veilig


@pytest.mark.asyncio
async def test_is_safe_host_onoplosbare_hostname(app_module):
    assert await app_module._is_safe_host("dit-bestaat-vast-niet.invalid") is False


class _RedirectHandler(BaseHTTPRequestHandler):
    def log_message(self, *a):
        pass

    def do_GET(self):
        if self.path == "/start":
            self.send_response(302)
            self.send_header("Location", "/relative-target")  # bewust relatief
            self.end_headers()
        elif self.path == "/relative-target":
            body = b"<html><title>Doel</title><body>gelukt</body></html>"
            self.send_response(200)
            self.send_header("Content-Type", "text/html")
            self.send_header("Content-Length", str(len(body)))
            self.end_headers()
            self.wfile.write(body)
        else:
            self.send_response(404)
            self.end_headers()


@pytest.fixture()
def redirect_server():
    server = HTTPServer(("127.0.0.1", 0), _RedirectHandler)
    thread = threading.Thread(target=server.serve_forever, daemon=True)
    thread.start()
    yield server
    server.shutdown()
    thread.join(timeout=5)


@pytest.mark.asyncio
async def test_relatieve_redirect_wordt_correct_opgelost(app_module, redirect_server):
    """De testserver draait op 127.0.0.1 (privé) — _is_safe_host wordt hier
    gemockt om alleen de urljoin-resolutie te testen, niet de allowlist zelf
    (die heeft z'n eigen dekking hierboven)."""
    port = redirect_server.server_address[1]
    with patch.object(app_module, "_is_safe_host", side_effect=_true):
        title, text = await app_module.fetch_url_text(f"http://127.0.0.1:{port}/start")
    assert title == "Doel"
    assert "gelukt" in text


async def _true(_host):
    return True


@pytest.mark.asyncio
async def test_fetch_url_text_weigert_privé_ip_zonder_mock(app_module):
    with pytest.raises(ValueError, match="intern/gereserveerd"):
        await app_module.fetch_url_text("http://127.0.0.1:1/")
