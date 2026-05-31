import { Z80 } from "./z80.js";

const KEY_ROWS = [
  ["CAPS SHIFT", "Z", "X", "C", "V"],
  ["A", "S", "D", "F", "G"],
  ["Q", "W", "E", "R", "T"],
  ["1", "2", "3", "4", "5"],
  ["0", "9", "8", "7", "6"],
  ["P", "O", "I", "U", "Y"],
  ["ENTER", "L", "K", "J", "H"],
  ["SPACE", "SYMBOL SHIFT", "M", "N", "B"]
];

const KEY_POSITIONS = new Map(
  KEY_ROWS.flatMap((row, rowIndex) =>
    row.map((key, bit) => [key, { row: rowIndex, mask: 1 << bit }])
  )
);

const PALETTE = [
  [
    [0, 0, 0],
    [0, 0, 205],
    [205, 0, 0],
    [205, 0, 205],
    [0, 205, 0],
    [0, 205, 205],
    [205, 205, 0],
    [205, 205, 205]
  ],
  [
    [0, 0, 0],
    [0, 0, 255],
    [255, 0, 0],
    [255, 0, 255],
    [0, 255, 0],
    [0, 255, 255],
    [255, 255, 0],
    [255, 255, 255]
  ]
];

function normalizeKey(key) {
  return String(key).trim().toUpperCase();
}

export class Spectrum48 {
  static SCREEN_WIDTH = 256;
  static SCREEN_HEIGHT = 192;
  static BORDER_LEFT = 32;
  static BORDER_RIGHT = 32;
  static BORDER_TOP = 24;
  static BORDER_BOTTOM = 24;
  static FRAME_WIDTH = Spectrum48.SCREEN_WIDTH + Spectrum48.BORDER_LEFT + Spectrum48.BORDER_RIGHT;
  static FRAME_HEIGHT = Spectrum48.SCREEN_HEIGHT + Spectrum48.BORDER_TOP + Spectrum48.BORDER_BOTTOM;
  static T_STATES_PER_FRAME = 69888;

  static fromRomFile(path) {
    const readFileSync = globalThis.process?.getBuiltinModule?.("fs")?.readFileSync;
    if (!readFileSync) throw new Error("Spectrum48.fromRomFile requires Node.js");
    return new Spectrum48({ rom: readFileSync(path) });
  }

  constructor({ rom }) {
    if (!rom || rom.length !== 0x4000) {
      throw new Error("Spectrum48 requires a 16K ROM");
    }

    this.rom = Uint8Array.from(rom);
    this.ram = new Uint8Array(0xc000);
    this.borderColor = 0;
    this.beeperOn = false;
    this.frame = 0;
    this.keyboardRows = new Uint8Array(8).fill(0x1f);
    this.cpu = new Z80(this, {
      read: (port) => this.readPort(port),
      write: (port, value) => this.writePort(port, value)
    });
  }

  read8(address) {
    const mappedAddress = address & 0xffff;
    if (mappedAddress < 0x4000) return this.rom[mappedAddress];
    return this.ram[mappedAddress - 0x4000];
  }

  write8(address, value) {
    const mappedAddress = address & 0xffff;
    if (mappedAddress < 0x4000) return;
    this.ram[mappedAddress - 0x4000] = value & 0xff;
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
    if ((port & 0x0001) === 0) return 0xe0 | this.readKeyboardRows(port);
    return 0xff;
  }

  writePort(port, value) {
    if ((port & 0x0001) !== 0) return;
    this.borderColor = value & 0x07;
    this.beeperOn = (value & 0x10) !== 0;
  }

  pressKey(key) {
    this.setKeyState(key, true);
  }

  releaseKey(key) {
    this.setKeyState(key, false);
  }

  setKeyState(key, pressed) {
    const position = KEY_POSITIONS.get(normalizeKey(key));
    if (!position) throw new Error(`Unknown Spectrum key: ${key}`);

    if (pressed) {
      this.keyboardRows[position.row] &= ~position.mask;
    } else {
      this.keyboardRows[position.row] |= position.mask;
    }
  }

  readKeyboardRows(port) {
    let value = 0x1f;
    for (let row = 0; row < 8; row += 1) {
      if ((port & (0x0100 << row)) === 0) {
        value &= this.keyboardRows[row];
      }
    }
    return value;
  }

  getPressedKeys() {
    const pressed = [];
    for (let row = 0; row < KEY_ROWS.length; row += 1) {
      for (let bit = 0; bit < KEY_ROWS[row].length; bit += 1) {
        if ((this.keyboardRows[row] & (1 << bit)) === 0) {
          pressed.push(KEY_ROWS[row][bit]);
        }
      }
    }
    return pressed.sort();
  }

  renderDisplayRgba({ flashOn = false } = {}) {
    const rgba = new Uint8ClampedArray(Spectrum48.SCREEN_WIDTH * Spectrum48.SCREEN_HEIGHT * 4);

    for (let y = 0; y < Spectrum48.SCREEN_HEIGHT; y += 1) {
      for (let xByte = 0; xByte < 32; xByte += 1) {
        const pixelByte = this.read8(this.screenByteAddress(xByte, y));
        const attribute = this.read8(0x5800 + ((y >> 3) * 32) + xByte);
        const bright = (attribute >> 6) & 0x01;
        const flash = (attribute & 0x80) !== 0 && flashOn;
        const ink = PALETTE[bright][attribute & 0x07];
        const paper = PALETTE[bright][(attribute >> 3) & 0x07];

        for (let bit = 0; bit < 8; bit += 1) {
          const pixelSet = (pixelByte & (0x80 >> bit)) !== 0;
          const color = pixelSet !== flash ? ink : paper;
          const offset = ((y * Spectrum48.SCREEN_WIDTH) + (xByte * 8) + bit) * 4;
          rgba[offset] = color[0];
          rgba[offset + 1] = color[1];
          rgba[offset + 2] = color[2];
          rgba[offset + 3] = 0xff;
        }
      }
    }

    return rgba;
  }

  renderFrameRgba({ flashOn = false } = {}) {
    const rgba = new Uint8ClampedArray(Spectrum48.FRAME_WIDTH * Spectrum48.FRAME_HEIGHT * 4);
    const border = PALETTE[0][this.borderColor];

    for (let offset = 0; offset < rgba.length; offset += 4) {
      rgba[offset] = border[0];
      rgba[offset + 1] = border[1];
      rgba[offset + 2] = border[2];
      rgba[offset + 3] = 0xff;
    }

    const display = this.renderDisplayRgba({ flashOn });
    for (let y = 0; y < Spectrum48.SCREEN_HEIGHT; y += 1) {
      const sourceOffset = y * Spectrum48.SCREEN_WIDTH * 4;
      const targetOffset =
        (((y + Spectrum48.BORDER_TOP) * Spectrum48.FRAME_WIDTH) + Spectrum48.BORDER_LEFT) * 4;
      rgba.set(display.subarray(sourceOffset, sourceOffset + Spectrum48.SCREEN_WIDTH * 4), targetOffset);
    }

    return rgba;
  }

  screenByteAddress(xByte, y) {
    return 0x4000 | ((y & 0xc0) << 5) | ((y & 0x07) << 8) | ((y & 0x38) << 2) | xByte;
  }

  step() {
    return this.cpu.step();
  }

  runTStates(targetTStates) {
    const start = this.cpu.tStates;
    while (this.cpu.tStates - start < targetTStates) {
      this.step();
    }
    return this.cpu.tStates - start;
  }

  runFrame() {
    this.cpu.requestInterrupt(0xff);
    const elapsed = this.runTStates(Spectrum48.T_STATES_PER_FRAME);
    this.frame += 1;
    return elapsed;
  }

  reset() {
    this.cpu.reset();
    this.frame = 0;
  }
}
