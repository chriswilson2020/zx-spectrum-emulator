import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { parseCas, trs80CasEntries, loadTrs80CasEntry } from "../public/trs80-cassette.js";
import { Trs80Model3Machine } from "../src/trs80-model3.js";

const TXTTAB = 0x40a4;
const VARTAB = 0x40f9;
const BASIC_START = 0x42e9;
const HELLO_CAS_FIXTURE = new Uint8Array(
  readFileSync(new URL("./fixtures/trs80-hello.cas.hex", import.meta.url), "utf8")
    .trim()
    .match(/[0-9a-f]{2}/gi)
    .map((byte) => Number.parseInt(byte, 16))
);

function makeRom(bytes = {}) {
  const rom = new Uint8Array(0x3800);
  for (const [address, value] of Object.entries(bytes)) {
    rom[Number(address)] = value;
  }
  return rom;
}

function basicProgramRecords() {
  return [
    0xf7, 0x42, 0x0a, 0x00, 0xb2, 0x20, 0x22, 0x48, 0x45, 0x4c, 0x4c, 0x4f, 0x22, 0x00,
    0x00, 0x00
  ];
}

function makeBasicCas({ name = "H", leaderBytes = 256 } = {}) {
  return new Uint8Array([
    ...new Array(leaderBytes).fill(0x00),
    0xa5,
    0xd3,
    0xd3,
    0xd3,
    name.charCodeAt(0),
    ...basicProgramRecords()
  ]);
}

function makeSystemCas({
  name = "SYSAPP",
  loadAddress = 0x5000,
  entryPoint = 0x5010,
  data = [0x3e, 0x2a, 0x32, 0x00, 0x44],
  leaderBytes = 256
} = {}) {
  const nameBytes = name.padEnd(6, " ").slice(0, 6).split("").map((char) => char.charCodeAt(0));
  const addressBytes = [loadAddress & 0xff, loadAddress >> 8];
  const checksum = [...addressBytes, ...data].reduce((sum, byte) => (sum + byte) & 0xff, 0);
  return new Uint8Array([
    ...new Array(leaderBytes).fill(0x00),
    0xa5,
    0x55,
    ...nameBytes,
    0x3c,
    data.length,
    ...addressBytes,
    ...data,
    checksum,
    0x78,
    entryPoint & 0xff,
    entryPoint >> 8
  ]);
}

function makeBlockCasHeader() {
  const headerPayload = [
    ..."BARKEEP ".split("").map((char) => char.charCodeAt(0)),
    0x02,
    0x00,
    0x00,
    0x03,
    0x00,
    0x01,
    0x00
  ];
  const checksum = [0x00, headerPayload.length, ...headerPayload].reduce((sum, byte) => (sum + byte) & 0xff, 0);
  return new Uint8Array([
    ...new Array(256).fill(0x55),
    0x3c,
    0x00,
    headerPayload.length,
    ...headerPayload,
    checksum,
    0x55
  ]);
}

function makeReadyMachine() {
  const machine = new Trs80Model3Machine({ rom: makeRom() });
  machine.write16(TXTTAB, BASIC_START);
  machine.write16(VARTAB, BASIC_START + 2);
  return machine;
}

test("parses Level II BASIC CAS files", () => {
  const blocks = parseCas(HELLO_CAS_FIXTURE);
  const entries = trs80CasEntries(blocks);

  assert.equal(blocks.length, 1);
  assert.equal(blocks[0].kind, "BASIC");
  assert.equal(blocks[0].name, "H");
  assert.equal(blocks[0].lineCount, 1);
  assert.equal(blocks[0].checksumValid, true);
  assert.equal(entries.length, 1);
  assert.equal(entries[0].loadable, true);
});

test("rejects block-structured CAS files with a helpful diagnostic", () => {
  assert.throws(
    () => parseCas(makeBlockCasHeader()),
    /unsupported block-structured CAS.*BARKEEP.*not TRS-80 Model III BASIC/i
  );
});

test("parses SYSTEM CAS files", () => {
  const blocks = parseCas(makeSystemCas());
  const entries = trs80CasEntries(blocks);

  assert.equal(blocks.length, 1);
  assert.equal(blocks[0].kind, "SYSTEM");
  assert.equal(blocks[0].name, "SYSAPP");
  assert.equal(blocks[0].entryPoint, 0x5010);
  assert.equal(blocks[0].records.length, 1);
  assert.equal(blocks[0].records[0].address, 0x5000);
  assert.deepEqual([...blocks[0].records[0].data], [0x3e, 0x2a, 0x32, 0x00, 0x44]);
  assert.equal(blocks[0].checksumValid, true);
  assert.equal(entries[0].loadable, true);
});

test("fast-loads BASIC CAS entries into Model III BASIC RAM", () => {
  const entry = trs80CasEntries(parseCas(makeBasicCas({ name: "H" })))[0];
  const machine = makeReadyMachine();

  const result = loadTrs80CasEntry(machine, entry);

  assert.equal(result.kind, "BASIC");
  assert.equal(result.name, "H");
  assert.equal(result.start, BASIC_START);
  assert.equal(result.end, BASIC_START + basicProgramRecords().length);
  assert.deepEqual(
    Array.from({ length: basicProgramRecords().length }, (_, offset) => machine.read8(BASIC_START + offset)),
    basicProgramRecords()
  );
  assert.equal(machine.read16(VARTAB), BASIC_START + basicProgramRecords().length);
});

test("fast-loads SYSTEM CAS entries and jumps to the entry point", () => {
  const entry = trs80CasEntries(parseCas(makeSystemCas()))[0];
  const machine = makeReadyMachine();

  const result = loadTrs80CasEntry(machine, entry);

  assert.equal(result.kind, "SYSTEM");
  assert.equal(result.name, "SYSAPP");
  assert.equal(result.start, 0x5000);
  assert.equal(result.end, 0x5005);
  assert.equal(result.entryPoint, 0x5010);
  assert.equal(machine.cpu.PC, 0x5010);
  assert.deepEqual(
    Array.from({ length: 5 }, (_, offset) => machine.read8(0x5000 + offset)),
    [0x3e, 0x2a, 0x32, 0x00, 0x44]
  );
});

test("rejects corrupt SYSTEM CAS entries when fast-loading", () => {
  const cas = makeSystemCas();
  cas[cas.length - 4] ^= 0xff;
  const entry = trs80CasEntries(parseCas(cas))[0];
  const machine = makeReadyMachine();

  assert.equal(entry.loadable, false);
  assert.throws(() => loadTrs80CasEntry(machine, entry), /SYSTEM.*corrupt/i);
});

test("relocates BASIC line links when TXTTAB changes", () => {
  const entry = trs80CasEntries(parseCas(makeBasicCas()))[0];
  const machine = makeReadyMachine();
  machine.write16(TXTTAB, 0x5000);

  loadTrs80CasEntry(machine, entry);

  assert.equal(machine.read16(0x5000), 0x500e);
  assert.equal(machine.read16(0x500e), 0x0000);
});

test("plays mounted CAS data as cassette levels on the input port", () => {
  const blocks = parseCas(makeBasicCas({ leaderBytes: 4 }));
  const machine = makeReadyMachine();
  machine.setCassetteBlocks(blocks);
  machine.startCassettePlayback({ initialSilenceMs: 0 });

  const firstLevel = machine.readPort(0xff) & 0x80;
  machine.cpu.tStates += Trs80Model3Machine.CASSETTE_HALF_WAVE_T_STATES;
  const secondLevel = machine.readPort(0xff) & 0x80;

  assert.notEqual(firstLevel, secondLevel);
});
