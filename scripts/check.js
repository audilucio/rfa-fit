import { readdirSync, readFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
for (const dir of ["api", "lib", "scripts", "assets"])
  for (const f of readdirSync(dir))
    if (f.endsWith(".js"))
      execFileSync(process.execPath, ["--check", dir + "/" + f], {
        stdio: "inherit",
      });
const html = readFileSync("index.html", "utf8");
for (const match of html.matchAll(/<script>([\s\S]*?)<\/script>/g))
  execFileSync(process.execPath, ["--check", "--input-type=commonjs"], {
    input: match[1],
    stdio: ["pipe", "inherit", "inherit"],
  });
JSON.parse(readFileSync("vercel.json"));
JSON.parse(readFileSync("data/products.json"));
console.log("JavaScript e JSON válidos.");
