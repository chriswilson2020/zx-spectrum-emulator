import { existsSync } from "node:fs";
import { copyFile, cp, mkdir, readFile, rm, writeFile } from "node:fs/promises";

await rm("dist", { recursive: true, force: true });
await mkdir("dist", { recursive: true });

function replaceRequired(source, from, to, label) {
  if (!source.includes(from)) {
    throw new Error(`GitHub Pages build invariant failed: ${label}`);
  }
  return source.replace(from, to);
}

const spectrumSource = await readFile("public/spectrum.html", "utf8");
const pagesSpectrum = replaceRequired(
  spectrumSource,
  'href="./index.html">Machines</a>',
  'href="./machines.html">Machines</a>',
  "Spectrum Machines link"
);
await writeFile("dist/index.html", pagesSpectrum);
await writeFile("dist/spectrum.html", pagesSpectrum);

const selectorSource = await readFile("public/index.html", "utf8");
const pagesSelector = replaceRequired(
  selectorSource,
  'class="machine-link spectrum-link" href="./spectrum.html"',
  'class="machine-link spectrum-link" href="./"',
  "machine selector Spectrum canonical link"
);
await writeFile("dist/machines.html", pagesSelector);

await copyFile("public/cpm.html", "dist/cpm.html");
await copyFile("public/trs80.html", "dist/trs80.html");
await copyFile("public/ti85.html", "dist/ti85.html");
await copyFile("sitemap.xml", "dist/sitemap.xml");
await cp("public", "dist/public", { recursive: true });
for (const htmlShell of ["index.html", "spectrum.html", "cpm.html", "trs80.html", "ti85.html"]) {
  await rm(`dist/public/${htmlShell}`, { force: true });
}
await cp("src", "dist/src", { recursive: true });

if (existsSync("ROM")) {
  await cp("ROM", "dist/ROM", { recursive: true });
}

console.log("Built GitHub Pages demo into dist/");
