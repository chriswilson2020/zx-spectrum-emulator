import assert from "node:assert/strict";
import test from "node:test";
import {
  disassembleAt,
  disassembleWindow,
  hexByte,
  hexWord,
  readBasicStatus,
  readMemoryRows,
  readSystemVariables
} from "../public/debugger.js";
import { Spectrum48 } from "../src/spectrum48.js";

function readFrom(bytes) {
  return (address) => bytes[address & 0xffff] ?? 0;
}

function makeMachine() {
  return new Spectrum48({ rom: new Uint8Array(0x4000) });
}

test("formats bytes and words as uppercase hex", () => {
  assert.equal(hexByte(0x0a), "0A");
  assert.equal(hexWord(0x5c53), "5C53");
});

test("disassembles common control and load instructions", () => {
  const memory = readFrom({
    0x0000: 0x3e,
    0x0001: 0x42,
    0x0002: 0xc3,
    0x0003: 0x34,
    0x0004: 0x12,
    0x0005: 0x18,
    0x0006: 0xfe
  });

  assert.deepEqual(disassembleAt(memory, 0x0000), {
    address: 0x0000,
    bytes: [0x3e, 0x42],
    text: "LD A,42H",
    size: 2
  });
  assert.equal(disassembleAt(memory, 0x0002).text, "JP 1234H");
  assert.equal(disassembleAt(memory, 0x0005).text, "JR 0005H");
});

test("builds a disassembly window with PC highlighted", () => {
  const rows = disassembleWindow(readFrom({ 0x1000: 0x00, 0x1001: 0x76 }), 0x1000, {
    beforeBytes: 0,
    count: 2
  });

  assert.equal(rows[0].text, "NOP");
  assert.equal(rows[0].isPc, true);
  assert.equal(rows[1].text, "HALT");
});

test("reads memory rows for hex inspection", () => {
  const rows = readMemoryRows(readFrom({ 0x4000: 1, 0x4001: 2, 0x4002: 3 }), 0x4000, {
    rows: 1,
    bytesPerRow: 4
  });

  assert.deepEqual(rows, [{ address: 0x4000, bytes: [1, 2, 3, 0] }]);
});

test("reads Spectrum BASIC status and system variables", () => {
  const machine = makeMachine();
  machine.write8(0x5c3a, 0xff);
  machine.write16(0x5c45, 20);
  machine.write8(0x5c47, 2);
  machine.write16(0x5c53, 0x5ccb);
  machine.write16(0x5c4b, 0x6000);
  machine.write16(0x5c59, 0x6001);
  machine.write16(0x5c5b, 0x6002);
  machine.write16(0x5c61, 0x6003);
  machine.write16(0x5c63, 0x6004);
  machine.write16(0x5c65, 0x6005);

  const status = readBasicStatus(machine);
  assert.equal(status.errText, "OK");
  assert.equal(status.currentLine, 20);
  assert.equal(status.subStatement, 2);
  assert.equal(status.pointers.PROG, 0x5ccb);

  const systemVariables = readSystemVariables(machine);
  assert.equal(systemVariables.find((item) => item.name === "ERR_NR").value, 0xff);
  assert.equal(systemVariables.find((item) => item.name === "PROG").value, 0x5ccb);
});
