import { createRemoteJWKSet, jwtVerify } from "jose";
export const isGoogleClientId = (value) =>
  typeof value === "string" &&
  /^\d+-[A-Za-z0-9_-]+\.apps\.googleusercontent\.com$/.test(value);
// Fixed Google origin: never trust a token-provided URL or a runtime JWKS override.
const googleKeys = createRemoteJWKSet(
  new URL("https://www.googleapis.com/oauth2/v3/certs"),
  { timeoutDuration: 5000, cooldownDuration: 30000, cacheMaxAge: 600000 },
);
// Dependency injection is available only to in-process tests. The deployed handler
// always uses verifyGoogleIdToken and Google's public keys below.
export function createGoogleVerifier(keys) {
  return async function verify(credential, clientId) {
    try {
      if (
        !isGoogleClientId(clientId) ||
        typeof credential !== "string" ||
        credential.length > 10000
      )
        throw Error();
      const { payload } = await jwtVerify(credential, keys, {
        algorithms: ["RS256"],
        issuer: ["https://accounts.google.com", "accounts.google.com"],
        audience: clientId,
        requiredClaims: [
          "sub",
          "email",
          "email_verified",
          "exp",
          "iat",
          "nonce",
        ],
        maxTokenAge: "1h",
        clockTolerance: 0,
      });
      if (
        payload.aud !== clientId ||
        (payload.azp && payload.azp !== clientId) ||
        payload.email_verified !== true ||
        typeof payload.sub !== "string" ||
        !/^[A-Za-z0-9_-]{1,255}$/.test(payload.sub) ||
        typeof payload.email !== "string" ||
        typeof payload.nonce !== "string" ||
        !/^[a-f0-9]{64}$/.test(payload.nonce) ||
        payload.exp <= payload.iat
      )
        throw Error();
      return payload;
    } catch {
      throw Error(
        "Login Google inválido ou expirado. Inicie novamente o acesso.",
      );
    }
  };
}
export const verifyGoogleIdToken = createGoogleVerifier(googleKeys);
