# Ollama WebUI — projectinstructie

> Dit document gaat de diepte in op configuratie, installatie en de
> beveiligingsmaatregelen. Voor een overzicht van het project (architectuur,
> featurelijst, threat-model-samenvatting) zie [`README.md`](README.md).

Lokale web-UI voor Ollama-modellen, met chatgeschiedenis (SQLite), streaming
responses, modelkeuze per gesprek, systeemprompt/temperature/context-lengte
per gesprek, en markdown/code-rendering — bereikbaar op het lokale wifi-netwerk.

## Stack

- FastAPI + uvicorn (backend, proxyt naar Ollama's `/api/chat`)
- SQLite (`chat.db`, wordt automatisch aangemaakt, migreert zichzelf bij
  schemawijzigingen) voor gesprekken/berichten
- Eén statische `index.html` (vanilla JS, geen build-stap) + `static/app.js`
  en `static/app.css` — losse bestanden i.p.v. inline, nodig voor een strikte
  Content-Security-Policy zonder `unsafe-inline`
- `static/vendor/`: marked.js (markdown), highlight.js (syntax-highlighting)
  en DOMPurify (sanitisatie), lokaal gevendord — geen CDN-afhankelijkheid,
  werkt dus ook zonder internetverbinding op het LAN
- `certs.py` — genereert het zelfondertekende TLS-certificaat
- `run.py` — launcher die het certificaat regelt en de app via HTTPS start

## Installeren

```bash
cd ollama_webui
uv sync
cp .env.example .env   # en vul OLLAMA_UI_PASS in
```

`uv sync` leest `pyproject.toml`/`uv.lock` en zet een `.venv/` op met exact
dezelfde dependency-versies als vastgelegd in `uv.lock`. Geen `uv`? Dan werkt
ook een gewone `venv` + `pip install -e .` (of `pip install fastapi uvicorn[standard]
httpx beautifulsoup4 lxml cryptography python-dotenv`, zonder versies vastgezet).

## Configuratie (environment variables)

| Variabele        | Default                   | Omschrijving                              |
|-------------------|---------------------------|--------------------------------------------|
| `OLLAMA_HOST`     | `http://localhost:11434`  | Waar Ollama draait                         |
| `OLLAMA_MODEL`    | `llama3.1:8b`              | Default-model als er geen expliciet gekozen is |
| `OLLAMA_UI_USER`  | `admin`                    | Gebruikersnaam voor basic auth             |
| `OLLAMA_UI_PASS`  | *(auto-gegenereerd)*      | Wachtwoord — **zet dit expliciet**, en met single quotes als het speciale tekens bevat |

Zonder `OLLAMA_UI_PASS` genereert de app bij opstart een tijdelijk wachtwoord
en print dat naar de console. Handig om te testen, niet om op te vertrouwen —
zet het wachtwoord vast in `.env` (zie `.env.example`) of je shell-profiel.
Een reeds gezette shell- of systemd-omgevingsvariabele wint altijd van `.env`.

Modelkeuze, systeemprompt, temperature en context-lengte zijn in de UI zelf
te kiezen (per gesprek, vast na het eerste bericht) — `OLLAMA_MODEL` is
alleen nog de fallback.

Ingebouwde limieten (niet via env-var instelbaar, aan te passen in `app.py`
als dat nodig is): max. 4 afbeeldingen per bericht (10MB elk), max. 3
bijlagen (bestand of URL) per bericht (60.000 tekens elk), max. 10
URL-ophaalverzoeken per minuut.

## Starten

**Met HTTPS (aanbevolen):**

```bash
export OLLAMA_UI_PASS='kies-hier-een-sterk-wachtwoord'
python run.py
```

Genereert bij de eerste run automatisch een zelfondertekend certificaat in
`certs/` (geldig voor `localhost` en de gedetecteerde LAN-IP's van deze
machine) en start op `https://0.0.0.0:8443`. De browser toont bij het eerste
bezoek een "niet vertrouwd"-waarschuwing — dat hoort zo bij een
zelfondertekend certificaat; kies "Geavanceerd" → "toch doorgaan" op elk
apparaat. Zie `certs.py` voor de precieze kanttekeningen (wél bescherming
tegen passief meeluisteren, geen garantie tegen een actieve
man-in-the-middle).

Extra hostnamen (bijv. een mDNS-naam) toevoegen aan het certificaat:
`OLLAMA_UI_SSL_HOSTS="werkstation.local"`. Poort/host aanpassen via
`OLLAMA_UI_PORT`/`OLLAMA_UI_HOST`.

**Zonder HTTPS (platte HTTP, zoals voorheen):**

```bash
export OLLAMA_UI_PASS='kies-hier-een-sterk-wachtwoord'
uvicorn app:app --host 0.0.0.0 --port 8000
```

`--host 0.0.0.0` is nodig om bereikbaar te zijn voor andere apparaten op het
wifi-netwerk — met `127.0.0.1` (de uvicorn-default) is de UI alleen lokaal
bereikbaar.

## Bereikbaarheid op het wifi-netwerk

1. IP van de Linux machine opzoeken: `ip a` (meestal `192.168.x.x`)
2. Op andere apparaten op hetzelfde netwerk: `http://<dat-ip>:8000`
3. Linux firewall blokkeert de poort standaard. Eenmalig openzetten
   (poort 8443 voor `run.py`/HTTPS, of 8000 als je zonder HTTPS draait):
   ```bash
   sudo firewall-cmd --add-port=8443/tcp --permanent
   sudo firewall-cmd --reload
   ```
   (of alleen voor de sessie, zonder `--permanent`)

## Als achtergrondservice (optioneel)

Voor gebruik op de lange termijn, een systemd user-service:

```ini
# ~/.config/systemd/user/ollama-webui.service
[Unit]
Description=Ollama WebUI
After=network.target

[Service]
WorkingDirectory=%h/ollama-webui
Environment=OLLAMA_UI_PASS=kies-hier-iets-sterks
ExecStart=%h/ollama-webui/.venv/bin/python run.py
Restart=on-failure

[Install]
WantedBy=default.target
```

```bash
systemctl --user daemon-reload
systemctl --user enable --now ollama-webui
```

## Features

- **Modelkeuze per gesprek** — dropdown bovenin de sidebar, gevuld vanuit
  Ollama's `/api/tags`. Eenmaal gekozen bij het eerste bericht, daarna vast
  voor dat gesprek (voorkomt modelwissel midden in de context).
- **Systeemprompt, antwoordstijl (temperature), context-lengte** — instelbaar
  per gesprek via het uitklapbare "Instellingen"-paneel, ook vast na het
  eerste bericht. Antwoordstijl is een presetkeuze (Standaard/Feitelijk/
  Gebalanceerd/Creatief) i.p.v. een kaal getal, voor niet-technische
  gebruikers. Context leeg laten = Ollama's eigen model-default.
- **Markdown- en code-rendering** — met syntax-highlighting, gerenderd via
  lokaal gevendorde libraries, HTML gesaniticeerd met DOMPurify.
- **Kopieerknoppen** — per volledig antwoord én per codeblok afzonderlijk
  (beide verschijnen on hover).
- **Stop-knop** tijdens het streamen — breekt de generatie af via
  `AbortController`; wat er al gestreamd was, blijft bewaard in de
  geschiedenis.
- **HTTP Basic Auth** — app-brede FastAPI-dependency (`Depends`), geldt voor
  elke route inclusief de vendor-bestanden. `/docs` en `/openapi.json` staan
  uit (die vallen buiten FastAPI's app-brede dependencies-lijst, dus zouden
  anders ongeauthenticeerd bereikbaar blijven).
- **Tokens/sec-statistieken** — na elk antwoord: aantal tokens, tok/s en
  duur, uit Ollama's eigen `eval_count`/`eval_duration`. Opgeslagen per
  bericht, dus ook zichtbaar bij het heropenen van een ouder gesprek.
- **Gesprekken hernoemen en exporteren** — via het "⋯"-menu per gesprek in
  de sidebar: hernoemen (inline), exporteren als `.md` of `.json`.
- **Afbeeldingen als input** — bijvoegen via de 📎-knop in de composer (max
  4 per bericht, 10MB per stuk), voor vision-modellen zoals `qwen2.5vl`.
  Afbeeldingen worden mee-opgeslagen in de gespreksgeschiedenis (base64 in
  SQLite) zodat ze ook na een herstart zichtbaar blijven.
- **Snelkoppelingen (`/`-commands)** — typ `/` in het invoerveld voor een
  lijst voorgedefinieerde instructie-templates (vertalen, samenvatten,
  uitleggen, etc.), navigeerbaar met pijltjestoetsen. Lijst staat hardcoded
  in `SLASH_COMMANDS` bovenin het script — daar zelf aan te passen.
- **Streamingprotocol**: newline-delimited JSON (`{"type": "content"|"thinking"|"error"|"done", ...}`)
  in plaats van platte tekst, nodig om stats/redenering na afloop mee te
  sturen zonder ze door de zichtbare tekst te laten lekken.
- **Redenering tonen** (reasoning/thinking-modellen) — bij modellen die
  Ollama's `think`-veld ondersteunen (`deepseek-r1`, `qwen3`, `gpt-oss`, etc.)
  verschijnt de redeneertekst live in een inklapbaar blok boven het
  antwoord, dat automatisch dichtklapt zodra het echte antwoord begint.
  Wordt mee-opgeslagen en blijft zichtbaar (dichtgeklapt) bij het heropenen
  van een gesprek. `think: true` staat altijd aan in de aanvraag — bij
  modellen zonder redeneervermogen gebeurt er dan simpelweg niets.
- **Code-paneel** — codeblokken van meer dan 3 regels krijgen een
  "paneel ⧉"-knop die het blok in een los paneel rechts opent, met
  syntax-highlighting, een eigen kopieerknop en een downloadknop (bestands-
  extensie afgeleid uit de gedetecteerde taal).
- **Tekstbestand/URL als context** — 📄-knop voor het bijvoegen van een
  tekstbestand (uitgelezen in de browser, geen upload naar de server nodig
  tenzij via de URL-route), 🔗-knop om een webpagina op te halen en als
  context mee te sturen. Zie de aparte "URL ophalen"-sectie hieronder voor
  de veiligheidsmaatregelen. Bijlage-inhoud wordt bij het versturen expliciet
  als niet-vertrouwd gemarkeerd in de prompt naar het model, om
  prompt-injectie vanuit een kwaadaardige pagina of bestand te beperken.
- **Bericht bewerken + regenereren** — "✎ bewerk" op elk eigen bericht
  (past de tekst aan, verwijdert alles wat daarna kwam, genereert een
  nieuw antwoord); "↻ regenereer" op het laatste antwoord (vervangt het
  zonder de vraag opnieuw te hoeven typen). Beide routes lopen via
  `/api/conversations/{id}/regenerate`, dat een nieuw antwoord genereert
  op basis van de bestaande geschiedenis zonder een nieuw gebruikersbericht
  toe te voegen.
- **HTTPS met zelfondertekend certificaat** — `python run.py` in plaats van
  `uvicorn app:app`, zie de "Starten"-sectie hierboven.
- **Brute-force-bescherming op inloggen** — na 5 mislukte pogingen vanaf
  hetzelfde IP binnen 5 minuten wordt verder inloggen (ook met het juiste
  wachtwoord) tijdelijk geblokkeerd (429, met `Retry-After`-header).
- **Volledige Content-Security-Policy** — niet alleen clickjacking
  (`frame-ancestors 'none'` + `X-Frame-Options: DENY`), maar ook:
  `script-src 'self'` en `style-src 'self'` (geen inline JS/CSS meer
  toegestaan — vandaar de verhuizing naar `static/app.js`/`static/app.css`),
  `img-src 'self' data:` (geen externe afbeeldingen), `connect-src 'self'`,
  `object-src 'none'`, `base-uri 'none'`, `form-action 'self'`.
- **Externe afbeeldingen in modeloutput geblokkeerd, dubbel** — naast de
  CSP (`img-src`) strippen we ook actief elke `<img>` met een niet-`data:`-
  bron via een DOMPurify-hook (`afterSanitizeAttributes`) vóórdat het in de
  pagina komt. Voorkomt dat markdown als `![x](https://tracker.example/p.png)`
  in een modelantwoord een externe request veroorzaakt (IP-/metadata-lekkage,
  potentieel via indirecte prompt-injectie vanuit een bijgevoegd
  bestand/webpagina). Lokale `data:`-afbeeldingen (eigen uploads) blijven
  gewoon werken.
- **URL-fetch is écht streaming-begrensd** — telt ontvangen bytes tijdens
  `aiter_bytes()` en breekt de verbinding meteen af zodra `MAX_FETCH_BYTES`
  wordt overschreden, in plaats van pas te controleren nadat de hele
  response is ingelezen. Beschermt tegen chunked responses zonder
  `Content-Length` en tegen een `Content-Length`-header die liegt. De
  `Content-Length`-check blijft daarnaast bestaan als vroege optimalisatie
  (voorkomt onnodig downloaden wanneer de header wél klopt).
- **URL-fetch negeert proxy-omgevingsvariabelen** — `trust_env=False` op de
  `httpx.AsyncClient` die externe URLs ophaalt, zodat `HTTP_PROXY`/
  `HTTPS_PROXY`/`ALL_PROXY` uit de omgeving de netwerkroute niet stilzwijgend
  kunnen beïnvloeden of de SSRF-checks kunnen omzeilen.
- **Afbeeldingen: validatie op inhoud, niet op claim** — het bestandstype
  wordt herkend aan de eerste bytes (magic numbers: PNG/JPEG/GIF/WEBP/BMP),
  niet vertrouwd op een naam of Content-Type die de client meestuurt.
  Voorkomt zowel het per ongeluk versturen van niet-afbeeldingsdata als het
  bewust omzeilen van de bestandstype-check. Loste ook een weergavebug op:
  afbeeldingen werden voorheen gerenderd met het ongeldige MIME-type
  `image/*`, wat in sommige browsers niets liet zien.

### URL ophalen — veiligheidsmaatregelen

Het ophalen van een URL als context (🔗-knop) is een klassiek SSRF-risico
(server-side request forgery) op een LAN: zonder bescherming zou een
gemanipuleerde prompt de server kunnen laten praten met interne diensten
(`192.168.x.x`, `169.254.169.254`, etc.). Ingebouwde maatregelen:

- Alleen `http`/`https`, geen `file://` en dergelijke.
- DNS wordt vooraf geresolved en **elk** geresolved IP wordt getoetst aan een
  allowlist (`ip.is_global`, met multicast er expliciet nog bovenop uitgesloten
  — zie code-comment bij `_is_safe_host`) i.p.v. losse blocklists per
  adrescategorie, vóór het daadwerkelijke request.
- Redirects worden niet automatisch gevolgd — elke hop wordt apart opnieuw
  gevalideerd (max. 5 hops). `Location`-headers mogen relatief zijn
  (`/login`, `../pagina`); die worden via `urljoin` omgezet naar een absolute
  URL vóór validatie.
- Timeout (8s connect / 15s totaal) en een écht streaming-begrensde
  paginagrootte (3MB) — de bytentelling loopt mee tijdens het ontvangen
  (`aiter_bytes()`), niet pas achteraf, dus ook chunked responses zonder
  `Content-Length` of met een liegende header worden op tijd afgebroken.
- `trust_env=False`: proxy-omgevingsvariabelen (`HTTP_PROXY` etc.) worden
  genegeerd, zodat die de netwerkroute of de SSRF-checks niet kunnen
  beïnvloeden.
- Rate limiting: max. 10 fetches per minuut, globaal (niet per gebruiker —
  zie bewuste afwegingen).
- Opgehaalde tekst wordt geëxtraheerd met BeautifulSoup (scripts/styles
  verwijderd) en expliciet als niet-vertrouwde inhoud gemarkeerd in de
  prompt naar het model.

**Bewust resterend risico — DNS-rebinding**: de IP-check en de daadwerkelijke
verbinding zijn twee aparte stappen. Een aanvaller die de DNS-respons van
een domein tussen die twee stappen wijzigt (rebinding), omzeilt de check in
theorie. Een volledig waterdichte oplossing zou het geresolved IP moeten
vastzetten voor de TCP-verbinding zelf (met correcte TLS/SNI-afhandeling) —
dat is met `httpx` niet triviaal en is voor dit MVP bewust achterwege
gelaten, passend bij het dreigingsmodel van een klein, vertrouwd LAN met
één gebruiker. Bij blootstelling aan een groter/onbekend netwerk zou dit
alsnog dichtgetimmerd moeten worden.

## Bewuste security-afwegingen (MVP-scope)

Dit is gebouwd voor een vertrouwd thuis-wifi-netwerk, niet voor blootstelling
aan het open internet.

- **HTTPS is optioneel, geen harde vereiste** — `python run.py` biedt
  encryptie tegen passief meeluisteren, maar met een zelfondertekend
  certificaat, dus geen garantie tegen een actieve man-in-the-middle
  (tenzij je het certificaat handmatig vertrouwt op elk apparaat). Draai je
  toch met platte `uvicorn app:app` (HTTP), dan gaan credentials in platte
  tekst over het netwerk — op een vertrouwd wifi-netwerk een geaccepteerd
  risico.
- **Rate limiting op chatberichten zelf ontbreekt nog** — de inlog-lockout
  beschermt tegen brute-forcen van het wachtwoord, maar wie eenmaal is
  ingelogd kan onbeperkt berichten sturen en zo de Ollama-instance belasten.
  Voor een groter/onbekend gebruikersgroep: `slowapi` of een proxy-laag
  toevoegen.
- **Brute-force-lockout is per IP, niet per account, en niet persistent** —
  een herstart van de app reset de teller. Voor dit dreigingsmodel (klein
  vertrouwd netwerk) voldoende; geen bescherming tegen een aanvaller die
  bewust IP's rouleert.
- **Eén gedeeld account, één gedeelde SQLite-pot** — geen per-gebruiker
  accounts of gespreksscheiding. Voldoende voor een klein huishouden; bij
  meer gebruikers zou je losse accounts en een echte sessie/token-laag
  willen.
- **Geen input-sanitisatie richting het model** — berichten gaan ongefilterd
  naar Ollama (behalve lengte-limiet van 8000 tekens). Modelrespons wordt wél
  gesaniticeerd vóór weergave (DOMPurify), om XSS via een gemanipuleerde
  modelrespons te voorkomen.
- **Afbeeldingen als base64 in SQLite** — eenvoudig en consistent met de
  rest van de opslag, maar niet ruimte-efficiënt bij veel/grote afbeeldingen.
  Bij zwaar gebruik zou losse bestandsopslag (met alleen een pad in de
  database) beter schalen.
- **URL-fetch rate limiting is globaal, niet per gebruiker** — bij meerdere
  mensen op het LAN delen ze dezelfde limiet van 10/minuut. Voor een klein
  huishouden geen probleem; bij meer gebruikers zou per-IP of per-sessie
  rate limiting nodig zijn.
- **Bijlage-inhoud (bestand/URL) wordt gemarkeerd als niet-vertrouwd, niet
  actief gefilterd** — de untrusted-content-framing in de prompt is een
  zachte maatregel (afhankelijk van of het model zich eraan houdt), geen
  harde garantie tegen prompt-injectie.

## Bekende beperkingen

- Geen instellingen aanpasbaar na het eerste bericht (bewuste keuze, zie
  hierboven) — wel zichtbaar (read-only) bij het heropenen van een gesprek.
- Geen multimodale input aan de kant van het model-antwoord — vision-modellen
  kunnen afbeeldingen lezen (als input), maar antwoorden blijven platte tekst.
- Geen automatische detectie of het gekozen model vision ondersteunt — de
  📎-knop is altijd zichtbaar; bij een niet-vision-model geeft Ollama zelf
  een foutmelding terug, die als error-event in de UI verschijnt.
- Geen text-to-image — Ollama's experimentele image-generatie (Z-Image,
  FLUX.2 Klein) is macOS-only; op Linux niet beschikbaar. Voor lokale
  text-to-image op Linux is een apart tool nodig (ComfyUI, Automatic1111,
  InvokeAI), buiten de scope van deze chat-UI.
- highlight.js is als volledige taalbundel gevendord (~1MB) voor brede
  taaldekking zonder build-stap; bij bandbreedteproblemen op het LAN is een
  kleinere subset-bundle te bouwen met alleen veelgebruikte talen.
- De DOMPurify-hook tegen externe afbeeldingen richt zich specifiek op
  `<img>`-tags uit markdown (de enige realistische vector die `marked.js`
  produceert). CSS-`url()`-achtige vectoren zijn niet apart getest, maar
  vallen al onder dezelfde CSP (`img-src`/`style-src`) als extra laag.
