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
    // Häufig in Rezepten, die als ganze Liste eingefügt werden
    "limette", "mango", "ananas", "kiwi", "melone", "pfirsich", "pflaume", "kirsche",
    "mandarine", "rucola", "radieschen", "kürbis", "fenchel", "spargel", "bete",
    "blumenkohl", "rotkohl", "weißkohl", "rosenkohl", "grünkohl", "spitzkohl", "kohlrabi",
    "wirsing", "basilikum", "koriander", "schnittlauch", "minze", "rosmarin", "thymian", "chili",
  ],
  Kühlregal: [
    "milch", "käse", "joghurt", "quark", "butter", "sahne", "ei", "eier", "wurst",
    "schinken", "hack", "hähnchen", "fleisch", "fisch", "lachs", "tofu",
    "frischkäse", "mozzarella", "margarine", "pudding", "feta", "salami",
    "parmesan", "gouda", "emmentaler", "cheddar", "ricotta", "mascarpone", "halloumi",
    "gorgonzola", "camembert", "schmand", "skyr", "kefir", "pute", "rind", "schwein",
    "speck", "chorizo", "garnelen",
  ],
  Trocken: [
    "brot", "brötchen", "nudel", "pasta", "spaghetti", "reis", "mehl", "zucker",
    "salz", "pfeffer", "öl", "essig", "kaffee", "tee", "müsli", "haferflocken",
    "tomatenmark", "linsen", "bohnen", "couscous", "chips", "schokolade", "keks",
    "honig", "marmelade", "nutella", "gewürz", "senf", "ketchup", "mayo", "dose",
    "olivenöl", "rapsöl", "sonnenblumenöl", "brühe", "passata", "kichererbsen",
    "backpulver", "sojasauce", "sojasoße", "pesto", "oliven", "kapern", "nuss", "nüsse",
    "mandel", "rosinen", "sesam", "curry", "zimt", "oregano", "paprikapulver", "toast",
    "tortilla", "wraps", "penne", "fusilli", "lasagne", "quinoa", "bulgur", "grieß",
    "stärke", "kakao", "sirup", "zwieback",
  ],
  Tiefkühl: ["tiefkühl", "tk", "pizza", "pommes", "eis", "fischstäbchen"],
  Getränke: [
    "wasser", "saft", "cola", "bier", "wein", "limo", "sprudel", "energy",
    "sekt", "schnaps", "spezi", "fanta", "mate", "schorle", "eistee", "radler",
    "prosecco", "tonic", "gin", "rum", "wodka", "whisky", "aperol",
  ],
  Drogerie: [
    "shampoo", "duschgel", "zahnpasta", "zahnbürste", "deo", "seife", "klopapier",
    "toilettenpapier", "taschentuch", "taschentücher", "rasier", "creme", "tampon",
    "binden", "watte", "wattestäbchen", "pflaster", "zahnseide", "spülung", "lotion",
    "slipeinlagen", "windeln", "feuchttücher",
  ],
  Haushalt: [
    "spüli", "spülmittel", "spülmaschinentab", "waschmittel", "weichspüler",
    "putzmittel", "schwamm", "müllbeutel", "müllsack", "alufolie",
    "frischhaltefolie", "backpapier", "batterie", "glühbirne", "lappen",
    "küchenrolle", "reiniger", "entkalker", "klarspüler", "kerze", "teelicht",
    "serviette", "gefrierbeutel", "streichhölzer", "feuerzeug",
  ],
};

// Endungen, nach denen ein Stichwort trotzdem als Wortende gilt („Tomate" → „Tomaten")
const PLURAL_ENDINGS = new Set(["", "n", "en", "e", "s", "er", "nen"]);

/**
 * Rät die Kategorie aus dem Artikelnamen.
 * Kurze Stichwörter müssen exakt als Wort vorkommen, sonst würde
 * z.B. "Fleisch" über "eis" im Tiefkühlregal landen.
 *
 * Bei zusammengesetzten Wörtern entscheidet das Ende: „Orangensaft" ist ein
 * Saft, „Himbeerjoghurt" ein Joghurt. Passen mehrere Stichwörter, gewinnt das
 * am Wortende, danach das längere („Zahnpasta" vor „Pasta").
 */
export function guessCategory(name: string): Aisle {
  const words = name
    .toLowerCase()
    .replace(/[^a-zäöüß\s]/g, " ")
    .split(/\s+/)
    .filter(Boolean);

  let best: Aisle = "Sonstiges";
  let bestScore = 0;

  for (const aisle of AISLE_ORDER) {
    if (aisle === "Sonstiges") continue;

    for (const word of words) {
      for (const keyword of KEYWORDS[aisle]) {
        let score = 0;
        if (keyword.length <= 3) {
          if (word === keyword) score = 100 + keyword.length;
        } else {
          const index = word.lastIndexOf(keyword);
          if (index >= 0) {
            const atEnd = PLURAL_ENDINGS.has(word.slice(index + keyword.length));
            score = (atEnd ? 100 : 0) + keyword.length;
          }
        }
        // Bei Gleichstand bleibt die frühere Regal-Reihenfolge maßgeblich
        if (score > bestScore) {
          best = aisle;
          bestScore = score;
        }
      }
    }
  }

  return best;
}

/** Vergleichbare Schreibweise, um Dubletten zu erkennen. */
export function normalizeName(name: string): string {
  return name.trim().toLowerCase().replace(/\s+/g, " ");
}
