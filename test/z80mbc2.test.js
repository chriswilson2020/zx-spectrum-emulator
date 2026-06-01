import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { RawZ80Mbc2Disk, Z80Mbc2Machine } from "../src/z80mbc2.js";

function loadDisk(name = "DS0N00.DSK") {
  return RawZ80Mbc2Disk.fromImage(readFileSync(`ROM/${name}`));
}

test("Z80-MBC2 raw disks expose 512-byte host sectors", () => {
  const disk = loadDisk();

  assert.equal(disk.bytes.length, 8 * 1024 * 1024);
  assert.deepEqual(Array.from(disk.readSector(0, 0).slice(0, 3)), [0xc3, 0x5c, 0xd5]);
  assert.equal(String.fromCharCode(...disk.readSector(1, 0).slice(1, 9)), "ASCIART ");
});

test("Z80-MBC2 IOS protocol reads and writes selected host sectors", () => {
  const disk = loadDisk();
  const machine = new Z80Mbc2Machine({ drives: [disk] });

  machine.writePort(1, 0x09);
  machine.writePort(0, 0);
  machine.writePort(1, 0x0a);
  machine.writePort(0, 1);
  machine.writePort(0, 0);
  machine.writePort(1, 0x0b);
  machine.writePort(0, 0);
  machine.writePort(1, 0x86);

  assert.equal(machine.readPort(0), 0x00);
  assert.equal(machine.readPort(0), 0x41);
  assert.equal(machine.readPort(0), 0x53);
  machine.writePort(1, 0x85);
  assert.equal(machine.readPort(0), 0);
});

test("reports compact debug state for the Z80-MBC2 CP/M machine", () => {
  const machine = new Z80Mbc2Machine({ drives: [loadDisk()] });
  machine.queueInput("Z");
  machine.writePort(1, 0x09);
  machine.writePort(0, 2);
  machine.writePort(1, 0x0a);
  machine.writePort(0, 4);
  machine.writePort(0, 1);
  machine.writePort(1, 0x0b);
  machine.writePort(0, 7);
  machine.writePort(1, 0x86);
  machine.readPort(0);
  machine.readPort(0);

  const state = machine.getDebugState();

  assert.equal(state.profile, "z80mbc2");
  assert.equal(state.halted, false);
  assert.equal(state.cpu.registers.PC, machine.cpu.PC);
  assert.deepEqual(state.io, {
    opcode: 0x86,
    drive: 2,
    track: 0x0104,
    trackLowPending: false,
    sector: 7,
    diskError: 1,
    readBufferLength: 512,
    readOffset: 2,
    writeBufferLength: 0
  });
  assert.deepEqual(state.console, {
    inputQueueLength: 1,
    outputQueueLength: 0,
    statusMode: "blocking"
  });
});

test("boots the Z80-MBC2 CP/M 2.2 disk to the CCP prompt", () => {
  const machine = new Z80Mbc2Machine({ drives: [loadDisk()] });
  const result = machine.runUntilOutput("A>", { maxInstructions: 500_000 });

  assert.equal(result.matched, true);
  assert.match(result.output, /Z80-MBC2 CP\/M 2\.2 BIOS/);
  assert.match(result.output, /CP\/M 2\.2 Copyright 1979/);
  assert.match(result.output, /A>$/);
});

test("runs DIR on mounted Z80-MBC2 drives", () => {
  const machine = new Z80Mbc2Machine({ drives: [loadDisk("DS0N00.DSK"), loadDisk("DS0N01.DSK")] });
  machine.runUntilOutput("A>", { maxInstructions: 500_000 });

  const a = machine.runCommand("DIR", { maxInstructions: 1_000_000 });
  assert.equal(a.matched, true);
  assert.match(a.output, /MBASIC\s+COM/);

  const b = machine.runCommand("B:\rDIR", { maxInstructions: 1_000_000 });
  assert.equal(b.matched, true);
  assert.match(b.output, /B>$/);
});

test("accepts interactive browser-style typing without duplicating characters", () => {
  const machine = new Z80Mbc2Machine({ drives: [loadDisk("DS0N00.DSK"), loadDisk("DS0N01.DSK")] });
  runFrameSlices(machine, (candidate) => candidate.getOutput().includes("A>"));

  for (const char of "DIR\r") {
    machine.queueInput(char);
    runFrameSlices(machine, undefined, 8);
  }
  runFrameSlices(machine, (candidate) => /A>DIR\r\r\nA:/.test(candidate.getOutput()), 500);

  assert.match(machine.getOutput(), /A>DIR\r\r\nA:/);
  assert.doesNotMatch(machine.getOutput(), /DDIIRR/);
  assert.match(machine.getOutput(), /MBASIC\s+COM/);
});

function runFrameSlices(machine, stopWhen, maxFrames = 1000) {
  for (let frame = 0; frame < maxFrames; frame += 1) {
    machine.run({ maxInstructions: 20_000 });
    if (stopWhen?.(machine)) return;
  }
}
