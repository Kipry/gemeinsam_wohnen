# Rechtliches: Auftragsverarbeitung und offene Punkte

Interne Arbeitsliste, nicht zur Veröffentlichung. Kein Rechtsrat — vor dem öffentlichen Release
einmal prüfen lassen (Verbraucherzentrale, Fachanwalt oder ein Dienst wie eRecht24).

## Was ein Auftragsverarbeitungsvertrag (AVV) ist

Verantwortlicher ist, wer über die Daten entscheidet — hier du. Auftragsverarbeiter ist jeder Dienst,
der personenbezogene Daten **in deinem Auftrag** verarbeitet, ohne selbst über den Zweck zu
entscheiden: der Hoster, der Push-Weiterleiter, später die Fehlerüberwachung. Für jeden davon
verlangt Art. 28 DSGVO einen Vertrag, der Zweck, Dauer, Weisungsbindung, Sicherheit,
Unterauftragnehmer, Löschung und Prüfrechte regelt. In der Praxis ist das ein Standardtext des
Anbieters, den man annimmt oder unterschreibt — meist im Kundenkonto.

Nicht jeder Dienstleister ist Auftragsverarbeiter: Apple ist beim Verkauf der App **eigener
Verantwortlicher** (Händler), dafür braucht es keinen AVV, wohl aber einen Hinweis in der
Datenschutzerklärung.

## Wen es hier betrifft

| Dienst | Rolle | Was zu tun ist |
| --- | --- | --- |
| **Supabase Inc.** (Datenbank, Anmeldung, Dateispeicher) | Auftragsverarbeiter | AVV im Dashboard unter der Organisation → Einstellungen → rechtliche Dokumente annehmen bzw. bei Supabase anfragen, falls im Gratis-Tarif nicht angeboten. Danach die Liste der Unterauftragnehmer speichern (u. a. AWS, Region Frankfurt). |
| **Amazon Web Services** | Unterauftragnehmer von Supabase | Kein eigener Vertrag nötig, nur in der eigenen Doku vermerken. |
| **650 Industries („Expo")** – Push-Weiterleitung, Build-Dienst | Auftragsverarbeiter | AVV anfragen bzw. im Konto annehmen. Expo sieht mehr als nur den Geräte-Token: `send_push` übergibt Titel und Text im Klartext, also Namen, Chat-Inhalte, Ausgabentitel samt Beträgen und den WG-Namen. Verkleinern geht über inhaltsarme Mitteilungen (Token bleibt, Vertrag bleibt nötig) oder indem man direkt an Apple sendet und den Dienstleister ganz einspart. |
| **Apple** – App Store, TestFlight, Anmeldung mit Apple, Zustellung der Mitteilungen | eigener Verantwortlicher; für Teile Auftragsverarbeiter nach dem Entwicklervertrag | Kein separater AVV; im Entwicklerprogramm enthalten. In der Datenschutzerklärung nennen. |
| **Google** (später, Play Store und FCM) | wie Apple | Erst bei Android relevant. |
| **Fehlerüberwachung** (z. B. Sentry), falls eingebaut | Auftragsverarbeiter | AVV abschließen, EU-Region wählen, personenbezogene Daten aus den Berichten heraushalten. |
| **RevenueCat** (falls für Käufe genutzt) | Auftragsverarbeiter | AVV abschließen; Kaufdaten enthalten Gerätekennungen. |

Alles, was aus der EU heraus geht (Supabase Inc., Expo, Apple), braucht zusätzlich eine Grundlage
für den Drittlandtransfer: Standarddatenschutzklauseln oder Zertifizierung nach dem EU-US Data
Privacy Framework. Beim Anbieter nachlesen und den Nachweis ablegen.

## Was du außerdem schriftlich brauchst

1. **Verzeichnis von Verarbeitungstätigkeiten** (Art. 30). Eine Tabelle genügt: Zweck,
   Datenkategorien, Betroffene, Empfänger, Drittland, Löschfristen, Sicherheitsmaßnahmen. Die
   Ausnahme für kleine Anbieter gilt hier nicht, weil die Verarbeitung nicht gelegentlich ist.
2. **Technische und organisatorische Maßnahmen** (Art. 32). Bei dieser App belegbar: Zugriff pro
   Datenzeile in der Datenbank geprüft (RLS), verschlüsselte Übertragung, Belege in nicht
   öffentlichem Speicher mit zeitlich begrenzten Links, Passwörter nur als Hash, Zwei-Faktor beim
   Supabase-Konto, Backups.
3. **Löschkonzept.** Was passiert beim Verlassen einer WG, beim Löschen des Kontos, mit Belegen,
   Push-Token und Chat. Der Code macht das bereits; es muss nur beschrieben sein.
4. **Prozess für Betroffenenanfragen.** Auskunft nach Art. 15 innerhalb eines Monats. Heute nur von
   Hand möglich — eine Export-Funktion in der App wäre die saubere Lösung.
5. **Datenschutz-Folgenabschätzung** ist voraussichtlich nicht nötig (keine Profilbildung, keine
   besonderen Kategorien, kleine Gruppen). Ein kurzer Aktenvermerk mit dieser Begründung genügt.

## Offene Punkte aus der Technik-Analyse

- Keine Aufbewahrungsfristen: Chat und Belege wachsen unbegrenzt. Frist festlegen (z. B. Chat 24
  Monate) und automatisch löschen.
- Push-Inhalte enthalten Klartext (Chat-Text, Beträge). Entweder in der Erklärung nennen (ist
  geschehen) oder inhaltsarme Mitteilungen verschicken.
- Kein Mindestalter-Hinweis in der App selbst; die Erklärung nennt 16 Jahre.
- Belegfotos können fremde Daten enthalten. Hinweis beim Fotografieren wäre gut.
- Für App Store Connect: den Fragebogen „App-Datenschutz" passend zu dieser Erklärung ausfüllen
  (Kontaktdaten, Nutzerinhalte, Kennungen; kein Tracking, keine Werbung).
