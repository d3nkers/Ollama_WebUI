import base64

import pytest
from pydantic import ValidationError

from conftest import import_app_module, make_isolated_app_dir

PNG_MAGIC = b"\x89PNG\r\n\x1a\n" + b"\x00" * 16  # geldige PNG-header + wat vulling


@pytest.fixture()
def app_module(tmp_path):
    return import_app_module(make_isolated_app_dir(tmp_path))


def test_attachment_accepteert_geldige_naam(app_module):
    a = app_module.Attachment(name="notes.txt", content="hallo")
    assert a.name == "notes.txt"


def test_attachment_weigert_controlkarakter_in_naam(app_module):
    with pytest.raises(ValidationError):
        app_module.Attachment(name="app\x00.log", content="x")


def test_attachment_weigert_te_lange_naam(app_module):
    with pytest.raises(ValidationError):
        app_module.Attachment(name="a" * 300, content="x")


def test_attachment_weigert_lege_naam(app_module):
    with pytest.raises(ValidationError):
        app_module.Attachment(name="", content="x")


def test_attachment_weigert_te_grote_inhoud(app_module):
    with pytest.raises(ValidationError):
        app_module.Attachment(name="a.txt", content="x" * (app_module.MAX_FILE_CHARS + 1))


def test_sniff_image_mime_herkent_png(app_module):
    assert app_module._sniff_image_mime(PNG_MAGIC) == "image/png"


def test_sniff_image_mime_herkent_jpeg(app_module):
    assert app_module._sniff_image_mime(b"\xff\xd8\xff" + b"\x00" * 16) == "image/jpeg"


def test_sniff_image_mime_onherkenbaar_geeft_none(app_module):
    assert app_module._sniff_image_mime(b"dit is geen afbeelding") is None


def test_images_to_internal_gebruikt_gesnifft_mime_niet_claim(app_module):
    """De client claimt geen MIME-type meer (list[str], puur base64) — het
    interne type komt uitsluitend uit de bytes zelf."""
    b64 = base64.b64encode(PNG_MAGIC).decode()
    result = app_module._images_to_internal([b64])
    assert result[0]["mime"] == "image/png"
    assert result[0]["data"] == b64


def test_images_to_internal_weigert_onherkenbaar_formaat(app_module):
    b64 = base64.b64encode(b"geen afbeelding, gewoon tekst" * 4).decode()
    with pytest.raises(ValueError, match="onherkenbaar"):
        app_module._images_to_internal([b64])


def test_images_to_internal_weigert_te_grote_afbeelding(app_module):
    huge = base64.b64encode(PNG_MAGIC + b"\x00" * (app_module.MAX_IMAGE_BYTES + 1)).decode()
    with pytest.raises(ValueError, match="te groot"):
        app_module._images_to_internal([huge])


def test_images_to_internal_weigert_ongeldige_base64(app_module):
    with pytest.raises(ValueError, match="ongeldige base64"):
        app_module._images_to_internal(["dit-is-geen-geldige-base64!!!"])
