async function call(operation) {
  const r = await fetch("/api/referral", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ action: "admin", operation }),
  });
  const d = await r.json();
  if (!r.ok) throw Error(d.error);
  return d;
}
const $ = (id) => document.getElementById(id);
async function load() {
  try {
    const data = await call({ action: "list" });
    $("records").replaceChildren();
    for (const [name, rows] of Object.entries(data)) {
      const h = document.createElement("h2");
      h.textContent = name;
      $("records").append(h);
      for (const row of rows) {
        const el = document.createElement("div");
        el.className = "admin-record";
        const pre = document.createElement("pre");
        pre.textContent = JSON.stringify(row, null, 2);
        el.append(pre);
        let actions = [];
        if (name === "participants") actions = ["approve", "block"];
        if (name === "orders" && row.status === "pending")
          actions = ["confirm", "cancel"];
        if (name === "deletion_requests" && !row.completed)
          actions = ["delete"];
        for (const action of actions) {
          const b = document.createElement("button");
          b.textContent = {
            approve: "Aprovar legitimidade",
            block: "Bloquear / fraude",
            confirm: "Confirmar venda",
            cancel: "Cancelar reserva",
            delete: "Remover contato e revogar acesso",
          }[action];
          b.onclick = async () => {
            try {
              await call({
                action,
                id: row.id || row.participant,
                reason: $("reason").value,
                ownerVerified: $("verified").checked,
              });
              $("verified").checked = false;
              await load();
            } catch (e) {
              $("status").textContent = e.message;
            }
          };
          el.append(b);
        }
        $("records").append(el);
      }
    }
    $("status").textContent =
      "Últimos 200 registros por categoria. Dados restritos; não compartilhe.";
  } catch (e) {
    $("status").textContent = e.message;
  }
}
$("load").onclick = load;
void load();
