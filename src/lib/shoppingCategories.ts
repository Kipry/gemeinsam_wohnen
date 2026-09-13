/**
 * Kategorien in der Reihenfolge, in der man sie im Laden abläuft —
 * damit die Liste nicht kreuz und quer durch den Markt schickt.
 */
export const AISLE_ORDER = [
  "Obst & Gemüse",
  "Kühlregal",
  "Trocken",
  "Tiefkühl",
  "Getränke",
  "Drogerie",
  "Haushalt",
  "Sonstiges",
] as const;

export type Aisle = (typeof AISLE_ORDER)[number];

const KEYWORDS: Record<Exclude<Aisle, "Sonstiges">, string[]> = {
  "Obst & Gemüse": [
    "apfel", "äpfel", "banane", "tomate", "gurke", "salat", "zwiebel", "kartoffel",
    "karotte", "möhre", "paprika", "zitrone", "orange", "avocado", "knoblauch",
    "pilz", "champignon", "brokkoli", "spinat", "beere", "traube", "birne",
    "zucchini", "aubergine", "lauch", "sellerie", "ingwer", "kräuter", "petersilie",
  ],
  Kühlregal: [
    "milch", "käse", "joghurt", "quark", "butter", "sahne", "ei", "eier", "wurst",
    "schinken", "hack", "hähnchen", "fleisch", "fisch", "lachs", "tofu",
    "frischkäse", "mozzarella", "margarine", "pudding", "feta", "salami",
  ],
  Trocken: [
    "brot", "brötchen", "nudel", "pasta", "spaghetti", "reis", "mehl", "zucker",
    "salz", "pfeffer", "öl", "essig", "kaffee", "tee", "müsli", "haferflocken",
    "tomatenmark", "linsen", "bohnen", "couscous", "chips", "schokolade", "keks",
    "honig", "marmelade", "nutella", "gewürz", "senf", "ketchup", "mayo", "dose",
  ],
  Tiefkühl: ["tiefkühl", "tk", "pizza", "pommes", "eis", "fischstäbchen"],
  Getränke: [
    "wasser", "saft", "cola", "bier", "wein", "limo", "sprudel", "energy",
    "sekt", "schnaps", "spezi", "fanta", "mate",
  ],
  Drogerie: [
    "shampoo", "duschgel", "zahnpasta", "zahnbürste", "deo", "seife", "klopapier",
    "toilettenpapier", "taschentuch", "taschentücher", "rasier", "creme", "tampon",
    "binden", "watte", "wattestäbchen", "pflaster",
  ],
  Haushalt: [
    "spüli", "spülmittel", "spülmaschinentab", "waschmittel", "weichspüler",
    "putzmittel", "schwamm", "müllbeutel", "müllsack", "alufolie",
    "frischhaltefolie", "backpapier", "batterie", "glühbirne", "lappen",
    "küchenrolle", "reiniger",
  ],
};

/**
 * Rät die Kategorie aus dem Artikelnamen.
 * Kurze Stichwörter müssen exakt als Wort vorkommen, sonst würde
 * z.B. "Fleisch" über "eis" im Tiefkühlregal landen.
 */
export function guessCategory(name: string): Aisle {
  const words = name
    .toLowerCase()
    .replace(/[^a-zäöüß\s]/g, " ")
    .split(/\s+/)
    .filter(Boolean);

  for (const aisle of AISLE_ORDER) {
    if (aisle === "Sonstiges") continue;
    const keywords = KEYWORDS[aisle];

    for (const word of words) {
      for (const keyword of keywords) {
        const hit = keyword.length <= 3 ? word === keyword : word.includes(keyword);
        if (hit) return aisle;
      }
    }
  }

  return "Sonstiges";
}

/** Vergleichbare Schreibweise, um Dubletten zu erkennen. */
export function normalizeName(name: string): string {
  return name.trim().toLowerCase().replace(/\s+/g, " ");
}
