import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { readFile, rm } from "node:fs/promises";
import { spawnSync } from "node:child_process";
import test from "node:test";

test("browser entry points use project-page-safe relative paths", async () => {
  const index = await readFile("public/index.html", "utf8");
  const spectrum = await readFile("public/spectrum.html", "utf8");
  const cpm = await readFile("public/cpm.html", "utf8");
  const app = await readFile("public/app.js", "utf8");

  assert.match(index, /href="\.\/public\/styles\.css"/);
  assert.match(index, /href="\.\/spectrum\.html"/);
  assert.match(index, /href="\.\/cpm\.html"/);
  assert.match(index, /src="\.\/public\/assets\/machine-selector-banner\.png"/);
  assert.match(spectrum, /href="\.\/public\/styles\.css"/);
  assert.match(spectrum, /src="\.\/public\/app\.js"/);
  assert.match(cpm, /href="\.\/public\/styles\.css"/);
  assert.match(cpm, /src="\.\/public\/cpm-app\.js(?:\?[^"]+)?"/);
  assert.doesNotMatch(index, /href="\/public\//);
  assert.doesNotMatch(index, /src="\/public\//);
  assert.doesNotMatch(spectrum, /href="\/public\//);
  assert.doesNotMatch(spectrum, /src="\/public\//);
  assert.doesNotMatch(cpm, /href="\/public\//);
  assert.doesNotMatch(cpm, /src="\/public\//);
  assert.doesNotMatch(app, /from "\/(public|src)\//);
  assert.match(app, /new URL\("\.\.\/ROM\/48\.rom", import\.meta\.url\)/);
});

test("viewer groups secondary tools into tabs and keeps debugger collapsible", async () => {
  const index = await readFile("public/spectrum.html", "utf8");

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

test("machine selector exposes Spectrum and CP/M routes", async () => {
  const index = await readFile("public/index.html", "utf8");

  assert.match(index, /Z80 Machine Lab/);
  assert.match(index, /ZX Spectrum 48K/);
  assert.match(index, /CP\/M 2\.2/);
  assert.match(index, /machine-selector-banner\.png/);
});

test("CP/M page exposes a live terminal entry point", async () => {
  const cpm = await readFile("public/cpm.html", "utf8");
  const app = await readFile("public/cpm-app.js", "utf8");

  assert.match(cpm, /id="cpmTerminal"/);
  assert.match(cpm, /tabindex="0"/);
  assert.match(cpm, /id="cpmMachineProfile"/);
  assert.match(cpm, /id="cpmReset"/);
  assert.match(cpm, /id="cpmDiskFile"/);
  assert.match(cpm, /id="cpmDiskDrive"/);
  assert.match(cpm, /id="cpmLoadDisk"/);
  assert.match(cpm, /id="cpmSaveDisk"/);
  assert.match(cpm, /id="cpmFileDrive"/);
  assert.match(cpm, /<option value="2">C: Companion Disk<\/option>/);
  assert.match(cpm, /<option value="2">C: Companion<\/option>/);
  assert.match(cpm, /id="cpmFileList"/);
  assert.match(cpm, /id="cpmImportFile"/);
  assert.match(cpm, /id="cpmDownloadFile"/);
  assert.match(cpm, /id="cpmDeleteFile"/);
  assert.match(cpm, /id="cpmForeignDiskFile"/);
  assert.match(cpm, /id="cpmLoadForeignDisk"/);
  assert.match(cpm, /id="cpmForeignFileList"/);
  assert.match(cpm, /id="cpmCopyForeignFiles"/);
  assert.match(cpm, /id="cpmCopyAllForeignFiles"/);
  assert.match(app, /new URL\(path, import\.meta\.url\)/);
  assert.match(app, /loadDiskAsset\("\.\.\/ROM\/cpm22-1\.dsk"\)/);
  assert.match(app, /loadDiskAsset\("\.\.\/ROM\/cpm22-2\.dsk"\)/);
  assert.match(app, /loadDiskAsset\("\.\.\/ROM\/DS0N00\.DSK"\)/);
  assert.match(app, /loadDiskAsset\("\.\.\/ROM\/DS0N06\.DSK"\)/);
  assert.match(app, /Z80Mbc2Machine/);
  assert.match(app, /downloadBytes/);
  assert.match(app, /RawCpmDisk\.z80simFloppy\(bytes\)/);
  assert.match(app, /RawCpmDisk\.blankZ80simFloppy\(\)/);
  assert.match(app, /activeProfile\.createFileSystem\(selectedFileDisk\(\), selectedDiskIndex\(fileDriveSelect\)\)/);
  assert.match(app, /detectCpmDiskGeometry/);
  assert.match(app, /foreignFileSystem\.readFile/);
  assert.doesNotMatch(app, /from "\/(public|src)\//);
});

test("build:pages creates a static dist tree for GitHub Pages", async () => {
  await rm("dist", { recursive: true, force: true });

  const result = spawnSync("npm", ["run", "build:pages"], {
    encoding: "utf8"
  });

  assert.equal(result.status, 0, result.stderr || result.stdout);
  assert.equal(existsSync("dist/index.html"), true);
  assert.equal(existsSync("dist/spectrum.html"), true);
  assert.equal(existsSync("dist/cpm.html"), true);
  assert.equal(existsSync("dist/public/app.js"), true);
  assert.equal(existsSync("dist/public/cpm-app.js"), true);
  assert.equal(existsSync("dist/public/cpm-terminal.js"), true);
  assert.equal(existsSync("dist/public/assets/machine-selector-banner.png"), true);
  assert.equal(existsSync("dist/src/spectrum48.js"), true);
  assert.equal(existsSync("dist/src/z80mbc2.js"), true);
  assert.equal(existsSync("dist/ROM/48.rom"), true);
  assert.equal(existsSync("dist/ROM/cpm22-1.dsk"), true);
  assert.equal(existsSync("dist/ROM/cpm22-2.dsk"), true);
  assert.equal(existsSync("dist/ROM/DS0N00.DSK"), true);
  assert.equal(existsSync("dist/ROM/DS0N06.DSK"), true);
});
