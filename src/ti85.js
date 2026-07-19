import { Z80 } from "./z80.js";
import { TI85_KEY_ROWS } from "./ti85-keys.js";

const ROM_SIZE = 0x20000;
const ROM_PAGE_SIZE = 0x4000;
const RAM_START = 0x8000;
const RAM_SIZE = 0x8000;
const CPU_CLOCK_HZ = 6_000_000;
const FRAME_HZ = 50;
const TIMER_HZ = 256;
const TIMER_T_STATES = Math.round(CPU_CLOCK_HZ / TIMER_HZ);
const LCD_BYTES_PER_ROW = 16;
const LCD_BACKGROUND = [174, 205, 176, 255];
const LCD_FOREGROUND = [47, 65, 58, 255];

const KEY_ALIASES = new Map([
  ["ENTRY", "ENTER"],
  ["STORE", "STO"],
  ["STO>", "STO"],
  ["STO▶", "STO"],
  ["X2", "X^2"],
  ["X²", "X^2"],
  ["SECOND", "2ND"],
  ["2", "2"],
  ["ON/OFF", "ON"]
]);

const KEY_POSITIONS = new Map(
  TI85_KEY_ROWS.flatMap((row, rowIndex) =>
    row.flatMap((key, bit) => key ? [[key, { row: rowIndex, mask: 1 << bit }]] : [])
  )
);

function normalizeKey(key) {
  const normalized = String(key).trim().toUpperCase();
  return KEY_ALIASES.get(normalized) ?? normalized;
}

export class Ti85Machine {
  static ROM_SIZE = ROM_SIZE;
  static RAM_SIZE = RAM_SIZE;
  static LCD_WIDTH = 128;
  static LCD_HEIGHT = 64;
  static T_STATES_PER_FRAME = Math.round(CPU_CLOCK_HZ / FRAME_HZ);

  static fromRomFile(path) {
    const readFileSync = globalThis.process?.getBuiltinModule?.("fs")?.readFileSync;
    if (!readFileSync) throw new Error("Ti85Machine.fromRomFile requires Node.js");
    return new Ti85Machine({ rom: readFileSync(path) });
  }

  constructor({ rom }) {
    if (!rom || rom.length !== ROM_SIZE) {
      throw new Error("Ti85Machine requires a 128K TI-85 ROM");
    }

    this.rom = Uint8Array.from(rom);
    this.ram = new Uint8Array(RAM_SIZE);
    this.romBank = 1;
    this.lcdMemoryBase = 0;
    this.lcdContrast = 0;
    this.lcdEnabled = false;
    this.lcdMask = 0;
    this.keypadMask = 0;
    this.keyRows = new Uint8Array(8);
    this.onPressed = false;
    this.onInterruptMask = 0;
    this.onInterruptStatus = 0;
    this.timerInterruptMask = 0;
    this.timerInterruptStatus = 0;
    this.nextTimerInterruptTState = TIMER_T_STATES;
    this.displayWidth = 0;
    this.interruptSpeed = 0;
    this.port4Bit0 = 0;
    this.powerMode = 0;
    this.linkPort = 0xc0;
    this.frame = 0;
    this.halted = false;
    this.cpu = new Z80(this, {
      read: (port) => this.readPort(port),
      write: (port, value) => this.writePort(port, value)
    });
  }

  read8(address) {
    const mappedAddress = address & 0xffff;
    if (mappedAddress < 0x4000) return this.rom[mappedAddress];
    if (mappedAddress < RAM_START) return this.rom[(this.selectedRomBank() * ROM_PAGE_SIZE) + (mappedAddress - 0x4000)];
    return this.ram[mappedAddress - RAM_START];
  }

  write8(address, value) {
    const mappedAddress = address & 0xffff;
    if (mappedAddress < RAM_START) return;
    this.ram[mappedAddress - RAM_START] = value & 0xff;
  }

  read16(address) {
    const lo = this.read8(address);
    const hi = this.read8(address + 1);
    return lo | (hi << 8);
  }

  write16(address, value) {
    this.write8(address, value);
    this.write8(address + 1, value >> 8);
  }

  readPort(port) {
    switch (port & 0xff) {
      case 0x01:
        return this.readKeypadPort();
      case 0x03:
        return this.readStatusPort();
      case 0x05:
        return this.romBank;
      case 0x06:
        return this.powerMode;
      case 0x07:
        return this.readLinkPort();
      default:
        return 0xff;
    }
  }

  writePort(port, value) {
    const data = value & 0xff;
    switch (port & 0xff) {
      case 0x00:
        this.lcdMemoryBase = data;
        return;
      case 0x01:
        this.keypadMask = data & 0x7f;
        return;
      case 0x02:
        this.lcdContrast = data & 0x1f;
        return;
      case 0x03:
        if (this.lcdEnabled && (data & 0x08) === 0) this.timerInterruptMask = 0;
        this.onInterruptMask = data & 0x01;
        this.lcdMask = data & 0x02;
        this.lcdEnabled = (data & 0x08) !== 0;
        if (this.lcdEnabled) this.timerInterruptMask = 0x04;
        return;
      case 0x04:
        this.displayWidth = (data >> 3) & 0x03;
        this.interruptSpeed = (data >> 1) & 0x03;
        this.port4Bit0 = data & 0x01;
        return;
      case 0x05:
        this.romBank = data;
        return;
      case 0x06:
        this.powerMode = data;
        return;
      case 0x07:
        this.linkPort = data & 0xfc;
        return;
      default:
        return;
    }
  }

  selectedRomBank() {
    return this.romBank & 0x07;
  }

  step() {
    this.advanceTimerInterrupts();
    const cycles = this.cpu.step();
    this.halted = this.cpu.halted;
    this.advanceTimerInterrupts();
    return cycles;
  }

  runTStates(targetTStates) {
    const start = this.cpu.tStates;
    while (this.cpu.tStates - start < targetTStates) {
      this.step();
    }
    return this.cpu.tStates - start;
  }

  runFrame() {
    const elapsed = this.runTStates(Ti85Machine.T_STATES_PER_FRAME);
    this.frame += 1;
    return elapsed;
  }

  reset() {
    this.cpu.reset();
    this.frame = 0;
    this.halted = false;
    this.nextTimerInterruptTState = TIMER_T_STATES;
    this.onInterruptStatus = 0;
    this.timerInterruptStatus = 0;
  }

  readKeypadPort() {
    let data = 0xff;
    if (this.keypadMask === 0x7f) return data;

    for (let bit = 0; bit < 7; bit += 1) {
      if (((~this.keypadMask) & (1 << bit)) === 0) continue;
      for (let row = 0; row < this.keyRows.length; row += 1) {
        if ((this.keyRows[row] & (1 << bit)) !== 0) data &= ~(1 << row);
      }
    }
    return data;
  }

  readStatusPort() {
    let data = 0;
    if (this.lcdEnabled) data |= this.lcdMask;
    if (this.onInterruptStatus) data |= 0x01;
    if (this.timerInterruptStatus) data |= 0x04;
    if (!this.onPressed) data |= 0x08;
    this.onInterruptStatus = 0;
    this.timerInterruptStatus = 0;
    return data;
  }

  readLinkPort() {
    const tipIn = 0x03;
    const ringIn = 0x03;
    return (~((this.linkPort >> 2) & (this.linkPort >> 4)) & tipIn & ringIn) | (this.linkPort & 0xfc);
  }

  pressKey(key) {
    this.setKeyState(key, true);
  }

  releaseKey(key) {
    this.setKeyState(key, false);
  }

  setKeyState(key, pressed) {
    const normalizedKey = normalizeKey(key);
    if (normalizedKey === "ON") {
      if (pressed && !this.onPressed && this.onInterruptMask) {
        this.onInterruptStatus = 1;
        this.cpu.requestInterrupt(0xff);
      }
      this.onPressed = pressed;
      return;
    }

    const position = KEY_POSITIONS.get(normalizedKey);
    if (!position) throw new Error(`Unknown TI-85 key: ${key}`);

    if (pressed) {
      this.keyRows[position.row] |= position.mask;
    } else {
      this.keyRows[position.row] &= ~position.mask;
    }
  }

  getPressedKeys() {
    const pressed = [];
    for (let row = 0; row < TI85_KEY_ROWS.length; row += 1) {
      for (let bit = 0; bit < TI85_KEY_ROWS[row].length; bit += 1) {
        if ((this.keyRows[row] & (1 << bit)) !== 0) pressed.push(TI85_KEY_ROWS[row][bit] ?? `ROW${row}BIT${bit}`);
      }
    }
    if (this.onPressed) pressed.push("ON");
    return pressed.sort();
  }

  pulseOnKey({ holdTStates = Math.round(CPU_CLOCK_HZ / 100) } = {}) {
    this.pressKey("ON");
    this.runTStates(holdTStates);
    this.releaseKey("ON");
  }

  advanceTimerInterrupts() {
    while (this.cpu.tStates >= this.nextTimerInterruptTState) {
      if (this.timerInterruptMask) {
        this.timerInterruptStatus = this.timerInterruptMask;
        this.cpu.requestInterrupt(0xff);
      }
      this.nextTimerInterruptTState += TIMER_T_STATES;
    }
  }

  lcdBaseAddress() {
    return (((this.lcdMemoryBase & 0x3f) + 0xc0) << 8) & 0xffff;
  }

  renderLcdBitmap() {
    const pixels = new Uint8Array(Ti85Machine.LCD_WIDTH * Ti85Machine.LCD_HEIGHT);
    let litPixelCount = 0;
    let checksum = 0;

    if (this.lcdEnabled) {
      const base = this.lcdBaseAddress();
      for (let y = 0; y < Ti85Machine.LCD_HEIGHT; y += 1) {
        for (let byteX = 0; byteX < LCD_BYTES_PER_ROW; byteX += 1) {
          const value = this.read8(base + (y * LCD_BYTES_PER_ROW) + byteX);
          checksum = (((checksum << 5) - checksum + value) >>> 0);
          for (let bit = 0; bit < 8; bit += 1) {
            const pixel = (value >> (7 - bit)) & 0x01;
            const offset = (y * Ti85Machine.LCD_WIDTH) + (byteX * 8) + bit;
            pixels[offset] = pixel;
            litPixelCount += pixel;
          }
        }
      }
    }

    return {
      width: Ti85Machine.LCD_WIDTH,
      height: Ti85Machine.LCD_HEIGHT,
      pixels,
      litPixelCount,
      checksum: checksum >>> 0,
      baseAddress: this.lcdBaseAddress(),
      enabled: this.lcdEnabled
    };
  }

  renderLcdRgba() {
    const bitmap = this.renderLcdBitmap();
    const rgba = new Uint8ClampedArray(bitmap.pixels.length * 4);
    for (let index = 0; index < bitmap.pixels.length; index += 1) {
      rgba.set(bitmap.pixels[index] ? LCD_FOREGROUND : LCD_BACKGROUND, index * 4);
    }
    return { ...bitmap, rgba };
  }

  getDebugState() {
    const bitmap = this.renderLcdBitmap();
    return {
      profile: "ti85",
      cpu: this.cpu.getState(),
      halted: this.halted,
      frame: this.frame,
      memory: {
        romSize: this.rom.length,
        ramSize: this.ram.length,
        romBank: this.selectedRomBank(),
        rawRomBank: this.romBank
      },
      keyboard: {
        pressedKeys: this.getPressedKeys(),
        mask: this.keypadMask,
        matrix: Array.from(this.keyRows, (value, row) => ({
          row,
          value,
          keys: TI85_KEY_ROWS[row].filter((key, bit) => key && (value & (1 << bit)) !== 0)
        }))
      },
      interrupts: {
        timerMask: this.timerInterruptMask,
        timerStatus: this.timerInterruptStatus,
        onMask: this.onInterruptMask,
        onStatus: this.onInterruptStatus,
        onPressed: this.onPressed,
        nextTimerInterruptTState: this.nextTimerInterruptTState
      },
      lcd: {
        memoryBase: this.lcdMemoryBase,
        baseAddress: this.lcdBaseAddress(),
        contrast: this.lcdContrast,
        enabled: this.lcdEnabled,
        mask: this.lcdMask,
        displayWidth: this.displayWidth,
        interruptSpeed: this.interruptSpeed,
        port4Bit0: this.port4Bit0
      },
      display: {
        width: Ti85Machine.LCD_WIDTH,
        height: Ti85Machine.LCD_HEIGHT,
        litPixelCount: bitmap.litPixelCount,
        checksum: bitmap.checksum
      },
      powerMode: this.powerMode,
      linkPort: this.linkPort
    };
  }
}
