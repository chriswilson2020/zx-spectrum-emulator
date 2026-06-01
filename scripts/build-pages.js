import { existsSync } from "node:fs";
import { copyFile, cp, mkdir, rm } from "node:fs/promises";

await rm("dist", { recursive: true, force: true });
await mkdir("dist", { recursive: true });

await copyFile("public/index.html", "dist/index.html");
await cp("public", "dist/public", { recursive: true });
await cp("src", "dist/src", { recursive: true });

if (existsSync("ROM")) {
  await cp("ROM", "dist/ROM", { recursive: true });
}

console.log("Built GitHub Pages demo into dist/");
