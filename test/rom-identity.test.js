import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import {
  FREE85_RELEASE_210_SHA256,
  isFree85Release210Rom,
  sha256Hex
} from "../src/rom-identity.js";

test("recognizes only the pinned Free85 Release 2.10 ROM", async () => {
  const free85Rom = new Uint8Array(await readFile("ROM/FREE85.ROM"));
  assert.equal(await sha256Hex(free85Rom), FREE85_RELEASE_210_SHA256);
  assert.equal(await isFree85Release210Rom(free85Rom), true);

  const otherRom = free85Rom.slice();
  otherRom[otherRom.length - 1] ^= 0xff;
  assert.equal(await isFree85Release210Rom(otherRom), false);
});

test("the vendored Free85 documentation bundle matches its manifest", async () => {
  const bundleRoot = "public/free85/Release_2.10";
  const manifest = JSON.parse(await readFile(`${bundleRoot}/manifest.json`, "utf8"));
  assert.equal(manifest.release, "Release_2.10");
  assert.equal(manifest.rom.sha256, FREE85_RELEASE_210_SHA256);

  for (const [fileName, identity] of Object.entries(manifest.files)) {
    const bytes = new Uint8Array(await readFile(`${bundleRoot}/${fileName}`));
    assert.equal(await sha256Hex(bytes), identity.sha256, fileName);
  }
});
