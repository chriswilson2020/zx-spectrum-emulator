import assert from "node:assert/strict";
import test from "node:test";
import { tokenizeBasicLine } from "../public/basic.js";
import { loadTapEntry, parseTapeFile, parseTap, parseTzx, tapEntries } from "../public/tape.js";
import { Spectrum48 } from "../src/spectrum48.js";

function checksum(bytes) {
  return bytes.reduce((value, byte) => value ^ byte, 0);
}

function tapBlock(bytes) {
  return [bytes.length & 0xff, bytes.length >> 8, ...bytes];
}

function headerBlock({ type = 0, name = "HELLO", length, param1 = 0x8000, param2 = length }) {
  const nameBytes = Array.from(name.padEnd(10, " ").slice(0, 10), (char) => char.charCodeAt(0));
  const body = [
    0x00,
    type,
    ...nameBytes,
    length & 0xff,
    length >> 8,
    param1 & 0xff,
    param1 >> 8,
    param2 & 0xff,
    param2 >> 8
  ];
  return tapBlock([...body, checksum(body)]);
}

function dataBlock(payload) {
  const body = [0xff, ...payload];
  return tapBlock([...body, checksum(body)]);
}

function makeTap(blocks) {
  return new Uint8Array(blocks.flat());
}

function standardTzxBlock(bytes, pauseMs = 1000) {
  return [0x10, pauseMs & 0xff, pauseMs >> 8, bytes.length & 0xff, bytes.length >> 8, ...bytes];
}

function makeTzx(blocks) {
  return new Uint8Array([
    ..."ZXTape!\x1a".split("").map((char) => char.charCodeAt(0)),
    1,
    10,
    0x30,
    4,
    ..."test".split("").map((char) => char.charCodeAt(0)),
    ...blocks.flat()
  ]);
}

function makeMachine() {
  const machine = new Spectrum48({ rom: new Uint8Array(0x4000) });
  machine.write16(0x5c53, 0x5ccb);
  return machine;
}

test("parses TAP header and data blocks", () => {
  const program = tokenizeBasicLine("10 PRINT \"TAPE\"");
  const blocks = parseTap(makeTap([
    headerBlock({ name: "HELLO", length: program.length, param1: 10, param2: program.length }),
    dataBlock(program)
  ]));

  assert.equal(blocks.length, 2);
  assert.equal(blocks[0].checksumValid, true);
  assert.equal(blocks[0].header.typeName, "Program");
  assert.equal(blocks[0].header.name, "HELLO");
  assert.equal(blocks[1].payload.length, program.length);
});

test("pairs TAP headers with following data blocks", () => {
  const program = tokenizeBasicLine("10 PRINT \"TAPE\"");
  const entries = tapEntries(parseTap(makeTap([
    headerBlock({ name: "HELLO", length: program.length, param1: 10, param2: program.length }),
    dataBlock(program)
  ])));

  assert.equal(entries.length, 1);
  assert.equal(entries[0].loadable, true);
  assert.equal(entries[0].header.name, "HELLO");
});

test("fast-loads BASIC TAP entries into program memory", () => {
  const program = tokenizeBasicLine("10 PRINT \"TAPE\"");
  const entry = tapEntries(parseTap(makeTap([
    headerBlock({ name: "HELLO", length: program.length, param1: 10, param2: program.length }),
    dataBlock(program)
  ])))[0];
  const machine = makeMachine();

  const result = loadTapEntry(machine, entry);

  assert.equal(result.kind, "BASIC");
  assert.equal(result.autoStartLine, 10);
  assert.deepEqual(
    Array.from({ length: program.length }, (_, offset) => machine.read8(0x5ccb + offset)),
    program
  );
  assert.equal(machine.read16(0x5c4b), 0x5ccb + program.length);
});

test("fast-loads CODE TAP entries to the header start address", () => {
  const code = [0x3e, 0x42, 0xc9];
  const entry = tapEntries(parseTap(makeTap([
    headerBlock({ type: 3, name: "ROUTINE", length: code.length, param1: 0x8000, param2: 0x8000 }),
    dataBlock(code)
  ])))[0];
  const machine = makeMachine();

  const result = loadTapEntry(machine, entry);

  assert.equal(result.kind, "CODE");
  assert.equal(result.start, 0x8000);
  assert.deepEqual([machine.read8(0x8000), machine.read8(0x8001), machine.read8(0x8002)], code);
});

test("rejects corrupt TAP checksums", () => {
  const program = tokenizeBasicLine("10 PRINT \"TAPE\"");
  const tap = makeTap([
    headerBlock({ name: "HELLO", length: program.length }),
    dataBlock(program)
  ]);
  tap[tap.length - 1] ^= 0xff;
  const entry = tapEntries(parseTap(tap))[0];

  assert.throws(() => loadTapEntry(makeMachine(), entry), /checksum/i);
});

test("parses TZX standard-speed blocks as mountable tape blocks", () => {
  const program = tokenizeBasicLine("10 PRINT \"TZX\"");
  const blocks = parseTzx(makeTzx([
    standardTzxBlock(headerBlock({ name: "TZXTEST", length: program.length, param1: 10, param2: program.length }).slice(2)),
    standardTzxBlock(dataBlock(program).slice(2)),
    standardTzxBlock(dataBlock([0x3e, 0x42, 0xc9]).slice(2))
  ]));
  const entries = tapEntries(blocks);

  assert.equal(blocks.length, 3);
  assert.equal(blocks[0].source, "TZX");
  assert.equal(blocks[0].pauseMs, 1000);
  assert.equal(blocks[2].flag, 0xff);
  assert.equal(entries.length, 1);
  assert.equal(entries[0].header.name, "TZXTEST");
  assert.equal(entries[0].loadable, true);
});

test("detects TZX files through the generic tape parser", () => {
  const blocks = parseTapeFile(makeTzx([
    standardTzxBlock(dataBlock([0x01, 0x02, 0x03]).slice(2), 500)
  ]));

  assert.equal(blocks.length, 1);
  assert.equal(blocks[0].source, "TZX");
  assert.equal(blocks[0].pauseMs, 500);
});

test("feeds mounted TAP blocks to the ROM tape load routine", () => {
  const header = headerBlock({ type: 3, name: "CODE", length: 3, param1: 0x8000, param2: 0x8000 });
  const blocks = parseTap(makeTap([header]));
  const machine = makeMachine();
  machine.setTapeBlocks(blocks);
  machine.cpu.PC = 0x0556;
  machine.cpu.SP = 0x7000;
  machine.cpu.A = 0x00;
  machine.cpu.IX = 0x6000;
  machine.cpu.DE = 17;
  machine.write16(machine.cpu.SP, 0x1234);

  const cycles = machine.step();

  assert.equal(cycles, 32);
  assert.equal(machine.cpu.PC, 0x1234);
  assert.equal(machine.cpu.SP, 0x7002);
  assert.equal(machine.cpu.IX, 0x6011);
  assert.equal(machine.cpu.DE, 0);
  assert.equal(machine.tapeCursor, 1);
  assert.deepEqual(
    Array.from({ length: 17 }, (_, offset) => machine.read8(0x6000 + offset)),
    Array.from(blocks[0].payload)
  );
});

test("leaves the ROM tape routine alone when the next TAP block does not match", () => {
  const blocks = parseTap(makeTap([dataBlock([0x3e, 0x42, 0xc9])]));
  const machine = makeMachine();
  machine.setTapeBlocks(blocks);
  machine.cpu.PC = 0x0556;
  machine.cpu.A = 0x00;
  machine.cpu.IX = 0x6000;
  machine.cpu.DE = 17;

  machine.step();

  assert.equal(machine.cpu.PC, 0x0557);
  assert.equal(machine.tapeCursor, 0);
});

test("standard tape pulse playback drives the EAR bit on port fe", () => {
  const blocks = parseTzx(makeTzx([
    standardTzxBlock(dataBlock([0x00]).slice(2), 0)
  ]));
  const machine = makeMachine();
  machine.setTapeBlocks(blocks);
  machine.startTapePlayback({ startIndex: 0, initialPauseMs: 0 });

  const firstLevel = machine.readPort(0xfe) & 0x40;
  machine.cpu.tStates += 2168;
  const secondLevel = machine.readPort(0xfe) & 0x40;

  assert.notEqual(firstLevel, secondLevel);
});

test("tape playback from the cursor waits for the previous block pause", () => {
  const blocks = parseTzx(makeTzx([
    standardTzxBlock(dataBlock([0x00]).slice(2), 2),
    standardTzxBlock(dataBlock([0xff]).slice(2), 0)
  ]));
  const machine = makeMachine();
  machine.setTapeBlocks(blocks, { cursor: 1 });
  machine.startTapePlaybackFromCursor();

  const firstLevel = machine.readPort(0xfe) & 0x40;
  machine.cpu.tStates += 6999;
  assert.equal(machine.readPort(0xfe) & 0x40, firstLevel);

  machine.cpu.tStates += 2169;
  assert.notEqual(machine.readPort(0xfe) & 0x40, firstLevel);
});
