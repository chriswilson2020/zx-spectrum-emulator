import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import {
  ACTIVE_FREE85_RELEASE,
  ACTIVE_FREE85_ROM_SHA256,
  isActiveFree85Rom,
  sha256Hex
} from "../src/rom-identity.js";

test("recognizes only the active pinned Free85 ROM", async () => {
  const free85Rom = new Uint8Array(await readFile("ROM/FREE85.ROM"));
  assert.equal(await sha256Hex(free85Rom), ACTIVE_FREE85_ROM_SHA256);
  assert.equal(await isActiveFree85Rom(free85Rom), true);

  const otherRom = free85Rom.slice();
  otherRom[otherRom.length - 1] ^= 0xff;
  assert.equal(await isActiveFree85Rom(otherRom), false);
});

test("the vendored Free85 documentation bundle matches its manifest", async () => {
  const bundleRoot = `public/free85/${ACTIVE_FREE85_RELEASE}`;
  const manifest = JSON.parse(await readFile(`${bundleRoot}/manifest.json`, "utf8"));
  assert.equal(manifest.release, ACTIVE_FREE85_RELEASE);
  assert.equal(manifest.rom.sha256, ACTIVE_FREE85_ROM_SHA256);

  for (const [fileName, identity] of Object.entries(manifest.files)) {
    const bytes = new Uint8Array(await readFile(`${bundleRoot}/${fileName}`));
    assert.equal(await sha256Hex(bytes), identity.sha256, fileName);
  }
});
