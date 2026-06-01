import { createReadStream, statSync } from "node:fs";
import { createServer } from "node:http";
import { extname, join, normalize, resolve } from "node:path";

const root = process.cwd();
const port = Number(process.env.PORT ?? 3000);

const contentTypes = new Map([
  [".css", "text/css; charset=utf-8"],
  [".html", "text/html; charset=utf-8"],
  [".js", "text/javascript; charset=utf-8"],
  [".json", "application/json; charset=utf-8"],
  [".png", "image/png"],
  [".rom", "application/octet-stream"],
  [".dsk", "application/octet-stream"]
]);

function resolveRequestPath(url) {
  const pathname = new URL(url, `http://localhost:${port}`).pathname;
  const htmlEntryPoints = new Set(["/index.html", "/spectrum.html", "/cpm.html"]);
  const requested = pathname === "/" ? "/public/index.html" : htmlEntryPoints.has(pathname) ? `/public${pathname}` : pathname;
  const resolved = resolve(root, normalize(`.${requested}`));
  if (!resolved.startsWith(root)) return null;
  return resolved;
}

const server = createServer((request, response) => {
  const filePath = resolveRequestPath(request.url);
  if (!filePath) {
    response.writeHead(403);
    response.end("Forbidden");
    return;
  }

  try {
    const stat = statSync(filePath);
    if (!stat.isFile()) throw new Error("Not a file");

    response.writeHead(200, {
      "content-length": stat.size,
      "content-type": contentTypes.get(extname(filePath)) ?? "application/octet-stream"
    });
    createReadStream(filePath).pipe(response);
  } catch {
    response.writeHead(404, { "content-type": "text/plain; charset=utf-8" });
    response.end("Not found");
  }
});

server.listen(port, () => {
  console.log(`Z80 Machine Lab: http://localhost:${port}`);
});
