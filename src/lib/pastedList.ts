import { normalizeName } from "./shoppingCategories";

/**
 * Eingefügte Listen (Rezept aus WhatsApp, Notizen-App, E-Mail) zerlegen.
 *
 * Kopierte Listen bringen allerlei Beiwerk mit: Spiegelstriche, Emojis,
 * Kästchen, Nummern, Überschriften wie „Für den Teig:" und Mengen in jeder
 * Schreibweise. Das alles soll nicht auf der Einkaufsliste landen.
 */

// Aufzählungszeichen, Pfeile, Kästchen, Emojis und Markdown-Häkchen am Zeilenanfang
const MARKER =
  /^(?:[\s\-–—•·*>#+]|[\u2190-\u21FF\u2500-\u27BF\u2B00-\u2BFF]|[\uD83C-\uDBFF][\uDC00-\uDFFF]|[\uFE0F\u200D]|\[[ xX✓✔]?\])+/;
const NUMBERING = /^\d{1,2}[.)]\s+/;

function stripMarker(line: string): string {
  return line.replace(MARKER, "").replace(NUMBERING, "").replace(MARKER, "");
}

/** Nicht-leere Zeilen ohne Aufzählungszeichen */
export function pastedLines(text: string): string[] {
  return text
    .split(/\r\n|\r|\n|\u2028/)
    .map((line) => stripMarker(line).replace(/\s+/g, " ").trim())
    .filter((line) => line.length > 0);
}

// ───────────────────────────────────────────── Mengen

const FRACTION = "½¼¾⅓⅔⅛";
const NUMBER = `(?:\\d+(?:[.,]\\d+)?(?:\\s*/\\s*\\d+)?|[${FRACTION}])(?:\\s*[${FRACTION}])?`;
const RANGE = `${NUMBER}(?:\\s*[-–]\\s*${NUMBER})?`;
const UNIT =
  "(?:kg|gr|g|mg|ml|cl|dl|l|liter|gramm|kilo|el|tl|msp|prisen?|päckchen|packungen?|pck|pkg|pack|" +
  "dosen?|gläser|glas|becher|bund|stück|stk|st|zehen?|scheiben?|tassen?|handvoll|zweige?|blätter|blatt|" +
  "beutel|flaschen?|tüten?|würfel|köpfe|kopf|knollen?|stangen?|schuss|spritzer|tuben?|netze?|rollen?|" +
  "kisten?|kasten|kästen|kartons?|schalen?|portionen?|pakete?|tafeln?|riegel|laibe?|kugeln?|sack|säcke)\\.?";
const PIECES = /^(?:stück|stk|st)\.?$/i;

// „500 g Mehl", „2 Eier", „3x Milch", „ca. 200g Feta" — ohne Leerzeichen bleibt „7Up" ein Name
const LEADING = new RegExp(
  `^(?:ca\\.?\\s*|circa\\s+|etwa\\s+)?(${RANGE})(?:\\s*(${UNIT})(?=\\s|$)|\\s*([x×])(?=\\s))?\\s+(\\S.*)$`,
  "i"
);
// „Mehl 1 kg", „Eier (10 Stück)"
const TRAILING_UNIT = new RegExp(`^(.+?)[\\s,(]+(${RANGE})\\s*(${UNIT})\\)?$`, "i");
// „Milch 2x", „Eier x10"
const TRAILING_TIMES = /^(.+?)[\s,(]+(?:(\d{1,2})\s*[x×]|[x×]\s*(\d{1,2}))\)?$/i;
// „Milch 2" — nur ein- oder zweistellig, sonst wird aus „Mehl Type 405" eine Menge
const TRAILING_COUNT = /^(.+?)[\s,(]+(\d{1,2})\)?$/;
// Nur eine Menge: Rezeptseiten liefern beim Kopieren oft „500 g" und „Mehl" als eigene Zeilen
const AMOUNT_ONLY = new RegExp(`^(${RANGE})\\s*(${UNIT}|[x×])?$`, "i");

const NUMBER_WORDS: Record<string, string> = {
  ein: "1", eine: "1", einen: "1", zwei: "2", drei: "3", vier: "4", fünf: "5",
  sechs: "6", sieben: "7", acht: "8", neun: "9", zehn: "10", zwölf: "12",
};
// „eine Zwiebel", „zwei Dosen Mais", „etwas Butter", „ein paar Blätter Basilikum"
const WORD_AMOUNT = new RegExp(
  `^((?:etwas|einige|ein paar|${Object.keys(NUMBER_WORDS).join("|")})(?:\\s+${UNIT}(?=\\s))?)\\s+(\\S.*)$`,
  "i"
);

function amountOf(number: string, unit?: string): string | null {
  const value = number.replace(/\s+/g, "").replace("-", "–");
  if ((!unit || PIECES.test(unit)) && /^\d{1,2}$/.test(value)) {
    return Number(value) > 0 ? String(Number(value)) : null;
  }
  return unit && !PIECES.test(unit) ? `${value} ${unit}` : value;
}

function cleanName(name: string): string {
  return name.replace(/^[,;:\s]+|[,;:\s]+$/g, "").replace(/\s+/g, " ");
}

/** Name und Menge trennen, damit Regal, Dubletten und Vorschläge am Namen hängen */
export function splitAmount(line: string): { name: string; quantity: string | null } {
  const leading = line.match(LEADING);
  if (leading) {
    return { name: cleanName(leading[4]), quantity: amountOf(leading[1], leading[2]) };
  }

  const word = line.match(WORD_AMOUNT);
  if (word) {
    const [first, ...rest] = word[1].split(/\s+/);
    const number = /^ein paar\b/i.test(word[1]) ? undefined : NUMBER_WORDS[first.toLowerCase()];
    const quantity = number
      ? amountOf(number, rest.join(" ") || undefined)
      : word[1].charAt(0).toLowerCase() + word[1].slice(1);
    return { name: cleanName(word[2]), quantity };
  }

  const withUnit = line.match(TRAILING_UNIT);
  if (withUnit && /[a-zäöüß]/i.test(withUnit[1])) {
    return { name: cleanName(withUnit[1]), quantity: amountOf(withUnit[2], withUnit[3]) };
  }

  const times = line.match(TRAILING_TIMES) ?? line.match(TRAILING_COUNT);
  if (times && /[a-zäöüß]/i.test(times[1])) {
    return { name: cleanName(times[1]), quantity: amountOf(times[2] ?? times[3]) };
  }

  return { name: cleanName(line), quantity: null };
}

/**
 * „Salz, Pfeffer" und „Öl und Essig" sind zwei Sachen, „Tomaten, gehackt" ist eine.
 * Deutsche Hauptwörter beginnen groß — daran lässt sich das gut unterscheiden.
 */
function splitCombined(line: string): string[] {
  const parts = line.split(/\s*(?:,(?!\d)|;|\s&\s|\s\+\s|\sund\s)\s*/).filter(Boolean);
  if (parts.length < 2) return [line];
  const separate = parts.every(
    (part) =>
      /^[A-ZÄÖÜ0-9½¼¾⅓⅔]/.test(part) && part.split(" ").length <= 4 && !AMOUNT_ONLY.test(part)
  );
  return separate ? parts : [line];
}

export type PastedItem = {
  name: string;
  quantity: string | null;
  /** Sieht nach Einkauf aus (sonst z.B. ein Satz aus der Zubereitung) */
  likely: boolean;
};

const MAX_ITEMS = 50;

export function parseShoppingList(text: string): PastedItem[] {
  const items: PastedItem[] = [];
  const seen = new Set<string>();
  let pendingAmount: string | null = null;

  for (const line of pastedLines(text)) {
    // Ab hier kommt die Anleitung, keine Zutaten mehr
    if (/^(zubereitung|anleitung|so geht'?s|arbeitsschritte)\b/i.test(line)) break;
    // Überschriften: „Für den Teig:", „Zutaten für 4 Personen"
    if (/:$/.test(line) || (/^(zutaten|einkaufsliste|einkaufen|für)\b/i.test(line) && line.split(" ").length <= 5)) {
      pendingAmount = null;
      continue;
    }

    const amountLine = line.match(AMOUNT_ONLY);
    if (amountLine) {
      const unit = amountLine[2] && !/^[x×]$/i.test(amountLine[2]) ? amountLine[2] : undefined;
      pendingAmount = amountOf(amountLine[1], unit);
      continue;
    }

    const parts = splitCombined(line);
    for (const part of parts) {
      const { name, quantity } = splitAmount(part);
      if (name.replace(/[^a-zäöüß]/gi, "").length < 2) continue;

      const key = normalizeName(name);
      if (seen.has(key)) continue;
      seen.add(key);

      const words = name.split(" ").length;
      items.push({
        name,
        quantity: quantity ?? (parts.length === 1 ? pendingAmount : null),
        likely: words <= 6 && !(/[.!?]$/.test(name) && words > 3),
      });
      if (items.length >= MAX_ITEMS) return items;
    }
    pendingAmount = null;
  }
  return items;
}
