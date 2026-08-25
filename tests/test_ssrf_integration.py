"""Bevestigt dat de SSRF-bescherming ook echt in de draaiende app zit (niet
alleen geïsoleerd in _is_safe_host/fetch_url_text, zie test_ssrf_unit.py).
Een lokale testserver draait per definitie op een privé-adres (127.0.0.1),
dus dit bewijst het weigeringspad — het accepteren van een écht publieke URL
end-to-end zou internettoegang vergen en hoort daarom bij de unit-tests met
een gemockte _is_safe_host (zie test_ssrf_unit.py::test_relatieve_redirect_..)."""


def test_fetch_url_weigert_loopback(client):
    r = client.post("/api/fetch-url", json={"url": "http://127.0.0.1:1/"})
    assert r.status_code == 400
    assert "intern" in r.json()["detail"].lower() or "gereserveerd" in r.json()["detail"].lower()


def test_fetch_url_weigert_file_scheme(client):
    r = client.post("/api/fetch-url", json={"url": "file:///etc/passwd"})
    assert r.status_code in (400, 422)


def test_fetch_url_rate_limit_isolated(isolated_app_server):
    with isolated_app_server.client() as c:
        for _ in range(10):
            r = c.post("/api/fetch-url", json={"url": "http://127.0.0.1:1/"})
            assert r.status_code == 400  # geweigerd op SSRF, telt wél mee voor de rate limit
        r = c.post("/api/fetch-url", json={"url": "http://127.0.0.1:1/"})
        assert r.status_code == 429
