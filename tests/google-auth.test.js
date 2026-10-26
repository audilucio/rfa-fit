import { test, before } from "node:test";
import assert from "node:assert/strict";
import { SignJWT } from "jose";
import { identityFixture, clientId } from "./google-fixture.js";
import { verifyGoogleIdToken, isGoogleClientId } from "../lib/google-auth.js";
process.env.IDENTITY_SECRET = "synthetic-test-only-secret-32-characters";
let fixture;
const nonce = "a".repeat(64);
before(async () => (fixture = await identityFixture()));
test("RSA signature, issuer, audience and verified email accepted for a valid local fixture", async () => {
  const token = await fixture.sign("test@gmail.com", nonce);
  const p = await fixture.verify(token, clientId);
  assert.equal(p.email, "test@gmail.com");
  assert.equal(p.email_verified, true);
  assert.equal(p.nonce, nonce);
});
test("invalid signature, malformed token, unknown key and wrong algorithms rejected", async () => {
  const token = await fixture.sign("test@gmail.com", nonce);
  const parts = token.split(".");
  parts[2] = (parts[2][0] === "A" ? "B" : "A") + parts[2].slice(1);
  await assert.rejects(() => fixture.verify(parts.join("."), clientId));
  for (const bad of ["", null, "a.b.c", "x".repeat(10001)])
    await assert.rejects(() => fixture.verify(bad, clientId));
  const unknown = await fixture.sign(
    "test@gmail.com",
    nonce,
    {},
    { kid: "untrusted" },
  );
  await assert.rejects(() => fixture.verify(unknown, clientId));
  const hs = await new SignJWT({ sub: "attacker" })
    .setProtectedHeader({ alg: "HS256" })
    .sign(new Uint8Array(32));
  await assert.rejects(() => fixture.verify(hs, clientId));
});
test("issuer, audience, azp, exp, iat, email_verified, sub and nonce are mandatory", async () => {
  const now = Math.floor(Date.now() / 1000);
  for (const extra of [
    { iss: "https://evil.example" },
    { aud: "other-client" },
    { azp: "other-client" },
    { exp: now - 1 },
    { iat: now + 60 },
    { email_verified: false },
    { email_verified: "true" },
    { email_verified: undefined },
    { sub: "" },
    { sub: ["subject"] },
    { nonce: undefined },
    { nonce: "wrong" },
    { exp: undefined },
    { iat: undefined },
    { email: undefined },
  ]) {
    const token = await fixture.sign("test@gmail.com", nonce, extra);
    await assert.rejects(
      () => fixture.verify(token, clientId),
      JSON.stringify(extra),
    );
  }
  const issuer = await fixture.sign("test@gmail.com", nonce, {
    iss: "accounts.google.com",
  });
  await fixture.verify(issuer, clientId);
});
test("deployed verifier never accepts our fixture keys or malformed client ids", async () => {
  assert.equal(isGoogleClientId("fake"), false);
  assert.equal(isGoogleClientId(clientId), true);
  const token = await fixture.sign("test@gmail.com", nonce);
  await assert.rejects(() => verifyGoogleIdToken(token, clientId));
});
