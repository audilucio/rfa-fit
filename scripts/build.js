import { mkdir, copyFile, cp } from "node:fs/promises";
// Publish an explicit static allowlist. Never expose backend, tests, backups or env files.
await mkdir("public/data", { recursive: true });
for (const name of [
  "index.html",
  "config.js",
  "404.html",
  "indicacoes.html",
  "admin-indicacoes.html",
  "regulamento.html",
  "privacidade.html",
])
  await copyFile(name, "public/" + name);
for (const name of ["products.json", "site.json"])
  await copyFile("data/" + name, "public/data/" + name);
await cp("assets", "public/assets", { recursive: true });
console.log(
  "Static allowlist generated in public/. Backend is bundled only into Vercel Functions.",
);
