"""
Start de Ollama WebUI met HTTPS, via een automatisch gegenereerd
zelfondertekend certificaat (zie certs.py voor de kanttekeningen daarbij).

Gebruik: python run.py
Configuratie via dezelfde env vars als app.py, plus:
  OLLAMA_UI_HOST   — default 0.0.0.0 (bereikbaar op het LAN)
  OLLAMA_UI_PORT   — default 8443
  OLLAMA_UI_SSL_HOSTS — komma-gescheiden extra hostnamen voor het certificaat
                        (bijv. een mDNS-naam), naast localhost en de
                        gedetecteerde LAN-IP's
"""
import os
from pathlib import Path

import uvicorn

from app import BASE_DIR
from certs import ensure_self_signed_cert

CERT_DIR = BASE_DIR / "certs"
CERT_PATH = CERT_DIR / "cert.pem"
KEY_PATH = CERT_DIR / "key.pem"

if __name__ == "__main__":
    extra_hosts = [h.strip() for h in os.environ.get("OLLAMA_UI_SSL_HOSTS", "").split(",") if h.strip()]
    ensure_self_signed_cert(CERT_PATH, KEY_PATH, extra_hosts)

    uvicorn.run(
        "app:app",
        host=os.environ.get("OLLAMA_UI_HOST", "0.0.0.0"),
        port=int(os.environ.get("OLLAMA_UI_PORT", "8443")),
        ssl_certfile=str(CERT_PATH),
        ssl_keyfile=str(KEY_PATH),
    )
