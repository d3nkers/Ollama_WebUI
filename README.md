# Ollama WebUI

Een lokale webinterface voor [Ollama](https://ollama.com/) met persistente chatgeschiedenis, streaming responses, per-gesprek modelinstellingen, multimodale input en een expliciet securitymodel voor gebruik op een vertrouwd lokaal netwerk.

Het project is bewust klein gehouden: **FastAPI + SQLite + vanilla JavaScript**, zonder frontend-framework, build-pipeline, cloudservice of externe CDN-afhankelijkheid.

> **Status:** MVP / portfolio-project. Ontworpen voor gebruik op een klein, vertrouwd thuis- of labnetwerk. Niet bedoeld om rechtstreeks aan het publieke internet bloot te stellen.

> Voor volledige installatie-/configuratiedetails, de exacte security-afwegingen en het `systemd`-voorbeeld voor langdurig draaien als achtergrondservice, zie [`project-instructie.md`](project-instructie.md).

---

## Waarom dit project?

Ollama levert een eenvoudige lokale API voor LLM-inference, maar geen complete multi-device chatinterface met persistente gesprekken en eigen beveiligingsmaatregelen.

Dit project voegt daar een lokale weblaag aan toe met onder andere:

- chatgeschiedenis in SQLite;
- streaming antwoorden;
- modelkeuze per gesprek;
- systeemprompt, temperature en contextlengte per gesprek;
- ondersteuning voor reasoning/thinking-output;
- vision-input;
- tekstbestanden en webpagina's als tijdelijke context;
- Markdown- en codeweergave;
- HTTPS voor gebruik vanaf andere apparaten op het LAN;
- expliciete mitigaties voor XSS, SSRF, brute-force en resource abuse.

De architectuur blijft bewust eenvoudig en lokaal-first.

---

## Architectuur

```text
┌──────────────────────────────┐
│ Browser op lokaal apparaat   │
│ HTML + CSS + vanilla JS      │
└──────────────┬───────────────┘
               │ HTTPS + Basic Auth
               ▼
┌──────────────────────────────┐
│ FastAPI                      │
│                              │
│ • authenticatie              │
│ • inputvalidatie             │
│ • streaming NDJSON           │
│ • SSRF-beveiligde URL-fetch  │
│ • security headers           │
│ • request limits             │
└───────┬──────────────┬───────┘
        │              │
        │              └──────────────► SQLite
        │                               gesprekken
        │                               berichten
        │                               instellingen
        │
        ▼
┌──────────────────────────────┐
│ Ollama                       │
│ standaard localhost:11434    │
└──────────────────────────────┘
```

De browser communiceert alleen met FastAPI. Ollama hoeft daardoor niet rechtstreeks op het LAN beschikbaar te worden gemaakt.

---

## Stack

- **Python 3.12+**
- **FastAPI**
- **Uvicorn**
- **Ollama**
- **SQLite**
- **httpx**
- **BeautifulSoup + lxml**
- **python-dotenv**
- **cryptography**
- **Vanilla JavaScript / HTML / CSS**

Frontendlibraries worden lokaal meegeleverd:

- marked.js — Markdown rendering
- highlight.js — syntax highlighting
- DOMPurify — HTML sanitisation

Er worden geen CDN-resources geladen.

---

## Features

### Chat en modellen

- Persistente gesprekken en berichten in SQLite.
- Streaming modelresponses.
- Modelkeuze vanuit Ollama's `/api/tags`.
- Model wordt na het eerste bericht vastgezet per gesprek.
- Systeemprompt per gesprek.
- Temperature-presets.
- Instelbare contextlengte.
- Automatische gesprekstitel op basis van het eerste bericht.
- Gesprekken hernoemen.
- Export naar Markdown en JSON.
- Gebruikersbericht bewerken en vanaf dat punt opnieuw genereren.
- Laatste antwoord regenereren.
- Stoppen van een actieve generation terwijl reeds ontvangen output behouden blijft.

### Reasoning

Voor modellen die Ollama's thinking/reasoning-output ondersteunen:

- reasoning wordt apart van het antwoord gestreamd;
- reasoning verschijnt in een inklapbaar blok;
- reasoning wordt apart opgeslagen in SQLite;
- modellen zonder thinking-support worden automatisch opnieuw aangeroepen zonder de `think`-parameter.

### Markdown en code

- Markdown rendering.
- Syntax highlighting.
- DOMPurify-sanitisation vóór HTML in de DOM wordt geplaatst.
- Kopieerknop voor volledige responses.
- Kopieerknop per codeblok.
- Grotere codeblokken kunnen in een apart zijpaneel worden geopend.
- Code uit het zijpaneel kan als bestand worden gedownload.

### Vision

- Maximaal 4 afbeeldingen per bericht.
- Maximaal 10 MB per afbeelding.
- MIME-type wordt bepaald via magic numbers, niet via een door de client aangeleverd Content-Type.
- Ondersteunde invoerformaten:
  - PNG
  - JPEG
  - GIF
  - WEBP
  - BMP
- Afbeeldingen worden samen met de chatgeschiedenis opgeslagen.

Of een model vision ondersteunt wordt momenteel niet vooraf door de UI bepaald; een incompatibel model retourneert een Ollama-fout.

### Bestanden en URL context

Een gebruiker kan:

- een lokaal tekstbestand in de browser laten uitlezen;
- de geëxtraheerde tekst als context meesturen;
- een publieke HTTP(S)-URL door de backend laten ophalen.

Bijlage-inhoud wordt in de modelprompt expliciet als **niet-vertrouwde referentie-inhoud** gemarkeerd. Dit vermindert het risico van indirecte prompt injection, maar vormt geen harde security boundary.

---

## Securitymodel

De applicatie is ontworpen voor een **vertrouwd lokaal netwerk met een klein aantal gebruikers**.

Het securitymodel gaat nadrukkelijk niet uit van veilige blootstelling aan het publieke internet.

### Authenticatie

Alle FastAPI routes vallen onder HTTP Basic Auth.

Configuratie:

```env
OLLAMA_UI_USER=admin
OLLAMA_UI_PASS='kies-een-sterk-wachtwoord'
```

Als `OLLAMA_UI_PASS` ontbreekt, genereert de applicatie bij het starten een tijdelijk willekeurig wachtwoord en print dit naar de console.

Na vijf mislukte authenticatiepogingen vanaf hetzelfde IP binnen vijf minuten wordt dat IP tijdelijk geblokkeerd.

De lockout is:

- per IP;
- in-memory;
- niet persistent na een herstart.

Dit is een bewuste MVP-afweging voor lokaal gebruik.

### HTTPS

De aanbevolen startmethode is:

```bash
python run.py
```

`run.py` genereert indien nodig een zelfondertekend certificaat en start Uvicorn via HTTPS.

Het certificaat bevat:

- `localhost`;
- gedetecteerde lokale IPv4-adressen;
- optionele extra hostnamen.

Een zelfondertekend certificaat beschermt tegen passief afluisteren, maar biedt zonder handmatig vertrouwen van het certificaat geen volledige bescherming tegen een actieve man-in-the-middle.

Rechtstreeks starten via HTTP is alleen bedoeld voor lokale ontwikkeling/debugging:

```bash
uvicorn app:app --host 0.0.0.0 --port 8000
```

Basic Auth over HTTP verzendt herbruikbare credentials zonder transportencryptie.

### Content Security Policy

De applicatie gebruikt onder andere:

```text
default-src 'self'
script-src 'self'
style-src 'self'
img-src 'self' data:
connect-src 'self'
object-src 'none'
base-uri 'none'
frame-ancestors 'none'
form-action 'self'
```

Daarnaast wordt `X-Frame-Options: DENY` gestuurd.

Inline JavaScript en CSS zijn daarom bewust uit `index.html` gehaald en onder `static/` geplaatst.

### XSS-beperking

Modeloutput wordt:

1. door marked.js naar HTML omgezet;
2. vervolgens door DOMPurify gesanitiseerd;
3. pas daarna in de pagina gerenderd.

Externe afbeeldingen in model-Markdown worden geblokkeerd:

- via CSP (`img-src 'self' data:`);
- aanvullend via een DOMPurify-hook.

Hiermee kan modeloutput niet eenvoudig een externe tracking-image laten ophalen door de browser.

### SSRF-bescherming bij URL fetching

Een URL-fetchfunctie op een LAN kan toegang geven tot interne diensten. Daarom:

- zijn alleen `http://` en `https://` toegestaan;
- wordt de hostname vooraf geresolved;
- moet **ieder** geresolved IP publiek routeerbaar zijn (`ip.is_global`);
- multicast wordt expliciet geweigerd;
- worden redirects niet automatisch gevolgd;
- wordt elke redirect opnieuw volledig gevalideerd;
- worden relatieve redirects eerst veilig via `urljoin()` opgelost;
- wordt maximaal vijf redirects gevolgd;
- worden proxy-environmentvariables genegeerd via `trust_env=False`;
- gelden connect/read timeouts;
- wordt maximaal 3 MB HTML opgehaald;
- wordt die grens tijdens het streamen afgedwongen;
- geldt een globale rate limit van 10 URL-fetches per minuut;
- worden scripts, styles, navigatie en andere niet-relevante HTML-elementen verwijderd.

### Bewust resterend SSRF risico: DNS rebinding

DNS-validatie en de daadwerkelijke TCP-connectie zijn nog twee afzonderlijke stappen.

Een aanvaller die controle heeft over DNS kan theoretisch tussen beide stappen een andere DNS-response laten teruggeven.

Een volledige oplossing zou het gevalideerde IP aan de daadwerkelijke verbinding moeten koppelen terwijl TLS/SNI en de `Host` header correct blijven werken.

Voor het huidige threat model is dit risico bewust geaccepteerd.

### Resource limiting

Ingebouwde limieten:

- maximaal 8.000 tekens per gebruikersbericht;
- maximaal 4 afbeeldingen per bericht;
- maximaal 10 MB per afbeelding;
- maximaal 3 tekstbijlagen per bericht;
- maximaal 60.000 tekens per bijlage;
- maximaal 3 MB per opgehaalde webpagina;
- maximaal 70 MB totale HTTP request-body;
- maximaal 10 URL-fetches per minuut.

De request-bodylimiet wordt op ASGI-niveau afgedwongen vóór Pydantic-validatie.

### Generation concurrency

Per gesprek mag maximaal één modelgeneration tegelijk actief zijn.

Een gelijktijdige `chat`- of `regenerate`-request voor hetzelfde gesprek retourneert `409 Conflict`.

Hiermee wordt voorkomen dat twee assistant-responses tegelijkertijd tegen dezelfde gesprekshistorie worden opgebouwd.

---

## Database

SQLite wordt automatisch aangemaakt.

De database bevat onder andere:

- gesprekken;
- berichten;
- modelinstellingen;
- bijlagen;
- afbeeldingen;
- reasoning-output;
- tokens/sec-statistieken.

De applicatie gebruikt:

```sql
PRAGMA foreign_keys = ON;
PRAGMA journal_mode = WAL;
PRAGMA busy_timeout = 5000;
```

Eenvoudige schemawijzigingen worden bij het starten automatisch gemigreerd.

---

## Installatie

### Vereisten

- Python 3.12 of nieuwer
- Ollama
- Minimaal één lokaal Ollama model

Controleer eerst of Ollama werkt:

```bash
ollama list
```

Start Ollama indien nodig:

```bash
ollama serve
```

### Repository installeren met `uv`

```bash
git clone https://github.com/d3nkers/Ollama_WebUI
cd Ollama_WebUI

uv sync
```

Activeer eventueel de virtual environment:

```bash
source .venv/bin/activate
```

### Alternatief met `venv` en pip

```bash
python3 -m venv venv
source venv/bin/activate
pip install -r requirements.txt
```

---

## Configuratie

Kopieer:

```bash
cp .env.example .env
```

Voorbeeld:

```env
OLLAMA_HOST=http://localhost:11434
OLLAMA_MODEL=llama3.1:8b

OLLAMA_UI_USER=admin
OLLAMA_UI_PASS='vervang-dit-door-een-sterk-wachtwoord'

# Optioneel voor HTTPS:
# OLLAMA_UI_HOST=0.0.0.0
# OLLAMA_UI_PORT=8443
# OLLAMA_UI_SSL_HOSTS=hostname.local
```

Bestaande shell of systemd-environmentvariables hebben voorrang boven `.env`.

---

## Starten

### Aanbevolen: HTTPS

```bash
python run.py
```

Standaard:

```text
https://0.0.0.0:8443
```

Open de applicatie vanaf een ander apparaat via het LAN-IP van de host:

```text
https://192.168.x.x:8443
```

De browser zal bij een nieuw zelfondertekend certificaat een waarschuwing tonen.

### Alleen voor development: HTTP

```bash
uvicorn app:app --host 0.0.0.0 --port 8000
```

---

## Linux firewall

Wanneer de applicatie vanaf andere apparaten op het LAN bereikbaar moet zijn:

```bash
sudo firewall-cmd --add-port=8443/tcp --permanent
sudo firewall-cmd --reload
```

Gebruik poort `8000` in plaats van `8443` wanneer bewust via HTTP wordt gestart.

Voor langdurig gebruik als achtergrondservice (systemd user-service): zie
[`project-instructie.md`](project-instructie.md#als-achtergrondservice-optioneel).

---

## Testen

```bash
uv sync --group dev
uv run pytest
```

Dekt de security- en concurrency-invariants: SSRF-bescherming (`_is_safe_host`,
redirect-resolutie), authenticatie (401/429-lockout), request-bodygrootte
(413) en de per-gesprek generation-lock (409). Draait als losse subprocess in
een tijdelijke werkmap — nooit tegen de echte `chat.db`, geen aanpassing aan
`app.py` nodig om dat te garanderen. Een fake, stdlib-only Ollama-server
maakt de tests onafhankelijk van een echt draaiende Ollama-instance.

---

## Projectstructuur

```text
ollama-webui/
├── app.py
├── certs.py
├── run.py
├── pyproject.toml
├── uv.lock
├── requirements.txt
├── .env.example
├── LICENSE
├── README.md
├── static/
│   ├── index.html
│   ├── app.js
│   ├── app.css
│   └── vendor/
└── tests/                  # pytest: SSRF, auth, request-size, generation-locking
```

---

## Bewuste ontwerpkeuzes

### Geen frontend-framework

De UI gebruikt vanilla JavaScript.

Voor deze schaal levert React/Vue/Svelte weinig functionele waarde op, terwijl een framework wel:

- build tooling;
- extra dependencies;
- grotere dependency attack surface;
- extra onderhoud

zou introduceren.

### Geen externe database

SQLite past bij:

- één applicatie-instance;
- lokaal gebruik;
- beperkte gelijktijdigheid;
- eenvoudige backups;
- minimale operationele overhead.

### Geen gebruikersaccounts/JWT/OAuth

Voor een klein vertrouwd LAN is één Basic Auth laag bewust eenvoudiger gehouden.

Bij multi-user of internet facing gebruik moet authenticatie opnieuw worden ontworpen.

### Geen vector database/RAG

RAG is geen vereiste voor de primaire functie van het project.

De applicatie ondersteunt wel expliciete tekst en URL context zonder daarvoor extra infrastructuur toe te voegen.

### Geen Docker-verplichting

De applicatie is direct als Python-project te draaien.

Containerisatie kan later worden toegevoegd maar is niet noodzakelijk voor lokaal gebruik.

---

## Bekende beperkingen

- Gericht op een vertrouwd LAN, niet op publieke internetexposure.
- Eén gedeelde authenticatiecontext.
- Brute-force-state is niet persistent.
- URL-fetch rate limiting is globaal.
- DNS rebinding is niet volledig opgelost.
- Afbeeldingen worden als base64 in SQLite opgeslagen.
- Vision-capabilities van modellen worden nog niet automatisch gedetecteerd.
- Thinking staat momenteel standaard aan en valt terug wanneer een model dit niet ondersteunt.
- Er is nog geen automatisch context-windowmanagement.
- Geen text-to-image.
- Geen harde bescherming tegen prompt injection in meegeleverde documenten; untrusted-content framing is een zachte modelinstructie.

---

## Roadmap

Mogelijke vervolgstappen:

- [ ] automatische detectie van modelcapabilities;
- [ ] context-windowmeter;
- [ ] gecontroleerde context truncation/samenvatting;
- [ ] configureerbare thinkingmodus;
- [ ] zoeken door gesprekken;
- [x] tests voor security- en concurrency-invariants;
- [ ] GitHub Actions CI;
- [ ] Ruff/linting;
- [ ] optionele losse opslag van afbeeldingen;
- [ ] uitgebreidere foutclassificatie voor Ollama-responses.

---

## Threat-model samenvatting

| Onderdeel | Aangenomen threat model |
|---|---|
| Netwerk | Vertrouwd thuis-/lab-LAN |
| Internet exposure | Niet ondersteund |
| Gebruikers | Klein aantal vertrouwde gebruikers |
| Auth | HTTP Basic Auth |
| Transport | Zelfondertekende HTTPS aanbevolen |
| Browseroutput | Onbetrouwbare modeloutput |
| URL-content | Onbetrouwbare externe input |
| Ollama | Lokale vertrouwde backend |
| Prompt injection | Mogelijk; geen tool-execution beschikbaar |
| SSRF | Actief beperkt, DNS rebinding bewust resterend risico |
| DoS/resource abuse | Basislimieten, geen enterprise rate limiting |

---

## License

MIT.
