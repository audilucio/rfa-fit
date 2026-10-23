import { randomBytes, createHmac } from "node:crypto";
import { readFileSync } from "node:fs";
export const catalog = JSON.parse(
  readFileSync(new URL("../data/products.json", import.meta.url)),
).products;
export const tier = (n) => Math.min(30, Math.floor(Math.max(0, n) / 3) * 10);
export const secret = () => process.env.IDENTITY_SECRET;
export const hash = (s) =>
  createHmac("sha256", secret()).update(s).digest("hex");
export const random = () => randomBytes(32).toString("hex");
export function emailIdentity(raw) {
  const email = String(raw || "")
    .trim()
    .toLowerCase();
  if (
    email.length > 254 ||
    !/^[a-z0-9.!#$%&'*+/=?^_`{|}~-]+@[a-z0-9-]+(?:\.[a-z0-9-]+)+$/.test(email)
  )
    throw Error("E-mail inválido.");
  let [local, domain] = email.split("@");
  // Conservatively group alias addresses; Gmail also ignores dots.
  local = local.split("+")[0];
  if (["gmail.com", "googlemail.com"].includes(domain)) {
    domain = "gmail.com";
    local = local.replaceAll(".", "");
  }
  return { email, identity_hash: hash(`${local}@${domain}`) };
}
export function quote(items, percent = 0) {
  if (!Array.isArray(items) || !items.length || items.length > 30)
    throw Error("Sacola inválida.");
  if (![0, 10, 20, 30].includes(percent)) throw Error("Desconto inválido.");
  let subtotal = 0,
    eligible = 0,
    units = 0;
  const lines = items.map((i) => {
    const p = catalog.find((p) => p.id === i.id && p.active);
    if (
      !p ||
      !Number.isInteger(i.qty) ||
      i.qty < 1 ||
      i.qty > 20 ||
      !p.sizes.includes(i.size) ||
      !Number.isInteger(i.variantIndex) ||
      !p.variants[i.variantIndex]
    )
      throw Error("Produto, quantidade, cor ou tamanho inválido.");
    units += i.qty;
    const price = Math.round(p.price * 100);
    const amount = price * i.qty;
    subtotal += amount;
    if (p.referralEligible !== false && p.name.startsWith("Biquíni"))
      eligible += amount;
    return {
      id: p.id,
      name: p.name,
      color: p.variants[i.variantIndex].name,
      size: i.size,
      qty: i.qty,
      unit: price,
      amount,
    };
  });
  if (units > 50) throw Error("Limite de 50 peças por pedido.");
  const discount = Math.round((eligible * percent) / 100);
  return { lines, subtotal, discount, total: subtotal - discount, percent };
}
export const money = (n) =>
  (n / 100).toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
export function message(order, id) {
  return [
    "Olá! Quero fazer este pedido pela RFA.FIT:",
    `Pedido: ${id}`,
    ...order.lines.map(
      (i) =>
        `• ${i.name} — Cor ${i.color} — Tamanho ${i.size} — ${i.qty} un. — ${money(i.amount)}`,
    ),
    `Subtotal: ${money(order.subtotal)}`,
    `Desconto (${order.percent}%): ${money(order.discount)}`,
    `Total: ${money(order.total)}`,
    order.percent
      ? "Benefício individual: confirme a venda com o e-mail cadastrado. Reserva válida por 30 minutos."
      : "",
    "Frete e disponibilidade a confirmar. Não altere os valores; atendimento deve conferir o pedido no painel.",
  ]
    .filter(Boolean)
    .join("\n");
}
