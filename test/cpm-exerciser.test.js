import assert from "node:assert/strict";
import test from "node:test";
import { runCpmProgram } from "../scripts/run-cpm-exerciser.js";

test("CP/M exerciser runner handles BDOS string, character, and terminate calls", () => {
  const program = [
    0x2a, 0x06, 0x00, // LD HL,($0006)
    0xf9, // LD SP,HL
    0x0e, 0x09, // LD C,9
    0x11, 0x18, 0x01, // LD DE,message
    0xcd, 0x05, 0x00, // CALL BDOS
    0x0e, 0x02, // LD C,2
    0x1e, 0x21, // LD E,'!'
    0xcd, 0x05, 0x00, // CALL BDOS
    0x0e, 0x00, // LD C,0
    0xcd, 0x05, 0x00, // CALL BDOS
    0x48, 0x45, 0x4c, 0x4c, 0x4f, 0x24 // "HELLO$"
  ];

  const result = runCpmProgram(program, { maxInstructions: 1000 });

  assert.equal(result.output, "HELLO!");
  assert.equal(result.terminatedReason, "BDOS terminate");
  assert.equal(result.cpu.PC, 0x0005);
});
