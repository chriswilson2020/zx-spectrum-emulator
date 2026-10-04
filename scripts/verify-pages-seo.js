import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";

const canonical = "https://tuklusan.github.io/zx-spectrum-emulator/";
const requiredTitle = "ZX Spectrum Online Emulator | JavaScript 48K Web Emulator";

function requireText(text, needle, label) {
  if (!text.includes(needle)) {
    throw new Error(`Pages SEO verification failed: ${label}`);
  }
}

function forbidText(text, needle, label) {
  if (text.includes(needle)) {
    throw new Error(`Pages SEO verification failed: ${label}`);
  }
}

const [indexHtml, spectrumHtml, machinesHtml, sitemap] = await Promise.all([
  readFile("dist/index.html", "utf8"),
  readFile("dist/spectrum.html", "utf8"),
  readFile("dist/machines.html", "utf8"),
  readFile("dist/sitemap.xml", "utf8")
]);

for (const [name, html] of [["index.html", indexHtml], ["spectrum.html", spectrumHtml]]) {
  requireText(html, `<title>${requiredTitle}</title>`, `${name} title`);
  requireText(html, `<link rel="canonical" href="${canonical}">`, `${name} canonical`);
  requireText(html, "<h1>ZX Spectrum 48K Online Emulator</h1>", `${name} H1`);
  requireText(html, "JavaScript web emulator", `${name} JavaScript/browser copy`);
  requireText(html, "standard-speed TZX", `${name} TZX accuracy qualifier`);
  requireText(html, "SNA and Z80 snapshot support", `${name} snapshot copy`);
  requireText(html, "Browser Z80 debugger", `${name} debugger copy`);
  requireText(html, 'href="./machines.html">Machines</a>', `${name} Machines navigation`);
  forbidText(html, 'name="keywords"', `${name} must not use obsolete meta keywords`);
}

if (indexHtml !== spectrumHtml) {
  throw new Error("Pages SEO verification failed: index.html and spectrum.html diverged");
}

requireText(
  machinesHtml,
  'class="machine-link spectrum-link" href="./"',
  "machines.html must link to the canonical Spectrum root"
);
requireText(
  machinesHtml,
  '<link rel="canonical" href="https://tuklusan.github.io/zx-spectrum-emulator/machines.html">',
  "machines.html canonical"
);
requireText(sitemap, `<loc>${canonical}</loc>`, "sitemap canonical root");
forbidText(
  sitemap,
  "<loc>https://tuklusan.github.io/zx-spectrum-emulator/spectrum.html</loc>",
  "sitemap must not list the duplicate spectrum.html URL"
);

for (const rawShell of ["index.html", "spectrum.html", "cpm.html", "trs80.html", "ti85.html"]) {
  if (existsSync(`dist/public/${rawShell}`)) {
    throw new Error(`Pages SEO verification failed: duplicate raw HTML shell dist/public/${rawShell}`);
  }
}

console.log("GitHub Pages SEO verification: PASS");
