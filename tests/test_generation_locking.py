import threading

import pytest


@pytest.fixture()
def slow_ollama(fake_ollama):
    """Zet de fake Ollama tijdelijk traag, zodat er een venster is om een
    gelijktijdige tweede request te proberen. Reset na de test altijd terug,
    want fake_ollama is gedeeld over de hele sessie."""
    fake_ollama.delay = 2.0
    yield fake_ollama
    fake_ollama.delay = 0.0


def test_gelijktijdige_chat_call_geeft_409(client, new_conversation_id, slow_ollama):
    results = {}

    def do_request(key, message):
        r = client.post(f"/api/chat/{new_conversation_id}", json={"message": message})
        results[key] = r

    t1 = threading.Thread(target=do_request, args=("eerste", "hallo"))
    t1.start()
    threading.Event().wait(0.4)  # geef de eerste call de tijd om de lock te pakken

    r2 = client.post(f"/api/chat/{new_conversation_id}", json={"message": "nogmaals"})
    t1.join(timeout=10)

    assert results["eerste"].status_code == 200
    assert r2.status_code == 409


def test_lock_komt_vrij_na_afloop(client, new_conversation_id, slow_ollama):
    r1 = client.post(f"/api/chat/{new_conversation_id}", json={"message": "hallo"})
    assert r1.status_code == 200

    r2 = client.post(f"/api/chat/{new_conversation_id}", json={"message": "nogmaals"})
    assert r2.status_code == 200


def test_lock_komt_vrij_na_vroege_fout_bij_regenerate(client, new_conversation_id):
    """regenerate op een gesprek zonder berichten faalt vroeg (400) — de lock
    mag daarna niet blijven hangen."""
    r1 = client.post(f"/api/conversations/{new_conversation_id}/regenerate")
    assert r1.status_code == 400

    r2 = client.post(f"/api/chat/{new_conversation_id}", json={"message": "test na 400"})
    assert r2.status_code == 200
