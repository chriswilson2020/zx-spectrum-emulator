import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { readFile, rm } from "node:fs/promises";
import { spawnSync } from "node:child_process";
import test from "node:test";

test("browser entry points use project-page-safe relative paths", async () => {
  const index = await readFile("public/index.html", "utf8");
  const app = await readFile("public/app.js", "utf8");

  assert.match(index, /href="\.\/public\/styles\.css"/);
  assert.match(index, /src="\.\/public\/app\.js"/);
  assert.doesNotMatch(index, /href="\/public\//);
  assert.doesNotMatch(index, /src="\/public\//);
  assert.doesNotMatch(app, /from "\/(public|src)\//);
  assert.match(app, /new URL\("\.\.\/ROM\/48\.rom", import\.meta\.url\)/);
});

test("viewer groups secondary tools into tabs and keeps debugger collapsible", async () => {
  const index = await readFile("public/index.html", "utf8");

  assert.match(index, /role="tablist"/);
  assert.match(index, /data-tool-tab="basic"/);
  assert.match(index, /data-tool-tab="tape"/);
  assert.match(index, /data-tool-tab="snapshots"/);
  assert.match(index, /data-tool-tab="debug"/);
  assert.match(index, /id="basicPanel"/);
  assert.match(index, /id="tapePanel"/);
  assert.match(index, /id="snapshotsPanel"/);
  assert.match(index, /id="debugPanel"/);
  assert.match(index, /<details class="debug-drawer"/);
});

test("build:pages creates a static dist tree for GitHub Pages", async () => {
  await rm("dist", { recursive: true, force: true });

  const result = spawnSync("npm", ["run", "build:pages"], {
    encoding: "utf8"
  });

  assert.equal(result.status, 0, result.stderr || result.stdout);
  assert.equal(existsSync("dist/index.html"), true);
  assert.equal(existsSync("dist/public/app.js"), true);
  assert.equal(existsSync("dist/src/spectrum48.js"), true);
  assert.equal(existsSync("dist/ROM/48.rom"), true);
});
