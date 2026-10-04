import assert from "node:assert/strict";
import test from "node:test";
import { createZip, jsonBytes, parseJsonBytes, readZip } from "../public/cpm-session.js";

test("CP/M session ZIP stores JSON and compressed binary entries", async () => {
  const zeros = new Uint8Array(16 * 1024).fill(0xe5);
  const zip = await createZip([
    { name: "manifest.json", bytes: jsonBytes({ format: "z80lab-cpm-session", version: 1 }) },
    { name: "drives/F.dsk", bytes: zeros }
  ]);

  assert.ok(zip.length < zeros.length, "blank disk data should compress inside the ZIP session");

  const entries = await readZip(zip);
  assert.deepEqual(parseJsonBytes(entries.get("manifest.json")), { format: "z80lab-cpm-session", version: 1 });
  assert.deepEqual(entries.get("drives/F.dsk"), zeros);
});
