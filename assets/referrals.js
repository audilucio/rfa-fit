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
let googleClientId = "";
let sdkPromise;
let prepared = false;
function loadGoogle() {
  if (window.google?.accounts?.id) return Promise.resolve();
  if (sdkPromise) return sdkPromise;
  sdkPromise = new Promise((resolve, reject) => {
    const script = document.createElement("script");
    script.src = "https://accounts.google.com/gsi/client";
    script.async = true;
    script.onload = resolve;
    script.onerror = () => {
      sdkPromise = null;
      script.remove();
      reject(Error("Não foi possível carregar o Google. Tente novamente."));
    };
    document.head.append(script);
  });
  return sdkPromise;
}
$("join").onsubmit = (e) => {
  e.preventDefault();
  run(async () => {
    if (prepared) {
      location.reload();
      return;
    }
    const f = new FormData(e.target);
    if (f.get("consent") !== "on")
      throw Error("Aceite o regulamento e a política de privacidade.");
    const button = $("prepareGoogle");
    button.disabled = true;
    try {
      const ch = await api("googleChallenge", {
        ref: new URLSearchParams(location.search).get("ref") || "",
      });
      await loadGoogle();
      window.google.accounts.id.initialize({
        client_id: googleClientId,
        nonce: ch.nonce,
        auto_select: false,
        ux_mode: "popup",
        callback: (response) =>
          run(async () => {
            try {
              await api("googleLogin", {
                credential: response.credential,
                csrfToken: ch.csrfToken,
                consent: new FormData($("join")).get("consent") === "on",
                website: f.get("website"),
              });
              $("googleSignIn").replaceChildren();
              await panel();
            } finally {
              button.disabled = false;
            }
          }),
      });
      prepared = true;
      button.textContent = "Reiniciar acesso";
      $("googleSignIn").replaceChildren();
      window.google.accounts.id.renderButton($("googleSignIn"), {
        type: "standard",
        theme: "outline",
        size: "large",
        text: "signin_with",
        width: Math.min(320, $("registration").clientWidth - 48),
        locale: "pt-BR",
      });
      status(
        "Selecione sua conta no botão do Google. O acesso expira em 5 minutos.",
      );
    } finally {
      button.disabled = false;
    }
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
