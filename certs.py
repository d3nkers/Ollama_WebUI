"""
Genereert eenmalig een zelfondertekend TLS-certificaat voor lokaal LAN-gebruik.

Waarschuwing: een zelfondertekend certificaat betekent dat de browser bij het
eerste bezoek een "niet vertrouwd"-waarschuwing toont — dat is verwacht op een
netwerk zonder eigen CA. Het biedt wél echte encryptie tegen passief
meeluisteren op het netwerk (bijv. iemand die verkeer op dezelfde wifi
afluistert). Het beschermt NIET tegen een actieve aanvaller die zelf een vals
certificaat aanbiedt (man-in-the-middle), tenzij je het certificaat handmatig
als vertrouwd markeert op elk apparaat dat verbinding maakt.
"""
import datetime
import ipaddress
import socket
from pathlib import Path

from cryptography import x509
from cryptography.hazmat.primitives import hashes, serialization
from cryptography.hazmat.primitives.asymmetric import rsa
from cryptography.x509.oid import ExtendedKeyUsageOID, NameOID


def _local_ips() -> list[str]:
    """Verzamelt de lokale IP-adressen van deze machine, zodat het certificaat
    ook geldig is als de UI via het LAN-IP bereikt wordt (niet alleen localhost)."""
    ips = {"127.0.0.1"}
    try:
        s = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
        s.connect(("8.8.8.8", 80))  # geen echt verkeer, alleen om de uitgaande interface te bepalen
        ips.add(s.getsockname()[0])
        s.close()
    except OSError:
        pass
    try:
        for info in socket.getaddrinfo(socket.gethostname(), None, socket.AF_INET):
            ips.add(info[4][0])
    except OSError:
        pass
    return sorted(ips)


def ensure_self_signed_cert(
    cert_path: Path, key_path: Path, extra_hosts: list[str] | None = None
) -> None:
    """Genereert cert/sleutel als ze nog niet bestaan. Idempotent: bestaande
    bestanden worden nooit overschreven (anders zou elke herstart alle eerder
    vertrouwde certificaten in browsers ongeldig maken)."""
    if cert_path.exists() and key_path.exists():
        return

    cert_path.parent.mkdir(parents=True, exist_ok=True)

    key = rsa.generate_private_key(public_exponent=65537, key_size=2048)

    subject = issuer = x509.Name([x509.NameAttribute(NameOID.COMMON_NAME, "ollama-webui.local")])

    san_ips = [x509.IPAddress(ipaddress.ip_address(ip)) for ip in _local_ips()]
    san_dns = [x509.DNSName("localhost")] + [x509.DNSName(h) for h in (extra_hosts or [])]

    now = datetime.datetime.now(datetime.timezone.utc)
    cert = (
        x509.CertificateBuilder()
        .subject_name(subject)
        .issuer_name(issuer)
        .public_key(key.public_key())
        .serial_number(x509.random_serial_number())
        .not_valid_before(now - datetime.timedelta(days=1))
        .not_valid_after(now + datetime.timedelta(days=825))  # max. wat Safari/Chrome nog accepteren
        .add_extension(x509.SubjectAlternativeName(san_ips + san_dns), critical=False)
        .add_extension(x509.BasicConstraints(ca=False, path_length=None), critical=True)
        .add_extension(
            x509.ExtendedKeyUsage([ExtendedKeyUsageOID.SERVER_AUTH]), critical=False
        )
        .sign(key, hashes.SHA256())
    )

    key_path.write_bytes(
        key.private_bytes(
            encoding=serialization.Encoding.PEM,
            format=serialization.PrivateFormat.PKCS8,
            encryption_algorithm=serialization.NoEncryption(),
        )
    )
    cert_path.write_bytes(cert.public_bytes(serialization.Encoding.PEM))
    key_path.chmod(0o600)  # privésleutel alleen leesbaar voor de eigenaar

    print("=" * 60)
    print(f"Zelfondertekend certificaat gegenereerd: {cert_path}")
    print("Geldig voor: " + ", ".join(_local_ips() + ["localhost"] + list(extra_hosts or [])))
    print("De browser meldt dit bij het eerste bezoek als 'niet vertrouwd' —")
    print("dat is verwacht. Kies 'Geavanceerd' -> 'toch doorgaan' op elk apparaat.")
    print("=" * 60)
