def test_normale_payload_wordt_geaccepteerd(client):
    r = client.post("/api/conversations", json={"system_prompt": "test"})
    assert r.status_code == 200


def test_te_grote_payload_geeft_413(client):
    # ruim boven de 70MB-grens in app.py (MAX_REQUEST_BODY_BYTES)
    payload = {"system_prompt": "x" * (75 * 1024 * 1024)}
    r = client.post("/api/conversations", json=payload)
    assert r.status_code == 413
