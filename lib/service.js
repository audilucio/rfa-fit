import { isDeepStrictEqual } from "node:util";
import { randomUUID } from "node:crypto";
import { hash, random, tier, quote, message, emailIdentity } from "./domain.js";
const row = async (c, q, p = []) => (await c.query(q, p)).rows[0];
const audit = (c, actor, event, target) =>
  c.query("INSERT INTO audit(actor,event,target) VALUES($1,$2,$3)", [
    actor,
    event,
    target,
  ]);
export async function rate(c, key, max = 30) {
  await c.query("DELETE FROM limits WHERE expires_at<now()");
  const r = await row(
    c,
    "INSERT INTO limits VALUES($1,1,now()+interval '1 hour') ON CONFLICT(key) DO UPDATE SET hits=limits.hits+1 RETURNING hits",
    [key],
  );
  return r.hits <= max;
}
export async function participant(c, token) {
  const p = await row(
    c,
    "SELECT p.* FROM sessions s JOIN participants p ON p.id=s.participant WHERE s.hash=$1 AND s.expires_at>now() AND NOT p.blocked AND NOT p.deleted AND p.google_sub_hash IS NOT NULL",
    [hash(token || "")],
  );
  if (!p) throw Error("Entre com sua conta Google.");
  return p;
}
export async function expire(c) {
  await c.query(
    "UPDATE orders SET status='expired' WHERE status='pending' AND expires_at<=now()",
  );
  await c.query("DELETE FROM tokens WHERE expires_at<now()");
  await c.query("DELETE FROM google_auth_challenges WHERE expires_at<now()");
  await c.query("DELETE FROM sessions WHERE expires_at<now()");
}
export async function googleChallenge(c, ref) {
  if (ref && (typeof ref !== "string" || !/^[a-f0-9]{20}$/.test(ref)))
    throw Error("Código de indicação inválido.");
  const csrfToken = random(),
    nonce = random();
  await c.query(
    "INSERT INTO google_auth_challenges(hash,nonce_hash,ref_code,expires_at) VALUES($1,$2,$3,now()+interval '5 minutes')",
    [hash(csrfToken), hash(nonce), ref || null],
  );
  return { csrfToken, nonce };
}
export async function googleLogin(c, claims, body, browserChallenge) {
  if (
    claims?.email_verified !== true ||
    typeof claims.sub !== "string" ||
    !claims.sub ||
    typeof claims.nonce !== "string"
  )
    throw Error("Identidade Google não verificada.");
  if (body.consent !== true)
    throw Error("Aceite o regulamento e a política de privacidade.");
  if (body.website) throw Error("Cadastro inválido.");
  if (
    typeof body.csrfToken !== "string" ||
    body.csrfToken !== browserChallenge ||
    !/^[a-f0-9]{64}$/.test(browserChallenge || "")
  )
    throw Error("Acesso expirado ou proteção CSRF inválida.");
  const challenge = await row(
    c,
    "SELECT * FROM google_auth_challenges WHERE hash=$1 AND NOT used AND expires_at>now() FOR UPDATE",
    [hash(browserChallenge)],
  );
  if (!challenge || challenge.nonce_hash !== hash(claims.nonce))
    throw Error("Acesso expirado, nonce inválido ou já utilizado.");
  const subjectHash = hash("google:" + claims.sub);
  const { email, identity_hash } = emailIdentity(claims.email);
  let p = await row(c, "SELECT * FROM participants WHERE google_sub_hash=$1", [
    subjectHash,
  ]);
  if (p?.deleted || p?.blocked)
    throw Error("Cadastro indisponível. Contate o atendimento.");
  const contact = await row(
    c,
    "SELECT participant FROM participant_contacts WHERE identity_hash=$1",
    [identity_hash],
  );
  if (contact && contact.participant !== p?.id)
    throw Error(
      "Contato já vinculado a outro cadastro. Solicite revisão ao atendimento.",
    );
  let ref;
  if (challenge.ref_code) {
    ref = await row(
      c,
      "SELECT * FROM participants WHERE code=$1 AND confirmed AND approved AND NOT blocked AND NOT deleted AND NOT redeemed",
      [challenge.ref_code],
    );
    if (!ref) throw Error("Código de indicação inválido ou encerrado.");
    if (
      ref.google_sub_hash === subjectHash ||
      ref.identity_hash === identity_hash
    )
      throw Error("Autoconvite não permitido.");
  }
  if (!p) {
    p = await row(
      c,
      "INSERT INTO participants(id,email,identity_hash,code,referrer,confirmed,google_sub_hash,consent_version) VALUES($1,$2,$3,$4,$5,true,$6,$7) RETURNING *",
      [
        randomUUID(),
        email,
        identity_hash,
        random().slice(0, 20),
        ref?.id || null,
        subjectHash,
        "google-2026-10",
      ],
    );
    await audit(c, p.id, "registration_google", p.id);
  } else {
    // Google sub is the account identifier; an email change never creates a new participant.
    p = await row(
      c,
      "UPDATE participants SET email=$2,identity_hash=$3,confirmed=true,consent_version=$4 WHERE id=$1 RETURNING *",
      [p.id, email, identity_hash, "google-2026-10"],
    );
  }
  await c.query(
    "INSERT INTO participant_contacts(identity_hash,participant) VALUES($1,$2) ON CONFLICT DO NOTHING",
    [identity_hash, p.id],
  );
  const adminEmails = (process.env.ADMIN_EMAILS || "")
    .split(",")
    .map((v) => v.trim().toLowerCase())
    .filter(Boolean);
  // For bootstrap privileges Google must be authoritative for the email address.
  // Once pinned, a different Google subject can never inherit this admin slot by email.
  if (
    adminEmails.includes(email) &&
    (email.endsWith("@gmail.com") ||
      (typeof claims.hd === "string" && claims.hd.length > 0))
  ) {
    await c.query(
      "INSERT INTO admin_bindings(email_hash,participant,google_sub_hash) VALUES($1,$2,$3) ON CONFLICT DO NOTHING",
      [hash("admin:" + email), p.id, subjectHash],
    );
  }
  await c.query("UPDATE google_auth_challenges SET used=true WHERE hash=$1", [
    challenge.hash,
  ]);
  const session = random();
  await c.query("INSERT INTO sessions VALUES($1,$2,now()+interval '7 days')", [
    hash(session),
    p.id,
  ]);
  await audit(c, p.id, "google_authenticated", p.id);
  return session;
}
export async function isAdmin(c, p) {
  const slots = (process.env.ADMIN_EMAILS || "")
    .split(",")
    .map((v) => v.trim().toLowerCase())
    .filter(Boolean)
    .map((e) => hash("admin:" + e));
  return !!(await row(
    c,
    "SELECT participant FROM admin_bindings WHERE participant=$1 AND google_sub_hash=$2 AND email_hash=ANY($3::text[])",
    [p.id, p.google_sub_hash, slots],
  ));
}
export async function dashboard(c, p) {
  p = await row(c, "SELECT * FROM participants WHERE id=$1", [p.id]);
  const n = Number(
    (
      await row(
        c,
        "SELECT count(*) FROM participants WHERE referrer=$1 AND confirmed AND approved AND NOT blocked AND NOT deleted",
        [p.id],
      )
    ).count,
  );
  const coupon = await row(
    c,
    "SELECT code,percent,expires_at,used FROM coupons WHERE participant=$1",
    [p.id],
  );
  return {
    code: p.code,
    confirmed: n,
    counted: Math.min(n, 9),
    percent: p.redeemed ? 0 : tier(n),
    redeemed: p.redeemed,
    approved: p.approved,
    coupon,
  };
}
export async function redeem(c, p) {
  p = await row(c, "SELECT * FROM participants WHERE id=$1 FOR UPDATE", [p.id]);
  if (p.redeemed || !p.approved || p.blocked)
    throw Error("Resgate indisponível.");
  const d = await dashboard(c, p);
  if (!d.percent)
    throw Error("São necessárias 3 indicações confirmadas e aprovadas.");
  const code = "RFA-" + random().slice(0, 20).toUpperCase();
  await c.query(
    "INSERT INTO coupons VALUES($1,$2,$3,now()+interval '30 days',false)",
    [code, p.id, d.percent],
  );
  await c.query("UPDATE participants SET redeemed=true WHERE id=$1", [p.id]);
  await audit(c, p.id, "coupon_issued", code);
  return dashboard(c, { ...p, redeemed: true });
}
export async function checkout(c, b, p, reserve) {
  await expire(c);
  let coupon;
  if (b.coupon) {
    if (!p) throw Error("Entre na sua conta para usar o benefício.");
    coupon = await row(
      c,
      "SELECT * FROM coupons WHERE code=$1 AND participant=$2 AND NOT used AND expires_at>now()",
      [b.coupon, p.id],
    );
    if (!coupon) throw Error("Cupom inválido, utilizado ou expirado.");
    // Revocation and deletion of a referral must also invalidate unconsumed rewards.
    const d = await dashboard(c, p);
    if (tier(d.confirmed) < coupon.percent)
      throw Error("Benefício suspenso: indicações precisam de revisão.");
    const pending = await row(
      c,
      "SELECT * FROM orders WHERE coupon=$1 AND status='pending'",
      [coupon.code],
    );
    if (pending) {
      if (
        isDeepStrictEqual(
          pending.snapshot.lines,
          quote(b.items, coupon.percent).lines,
        )
      )
        return reserve
          ? {
              ...pending.snapshot,
              id: pending.id,
              message: message(pending.snapshot, pending.id),
            }
          : pending.snapshot;
      throw Error(
        "Cupom reservado em outro pedido. Cancele-o no painel do participante ou aguarde 30 minutos.",
      );
    }
  }
  const snapshot = quote(b.items, coupon?.percent || 0);
  if (!reserve) return snapshot;
  const id = randomUUID();
  await c.query(
    "INSERT INTO orders(id,participant,coupon,snapshot,expires_at) VALUES($1,$2,$3,$4,now()+interval '30 minutes')",
    [id, p?.id || null, coupon?.code || null, JSON.stringify(snapshot)],
  );
  await audit(c, p?.id || "guest", "order_reserved", id);
  return { ...snapshot, id, message: message(snapshot, id) };
}
export async function admin(c, b, actor) {
  await expire(c);
  if (b.action === "list") {
    const result = {};
    for (const table of [
      "participants",
      "coupons",
      "orders",
      "audit",
      "deletion_requests",
    ])
      result[table] = (
        await c.query(
          `SELECT * FROM ${table} ORDER BY ${table === "coupons" ? "expires_at" : "created_at"} DESC LIMIT 200`,
        )
      ).rows;
    // Identity HMAC is internal only.
    result.participants.forEach((p) => {
      delete p.identity_hash;
      delete p.google_sub_hash;
    });
    return result;
  }
  if (!b.reason || String(b.reason).length < 8 || String(b.reason).length > 300)
    throw Error("Registre o motivo (8 a 300 caracteres), sem dados pessoais.");
  if (["approve", "block"].includes(b.action)) {
    const p = await row(c, "SELECT * FROM participants WHERE id=$1", [b.id]);
    if (!p || p.deleted || !p.confirmed)
      throw Error("Participante indisponível ou contato não confirmado.");
    await c.query(
      `UPDATE participants SET ${b.action === "approve" ? "approved=true" : "blocked=true, approved=false"} WHERE id=$1`,
      [b.id],
    );
  } else if (["confirm", "cancel"].includes(b.action)) {
    const o = await row(
      c,
      "SELECT * FROM orders WHERE id=$1 AND status='pending' AND expires_at>now()",
      [b.id],
    );
    if (!o) throw Error("Pedido não está pendente ou reserva expirou.");
    if (b.action === "confirm" && b.ownerVerified !== true)
      throw Error(
        "Confirme identidade do titular e pagamento antes de concluir.",
      );
    if (b.action === "confirm" && o.coupon) {
      const p = await row(
        c,
        "SELECT * FROM participants WHERE id=$1 AND NOT blocked AND NOT deleted",
        [o.participant],
      );
      if (!p || !p.approved) throw Error("Titular inválido.");
      const d = await dashboard(c, p);
      const cp = await row(
        c,
        "SELECT * FROM coupons WHERE code=$1 AND NOT used AND expires_at>now()",
        [o.coupon],
      );
      if (!cp || tier(d.confirmed) < cp.percent)
        throw Error("Benefício inválido.");
      await c.query("UPDATE coupons SET used=true WHERE code=$1", [o.coupon]);
    }
    await c.query("UPDATE orders SET status=$1 WHERE id=$2", [
      b.action === "confirm" ? "confirmed" : "cancelled",
      b.id,
    ]);
  } else if (b.action === "delete") {
    const request = await row(
      c,
      "SELECT * FROM deletion_requests WHERE participant=$1 AND NOT completed",
      [b.id],
    );
    if (!request) throw Error("Solicitação não encontrada.");
    if (
      await row(
        c,
        "SELECT id FROM orders WHERE participant=$1 AND status='pending'",
        [b.id],
      )
    )
      throw Error("Cancele as reservas antes de excluir.");
    await c.query(
      "UPDATE participants SET email=$2,deleted=true,blocked=true,approved=false WHERE id=$1",
      [b.id, `removed-${b.id}@invalid.local`],
    );
    await c.query("DELETE FROM sessions WHERE participant=$1", [b.id]);
    await c.query("DELETE FROM tokens WHERE participant=$1", [b.id]);
    await c.query(
      "UPDATE deletion_requests SET completed=true WHERE participant=$1",
      [b.id],
    );
  } else throw Error("Ação inválida.");
  await audit(c, actor, `${b.action}: ${b.reason}`, b.id);
  return { ok: true };
}
