import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { RawCpmDisk } from "../src/cpm-disk.js";
import { Cpm22Machine } from "../src/cpm22.js";

function loadBootDisk() {
  return RawCpmDisk.z80simFloppy(readFileSync("ROM/cpm22-1.dsk"));
}

test("reset loads drive A boot sector at address zero", () => {
  const disk = loadBootDisk();
  const machine = new Cpm22Machine({ drives: [disk] });

  assert.deepEqual(
    [machine.read8(0x0000), machine.read8(0x0001), machine.read8(0x0002)],
    [0xc3, 0x19, 0x00]
  );
  assert.equal(machine.cpu.PC, 0x0000);
});

test("requires drive A to boot", () => {
  assert.throws(() => new Cpm22Machine(), /drive A/);
});

test("console ports report input status, read input, and capture output", () => {
  const machine = new Cpm22Machine({ drives: [loadBootDisk()] });

  assert.equal(machine.readPort(0x00), 0x00);
  machine.queueInput("A");
  assert.equal(machine.readPort(0x00), 0xff);
  assert.equal(machine.readPort(0x01), 0x41);
  assert.equal(machine.readPort(0x00), 0x00);

  machine.writePort(0x01, 0x42);
  assert.equal(machine.getOutput(), "B");
});

test("CPU waits on direct console data input until a key is queued", () => {
  const machine = new Cpm22Machine({ drives: [loadBootDisk()] });
  machine.write8(0x0200, 0xdb); // IN A,($01)
  machine.write8(0x0201, 0x01);
  machine.write8(0x0202, 0xd3); // OUT ($01),A
  machine.write8(0x0203, 0x01);
  machine.cpu.PC = 0x0200;

  assert.equal(machine.step(), 4);
  assert.equal(machine.cpu.PC, 0x0200);
  assert.equal(machine.getOutput(), "");

  machine.queueInput("X");
  machine.step();
  machine.step();

  assert.equal(machine.getOutput(), "X");
});

test("booted CP/M stays idle at the prompt until input arrives", () => {
  const machine = new Cpm22Machine({ drives: [loadBootDisk()] });
  machine.runUntilOutput("A>", { maxInstructions: 100_000 });
  machine.clearOutput();

  const result = machine.run({ maxInstructions: 10_000 });

  assert.equal(result.output, "");
  assert.equal(machine.read8(machine.cpu.PC), 0xdb);
  assert.equal(machine.read8(machine.cpu.PC + 1), 0x01);
});

test("FDC read command copies the selected sector to DMA memory", () => {
  const disk = loadBootDisk();
  const machine = new Cpm22Machine({ drives: [disk] });

  machine.writePort(0x0a, 0);
  machine.writePort(0x0b, 0);
  machine.writePort(0x0c, 2);
  machine.writePort(0x0f, 0x00);
  machine.writePort(0x10, 0x40);
  machine.writePort(0x0d, 0);

  assert.equal(machine.readPort(0x0e), 0);
  assert.deepEqual(
    Array.from({ length: 16 }, (_, offset) => machine.read8(0x4000 + offset)),
    Array.from(disk.readSector(0, 2).slice(0, 16))
  );
});

test("FDC write command copies DMA memory to the selected sector", () => {
  const disk = loadBootDisk();
  const machine = new Cpm22Machine({ drives: [disk] });

  for (let offset = 0; offset < 128; offset += 1) {
    machine.write8(0x5000 + offset, offset);
  }

  machine.writePort(0x0a, 0);
  machine.writePort(0x0b, 10);
  machine.writePort(0x0c, 7);
  machine.writePort(0x0f, 0x00);
  machine.writePort(0x10, 0x50);
  machine.writePort(0x0d, 1);

  assert.equal(machine.readPort(0x0e), 0);
  assert.equal(disk.dirty, true);
  assert.deepEqual(Array.from(disk.readSector(10, 7)), Array.from({ length: 128 }, (_, offset) => offset));
});

test("FDC commands address the selected drive", () => {
  const systemDisk = loadBootDisk();
  const workDisk = RawCpmDisk.blankZ80simFloppy();
  const machine = new Cpm22Machine({ drives: [systemDisk, workDisk] });

  for (let offset = 0; offset < 128; offset += 1) {
    machine.write8(0x5100 + offset, 0x5a);
  }

  machine.writePort(0x0a, 1);
  machine.writePort(0x0b, 2);
  machine.writePort(0x0c, 1);
  machine.writePort(0x0f, 0x00);
  machine.writePort(0x10, 0x51);
  machine.writePort(0x0d, 1);

  assert.equal(machine.readPort(0x0e), 0);
  assert.equal(systemDisk.dirty, false);
  assert.equal(workDisk.dirty, true);
  assert.deepEqual(Array.from(workDisk.readSector(2, 1)), new Array(128).fill(0x5a));
});

test("FDC reports z80pack-compatible status codes for invalid operations", () => {
  const machine = new Cpm22Machine({ drives: [loadBootDisk()] });

  machine.writePort(0x0a, 9);
  machine.writePort(0x0d, 0);
  assert.equal(machine.readPort(0x0e), 1);

  machine.writePort(0x0a, 0);
  machine.writePort(0x0b, 77);
  machine.writePort(0x0d, 0);
  assert.equal(machine.readPort(0x0e), 2);

  machine.writePort(0x0b, 0);
  machine.writePort(0x0c, 27);
  machine.writePort(0x0d, 0);
  assert.equal(machine.readPort(0x0e), 3);

  machine.writePort(0x0c, 1);
  machine.writePort(0x0d, 99);
  assert.equal(machine.readPort(0x0e), 7);
});

test("boots the z80pack CP/M 2.2 disk to the CCP prompt", () => {
  const machine = new Cpm22Machine({ drives: [loadBootDisk()] });
  const result = machine.runUntilOutput("A>", { maxInstructions: 100_000 });

  assert.match(result.output, /64K CP\/M Vers\. 2\.2/);
  assert.match(result.output, /A>$/);
  assert.equal(result.matched, true);
});

test("runs a real CP/M DIR command and returns to the prompt", () => {
  const machine = new Cpm22Machine({ drives: [loadBootDisk()] });
  machine.runUntilOutput("A>", { maxInstructions: 100_000 });

  const result = machine.runCommand("DIR", { maxInstructions: 200_000 });

  assert.equal(result.matched, true);
  assert.match(result.output, /A>DIR\r+\n/);
  assert.match(result.output, /DUMP\s+COM/);
  assert.match(result.output, /Z80ASM\s+COM/);
  assert.match(result.output, /A>$/);
});

test("runs ED with a filename and writes the edited file", () => {
  const disk = loadBootDisk();
  const machine = new Cpm22Machine({ drives: [disk] });
  machine.runUntilOutput("A>", { maxInstructions: 100_000 });

  machine.queueInput("ED TEST.TXT\rI\rHELLO FROM ED\r\x1a\rE\r");
  const result = machine.runUntilOutput("A>", {
    maxInstructions: 5_000_000,
    fromOffset: machine.consoleOutput.length
  });

  assert.equal(result.matched, true);
  assert.equal(disk.dirty, true);
  assert.match(result.output, /NEW FILE/);
  assert.match(result.output, /HELLO FROM ED/);
  assert.doesNotMatch(result.output, /DISK OR DIRECTORY FULL/);
});

test("runs BYE through CP/M and halts the CPU", () => {
  const machine = new Cpm22Machine({ drives: [loadBootDisk()] });
  machine.runUntilOutput("A>", { maxInstructions: 100_000 });

  machine.queueInput("BYE\r");
  const result = machine.run({ maxInstructions: 200_000 });

  assert.equal(result.halted, true);
  assert.match(result.output, /A>BYE\r+\n/);
});
