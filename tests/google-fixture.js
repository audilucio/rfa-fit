// Locally signed JWTs, NOT real Google tokens. Injection is restricted to test processes.
import { generateKeyPair, exportJWK, SignJWT, createLocalJWKSet } from "jose";
import { createGoogleVerifier } from "../lib/google-auth.js";
import { claims } from "./helpers.js";
export const clientId = "123456-fixture.apps.googleusercontent.com";
export async function identityFixture() {
  const { privateKey, publicKey } = await generateKeyPair("RS256");
  const jwk = {
    ...(await exportJWK(publicKey)),
    kid: "local-fixture",
    alg: "RS256",
    use: "sig",
  };
  return {
    verify: createGoogleVerifier(createLocalJWKSet({ keys: [jwk] })),
    sign: (email, nonce, extra = {}, header = {}) =>
      new SignJWT(claims(email, nonce, extra))
        .setProtectedHeader({ alg: "RS256", kid: "local-fixture", ...header })
        .sign(privateKey),
  };
}
