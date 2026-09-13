# Gemeinsam Wohnen

WG-App für Putzplan, Einkaufsliste, Abwesenheiten, Chat und eine Fairness-Balance (wer hat wie viele Aufgaben erledigt).

**Stack:** Expo (React Native, TypeScript) + Supabase (Postgres, Auth, Realtime).

## Setup

1. Supabase-Projekt anlegen: https://supabase.com/dashboard
2. Im SQL Editor des Projekts den Inhalt von [`supabase/schema.sql`](supabase/schema.sql) ausführen.
3. `.env.example` nach `.env` kopieren und mit den Werten aus **Project Settings → API** füllen:
   ```
   EXPO_PUBLIC_SUPABASE_URL=...
   EXPO_PUBLIC_SUPABASE_ANON_KEY=...
   ```
4. Abhängigkeiten installieren und App starten:
   ```bash
   npm install
   npm start
   ```
   Dann `i` (iOS Simulator), `a` (Android) oder `w` (Web) drücken — oder mit der Expo-Go-App den QR-Code scannen.

## Features

- **Login/Registrierung** — E-Mail + Passwort über Supabase Auth.
- **WG erstellen/beitreten** — eine WG hat einen Einladungscode, den Mitbewohner zum Beitreten nutzen. Ein Account kann in mehreren WGs sein.
- **Putzplan** (`tasks`) — wiederkehrende Aufgaben mit Punktewert und Intervall. Nach "Erledigt" wird automatisch die nächste Fälligkeit erzeugt.
- **Einkaufsliste** (`shopping`) — gemeinsame Liste mit Realtime-Sync zwischen allen Mitbewohnern.
- **Abwesenheiten** (`absences`) — Zeiträume melden, sichtbar für die ganze WG.
- **Chat** (`chat`) — WG-interner Realtime-Chat.
- **Balance** (`balance`) — Punkte pro Person aus erledigten Putzplan-Aufgaben, verglichen mit dem WG-Durchschnitt.

## Projektstruktur

```
app/                 Bildschirme (Expo Router, dateibasiertes Routing)
  (auth)/            Login, Registrierung, WG erstellen/beitreten
  (tabs)/            Hauptnavigation nach Login
src/lib/             Supabase-Client, Auth-/Household-Context, Theme
src/types/           TypeScript-Typen für die DB-Tabellen
supabase/schema.sql  Datenbankschema inkl. Row Level Security
```

## Nächste Schritte (Ideen)

- Aufgaben rotierend automatisch zuweisen statt "wer will, macht"
- Push-Benachrichtigungen bei fälligen Aufgaben / neuen Chat-Nachrichten
- Profilbilder / Avatare
- Export der Balance als Zusammenfassung (z.B. Monatsrückblick)
