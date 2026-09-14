# Gemeinsam Wohnen

WG-App für Putzplan, Einkaufsliste, Kostenaufteilung, Kalender, Chat und eine
Fairness-Statistik (wer hat wie viel im Haushalt gemacht).

**Stack:** Expo (React Native, TypeScript) + Supabase (Postgres, Auth, Realtime, Storage,
Edge Functions, pg_net/pg_cron für Push).

## Features

| Bereich | Was drin ist |
| --- | --- |
| **Login** | E-Mail + Passwort, „Mit Apple anmelden" (iOS) |
| **WGs** | WG erstellen oder beitreten — per Einladungslink, QR-Code oder 6-stelligem Code. Nach dem Gründen führt ein Assistent durch Mitbewohner und Putzplan: noch nicht beigetretene Mitbewohner werden als Platzhalter vorgemerkt und stehen sofort in der Rotation; wer beitritt, wählt „Ich bin Lisa" und übernimmt Platz und Termine. Ein Account kann in mehreren WGs sein |
| **Putzplan** | Wiederkehrende Aufgaben mit Punkten, Intervall und optional festem Wochentag. Zuteilung wahlweise: *wer mag*, *reihum an Personen*, *reihum an Teams*, *feste Person*. Termine werden vier Wochen im Voraus geplant — Ansicht „Plan" zeigt sie nach Wochen gruppiert, „Routinen" jede angelegte Aufgabe einmal mit Rhythmus, Reihenfolge und nächstem Termin. Jede Routine kann eine Checkliste und eine Notiz haben (Vorlagen bringen passende Listen mit); beim Antippen einer Aufgabe hakt man die Punkte ab — der Bildschirm bleibt dabei an, Haken von Mitputzenden erscheinen live. Vorlagen für die häufigsten WG-Aufgaben. Abhaken ist rückgängig zu machen, Aufgaben lassen sich bearbeiten (Name, Punkte, Notiz und Checkliste ändern den Plan nicht), pausieren und löschen |
| **Teams** | Putz-Teams anlegen und Mitglieder zuordnen — Aufgaben können reihum an ganze Teams gehen |
| **Tracking** | Statistik pro Person: erledigte Aufgaben, Punkte, Pünktlichkeitsquote, offene und überfällige Zuweisungen, Vergleich zum WG-Durchschnitt |
| **Monatsrückblick** | Pro Monat: Gesamtausgaben mit Vergleich zum Vormonat und eigenem Anteil, Ausgaben nach Kategorie, wer was bezahlt und getragen hat, Putzpunkte und Pünktlichkeit pro Person |
| **Kosten** | Ausgaben mit eingebautem Rechen-Keypad erfassen („12,50+8,30" ergibt live 20,80 €). Aufteilung gleichmäßig, mit festen Beträgen oder nach Anteilen (1:2 bei ungleich großen Zimmern). Beteiligte per Häkchen, Kategorie-Chips, Foto vom Kassenbon (Kamera oder Galerie, privat pro WG gespeichert). Saldo pro Person, Vorschlag „wer zahlt wem" mit möglichst wenigen Überweisungen. Ausgaben lassen sich öffnen, korrigieren und löschen |
| **Einkauf** | Liste nach Regalreihenfolge sortiert, Kategorie wird beim Tippen geraten. Vorschläge aus der WG-Historie, Dublettenerkennung, Mengen-Stepper, Realtime-Sync, Löschen mit Rückgängig. „Ich kauf ein" öffnet eine Einkaufs-Sitzung; am Ende wird daraus mit einem Betrag eine geteilte Ausgabe — ohne alles zweimal zu tippen |
| **Feste Kosten** | Miete, Strom, Streaming einmal anlegen; die App bucht die Ausgabe monatlich selbst und holt verpasste Monate nach |
| **Kalender** | Monatsansicht mit gemeinsamen Terminen (Termin, WG-Abend, Besuch, Handwerker, Geburtstag), Abwesenheiten und den eigenen Putzaufgaben. Termine mit Uhrzeit oder ganztägig, auch mehrtägig (als durchgehender Balken über die Tage), mit Zusage-Liste — beim Handwerker heißt die Zusage „Ich mache auf". Abwesenheit per Chip für den angetippten Tag, Heute, Morgen, Wochenende oder nächste Woche; Abwesende werden aus geplanten Rotations-Terminen herausgenommen und der weitere Plan neu verteilt |
| **Müllabfuhr** | Tonnen einmal eintragen (Art, Abholtag, Rhythmus) — die Abholtage erscheinen als Tonnen-Symbole im Kalender, der Putzplan zeigt am Vortag „Heute Abend rausstellen". Einzelne Abholungen lassen sich im Kalender verschieben oder ausfallen lassen (Feiertage); am Vorabend kommt eine Mitteilung. Auf Wunsch wird „Mülltonnen rausstellen" zur rotierenden Putzplan-Aufgabe |
| **Chat** | Pinnwand statt Messenger: erledigte Aufgaben, neue Ausgaben, Termine und Abwesenheiten erscheinen als Ereigniskarte im Verlauf. Aushänge kleben oben, bis alle „Verstanden" getippt haben; Bitten haben einen „Mach ich"-Knopf |
| **Mitteilungen** | Push bei Chat-Nachrichten, Aushängen und Bitten („Ben kümmert sich drum"), neuen Ausgaben mit dem eigenen Anteil, Rückzahlungen, „Ben geht einkaufen", neuen Terminen und Abwesenheiten, neuen Mitbewohnern, wenn jemand die eigene Aufgabe übernommen hat und am Vorabend der Müllabfuhr. Erinnerung, wenn man dran ist — zur selbst gewählten Uhrzeit: morgens für heute oder abends für morgen. Jeder Bereich einzeln abschaltbar; ein Tipp öffnet den passenden Bildschirm in der richtigen WG |
| **Bedienung** | Dunkelmodus (folgt dem System), eigenes App-Icon in Hell/Dunkel/Getönt, kurzes Vibrieren beim Abhaken, Erledigen und Bezahlen, Listen per Herunterziehen aktualisieren |
| **Konto** | WG verlassen (Putz-Plätze werden neu verteilt) und Konto löschen. Ausgaben und Salden bleiben für die anderen stimmig — statt des Namens steht dort „Ehemaliges Mitglied"; Persönliches wie Chat-Nachrichten und Abwesenheiten wird gelöscht |

## Setup

### 1. Supabase

Das Projekt **`gemeinsam-wohnen`** (Region eu-central-1) ist bereits angelegt; alle
Migrationen aus `supabase/migrations/` sind eingespielt.

Für eine lokale `.env`:

```
EXPO_PUBLIC_SUPABASE_URL=https://avrgpupxlzmyyqojcquu.supabase.co
EXPO_PUBLIC_SUPABASE_ANON_KEY=<Publishable Key aus Project Settings → API Keys>
```

Für ein frisches Supabase-Projekt: die Dateien in `supabase/migrations/` in dieser
Reihenfolge im SQL-Editor ausführen.

### 2. App starten

```bash
npm install
npm start
```

Dann `i` (iOS Simulator), `a` (Android) oder `w` (Web) drücken.

### 3. Apple-Anmeldung aktivieren

Der Button erscheint nur auf iOS und braucht zwei Dinge, die noch offen sind:

1. **Apple Developer Program** ($99/Jahr): App-ID `com.kipry.gemeinsamwohnen` anlegen,
   Capability *Sign in with Apple* aktivieren.
2. **Supabase**: Authentication → Sign In / Providers → Apple aktivieren und die Bundle-ID
   `com.kipry.gemeinsamwohnen` als Client-ID eintragen.

Außerdem läuft Apple-Login **nicht in Expo Go** — dafür braucht es einen Development Build
(`npx expo run:ios` oder EAS Build), weil Expo Go eine fremde Bundle-ID nutzt.

### 4. Push-Benachrichtigungen

Die Datenbank verschickt die Mitteilungen selbst (Trigger → `send_push` → pg_net →
Expo-Push-API). Die Putz-Erinnerung läuft stündlich als pg_cron-Job `putz-erinnerungen` und
erreicht jeweils die, deren gewählte Stunde gerade ist.
Für iOS braucht der Build einen APNs-Schlüssel — `eas build` fragt beim ersten Build mit
`expo-notifications` danach und legt ihn an. In Expo Go gibt es keinen Push-Token.

### 5. Konto löschen und Apple

Die Edge Function `delete-account` löscht Konto und Daten. Für App-Store-Releases verlangt
Apple bei „Mit Apple anmelden" zusätzlich, dass die Anmeldung dabei widerrufen wird. Dafür in
Supabase unter Edge Functions → Secrets setzen (Schlüssel aus dem Apple Developer Portal,
Keys → *Sign in with Apple*):

```
APPLE_TEAM_ID=...
APPLE_KEY_ID=...
APPLE_PRIVATE_KEY=-----BEGIN PRIVATE KEY-----...
```

Ohne diese Secrets wird trotzdem gelöscht, nur nicht bei Apple widerrufen.

### 6. E-Mail-Bestätigung

Supabase verlangt bei neuen Projekten eine E-Mail-Bestätigung vor dem ersten Login. Wer das
für den Anfang nicht will: Authentication → Sign In / Providers → Email → *Confirm email*
ausschalten.

## Datenmodell

```
profiles ─┬─ household_members ─── households
          │                            │
          │                            ├── household_placeholders
          │                            ├── teams ── team_members
          │                            ├── tasks ── task_rotation
          │                            │        ├── task_occurrences   (Termine + Erledigung)
          │                            │        └── task_checklist_items ── task_checklist_checks (je Tag)
          │                            ├── shopping_items
          │                            ├── absences
          │                            ├── calendar_events ── calendar_event_attendees
          │                            ├── waste_bins ── waste_bin_changes
          │                            ├── chat_messages ── chat_receipts
          │                            ├── shopping_trips
          │                            ├── recurring_expenses ── recurring_expense_shares
          │                            └── expenses ── expense_shares
          ├────────────────────────────── settlements
          └── push_tokens, notification_prefs
```

Gelöschte Konten: Das Profil bleibt als anonymes „Ehemaliges Mitglied" stehen, damit
Ausgaben und Salden der anderen nicht kippen. Aufgeräumt wird per Trigger auf `auth.users`
(`handle_deleted_user` → `remove_member`) — auch beim Löschen über das Dashboard.

Views: `chore_stats_view` (Putz-Tracking), `expense_balance_view` (Salden),
`occurrence_responsibles` (wer ist für einen Termin zuständig, inkl. Teams).

**Sicherheit:** Auf allen Tabellen ist Row Level Security aktiv — man sieht ausschließlich
Daten der eigenen WGs. Schreibvorgänge, die mehrere Tabellen betreffen oder geprüft werden
müssen, laufen über Datenbankfunktionen (z.B. `create_household`, `join_household_by_code`,
`create_task`, `complete_occurrence`, `create_expense`, `claim_placeholder`, `leave_household`).
Interne Helfer wie `send_push` oder `remove_member` sind für App-Nutzer gesperrt.

Beträge werden durchgängig als Cent (`bigint`) gespeichert, nie als Fließkommazahl.

Der Supabase-Security-Advisor meldet für diese Funktionen Warnungen („SECURITY DEFINER
function executable") — das ist hier beabsichtigt: jede dieser RPCs prüft intern die
Mitgliedschaft, und die Hilfsfunktionen `is_household_member` / `is_household_owner` /
`shares_household_with` beantworten ausschließlich Fragen über den Aufrufer selbst.
Offen ist dagegen noch: *Leaked Password Protection* in Authentication → Policies
einschalten.

## Projektstruktur

```
app/                 Screens (Expo Router, dateibasiertes Routing)
  (auth)/            Login, WG erstellen/beitreten
  (tabs)/            Putzplan, Einkauf, Kosten, Kalender, Chat ("Mehr" über das Profil-Symbol oben rechts)
  new-task.tsx       Aufgabe anlegen (inkl. Rotationsreihenfolge)
  new-expense.tsx    Ausgabe anlegen (inkl. Aufteilung)
  new-event.tsx, event/[id].tsx, new-absence.tsx
  onboarding.tsx, claim.tsx  WG-Einstieg und Übernahme eines Platzhalters
  more.tsx, review.tsx, teams.tsx, stats.tsx
  notifications.tsx, delete-account.tsx
  chore/[taskId].tsx  Aufgabe abarbeiten (Checkliste, Notiz, erledigen)
  waste.tsx, waste-bin.tsx, waste-change.tsx  Müllabfuhr
src/components/ui.tsx  Gemeinsame UI-Bausteine
src/lib/             Supabase-Client, Auth-/Household-Context, Geld-Helfer, Theme
src/types/           TypeScript-Typen der DB-Tabellen
supabase/migrations/ Datenbankschema
supabase/functions/  Edge Functions (delete-account)
```

## Ideen für später

- Widget für den Homescreen: „Heute dran" auf einen Blick
