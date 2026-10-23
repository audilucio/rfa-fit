export async function api(action, data = {}) {
  const r = await fetch("/api/referral", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ action, ...data }),
  });
  const b = await r.json();
  if (!r.ok) throw Error(b.error || "Serviço indisponível.");
  return b;
}
const $ = (id) => document.getElementById(id);
const status = (s) => ($("status").textContent = s);
let link = "";
async function panel() {
  const d = await api("dashboard");
  $("registration").hidden = true;
  $("dashboard").hidden = false;
  link = location.origin + "/indicacoes.html?ref=" + encodeURIComponent(d.code);
  $("shareLink").textContent = link;
  $("share").href =
    "https://wa.me/?text=" +
    encodeURIComponent(
      "Conheça a RFA.FIT! Cadastre-se voluntariamente pelo meu link: " + link,
    );
  $("counts").textContent =
    `${d.confirmed} indicações confirmadas e aprovadas (${d.counted}/9 contabilizadas). ${d.approved ? "" : "Seu cadastro aguarda revisão de legitimidade."}`;
  $("progress").value = d.counted;
  $("redeem").disabled = d.redeemed || !d.percent || !d.approved;
  $("redeem").textContent = d.redeemed
    ? "Benefício já resgatado"
    : `Resgatar ${d.percent}% OFF`;
  $("coupon").textContent = d.coupon
    ? `Seu cupom: ${d.coupon.code} · ${d.coupon.percent}% · ${d.coupon.used ? "Utilizado" : "Validade: " + new Date(d.coupon.expires_at).toLocaleString("pt-BR")}`
    : "";
  $("orders").replaceChildren();
  for (const o of d.orders) {
    const el = document.createElement("p");
    el.textContent = `Pedido ${o.id} — ${o.status}`;
    if (o.status === "pending") {
      const btn = document.createElement("button");
      btn.textContent = "Cancelar reserva";
      btn.onclick = () =>
        run(async () => {
          await api("cancelOrder", { id: o.id });
          await panel();
        });
      el.append(btn);
    }
    $("orders").append(el);
  }
  status("Painel atualizado.");
}
async function run(fn) {
  try {
    await fn();
  } catch (e) {
    status(e.message);
  }
}
$("join").onsubmit = (e) => {
  e.preventDefault();
  const f = new FormData(e.target);
  run(async () => {
    const b = await api("register", {
      email: f.get("email"),
      website: f.get("website"),
      consent: f.get("consent") === "on",
      ref: new URLSearchParams(location.search).get("ref") || "",
    });
    status(b.message);
  });
};
$("copy").onclick = () =>
  run(async () => {
    await navigator.clipboard.writeText(link);
    status("Link copiado.");
  });
$("refresh").onclick = () => run(panel);
$("redeem").onclick = () =>
  run(async () => {
    await api("redeem");
    await panel();
  });
$("deletion").onclick = () =>
  run(async () => {
    await api("deleteRequest");
    status(
      "Solicitação registrada. O atendimento analisará sua exclusão em até 15 dias.",
    );
  });
$("logout").onclick = () =>
  run(async () => {
    await api("logout");
    location.reload();
  });
run(async () => {
  const r = await fetch("/api/referral");
  const config = await r.json();
  if (!config.enabled) {
    status(
      "Campanha ainda não disponível. Continue comprando normalmente na loja.",
    );
    return;
  }
  $("registration").hidden = false;
  const token = new URLSearchParams(location.hash.slice(1)).get("token");
  history.replaceState(null, "", location.pathname + location.search);
  if (token) await api("verify", { token });
  try {
    await panel();
  } catch {
    status("Informe seu e-mail para receber um link de acesso.");
  }
});
