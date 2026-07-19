import { Z80 } from "./z80.js";

const ROM_SIZE = 0x3800;
const KEYBOARD_START = 0x3800;
const KEYBOARD_END = 0x3bff;
const VIDEO_START = 0x3c00;
const VIDEO_SIZE = 0x0400;
const RAM_START = 0x4000;
const RAM_SIZE = 0xc000;

const KEY_ROWS = [
  ["@", "A", "B", "C", "D", "E", "F", "G"],
  ["H", "I", "J", "K", "L", "M", "N", "O"],
  ["P", "Q", "R", "S", "T", "U", "V", "W"],
  ["X", "Y", "Z", undefined, undefined, undefined, undefined, undefined],
  ["0", "1", "2", "3", "4", "5", "6", "7"],
  ["8", "9", ":", ";", ",", "-", ".", "/"],
  ["ENTER", "CLEAR", "BREAK", "UP", "DOWN", "LEFT", "RIGHT", "SPACE"],
  ["LEFT SHIFT", "RIGHT SHIFT"]
];

const KEY_POSITIONS = new Map(
  KEY_ROWS.flatMap((row, rowIndex) =>
    row.flatMap((key, bit) => key ? [[key, { row: rowIndex, mask: 1 << bit }]] : [])
  )
);

function normalizeKey(key) {
  return String(key).trim().toUpperCase();
}

export class Trs80Model3Machine {
  static ROM_SIZE = ROM_SIZE;
  static SCREEN_COLUMNS = 64;
  static SCREEN_ROWS = 16;
  static T_STATES_PER_FRAME = 67584;

  static fromRomFile(path) {
    const readFileSync = globalThis.process?.getBuiltinModule?.("fs")?.readFileSync;
    if (!readFileSync) throw new Error("Trs80Model3Machine.fromRomFile requires Node.js");
    return new Trs80Model3Machine({ rom: readFileSync(path) });
  }

  constructor({ rom }) {
    if (!rom || rom.length !== ROM_SIZE) {
      throw new Error("Trs80Model3Machine requires a 14K Model III ROM");
    }

    this.rom = Uint8Array.from(rom);
    this.videoRam = new Uint8Array(VIDEO_SIZE);
    this.ram = new Uint8Array(RAM_SIZE);
    this.keyboardRows = new Uint8Array(8);
    this.frame = 0;
    this.halted = false;
    this.cpu = new Z80(this, {
      read: () => 0xff,
      write: () => {}
    });
  }

  read8(address) {
    const mappedAddress = address & 0xffff;
    if (mappedAddress < ROM_SIZE) return this.rom[mappedAddress];
    if (mappedAddress >= KEYBOARD_START && mappedAddress <= KEYBOARD_END) return this.readKeyboardAddress(mappedAddress);
    if (mappedAddress >= VIDEO_START && mappedAddress < RAM_START) return this.videoRam[mappedAddress - VIDEO_START];
    return this.ram[mappedAddress - RAM_START];
  }

  write8(address, value) {
    const mappedAddress = address & 0xffff;
    if (mappedAddress < ROM_SIZE) return;
    if (mappedAddress >= KEYBOARD_START && mappedAddress <= KEYBOARD_END) return;
    if (mappedAddress >= VIDEO_START && mappedAddress < RAM_START) {
      this.videoRam[mappedAddress - VIDEO_START] = value & 0xff;
      return;
    }
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

  readKeyboardAddress(address) {
    let value = 0x00;
    for (let row = 0; row < this.keyboardRows.length; row += 1) {
      if ((address & (1 << row)) !== 0) value |= this.keyboardRows[row];
    }
    return value;
  }

  pressKey(key) {
    this.setKeyState(key, true);
  }

  releaseKey(key) {
    this.setKeyState(key, false);
  }

  setKeyState(key, pressed) {
    const position = KEY_POSITIONS.get(normalizeKey(key));
    if (!position) throw new Error(`Unknown TRS-80 key: ${key}`);

    if (pressed) {
      this.keyboardRows[position.row] |= position.mask;
    } else {
      this.keyboardRows[position.row] &= ~position.mask;
    }
  }

  getPressedKeys() {
    const pressed = [];
    for (let row = 0; row < KEY_ROWS.length; row += 1) {
      for (let bit = 0; bit < KEY_ROWS[row].length; bit += 1) {
        if ((this.keyboardRows[row] & (1 << bit)) !== 0) {
          pressed.push(KEY_ROWS[row][bit] ?? `ROW${row}BIT${bit}`);
        }
      }
    }
    return pressed.sort();
  }

  renderTextDisplay() {
    const rows = [];
    for (let row = 0; row < Trs80Model3Machine.SCREEN_ROWS; row += 1) {
      let line = "";
      for (let column = 0; column < Trs80Model3Machine.SCREEN_COLUMNS; column += 1) {
        line += this.displayByteToChar(this.videoRam[(row * Trs80Model3Machine.SCREEN_COLUMNS) + column]);
      }
      rows.push(line);
    }
    return rows;
  }

  displayByteToChar(value) {
    const code = value & 0x7f;
    if (code < 0x20 || code > 0x7e) return " ";
    return String.fromCharCode(code);
  }

  step() {
    const cycles = this.cpu.step();
    this.halted = this.cpu.halted;
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
    this.cpu.requestInterrupt(0xff);
    const elapsed = this.runTStates(Trs80Model3Machine.T_STATES_PER_FRAME);
    this.frame += 1;
    return elapsed;
  }

  reset() {
    this.cpu.reset();
    this.frame = 0;
    this.halted = false;
  }

  getDebugState() {
    return {
      profile: "trs80-model3",
      cpu: this.cpu.getState(),
      halted: this.halted,
      frame: this.frame,
      keyboard: {
        pressedKeys: this.getPressedKeys()
      },
      display: {
        columns: Trs80Model3Machine.SCREEN_COLUMNS,
        rows: Trs80Model3Machine.SCREEN_ROWS,
        videoStart: VIDEO_START
      }
    };
  }
}
