# Website: Einladungsseite, Datenschutz, Impressum

Der Ordner `web/` ist die komplette Website — alles darin wird veröffentlicht, deshalb liegt diese
Anleitung hier und nicht dort.

| Datei | Adresse | Inhalt |
| --- | --- | --- |
| `web/index.html` | `/` | Kurze Vorstellung, Knopf zu TestFlight |
| `web/join/index.html` + `join.js` | `/join/?code=ABC123` | Einladung: Code, „In der App öffnen", Installationsweg |
| `web/datenschutz.html` | `/datenschutz.html` | Datenschutzerklärung |
| `web/impressum.html` | `/impressum.html` | Impressum |
| `web/404.html` | jede unbekannte Adresse | „Seite nicht gefunden" mit Hinweis auf den Code |
| `web/_headers` | – | Sicherheits-Header für Cloudflare Pages (strikte Content-Security-Policy, kein Referrer) |

Kein Build, keine Abhängigkeiten, keine Cookies, nichts von Dritten. Wegen der strikten
Content-Security-Policy keine Inline-Skripte und keine `style="…"`-Attribute verwenden — Skripte als
eigene Datei, Abstände über Klassen in `style.css`.

Die Einladungsseite und die 404-Seite verweisen mit absoluten Pfaden (`/style.css`), weil Cloudflare
sie unter mehreren Adressen ausliefert. Ohne `404.html` würde Cloudflare jede unbekannte Adresse mit
der Startseite beantworten (Single-Page-App-Verhalten).

Der Installationsknopf zeigt bis zum Store-Release auf den öffentlichen TestFlight-Link. Nach dem
Release in `index.html` und `join/index.html` durch den App-Store-Link ersetzen und den
TestFlight-Hinweis entfernen. Bei inhaltlichen Änderungen an der App das Datum in der
Datenschutzerklärung mitziehen.

## Veröffentlichen: Cloudflare Pages mit GitHub

Einmal einrichten, danach aktualisiert sich die Seite bei jedem Push auf `main` von selbst.

1. Kostenloses Konto auf [dash.cloudflare.com](https://dash.cloudflare.com) anlegen. Die Frage nach
   einer eigenen Domain überspringen.
2. Links **Workers & Pages** → **Create application** → Reiter **Pages** → **Connect to Git**.
   Zeigt Cloudflare nur Workers-Optionen, ganz unten den Verweis auf Pages nehmen — nicht „Import a
   repository" bei Workers, das ist ein anderes Produkt.
3. GitHub verbinden. Im GitHub-Fenster **Only select repositories** wählen und nur
   `gemeinsam_wohnen` freigeben → **Install & Authorize**.
4. Repository auswählen → **Begin setup**.
5. Einstellungen:
   - **Project name:** z. B. `gemeinsam-wohnen` (ergibt `gemeinsam-wohnen.pages.dev`, falls frei)
   - **Production branch:** `main`
   - **Framework preset:** `None`
   - **Build command:** leer lassen (nur falls das Feld etwas verlangt: `exit 0`)
   - **Build output directory:** `web`
   - **Root directory:** nicht ändern
   - **Environment variables:** `SKIP_DEPENDENCY_INSTALL` = `1` — sonst installiert Cloudflare
     womöglich bei jedem Deploy die ganze Expo-App, obwohl nur `web/` gebraucht wird.
6. **Save and Deploy**. Nach etwa einer Minute steht die Adresse oben im Projekt.

Im Projekt unter **Metrics** die **Web Analytics nicht einschalten**: Cloudflare würde dann ein
Mess-Skript in jede Seite einbauen — das widerspräche der Datenschutzerklärung und würde von der
Content-Security-Policy ohnehin blockiert.

Prüfen: `https://<projekt>.pages.dev/join/?code=ABC123` zeigt den Code, `/datenschutz.html` und
`/impressum.html` laden, eine ausgedachte Adresse zeigt „Diese Seite gibt es nicht", und in den
Entwicklerwerkzeugen des Browsers steht bei den Antwort-Headern `Content-Security-Policy`.

**Ohne GitHub-Anbindung:** Unter **Create application** → **Pages** → **Upload assets** lässt sich der
Ordner `web` auch per Drag-and-Drop hochladen. Dann muss man ihn nach jeder Änderung neu hochladen.

**Eigene Domain** (optional, etwa 10–20 € im Jahr): im Pages-Projekt unter **Custom domains**.

## Danach in der App und im App Store

1. In `src/lib/links.ts` die Adresse eintragen, z. B. `https://gemeinsam-wohnen.pages.dev`. Dann
   verschickt die Einladung den https-Link, und unter „Mehr" erscheinen Datenschutz und Impressum.
   Wirkt ab dem nächsten Build.
2. In App Store Connect bei der App: **Datenschutzrichtlinie-URL** auf `…/datenschutz.html`, als
   Support-URL die Startseite.

## Später: Universal Links

Damit der Link die App direkt öffnet, statt zuerst die Seite zu zeigen:

1. Datei `web/.well-known/apple-app-site-association` (ohne Endung):
   ```json
   { "applinks": { "details": [{ "appIDs": ["TEAMID.com.kipry.gemeinsamwohnen"], "components": [{ "/": "/join*" }] }] } }
   ```
2. In `web/_headers` ergänzen:
   ```
   /.well-known/apple-app-site-association
     Content-Type: application/json
   ```
3. In `app.json` unter `ios`: `"associatedDomains": ["applinks:<deine-domain>"]` — und neu bauen, weil das
   in die App-Signatur eingeht.

Ohne diesen Schritt funktioniert die Seite trotzdem: „In der App öffnen" startet die App über
`gemeinsamwohnen://`.
