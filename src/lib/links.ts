/**
 * Adresse der Website (Einladungsseite, Datenschutz, Impressum) — siehe web/README.md.
 * Solange sie leer ist, verschickt die App wie bisher nur den App-Link und zeigt
 * keine Rechtliches-Verweise.
 */
export const WEB_BASE_URL = "";

/** Link zum Weiterschicken. Ohne Website nur der App-Link, der ohne installierte App ins Nichts führt. */
export function inviteUrl(code: string): string {
  return WEB_BASE_URL ? `${WEB_BASE_URL}/join?code=${code}` : `gemeinsamwohnen://join?code=${code}`;
}

/** Null, solange die Website nicht veröffentlicht ist */
export const legalLinks = WEB_BASE_URL
  ? { privacy: `${WEB_BASE_URL}/datenschutz.html`, imprint: `${WEB_BASE_URL}/impressum.html` }
  : null;
