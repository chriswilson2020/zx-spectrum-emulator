import { FLAG, Z80 } from "./z80.js";

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

const T_STATES_PER_MS = 3500;
const PILOT_PULSE_T_STATES = 2168;
const SYNC_PULSE_T_STATES = [667, 735];
const ZERO_BIT_PULSE_T_STATES = 855;
const ONE_BIT_PULSE_T_STATES = 1710;
const HEADER_PILOT_PULSES = 8063;
const DATA_PILOT_PULSES = 3223;

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
  static T_STATES_PER_LINE = 224;
  static SCANLINES_PER_FRAME = 312;
  static DISPLAY_FIRST_LINE = 64;
  static DISPLAY_FIRST_COLUMN = 128;

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
    this.beeperEvents = [];
    this.tapeBlocks = [];
    this.tapeCursor = 0;
    this.tapePulseDurations = new Uint32Array();
    this.tapePulseToggles = new Uint8Array();
    this.tapePulseIndex = 0;
    this.tapeNextPulseTState = 0;
    this.tapePlaybackEndCursor = 0;
    this.tapeEarLevel = false;
    this.tapePlaying = false;
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
    if ((port & 0x0001) === 0) return 0xa0 | this.readTapeEarBit() | this.readKeyboardRows(port);
    return 0xff;
  }

  writePort(port, value) {
    if ((port & 0x0001) !== 0) return;
    this.borderColor = value & 0x07;
    const beeperOn = (value & 0x10) !== 0;
    if (beeperOn !== this.beeperOn) {
      this.beeperEvents.push({ tState: this.cpu.tStates, on: beeperOn });
    }
    this.beeperOn = beeperOn;
  }

  drainBeeperEvents() {
    const events = this.beeperEvents;
    this.beeperEvents = [];
    return events;
  }

  setTapeBlocks(blocks, { cursor = 0 } = {}) {
    this.tapeBlocks = blocks.map((block, index) => ({
      index: block.index ?? index,
      flag: block.flag & 0xff,
      payload: Uint8Array.from(block.payload ?? []),
      checksum: block.checksum ?? 0,
      pauseMs: block.pauseMs ?? 0,
      checksumValid: block.checksumValid !== false
    }));
    this.tapeCursor = Math.max(0, Math.min(cursor, this.tapeBlocks.length));
    this.stopTapePlayback();
  }

  setTapeCursor(cursor) {
    this.tapeCursor = Math.max(0, Math.min(cursor, this.tapeBlocks.length));
  }

  clearTape() {
    this.tapeBlocks = [];
    this.tapeCursor = 0;
    this.stopTapePlayback();
  }

  startTapePlayback({ startIndex = this.tapeCursor, initialPauseMs = 0 } = {}) {
    const sequence = this.buildTapePulseSequence(startIndex, initialPauseMs);
    this.tapePulseDurations = sequence.durations;
    this.tapePulseToggles = sequence.toggles;
    this.tapePulseIndex = 0;
    this.tapeEarLevel = false;
    this.tapePlaying = this.tapePulseDurations.length > 0;
    this.tapePlaybackEndCursor = this.tapeBlocks.length;
    this.tapeNextPulseTState = this.cpu.tStates + (this.tapePulseDurations[0] ?? 0);
  }

  startTapePlaybackFromCursor() {
    const previousPause = this.tapeCursor > 0 ? this.tapeBlocks[this.tapeCursor - 1]?.pauseMs ?? 0 : 0;
    this.startTapePlayback({ startIndex: this.tapeCursor, initialPauseMs: previousPause });
  }

  stopTapePlayback() {
    this.tapePulseDurations = new Uint32Array();
    this.tapePulseToggles = new Uint8Array();
    this.tapePulseIndex = 0;
    this.tapeNextPulseTState = 0;
    this.tapePlaybackEndCursor = this.tapeCursor;
    this.tapeEarLevel = false;
    this.tapePlaying = false;
  }

  buildTapePulseSequence(startIndex, initialPauseMs) {
    const durations = [];
    const toggles = [];
    const pushDuration = (duration, togglesEar) => {
      if (duration <= 0) return;
      durations.push(duration);
      toggles.push(togglesEar ? 1 : 0);
    };

    if (initialPauseMs > 0) pushDuration(Math.round(initialPauseMs * T_STATES_PER_MS), false);

    for (let index = startIndex; index < this.tapeBlocks.length; index += 1) {
      const block = this.tapeBlocks[index];
      if (!block.checksumValid) continue;
      this.appendStandardBlockPulses(pushDuration, block);
      if (block.pauseMs > 0) pushDuration(Math.round(block.pauseMs * T_STATES_PER_MS), false);
    }

    return {
      durations: Uint32Array.from(durations),
      toggles: Uint8Array.from(toggles)
    };
  }

  appendStandardBlockPulses(pushDuration, block) {
    const pilotPulses = block.flag < 0x80 ? HEADER_PILOT_PULSES : DATA_PILOT_PULSES;
    for (let pulse = 0; pulse < pilotPulses; pulse += 1) pushDuration(PILOT_PULSE_T_STATES, true);
    for (const syncPulse of SYNC_PULSE_T_STATES) pushDuration(syncPulse, true);

    const bytes = [block.flag, ...block.payload, block.checksum & 0xff];
    for (const byte of bytes) {
      for (let bit = 7; bit >= 0; bit -= 1) {
        const pulseLength = (byte & (1 << bit)) === 0 ? ZERO_BIT_PULSE_T_STATES : ONE_BIT_PULSE_T_STATES;
        pushDuration(pulseLength, true);
        pushDuration(pulseLength, true);
      }
    }
  }

  readTapeEarBit() {
    this.advanceTapePlayback();
    if (!this.tapePlaying) return 0x40;
    return this.tapeEarLevel ? 0x40 : 0x00;
  }

  advanceTapePlayback() {
    while (this.tapePlaying && this.cpu.tStates >= this.tapeNextPulseTState) {
      if (this.tapePulseToggles[this.tapePulseIndex]) this.tapeEarLevel = !this.tapeEarLevel;
      this.tapePulseIndex += 1;
      if (this.tapePulseIndex >= this.tapePulseDurations.length) {
        this.tapeCursor = this.tapePlaybackEndCursor;
        this.stopTapePlayback();
        return;
      }
      this.tapeNextPulseTState += this.tapePulseDurations[this.tapePulseIndex];
    }
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

  getRasterPosition() {
    const tStateInFrame = ((this.cpu.tStates % Spectrum48.T_STATES_PER_FRAME) + Spectrum48.T_STATES_PER_FRAME) % Spectrum48.T_STATES_PER_FRAME;
    const line = Math.floor(tStateInFrame / Spectrum48.T_STATES_PER_LINE);
    const column = tStateInFrame % Spectrum48.T_STATES_PER_LINE;
    const displayLine = line - Spectrum48.DISPLAY_FIRST_LINE;
    const displayColumn = column - Spectrum48.DISPLAY_FIRST_COLUMN;
    return {
      tStateInFrame,
      line,
      column,
      displayLine,
      displayColumn,
      inDisplay: displayLine >= 0 && displayLine < Spectrum48.SCREEN_HEIGHT && displayColumn >= 0 && displayColumn < Spectrum48.SCREEN_WIDTH
    };
  }

  step() {
    const tapeCycles = this.interceptRomTapeLoad();
    if (tapeCycles !== 0) return tapeCycles;
    return this.cpu.step();
  }

  interceptRomTapeLoad() {
    if (this.cpu.PC !== 0x0556 || this.tapeCursor >= this.tapeBlocks.length) return 0;

    const block = this.tapeBlocks[this.tapeCursor];
    const expectedFlag = this.cpu.A & 0xff;
    const requestedLength = this.cpu.DE & 0xffff;
    if (!block.checksumValid || block.flag !== expectedFlag || block.payload.length !== requestedLength) {
      return 0;
    }

    this.stopTapePlayback();
    const destination = this.cpu.IX;
    for (let offset = 0; offset < block.payload.length; offset += 1) {
      this.write8(destination + offset, block.payload[offset]);
    }

    this.tapeCursor += 1;
    if (this.tapeCursor < this.tapeBlocks.length && !this.tapeBlocks[this.tapeCursor].header) {
      this.startTapePlaybackFromCursor();
    }
    this.cpu.IX = (destination + block.payload.length) & 0xffff;
    this.cpu.DE = 0;
    this.cpu.A = 0;
    this.cpu.F = (this.cpu.F & ~(FLAG.H | FLAG.N)) | FLAG.C;
    this.cpu.WZ = this.read16(this.cpu.SP);
    this.cpu.PC = this.cpu.WZ;
    this.cpu.SP = (this.cpu.SP + 2) & 0xffff;

    const cycles = 32;
    this.cpu.tStates += cycles;
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
    const elapsed = this.runTStates(Spectrum48.T_STATES_PER_FRAME);
    this.frame += 1;
    return elapsed;
  }

  reset() {
    this.cpu.reset();
    this.frame = 0;
    this.beeperEvents = [];
  }
}
