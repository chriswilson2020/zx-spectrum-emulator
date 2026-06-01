import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { RawCpmDisk } from "../src/cpm-disk.js";
import { CpmFileSystem, detectCpmDiskGeometry, normalizeCpmName } from "../src/cpm-filesystem.js";

function loadFileSystem() {
  return new CpmFileSystem(RawCpmDisk.z80simFloppy(readFileSync("ROM/cpm22-1.dsk")));
}

function emptyFileSystem() {
  const bytes = new Uint8Array(77 * 26 * 128).fill(0xe5);
  return new CpmFileSystem(RawCpmDisk.z80simFloppy(bytes));
}

test("normalizes valid CP/M 8.3 filenames and rejects invalid names", () => {
  assert.equal(normalizeCpmName("test.txt"), "TEST.TXT");
  assert.equal(normalizeCpmName("ed"), "ED");
  assert.throws(() => normalizeCpmName("TOOLONGER.TXT"), /Invalid/);
  assert.throws(() => normalizeCpmName("BAD.NAME2"), /Invalid/);
  assert.throws(() => normalizeCpmName("bad/name.txt"), /Invalid/);
});

test("lists files from the z80pack CP/M system disk", () => {
  const fs = loadFileSystem();
  const names = fs.listFiles().map((file) => file.name);

  assert.equal(names.includes("ED.COM"), true);
  assert.equal(names.includes("PIP.COM"), true);
  assert.equal(names.includes("Z80ASM.COM"), true);
});

test("reads existing CP/M files from allocation blocks", () => {
  const fs = loadFileSystem();
  const bytes = fs.readFile("ED.COM");

  assert.equal(bytes.length > 0, true);
  assert.equal(bytes[0], 0xc3);
  assert.equal(bytes.some((byte, index) => index < 512 && byte === 0xcd), true);
});

test("writes, reads, overwrites, and deletes a CP/M text file", () => {
  const fs = emptyFileSystem();
  const text = new TextEncoder().encode("HELLO FROM HOST\r\n");

  fs.writeFile("HOST.TXT", text);

  assert.equal(fs.disk.dirty, true);
  assert.equal(fs.hasFile("HOST.TXT"), true);
  assert.deepEqual(fs.readFile("HOST.TXT", { trimCtrlZ: true }), text);

  const replacement = new TextEncoder().encode("REPLACED\r\n");
  fs.writeFile("HOST.TXT", replacement);

  assert.deepEqual(fs.readFile("HOST.TXT", { trimCtrlZ: true }), replacement);
  assert.equal(fs.deleteFile("HOST.TXT"), true);
  assert.equal(fs.hasFile("HOST.TXT"), false);
});

test("writes files that require multiple extents", () => {
  const fs = emptyFileSystem();
  const bytes = new Uint8Array(20_000);
  for (let index = 0; index < bytes.length; index += 1) bytes[index] = index & 0xff;

  fs.writeFile("BIG.BIN", bytes);

  assert.deepEqual(fs.readFile("BIG.BIN", { trimCtrlZ: true }), bytes);
  assert.equal(fs.listFiles().find((file) => file.name === "BIG.BIN").extents, 2);
  assert.deepEqual(
    fs.readDirectoryEntries()
      .filter((entry) => !entry.deleted && entry.name === "BIG.BIN")
      .map((entry) => entry.rawRecords),
    [128, 29]
  );
});

test("repairs old imports that stored full extents with a zero record count", () => {
  const fs = emptyFileSystem();
  const bytes = new Uint8Array(32_768).fill(0xa5);

  fs.writeFile("FULL.COM", bytes);
  for (const entry of fs.readDirectoryEntries().filter((candidate) => !candidate.deleted && candidate.name === "FULL.COM")) {
    fs.writeLogicalByte(entry.offset + 15, 0);
  }
  fs.disk.dirty = false;

  assert.equal(fs.repairFullExtentRecordCounts(), true);
  assert.equal(fs.disk.dirty, true);
  assert.deepEqual(
    fs.readDirectoryEntries()
      .filter((entry) => !entry.deleted && entry.name === "FULL.COM")
      .map((entry) => entry.rawRecords),
    [128, 128]
  );
  assert.deepEqual(fs.readFile("FULL.COM", { trimCtrlZ: true }), bytes);
});

test("detects and reads Z80-MBC2 8MB system disk images", () => {
  const bytes = new Uint8Array(8 * 1024 * 1024).fill(0xe5);
  const directoryOffset = 0x4000;
  const payload = new Uint8Array(24_576);
  for (let index = 0; index < payload.length; index += 1) payload[index] = index & 0xff;
  payload[0] = 0xc3;

  writeSyntheticDirectoryEntry(bytes, directoryOffset, {
    name: "MBASIC.COM",
    extent: 1,
    records: 64,
    blocks: [4, 5, 6, 7, 8, 9]
  });
  bytes.set(payload.slice(0, 4096), 0x8000);
  bytes.set(payload.slice(4096, 8192), 0x9000);
  bytes.set(payload.slice(8192, 12_288), 0xa000);
  bytes.set(payload.slice(12_288, 16_384), 0xb000);
  bytes.set(payload.slice(16_384, 20_480), 0xc000);
  bytes.set(payload.slice(20_480), 0xd000);

  const geometry = detectCpmDiskGeometry(bytes, "DS0N00.DSK");
  const fs = new CpmFileSystem({ bytes, dirty: false }, { geometry });

  assert.equal(geometry.id, "z80mbc2-d0");
  assert.equal(fs.listFiles()[0].name, "MBASIC.COM");
  assert.equal(fs.listFiles()[0].size, payload.length);
  assert.deepEqual(fs.readFile("MBASIC.COM"), payload);
});

test("detects and reads Z80-MBC2 8MB data disk images", () => {
  const bytes = new Uint8Array(8 * 1024 * 1024).fill(0xe5);
  const payload = new TextEncoder().encode("HELLO FROM Z80-MBC2\r\n");
  writeSyntheticDirectoryEntry(bytes, 0, {
    name: "HELLO.TXT",
    extent: 0,
    records: 1,
    blocks: [4]
  });
  bytes.set(payload, 0x4000);

  const geometry = detectCpmDiskGeometry(bytes, "DS0N01.DSK");
  const fs = new CpmFileSystem({ bytes, dirty: false }, { geometry });

  assert.equal(geometry.id, "z80mbc2-d1");
  assert.equal(fs.listFiles()[0].name, "HELLO.TXT");
  assert.deepEqual(fs.readFile("HELLO.TXT", { trimCtrlZ: true }).slice(0, payload.length), payload);
});

test("rejects unknown CP/M disk image sizes", () => {
  assert.throws(() => detectCpmDiskGeometry(new Uint8Array(12345), "unknown.dsk"), /Unsupported CP\/M disk image/);
});

function writeSyntheticDirectoryEntry(bytes, offset, { name, extent, records, blocks }) {
  const [base, extension = ""] = name.split(".");
  bytes[offset] = 0;
  writeAscii(bytes, offset + 1, base.padEnd(8, " "));
  writeAscii(bytes, offset + 9, extension.padEnd(3, " "));
  bytes[offset + 12] = extent;
  bytes[offset + 15] = records;
  blocks.forEach((block, index) => {
    const blockOffset = offset + 16 + (index * 2);
    bytes[blockOffset] = block & 0xff;
    bytes[blockOffset + 1] = block >> 8;
  });
}

function writeAscii(bytes, offset, text) {
  for (let index = 0; index < text.length; index += 1) bytes[offset + index] = text.charCodeAt(index);
}
