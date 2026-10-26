// Synthetic identities for isolated tests only. Never used by the deployed API.
import { readFileSync, readdirSync } from "node:fs";
import { hash, emailIdentity } from "../lib/domain.js";
import * as service from "../lib/service.js";
export async function migrate(db) {
  for (const name of readdirSync("migrations")
    .filter((n) => n.endsWith(".sql"))
    .sort()) {
    const sql = readFileSync("migrations/" + name, "utf8");
    if (db.exec) await db.exec(sql);
    else await db.query(sql);
  }
}
export function claims(email, nonce, extra = {}) {
  const now = Math.floor(Date.now() / 1000);
  return {
    sub: hash("fixture:" + emailIdentity(email).identity_hash),
    email,
    email_verified: true,
    nonce,
    iss: "https://accounts.google.com",
    aud: "123456-fixture.apps.googleusercontent.com",
    iat: now,
    exp: now + 3600,
    ...extra,
  };
}
export async function login(db, email, ref, extra = {}) {
  const ch = await service.googleChallenge(db, ref);
  return service.googleLogin(
    db,
    claims(email, ch.nonce, extra),
    { csrfToken: ch.csrfToken, consent: true },
    ch.csrfToken,
  );
}
export async function person(db, email, ref, extra = {}) {
  const session = await login(db, email, ref, extra);
  const p = await service.participant(db, session);
  await service.admin(
    db,
    { action: "approve", id: p.id, reason: "Cadastro sintético revisado" },
    "test-admin",
  );
  return { ...p, approved: true };
}
