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
