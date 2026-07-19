import assert from "node:assert/strict";
import test from "node:test";
import { Ti85Machine } from "../src/ti85.js";

function makeRom(pages = {}) {
  const rom = new Uint8Array(0x20000);
  for (let page = 0; page < 8; page += 1) {
    rom.fill(page, page * 0x4000, (page + 1) * 0x4000);
  }
  for (const [address, value] of Object.entries(pages)) {
    rom[Number(address)] = value;
  }
  return rom;
}

test("requires a 128K TI-85 ROM", () => {
  assert.throws(() => new Ti85Machine({ rom: new Uint8Array(0x1ffff) }), /128K TI-85 ROM/);
  assert.throws(() => new Ti85Machine({ rom: new Uint8Array(0x20001) }), /128K TI-85 ROM/);
});

test("maps fixed ROM at 0000-3fff and ignores writes to ROM", () => {
  const machine = new Ti85Machine({
    rom: makeRom({
      0x0000: 0xf3,
      0x1234: 0x5a,
      0x3fff: 0xc9
    })
  });

  assert.equal(machine.read8(0x0000), 0xf3);
  assert.equal(machine.read8(0x1234), 0x5a);
  assert.equal(machine.read8(0x3fff), 0xc9);

  machine.write8(0x1234, 0x99);
  assert.equal(machine.read8(0x1234), 0x5a);
});

test("maps banked ROM at 4000-7fff through port 5", () => {
  const machine = new Ti85Machine({ rom: makeRom() });

  assert.equal(machine.read8(0x4000), 1);
  assert.equal(machine.read8(0x7fff), 1);

  machine.writePort(0x05, 0x03);
  assert.equal(machine.read8(0x4000), 3);
  assert.equal(machine.read8(0x7fff), 3);
  assert.equal(machine.readPort(0x05), 0x03);

  machine.writePort(0x05, 0x0f);
  assert.equal(machine.read8(0x4000), 7);
});

test("maps RAM at 8000-ffff", () => {
  const machine = new Ti85Machine({ rom: makeRom() });

  machine.write8(0x8000, 0x12);
  machine.write8(0xc000, 0x34);
  machine.write8(0xffff, 0x56);

  assert.equal(machine.read8(0x8000), 0x12);
  assert.equal(machine.read8(0xc000), 0x34);
  assert.equal(machine.read8(0xffff), 0x56);
});

test("reads and writes 16-bit little-endian values through the memory map", () => {
  const machine = new Ti85Machine({ rom: makeRom({ 0x3fff: 0xaa }) });

  machine.write16(0x8000, 0x1234);
  assert.equal(machine.read8(0x8000), 0x34);
  assert.equal(machine.read8(0x8001), 0x12);
  assert.equal(machine.read16(0x8000), 0x1234);

  machine.write16(0x3fff, 0x5678);
  assert.equal(machine.read8(0x3fff), 0xaa);
  assert.equal(machine.read8(0x4000), 1);
});

test("wires the CPU to fetch and execute bytes from TI-85 ROM", () => {
  const machine = new Ti85Machine({
    rom: makeRom({
      0x0000: 0x3e,
      0x0001: 0x42
    })
  });

  assert.equal(machine.step(), 7);
  assert.equal(machine.cpu.A, 0x42);
  assert.equal(machine.cpu.PC, 0x0002);
});

test("runs CPU work in t-state and frame-sized slices", () => {
  const machine = new Ti85Machine({ rom: makeRom() });

  assert.equal(machine.runTStates(8), 8);
  assert.equal(machine.cpu.PC, 0x0002);

  const frameStart = machine.cpu.tStates;
  const elapsed = machine.runFrame();

  assert.equal(machine.frame, 1);
  assert.equal(elapsed >= Ti85Machine.T_STATES_PER_FRAME, true);
  assert.equal(machine.cpu.tStates - frameStart, elapsed);
});

test("reset restarts CPU and frame state without clearing RAM or port state", () => {
  const machine = new Ti85Machine({
    rom: makeRom({
      0x0000: 0x3e,
      0x0001: 0x42
    })
  });

  machine.write8(0x8000, 0x99);
  machine.writePort(0x05, 0x04);
  machine.step();
  machine.runFrame();
  machine.reset();

  assert.equal(machine.cpu.PC, 0x0000);
  assert.equal(machine.cpu.A, 0x00);
  assert.equal(machine.frame, 0);
  assert.equal(machine.read8(0x8000), 0x99);
  assert.equal(machine.readPort(0x05), 0x04);
});

test("stores TI-85 LCD, interrupt, power, and link port state", () => {
  const machine = new Ti85Machine({ rom: makeRom() });

  machine.writePort(0x00, 0x05);
  machine.writePort(0x02, 0x1f);
  machine.writePort(0x03, 0x0b);
  machine.writePort(0x04, 0x19);
  machine.writePort(0x06, 0xaa);
  machine.writePort(0x07, 0xd4);

  assert.equal(machine.readPort(0x00), 0xff);
  assert.equal(machine.readPort(0x02), 0xff);
  assert.equal(machine.readPort(0x04), 0xff);
  assert.equal(machine.readPort(0x06), 0xaa);
  assert.equal(machine.readPort(0x07), 0xd6);

  const state = machine.getDebugState();
  assert.equal(state.lcd.memoryBase, 0x05);
  assert.equal(state.lcd.contrast, 0x1f);
  assert.equal(state.lcd.enabled, true);
  assert.equal(state.lcd.mask, 0x02);
  assert.equal(state.lcd.displayWidth, 3);
  assert.equal(state.interrupts.onMask, 1);
  assert.equal(state.powerMode, 0xaa);
  assert.equal(state.linkPort, 0xd4);
});

test("keyboard keys read through the TI-85 keypad mask", () => {
  const machine = new Ti85Machine({ rom: makeRom() });

  machine.pressKey("DOWN");
  machine.pressKey("ENTER");
  machine.pressKey("F5");

  machine.writePort(0x01, 0x7e);
  assert.equal(machine.readPort(0x01), 0xfe);

  machine.writePort(0x01, 0x7d);
  assert.equal(machine.readPort(0x01), 0xfe);

  machine.writePort(0x01, 0x3f);
  assert.equal(machine.readPort(0x01), 0xfe);

  machine.releaseKey("ENTER");
  machine.writePort(0x01, 0x7e);
  assert.equal(machine.readPort(0x01), 0xfe);
});

test("reports currently pressed TI-85 keys for diagnostics", () => {
  const machine = new Ti85Machine({ rom: makeRom() });

  machine.pressKey("ALPHA");
  machine.pressKey("F1");
  machine.pressKey("ON");

  assert.deepEqual(machine.getPressedKeys(), ["ALPHA", "F1", "ON"]);
});

test("ON key pulse raises and clears port 3 interrupt status", () => {
  const machine = new Ti85Machine({ rom: makeRom() });

  machine.writePort(0x03, 0x01);
  assert.equal(machine.readPort(0x03) & 0x08, 0x08);

  machine.pressKey("ON");
  assert.equal(machine.readPort(0x03) & 0x09, 0x01);
  assert.equal(machine.readPort(0x03) & 0x01, 0x00);

  machine.releaseKey("ON");
  assert.equal(machine.readPort(0x03) & 0x08, 0x08);
});

test("runFrame raises timer interrupt status when timer interrupts are enabled", () => {
  const machine = new Ti85Machine({ rom: makeRom() });

  machine.writePort(0x03, 0x08);
  machine.runFrame();

  assert.equal(machine.readPort(0x03) & 0x04, 0x04);
  assert.equal(machine.readPort(0x03) & 0x04, 0x00);
});

test("renders TI-85 LCD memory into a 128x64 packed bitmap", () => {
  const machine = new Ti85Machine({ rom: makeRom() });

  machine.writePort(0x00, 0x00);
  machine.writePort(0x03, 0x08);
  machine.write8(0xc000, 0x80);
  machine.write8(0xc00f, 0x01);
  machine.write8(0xc010, 0x55);

  const frame = machine.renderLcdBitmap();

  assert.equal(frame.width, 128);
  assert.equal(frame.height, 64);
  assert.equal(frame.pixels.length, 8192);
  assert.equal(frame.pixels[0], 1);
  assert.equal(frame.pixels[7], 0);
  assert.equal(frame.pixels[127], 1);
  assert.deepEqual([...frame.pixels.slice(128, 136)], [0, 1, 0, 1, 0, 1, 0, 1]);
  assert.equal(frame.litPixelCount, 6);
  assert.notEqual(frame.checksum, 0);
});

test("renders TI-85 LCD pixels to RGBA", () => {
  const machine = new Ti85Machine({ rom: makeRom() });

  machine.writePort(0x03, 0x08);
  machine.write8(0xc000, 0x80);

  const frame = machine.renderLcdRgba();

  assert.equal(frame.width, 128);
  assert.equal(frame.height, 64);
  assert.equal(frame.rgba.length, 32768);
  assert.deepEqual([...frame.rgba.slice(0, 4)], [47, 65, 58, 255]);
  assert.deepEqual([...frame.rgba.slice(4, 8)], [174, 205, 176, 255]);
  assert.equal(frame.litPixelCount, 1);
});

test("reports compact debug state for the TI-85 machine", () => {
  const machine = new Ti85Machine({ rom: makeRom() });

  machine.pressKey("F2");
  machine.writePort(0x00, 0x02);
  machine.writePort(0x03, 0x09);
  machine.writePort(0x05, 0x06);

  const state = machine.getDebugState();

  assert.equal(state.profile, "ti85");
  assert.equal(state.halted, false);
  assert.equal(state.frame, 0);
  assert.equal(state.cpu.registers.PC, machine.cpu.PC);
  assert.equal(state.memory.romBank, 6);
  assert.deepEqual(state.keyboard.pressedKeys, ["F2"]);
  assert.equal(state.lcd.memoryBase, 0x02);
  assert.equal(state.lcd.baseAddress, 0xc200);
  assert.equal(state.lcd.enabled, true);
  assert.equal(state.display.width, 128);
  assert.equal(state.display.height, 64);
});

test("bundled TI-85 ROM boots far enough to produce nonblank LCD output", () => {
  const machine = Ti85Machine.fromRomFile("ROM/TI85.ROM");

  for (let count = 0; count < 20 && !machine.halted; count += 1) {
    machine.runFrame();
  }

  assert.equal(machine.halted, true, JSON.stringify(machine.getDebugState(), null, 2));
  machine.pressKey("ON");
  for (let count = 0; count < 4; count += 1) {
    machine.runFrame();
  }
  machine.releaseKey("ON");

  let frame = machine.renderLcdBitmap();
  for (let count = 0; count < 240 && frame.litPixelCount === 0; count += 1) {
    machine.runFrame();
    frame = machine.renderLcdBitmap();
  }

  assert.notEqual(frame.litPixelCount, 0, JSON.stringify(machine.getDebugState(), null, 2));
});
