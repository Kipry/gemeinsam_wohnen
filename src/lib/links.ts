/**
 * Adresse der Website (Einladungsseite, Datenschutz, Impressum) — siehe docs/website.md.
 * Solange sie leer ist, verschickt die App wie bisher nur den App-Link und zeigt
 * keine Rechtliches-Verweise.
 */
export const WEB_BASE_URL = "https://gemeinsam-wohnen.pages.dev";

/**
 * Link zum Weiterschicken. Ohne Website nur der App-Link, der ohne installierte App ins Nichts führt.
 * Mit Schrägstrich nach „join": Cloudflare leitet /join sonst erst auf /join/ um.
 */
export function inviteUrl(code: string): string {
  return WEB_BASE_URL ? `${WEB_BASE_URL}/join/?code=${code}` : `gemeinsamwohnen://join?code=${code}`;
}

/** Null, solange die Website nicht veröffentlicht ist */
export const legalLinks = WEB_BASE_URL
  ? { privacy: `${WEB_BASE_URL}/datenschutz.html`, imprint: `${WEB_BASE_URL}/impressum.html` }
  : null;
