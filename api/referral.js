import { timingSafeEqual } from "node:crypto";
import { transaction } from "../lib/db.js";
import { hash } from "../lib/domain.js";
import { isGoogleClientId, verifyGoogleIdToken } from "../lib/google-auth.js";
import * as service from "../lib/service.js";
export const config = { maxDuration: 30 };
function enabled() {
  try {
    const origin = new URL(process.env.APP_ORIGIN);
    const local = ["localhost", "127.0.0.1", "[::1]"].includes(origin.hostname);
    return (
      process.env.REFERRALS_ENABLED === "true" &&
      ["DATABASE_URL", "IDENTITY_SECRET", "ADMIN_EMAILS"].every(
        (k) => process.env[k],
      ) &&
      process.env.IDENTITY_SECRET.length >= 32 &&
      isGoogleClientId(process.env.GOOGLE_CLIENT_ID) &&
      (origin.protocol === "https:" ||
        (local && origin.protocol === "http:")) &&
      origin.origin === process.env.APP_ORIGIN
    );
  } catch {
    return false;
  }
}
const cookie = (req, name) =>
  String(req.headers.cookie || "")
    .split(";")
    .map((s) => s.trim())
    .find((s) => s.startsWith(name + "="))
    ?.slice(name.length + 1) || "";
const sessionCookie = (name, value, seconds) =>
  `${name}=${value}; HttpOnly; SameSite=Strict; Path=/; Max-Age=${seconds}${process.env.APP_ORIGIN.startsWith("https:") ? "; Secure" : ""}`;
// The default deployed export never accepts verifier/config overrides from HTTP or env.
export function createHandler({
  verifyToken = verifyGoogleIdToken,
  transact = transaction,
} = {}) {
  return async function handler(req, res) {
    res.setHeader("Cache-Control", "no-store");
    res.setHeader("X-Content-Type-Options", "nosniff");
    res.setHeader("Referrer-Policy", "no-referrer");
    if (req.method === "GET") {
      res.status(200).json({
        enabled: !!enabled(),
        googleClientId: enabled() ? process.env.GOOGLE_CLIENT_ID : null,
      });
      return;
    }
    if (req.method !== "POST") {
      res.status(405).json({ error: "Método não permitido." });
      return;
    }
    if (!enabled()) {
      res
        .status(503)
        .json({ error: "Campanha indisponível. A loja continua funcionando." });
      return;
    }
    if (
      req.headers.origin !== process.env.APP_ORIGIN ||
      !String(req.headers["content-type"]).startsWith("application/json")
    ) {
      res.status(403).json({ error: "Origem inválida." });
      return;
    }
    let b = req.body;
    try {
      if (typeof b === "string") b = JSON.parse(b);
      if (
        !b ||
        typeof b !== "object" ||
        Array.isArray(b) ||
        JSON.stringify(b).length > 16000
      )
        throw Error();
    } catch {
      res.status(400).json({ error: "Requisição inválida." });
      return;
    }
    const ip = String(
      req.headers["x-vercel-forwarded-for"] ||
        req.socket?.remoteAddress ||
        "unknown",
    )
      .split(",")[0]
      .trim();
    const session = cookie(req, "rfa_session"),
      challenge = cookie(req, "rfa_google_login");
    try {
      const allowed = await transact(async (c) => {
        const ipOK = await service.rate(c, hash("ip:" + ip), 120);
        const authOK = ["googleChallenge", "googleLogin"].includes(b.action)
          ? await service.rate(c, hash("google-auth:" + ip), 40)
          : true;
        return ipOK && authOK;
      });
      if (!allowed) {
        res.status(429).json({ error: "Muitas tentativas. Aguarde uma hora." });
        return;
      }
      let claims;
      if (b.action === "googleLogin") {
        if (
          typeof b.csrfToken !== "string" ||
          !/^[a-f0-9]{64}$/.test(b.csrfToken) ||
          !/^[a-f0-9]{64}$/.test(challenge) ||
          b.csrfToken.length !== challenge.length ||
          !timingSafeEqual(Buffer.from(b.csrfToken), Buffer.from(challenge))
        ) {
          res.status(403).json({
            error: "Proteção CSRF inválida. Inicie novamente o acesso.",
          });
          return;
        }
        claims = await verifyToken(b.credential, process.env.GOOGLE_CLIENT_ID);
      }
      const result = await transact(async (c) => {
        await service.expire(c);
        if (b.action === "googleChallenge") {
          const ch = await service.googleChallenge(c, b.ref);
          res.setHeader(
            "Set-Cookie",
            sessionCookie("rfa_google_login", ch.csrfToken, 300),
          );
          return ch;
        }
        if (b.action === "googleLogin") {
          const token = await service.googleLogin(c, claims, b, challenge);
          res.setHeader("Set-Cookie", [
            sessionCookie("rfa_session", token, 604800),
            sessionCookie("rfa_google_login", "", 0),
          ]);
          return { ok: true };
        }
        if (b.action === "logout") {
          await c.query("DELETE FROM sessions WHERE hash=$1", [hash(session)]);
          res.setHeader("Set-Cookie", [
            sessionCookie("rfa_session", "", 0),
            sessionCookie("rfa_google_login", "", 0),
          ]);
          return { ok: true };
        }
        let p;
        if (session) {
          try {
            p = await service.participant(c, session);
          } catch (e) {
            if (!(["quote", "checkout"].includes(b.action) && !b.coupon))
              throw e;
          }
        }
        if (["quote", "checkout"].includes(b.action))
          return service.checkout(c, b, p, b.action === "checkout");
        p ??= await service.participant(c, session);
        if (b.action === "dashboard")
          return {
            ...(await service.dashboard(c, p)),
            orders: (
              await c.query(
                "SELECT id,status,snapshot,expires_at FROM orders WHERE participant=$1 ORDER BY created_at DESC LIMIT 20",
                [p.id],
              )
            ).rows,
          };
        if (b.action === "redeem") return service.redeem(c, p);
        if (b.action === "cancelOrder") {
          await c.query(
            "UPDATE orders SET status='cancelled' WHERE id=$1 AND participant=$2 AND status='pending'",
            [b.id, p.id],
          );
          await c.query(
            "INSERT INTO audit(actor,event,target) VALUES($1,$2,$3)",
            [p.id, "order_cancel_requested", String(b.id)],
          );
          return { ok: true };
        }
        if (b.action === "deleteRequest") {
          await c.query(
            "INSERT INTO deletion_requests(participant) VALUES($1) ON CONFLICT DO NOTHING",
            [p.id],
          );
          return { ok: true };
        }
        if (b.action === "admin") {
          if (!(await service.isAdmin(c, p)))
            throw Error("Acesso administrativo negado.");
          return service.admin(c, b.operation, p.id);
        }
        throw Error("Ação inválida.");
      });
      res.status(200).json(result);
    } catch (e) {
      const safe =
        !e.code &&
        !/fetch|connect|timeout|password|certificate/i.test(e.message);
      res.status(safe ? 400 : 503).json({
        error: safe ? e.message : "Serviço temporariamente indisponível.",
      });
    }
  };
}
export default createHandler();
