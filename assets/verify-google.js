import { api } from "./referral-api.js";
import { attachGoogleLogin } from "./google-login.js";
const $ = (id) => document.getElementById(id),
  status = (s) => ($("status").textContent = s);
async function verified() {
  const s = await api("authStatus", { purpose: "admin-check" });
  if (!s.authenticated || !s.administrator || !s.databaseConnected)
    throw Error("Não foi possível confirmar o acesso administrativo.");
  $("registration").hidden = true;
  $("verified").hidden = false;
  const message = $("campaignState");
  if (message)
    message.textContent = s.campaignEnabled
      ? "Autenticação administrativa confirmada. A campanha está disponível; cadastros e vendas continuam sujeitos à revisão administrativa."
      : "Autenticação administrativa confirmada. A campanha continua desativada.";
  status(
    s.campaignEnabled
      ? "Autenticação administrativa confirmada."
      : "Login real confirmado. A campanha permanece desativada.",
  );
}
$("logout").onclick = async () => {
  try {
    await api("logout", { purpose: "admin-check" });
    window.google?.accounts?.id.disableAutoSelect();
    location.reload();
  } catch (e) {
    status(e.message);
  }
};
try {
  const r = await fetch("/api/referral");
  const c = await r.json();
  if (!c.authenticationAvailable || !c.googleClientId)
    throw Error("A configuração do Google ainda não está disponível.");
  try {
    await verified();
  } catch {
    $("registration").hidden = false;
    status("Entre com a conta Google administradora para validar o acesso.");
    attachGoogleLogin({
      clientId: () => c.googleClientId,
      form: $("join"),
      container: $("googleSignIn"),
      button: $("prepareGoogle"),
      status,
      onSuccess: verified,
      purpose: "admin-check",
    });
  }
} catch (e) {
  status(e.message);
}
