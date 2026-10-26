import http from "node:http";
import { readFile } from "node:fs/promises";
import { resolve, extname } from "node:path";
import handler from "../api/referral.js";
import { pathToFileURL } from "node:url";
const root = resolve(".");
export function createDevServer(apiHandler = handler) {
  return http.createServer(async (req, res) => {
    const pathname = new URL(req.url, "http://localhost").pathname;
    if (pathname === "/api/referral") {
      let body = "";
      for await (const part of req) {
        body += part;
        if (body.length > 16000) {
          res.writeHead(413);
          res.end();
          return;
        }
      }
      req.body = body;
      res.status = (n) => {
        res.statusCode = n;
        return res;
      };
      res.json = (b) => {
        res.setHeader("Content-Type", "application/json");
        res.end(JSON.stringify(b));
      };
      return apiHandler(req, res);
    }
    try {
      let p = decodeURIComponent(pathname);
      if (p === "/") p = "/index.html";
      if (
        !/^\/(assets\/[^.][^?]*|data\/(products|site)\.json|[a-z-]+\.html|config\.js)$/.test(
          p,
        )
      )
        throw Error();
      const path = resolve(root, "." + p);
      if (!path.startsWith(root + "/")) throw Error();
      res.setHeader(
        "Content-Type",
        {
          ".html": "text/html; charset=utf-8",
          ".js": "text/javascript",
          ".css": "text/css",
          ".json": "application/json",
          ".png": "image/png",
          ".jpg": "image/jpeg",
          ".svg": "image/svg+xml",
        }[extname(path)] || "application/octet-stream",
      );
      res.end(await readFile(path));
    } catch {
      res.writeHead(404);
      res.end("Not found");
    }
  });
}
if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(resolve(process.argv[1])).href
) {
  createDevServer().listen(Number(process.env.PORT || 3000), "127.0.0.1", () =>
    console.log("RFA.FIT http://127.0.0.1:" + (process.env.PORT || 3000)),
  );
}
