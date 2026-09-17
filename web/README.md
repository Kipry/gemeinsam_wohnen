# Website: Einladungsseite, Datenschutz, Impressum

Drei statische Seiten, keine Abhängigkeiten, kein Build. `index.html` zeigt einen Einladungscode
aus `?code=ABC123` (oder `/join/ABC123`) und bietet „In der App öffnen" (`gemeinsamwohnen://join?code=…`)
sowie den Weg in den App Store.

## Vor dem Veröffentlichen ausfüllen

Alle Platzhalter stehen in doppelten Klammern und sind gelb hinterlegt:

| Platzhalter | Wo | Inhalt |
| --- | --- | --- |
| `[[APP_STORE_URL]]` | `index.html`, `join/index.html` | App-Store-Link; bis zum Release der öffentliche TestFlight-Link |

Name, Anschrift, Kontakt-E-Mail, Datum und Aufsichtsbehörde sind eingetragen. Bei jeder inhaltlichen
Änderung an der App das Datum in der Datenschutzerklärung mitziehen.

Die Texte sind ein Entwurf nach bestem Wissen, aber keine Rechtsberatung. Vor dem Release einmal
prüfen lassen.

## Veröffentlichen (kostenlos)

**Empfehlung: Cloudflare Pages.** Kostenlos, eigene Domain möglich, eigene HTTP-Header (die braucht
man später für Universal Links).

1. Auf [dash.cloudflare.com](https://dash.cloudflare.com) → Workers & Pages → Create → Pages →
   „Upload assets" (ohne Git) oder das Repo verbinden und als Projektordner `web` angeben.
2. Build-Befehl: leer. Ausgabeverzeichnis: `web` (bei Upload: den Ordnerinhalt hochladen).
3. Ergebnis: `https://<projekt>.pages.dev`. Eigene Domain später unter „Custom domains".

**Alternative: GitHub Pages.** Ebenfalls kostenlos, aber im Gratis-Tarif nur für öffentliche
Repositories. Da dieses Repo privat bleiben soll, wäre ein zweites, öffentliches Repo nötig, das nur
den Inhalt von `web/` enthält. Cloudflare erspart das.

**Eigene Domain** (z. B. `gemeinsam-wohnen.app`): rund 10–20 € im Jahr. Nicht nötig für den Start,
aber besser fürs Vertrauen — und der Datenschutz-Link steht später im App Store.

## In der App eintragen

Nach dem Veröffentlichen in `src/lib/links.ts` die Basis-Adresse setzen. Dann verschickt
`app/invite.tsx` `https://…/join/ABC123` statt des reinen App-Links, und unter „Mehr → Rechtliches"
sind Datenschutz und Impressum verlinkt.

Außerdem in App Store Connect eintragen: Datenschutz-URL (Pflichtfeld) und Support-URL.

## Später: Universal Links

Damit der Link die App direkt öffnet, statt zuerst Safari zu zeigen:

1. Datei `.well-known/apple-app-site-association` (ohne Endung) mit dem Inhalt:
   ```json
   { "applinks": { "details": [{ "appIDs": ["TEAMID.com.kipry.gemeinsamwohnen"], "components": [{ "/": "/join/*" }] }] } }
   ```
2. Muss als `application/json` ausgeliefert werden. Bei Cloudflare Pages über eine Datei `_headers`:
   ```
   /.well-known/apple-app-site-association
     Content-Type: application/json
   ```
3. In `app.json` unter `ios` ergänzen: `"associatedDomains": ["applinks:<deine-domain>"]` — und neu
   bauen, weil das in die App-Signatur eingeht.

Ohne diesen Schritt funktioniert die Seite trotzdem: Der Knopf „In der App öffnen" startet die App
über `gemeinsamwohnen://`.
