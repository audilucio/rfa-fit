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
