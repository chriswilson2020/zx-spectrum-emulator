import { Z80 } from "./z80.js";
import { buildCasPulseSequence } from "./trs80-cassette.js";

const ROM_SIZE = 0x3800;
const KEYBOARD_START = 0x3800;
const KEYBOARD_END = 0x3bff;
const VIDEO_START = 0x3c00;
const VIDEO_SIZE = 0x0400;
const RAM_START = 0x4000;
const RAM_SIZE = 0xc000;
const T_STATES_PER_SECOND = 2_027_520;
const T_STATES_PER_MS = T_STATES_PER_SECOND / 1000;
const CASSETTE_HALF_WAVE_T_STATES = Math.round(T_STATES_PER_SECOND / 3000);
const CASSETTE_INPUT_PORT = 0xff;
const SESSION_FORMAT = "z80lab-trs80-session";
const SESSION_VERSION = 1;

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
  static CASSETTE_HALF_WAVE_T_STATES = CASSETTE_HALF_WAVE_T_STATES;

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
    this.cassetteBlocks = [];
    this.cassetteCursor = 0;
    this.cassettePulseDurations = new Uint32Array();
    this.cassettePulseToggles = new Uint8Array();
    this.cassettePulseIndex = 0;
    this.cassetteNextPulseTState = 0;
    this.cassettePlaybackEndCursor = 0;
    this.cassetteInputLevel = false;
    this.cassettePlaying = false;
    this.frame = 0;
    this.halted = false;
    this.cpu = new Z80(this, {
      read: (port) => this.readPort(port),
      write: (port, value) => this.writePort(port, value)
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

  readPort(port) {
    if ((port & 0xff) === CASSETTE_INPUT_PORT) return this.readCassetteInputBit() | 0x7f;
    return 0xff;
  }

  writePort() {}

  setCassetteBlocks(blocks, { cursor = 0 } = {}) {
    this.cassetteBlocks = blocks.map((block, index) => ({
      ...block,
      index: block.index ?? index,
      raw: Uint8Array.from(block.raw ?? []),
      program: Uint8Array.from(block.program ?? [])
    }));
    this.cassetteCursor = Math.max(0, Math.min(cursor, this.cassetteBlocks.length));
    this.stopCassettePlayback();
  }

  setCassetteCursor(cursor) {
    this.cassetteCursor = Math.max(0, Math.min(cursor, this.cassetteBlocks.length));
  }

  clearCassette() {
    this.cassetteBlocks = [];
    this.cassetteCursor = 0;
    this.stopCassettePlayback();
  }

  startCassettePlayback({ startIndex = this.cassetteCursor, initialSilenceMs = 250 } = {}) {
    const sequence = buildCasPulseSequence(this.cassetteBlocks.slice(startIndex), {
      halfWaveTStates: CASSETTE_HALF_WAVE_T_STATES,
      initialSilenceTStates: Math.round(initialSilenceMs * T_STATES_PER_MS)
    });
    this.cassettePulseDurations = sequence.durations;
    this.cassettePulseToggles = sequence.toggles;
    this.cassettePulseIndex = 0;
    this.cassetteInputLevel = false;
    this.cassettePlaying = this.cassettePulseDurations.length > 0;
    this.cassettePlaybackEndCursor = this.cassetteBlocks.length;
    this.cassetteNextPulseTState = this.cpu.tStates + (this.cassettePulseDurations[0] ?? 0);
  }

  stopCassettePlayback() {
    this.cassettePulseDurations = new Uint32Array();
    this.cassettePulseToggles = new Uint8Array();
    this.cassettePulseIndex = 0;
    this.cassetteNextPulseTState = 0;
    this.cassettePlaybackEndCursor = this.cassetteCursor;
    this.cassetteInputLevel = false;
    this.cassettePlaying = false;
  }

  readCassetteInputBit() {
    this.advanceCassettePlayback();
    return this.cassetteInputLevel ? 0x80 : 0x00;
  }

  advanceCassettePlayback() {
    while (this.cassettePlaying && this.cpu.tStates >= this.cassetteNextPulseTState) {
      if (this.cassettePulseToggles[this.cassettePulseIndex]) this.cassetteInputLevel = !this.cassetteInputLevel;
      this.cassettePulseIndex += 1;
      if (this.cassettePulseIndex >= this.cassettePulseDurations.length) {
        this.cassetteCursor = this.cassettePlaybackEndCursor;
        this.stopCassettePlayback();
        return;
      }
      this.cassetteNextPulseTState += this.cassettePulseDurations[this.cassettePulseIndex];
    }
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
      cassette: {
        blocks: this.cassetteBlocks.length,
        cursor: this.cassetteCursor,
        playing: this.cassettePlaying,
        inputLevel: this.cassetteInputLevel
      },
      display: {
        columns: Trs80Model3Machine.SCREEN_COLUMNS,
        rows: Trs80Model3Machine.SCREEN_ROWS,
        videoStart: VIDEO_START
      }
    };
  }

  saveState() {
    return {
      format: SESSION_FORMAT,
      version: SESSION_VERSION,
      profile: "trs80-model3",
      cpu: this.cpu.getState(),
      halted: this.halted,
      frame: this.frame,
      ram: [...this.ram],
      videoRam: [...this.videoRam],
      keyboardRows: [...this.keyboardRows],
      cassette: {
        cursor: this.cassetteCursor,
        blocks: this.cassetteBlocks.length,
        playing: false
      }
    };
  }

  restoreState(state) {
    if (state?.format !== SESSION_FORMAT) throw new Error("Unsupported TRS-80 session format");
    if (state.version !== SESSION_VERSION) throw new Error("Unsupported TRS-80 session version");
    if (state.profile !== "trs80-model3") throw new Error(`Unsupported TRS-80 profile: ${state.profile ?? "(missing)"}`);
    if (!Array.isArray(state.ram) || state.ram.length !== RAM_SIZE) throw new Error("TRS-80 session RAM image has the wrong size");
    if (!Array.isArray(state.videoRam) || state.videoRam.length !== VIDEO_SIZE) throw new Error("TRS-80 session video RAM image has the wrong size");
    if (!Array.isArray(state.keyboardRows) || state.keyboardRows.length !== this.keyboardRows.length) {
      throw new Error("TRS-80 session keyboard state has the wrong size");
    }

    this.cpu.setState(state.cpu ?? {});
    this.halted = Boolean(state.halted);
    this.cpu.halted = this.halted;
    this.frame = Math.max(0, state.frame ?? 0);
    this.ram.set(state.ram.map((value) => value & 0xff));
    this.videoRam.set(state.videoRam.map((value) => value & 0xff));
    this.keyboardRows.set(state.keyboardRows.map((value) => value & 0xff));
    this.cassetteCursor = Math.max(0, Math.min(state.cassette?.cursor ?? 0, this.cassetteBlocks.length));
    this.stopCassettePlayback();
  }
}
