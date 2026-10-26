import { api } from "./referral-api.js";
let sdkPromise;
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
export function attachGoogleLogin({
  clientId,
  form,
  container,
  button,
  status,
  onSuccess,
  ref = () => "",
  purpose,
}) {
  let prepared = false;
  const scope = purpose ? { purpose } : {};
  form.onsubmit = async (e) => {
    e.preventDefault();
    try {
      if (prepared) {
        location.reload();
        return;
      }
      const f = new FormData(form);
      if (f.get("consent") !== "on")
        throw Error("Aceite o regulamento e a política de privacidade.");
      button.disabled = true;
      const ch = await api("googleChallenge", { ...scope, ref: ref() });
      await loadGoogle();
      window.google.accounts.id.initialize({
        client_id: clientId(),
        nonce: ch.nonce,
        auto_select: false,
        ux_mode: "popup",
        callback: async (response) => {
          try {
            await api("googleLogin", {
              ...scope,
              credential: response.credential,
              csrfToken: ch.csrfToken,
              consent: new FormData(form).get("consent") === "on",
              website: f.get("website"),
            });
            container.replaceChildren();
            await onSuccess();
          } catch (e) {
            status(e.message);
          } finally {
            button.disabled = false;
          }
        },
      });
      prepared = true;
      button.textContent = "Reiniciar acesso";
      container.replaceChildren();
      window.google.accounts.id.renderButton(container, {
        type: "standard",
        theme: "outline",
        size: "large",
        text: "signin_with",
        width: Math.min(320, form.parentElement.clientWidth - 48),
        locale: "pt-BR",
      });
      status(
        "Selecione sua conta no botão do Google. O acesso expira em 5 minutos.",
      );
    } catch (e) {
      status(e.message);
    } finally {
      button.disabled = false;
    }
  };
}
