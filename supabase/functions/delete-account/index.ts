// Löscht das Konto der aufrufenden Person.
//
// Die Datenbank räumt per Trigger auf (on_auth_user_deleted): WGs verlassen,
// Solo-WGs löschen, Profil anonymisieren. Hier passiert nur, was SQL nicht
// kann: Belegfotos aus dem Storage entfernen, den Apple-Zugang widerrufen und
// das Auth-Konto selbst löschen.

import { createClient } from "npm:@supabase/supabase-js@2";
import { importPKCS8, SignJWT } from "npm:jose@5";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

function secretKey(): string {
  const keys = Deno.env.get("SUPABASE_SECRET_KEYS");
  if (keys) {
    try {
      const parsed = JSON.parse(keys);
      if (typeof parsed.default === "string") return parsed.default;
    } catch {
      // fällt auf den Legacy-Key zurück
    }
  }
  return Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
}

/**
 * Widerruft die Apple-Anmeldung (App-Store-Vorgabe für „Mit Apple anmelden").
 * Braucht einen „Sign in with Apple"-Schlüssel als Secrets; ohne die wird
 * übersprungen, das Konto aber trotzdem gelöscht.
 */
async function revokeApple(authorizationCode: string): Promise<boolean> {
  const teamId = Deno.env.get("APPLE_TEAM_ID");
  const keyId = Deno.env.get("APPLE_KEY_ID");
  const privateKey = Deno.env.get("APPLE_PRIVATE_KEY");
  const clientId = Deno.env.get("APPLE_CLIENT_ID") ?? "com.kipry.gemeinsamwohnen";
  if (!teamId || !keyId || !privateKey) {
    console.log("Apple-Widerruf übersprungen: APPLE_TEAM_ID/APPLE_KEY_ID/APPLE_PRIVATE_KEY fehlen");
    return false;
  }

  const key = await importPKCS8(privateKey.replace(/\\n/g, "\n"), "ES256");
  const clientSecret = await new SignJWT({})
    .setProtectedHeader({ alg: "ES256", kid: keyId })
    .setIssuer(teamId)
    .setIssuedAt()
    .setExpirationTime("5m")
    .setAudience("https://appleid.apple.com")
    .setSubject(clientId)
    .sign(key);

  const tokenResponse = await fetch("https://appleid.apple.com/auth/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: clientId,
      client_secret: clientSecret,
      code: authorizationCode,
      grant_type: "authorization_code",
    }),
  });
  if (!tokenResponse.ok) {
    console.error("Apple-Token fehlgeschlagen", tokenResponse.status, await tokenResponse.text());
    return false;
  }

  const tokens = await tokenResponse.json();
  const token = tokens.refresh_token ?? tokens.access_token;
  if (!token) return false;

  const revokeResponse = await fetch("https://appleid.apple.com/auth/revoke", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: clientId,
      client_secret: clientSecret,
      token,
      token_type_hint: tokens.refresh_token ? "refresh_token" : "access_token",
    }),
  });
  if (!revokeResponse.ok) {
    console.error("Apple-Widerruf fehlgeschlagen", revokeResponse.status, await revokeResponse.text());
    return false;
  }
  return true;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return json({ error: "Nur POST" }, 405);

  const token = (req.headers.get("Authorization") ?? "").replace(/^Bearer\s+/i, "");
  if (!token) return json({ error: "Nicht angemeldet" }, 401);

  const admin = createClient(Deno.env.get("SUPABASE_URL")!, secretKey(), {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  // Prüft das Token beim Auth-Server — funktioniert mit jedem Signaturverfahren
  const { data: userData, error: userError } = await admin.auth.getUser(token);
  const user = userData?.user;
  if (userError || !user) return json({ error: "Sitzung abgelaufen, bitte neu anmelden" }, 401);

  let body: { appleAuthorizationCode?: unknown } = {};
  try {
    body = await req.json();
  } catch {
    // leerer Body ist in Ordnung
  }

  let appleRevoked = false;
  if (typeof body.appleAuthorizationCode === "string" && body.appleAuthorizationCode) {
    try {
      appleRevoked = await revokeApple(body.appleAuthorizationCode);
    } catch (error) {
      console.error("Apple-Widerruf", error);
    }
  }

  // WGs, die mit dem Konto verschwinden: deren Belegfotos zuerst entfernen
  const { data: memberships, error: membershipError } = await admin
    .from("household_members")
    .select("household_id")
    .eq("user_id", user.id);
  if (membershipError) {
    console.error(membershipError);
    return json({ error: "Konto konnte nicht gelöscht werden" }, 500);
  }

  for (const { household_id } of memberships ?? []) {
    const { count } = await admin
      .from("household_members")
      .select("user_id", { count: "exact", head: true })
      .eq("household_id", household_id)
      .neq("user_id", user.id);
    if (count !== 0) continue;

    for (let round = 0; round < 50; round++) {
      const { data: files, error } = await admin.storage
        .from("receipts")
        .list(household_id, { limit: 100 });
      if (error || !files || files.length === 0) break;
      const { error: removeError } = await admin.storage
        .from("receipts")
        .remove(files.map((file) => `${household_id}/${file.name}`));
      if (removeError) {
        console.error("Belege nicht gelöscht", household_id, removeError);
        break;
      }
    }
  }

  const { error: deleteError } = await admin.auth.admin.deleteUser(user.id);
  if (deleteError) {
    console.error("Löschen fehlgeschlagen", deleteError);
    return json({ error: "Konto konnte nicht gelöscht werden" }, 500);
  }

  return json({ ok: true, appleRevoked });
});
