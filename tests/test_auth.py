import httpx

from conftest import AUTH


def test_zonder_credentials_geeft_401(app_server):
    with httpx.Client(base_url=app_server.base_url, timeout=5) as c:
        r = c.get("/api/health")
    assert r.status_code == 401


def test_verkeerd_wachtwoord_geeft_401(app_server):
    with httpx.Client(base_url=app_server.base_url, auth=(AUTH[0], "fout-wachtwoord"), timeout=5) as c:
        r = c.get("/api/health")
    assert r.status_code == 401


def test_juiste_credentials_geeft_toegang(client):
    r = client.get("/api/conversations")
    assert r.status_code == 200


def test_vendor_route_ook_achter_auth(app_server):
    """Volgens de README/instructie geldt auth voor élke route, ook static/vendor-bestanden."""
    with httpx.Client(base_url=app_server.base_url, timeout=5) as c:
        r = c.get("/static/app.js")
    assert r.status_code == 401


def test_lockout_na_vijf_mislukte_pogingen(isolated_app_server):
    """Eigen, verse subprocess — zodat deze test de gedeelde sessie-server
    niet voor andere tests blokkeert (lockout duurt 5 minuten)."""
    with httpx.Client(base_url=isolated_app_server.base_url, auth=(AUTH[0], "fout"), timeout=5) as bad_client:
        for _ in range(5):
            r = bad_client.get("/api/health")
            assert r.status_code == 401

        r = bad_client.get("/api/health")
        assert r.status_code == 429
        assert "Retry-After" in r.headers

    # ook met de juiste wachtwoord blijft de lockout gelden
    with httpx.Client(base_url=isolated_app_server.base_url, auth=AUTH, timeout=5) as good_client:
        r = good_client.get("/api/health")
        assert r.status_code == 429
