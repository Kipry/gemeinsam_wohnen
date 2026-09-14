# Gemeinsam Wohnen

WG-App für Putzplan, Einkaufsliste, Kostenaufteilung, Abwesenheiten, Chat und eine
Fairness-Statistik (wer hat wie viel im Haushalt gemacht).

**Stack:** Expo (React Native, TypeScript) + Supabase (Postgres, Auth, Realtime).

## Features

| Bereich | Was drin ist |
| --- | --- |
| **Login** | E-Mail + Passwort, „Mit Apple anmelden" (iOS) |
| **WGs** | WG erstellen oder beitreten — per Einladungslink, QR-Code oder 6-stelligem Code. Ein Account kann in mehreren WGs sein |
| **Putzplan** | Wiederkehrende Aufgaben mit Punkten, Intervall und optional festem Wochentag. Zuteilung wahlweise: *wer mag*, *reihum an Personen*, *reihum an Teams*, *feste Person*. Termine werden vier Wochen im Voraus geplant — Ansicht „Plan" zeigt sie nach Wochen gruppiert. Vorlagen für die häufigsten WG-Aufgaben. Abhaken ist rückgängig zu machen, Aufgaben lassen sich bearbeiten, pausieren und löschen |
| **Teams** | Putz-Teams anlegen und Mitglieder zuordnen — Aufgaben können reihum an ganze Teams gehen |
| **Tracking** | Statistik pro Person: erledigte Aufgaben, Punkte, Pünktlichkeitsquote, offene und überfällige Zuweisungen, Vergleich zum WG-Durchschnitt |
| **Kosten** | Ausgaben mit eingebautem Rechen-Keypad erfassen („12,50+8,30" ergibt live 20,80 €). Aufteilung gleichmäßig, mit festen Beträgen oder nach Anteilen (1:2 bei ungleich großen Zimmern). Beteiligte per Häkchen, Kategorie-Chips. Saldo pro Person, Vorschlag „wer zahlt wem" mit möglichst wenigen Überweisungen. Ausgaben lassen sich öffnen, korrigieren und löschen |
| **Einkauf** | Liste nach Regalreihenfolge sortiert, Kategorie wird beim Tippen geraten. Vorschläge aus der WG-Historie, Dublettenerkennung, Mengen-Stepper, Realtime-Sync, Löschen mit Rückgängig. „Ich kauf ein" öffnet eine Einkaufs-Sitzung; am Ende wird daraus mit einem Betrag eine geteilte Ausgabe — ohne alles zweimal zu tippen |
| **Feste Kosten** | Miete, Strom, Streaming einmal anlegen; die App bucht die Ausgabe monatlich selbst und holt verpasste Monate nach |
| **Abwesenheiten** | Melden per Chip (Heute, Morgen, Wochenende, nächste Woche) oder eigener Zeitraum. Abwesende werden aus geplanten Rotations-Terminen herausgenommen und der weitere Plan neu verteilt, damit der Einspringer nicht mehrfach hintereinander dran ist |
| **Chat** | Pinnwand statt Messenger: erledigte Aufgaben, neue Ausgaben und Abwesenheiten erscheinen als Ereigniskarte im Verlauf. Aushänge kleben oben, bis alle „Verstanden" getippt haben; Bitten haben einen „Mach ich"-Knopf |

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

### 4. E-Mail-Bestätigung

Supabase verlangt bei neuen Projekten eine E-Mail-Bestätigung vor dem ersten Login. Wer das
für den Anfang nicht will: Authentication → Sign In / Providers → Email → *Confirm email*
ausschalten.

## Datenmodell

```
profiles ─┬─ household_members ─── households
          │                            │
          │                            ├── teams ── team_members
          │                            ├── tasks ── task_rotation
          │                            │        └── task_occurrences   (Termine + Erledigung)
          │                            ├── shopping_items
          │                            ├── absences
          │                            ├── chat_messages
          │                            └── expenses ── expense_shares
          └────────────────────────────── settlements
```

Views: `chore_stats_view` (Putz-Tracking), `expense_balance_view` (Salden),
`occurrence_responsibles` (wer ist für einen Termin zuständig, inkl. Teams).

**Sicherheit:** Auf allen Tabellen ist Row Level Security aktiv — man sieht ausschließlich
Daten der eigenen WGs. Schreibvorgänge, die mehrere Tabellen betreffen oder geprüft werden
müssen, laufen über Datenbankfunktionen: `create_household`, `join_household_by_code`,
`create_task`, `complete_occurrence`, `create_expense`.

Beträge werden durchgängig als Cent (`bigint`) gespeichert, nie als Fließkommazahl.

Der Supabase-Security-Advisor meldet für diese Funktionen Warnungen („SECURITY DEFINER
function executable") — das ist hier beabsichtigt: die fünf RPCs prüfen intern die
Mitgliedschaft, und die Hilfsfunktionen `is_household_member` / `is_household_owner` /
`shares_household_with` beantworten ausschließlich Fragen über den Aufrufer selbst.
Offen ist dagegen noch: *Leaked Password Protection* in Authentication → Policies
einschalten.

## Projektstruktur

```
app/                 Screens (Expo Router, dateibasiertes Routing)
  (auth)/            Login, WG erstellen/beitreten
  (tabs)/            Putzplan, Einkauf, Kosten, Chat, Mehr
  new-task.tsx       Aufgabe anlegen (inkl. Rotationsreihenfolge)
  new-expense.tsx    Ausgabe anlegen (inkl. Aufteilung)
  teams.tsx, stats.tsx, absences.tsx
src/components/ui.tsx  Gemeinsame UI-Bausteine
src/lib/             Supabase-Client, Auth-/Household-Context, Geld-Helfer, Theme
src/types/           TypeScript-Typen der DB-Tabellen
supabase/migrations/ Datenbankschema
```

## Ideen für später

- Push-Benachrichtigungen bei fälligen Aufgaben und neuen Nachrichten
- Foto zur Ausgabe (Kassenbon) hochladen
- Aufgaben-Termine per Cron-Job vorausplanen statt erst beim Abhaken
- Monatsrückblick: Punkte und Kosten pro Person
