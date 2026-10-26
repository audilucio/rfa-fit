import { api } from "./referral-api.js";
import { attachGoogleLogin } from "./google-login.js";
export { api };
const $ = (id) => document.getElementById(id);
const status = (s) => ($("status").textContent = s);
let link = "";
async function panel() {
  const d = await api("dashboard");
  $("registration").hidden = true;
  $("dashboard").hidden = false;
  link = location.origin + "/indicacoes.html?ref=" + encodeURIComponent(d.code);
  const canShare = d.approved && !d.redeemed;
  $("copy").disabled = !canShare;
  $("share").hidden = !canShare;
  $("shareLink").textContent = canShare
    ? link
    : d.redeemed
      ? "A progressão desta campanha foi encerrada."
      : "Seu link ficará disponível após a aprovação administrativa.";
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
let googleClientId = "";
attachGoogleLogin({
  clientId: () => googleClientId,
  form: $("join"),
  container: $("googleSignIn"),
  button: $("prepareGoogle"),
  status,
  onSuccess: panel,
  ref: () => new URLSearchParams(location.search).get("ref") || "",
});
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
    window.google?.accounts?.id.disableAutoSelect();
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
  googleClientId = config.googleClientId;
  history.replaceState(null, "", location.pathname + location.search);
  try {
    await panel();
  } catch {
    status("Entre com Google para acessar seu painel.");
  }
});
