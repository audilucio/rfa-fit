import { transaction } from "../lib/db.js";
import { hash, emailIdentity } from "../lib/domain.js";
import * as service from "../lib/service.js";
export const config = { maxDuration: 30 };
const enabled = () =>
  process.env.REFERRALS_ENABLED === "true" &&
  [
    "DATABASE_URL",
    "IDENTITY_SECRET",
    "RESEND_API_KEY",
    "EMAIL_FROM",
    "APP_ORIGIN",
    "ADMIN_EMAILS",
  ].every((k) => process.env[k]) &&
  process.env.IDENTITY_SECRET.length >= 32;
export default async function handler(req, res) {
  res.setHeader("Cache-Control", "no-store");
  res.setHeader("X-Content-Type-Options", "nosniff");
  res.setHeader("Referrer-Policy", "no-referrer");
  if (req.method === "GET") {
    res.status(200).json({ enabled: !!enabled() });
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
    req.headers.origin !== new URL(process.env.APP_ORIGIN).origin ||
    !String(req.headers["content-type"]).startsWith("application/json")
  ) {
    res.status(403).json({ error: "Origem inválida." });
    return;
  }
  let b = req.body;
  try {
    if (typeof b === "string") b = JSON.parse(b);
    if (!b || JSON.stringify(b).length > 16000) throw Error();
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
  const session =
    String(req.headers.cookie || "")
      .split(";")
      .map((s) => s.trim())
      .find((s) => s.startsWith("rfa_session="))
      ?.slice(12) || "";
  try {
    const allowed = await transaction(async (c) => {
      const ipOK = await service.rate(c, hash("ip:" + ip), 120);
      let emailOK = true;
      if (b.action === "register") {
        let identity;
        try {
          identity = emailIdentity(b.email);
        } catch {
          /* Count invalid input against IP too. */
        }
        if (identity)
          emailOK = await service.rate(c, identity.identity_hash, 5);
      }
      return ipOK && emailOK;
    });
    if (!allowed) {
      res.status(429).json({ error: "Muitas tentativas. Aguarde uma hora." });
      return;
    }
    let mail;
    const result = await transaction(async (c) => {
      await service.expire(c);
      if (b.action === "register") {
        mail = await service.register(c, b);
        return {
          ok: true,
          message: "Confira seu e-mail. O link expira em 15 minutos.",
        };
      }
      if (b.action === "verify") {
        const token = await service.verify(c, b.token);
        res.setHeader(
          "Set-Cookie",
          `rfa_session=${token}; HttpOnly; SameSite=Strict; Path=/; Max-Age=604800${process.env.APP_ORIGIN.startsWith("https:") ? "; Secure" : ""}`,
        );
        return { ok: true };
      }
      if (b.action === "logout") {
        await c.query("DELETE FROM sessions WHERE hash=$1", [hash(session)]);
        res.setHeader(
          "Set-Cookie",
          "rfa_session=; HttpOnly; SameSite=Strict; Path=/; Max-Age=0",
        );
        return { ok: true };
      }
      let p;
      if (session) p = await service.participant(c, session);
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
        if (
          !process.env.ADMIN_EMAILS.split(",")
            .map((s) => s.trim().toLowerCase())
            .includes(p.email)
        )
          throw Error("Acesso administrativo negado.");
        return service.admin(c, b.operation, p.id);
      }
      throw Error("Ação inválida.");
    });
    if (mail) {
      const response = await fetch("https://api.resend.com/emails", {
        method: "POST",
        signal: AbortSignal.timeout(8000),
        headers: {
          Authorization: `Bearer ${process.env.RESEND_API_KEY}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          from: process.env.EMAIL_FROM,
          to: [mail.email],
          subject: "Seu acesso à RFA.FIT — Indique & Ganhe",
          text: `Use este link em até 15 minutos para confirmar seu contato e acessar sua conta: ${process.env.APP_ORIGIN}/indicacoes.html#token=${mail.token}\nSe não solicitou, ignore. Não compartilhe este link. Não enviamos publicidade por este cadastro.`,
        }),
      });
      if (!response.ok) {
        res.status(502).json({
          error:
            "Não foi possível enviar o e-mail. Tente novamente mais tarde.",
        });
        return;
      }
    }
    res.status(200).json(result);
  } catch (e) {
    const safe =
      !e.code && !/fetch|connect|timeout|password|certificate/i.test(e.message);
    res.status(safe ? 400 : 503).json({
      error: safe ? e.message : "Serviço temporariamente indisponível.",
    });
  }
}
