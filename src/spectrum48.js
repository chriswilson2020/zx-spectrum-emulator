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
const ULA_CONTENTION_PATTERN = [6, 5, 4, 3, 2, 1, 0, 0];

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
    this.tapePulseLevels = new Uint8Array();
    this.tapePulseIndex = 0;
    this.tapeNextPulseTState = 0;
    this.tapePlaybackEndCursor = 0;
    this.tapeEarLevel = false;
    this.tapePlaying = false;
    this.inputPlayback = null;
    this.cpuExecuting = false;
    this.busTState = 0;
    this.pendingContention = 0;
    this.busAccessCount = 0;
    this.frame = 0;
    this.keyboardRows = new Uint8Array(8).fill(0x1f);
    this.cpu = new Z80(this, {
      read: (port) => this.readPort(port),
      write: (port, value) => this.writePort(port, value)
    });
  }

  read8(address) {
    const mappedAddress = address & 0xffff;
    this.trackMemoryAccess(mappedAddress);
    if (mappedAddress < 0x4000) return this.rom[mappedAddress];
    return this.ram[mappedAddress - 0x4000];
  }

  write8(address, value) {
    const mappedAddress = address & 0xffff;
    this.trackMemoryAccess(mappedAddress);
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
    if (this.inputPlayback) {
      if (this.inputPlayback.index >= this.inputPlayback.values.length) {
        throw new Error("RZX frame performed more input reads than recorded");
      }
      const value = this.inputPlayback.values[this.inputPlayback.index];
      this.inputPlayback.index += 1;
      return value;
    }
    if ((port & 0x0001) === 0) return 0xa0 | this.readTapeEarBit() | this.readKeyboardRows(port);
    return this.readFloatingBus();
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
      source: block.source ?? "TAP",
      type: block.type ?? "tap",
      flag: Number.isInteger(block.flag) ? block.flag & 0xff : null,
      payload: Uint8Array.from(block.payload ?? []),
      checksum: Number.isInteger(block.checksum) ? block.checksum & 0xff : null,
      pauseMs: block.pauseMs ?? 0,
      checksumValid: block.checksumValid !== false,
      header: block.header ? { ...block.header } : null,
      timing: block.timing ? { ...block.timing } : null,
      generalized: block.generalized ? {
        pilotSymbols: block.generalized.pilotSymbols.map((symbol) => ({ flags: symbol.flags, pulses: [...symbol.pulses] })),
        pilotStream: block.generalized.pilotStream.map((entry) => ({ ...entry })),
        dataSymbols: block.generalized.dataSymbols.map((symbol) => ({ flags: symbol.flags, pulses: [...symbol.pulses] })),
        dataStream: Uint8Array.from(block.generalized.dataStream),
        dataSymbolCount: block.generalized.dataSymbolCount,
        dataBitsPerSymbol: block.generalized.dataBitsPerSymbol
      } : null,
      fastLoadable: block.fastLoadable !== false
    }));
    this.tapeCursor = Math.max(0, Math.min(cursor, this.tapeBlocks.length));
    this.stopTapePlayback();
  }

  setTapeCursor(cursor) { this.tapeCursor = Math.max(0, Math.min(cursor, this.tapeBlocks.length)); }

  clearTape() {
    this.tapeBlocks = [];
    this.tapeCursor = 0;
    this.stopTapePlayback();
  }

  startTapePlayback({ startIndex = this.tapeCursor, initialPauseMs = 0 } = {}) {
    const sequence = this.buildTapePulseSequence(startIndex, initialPauseMs);
    this.tapePulseDurations = sequence.durations;
    this.tapePulseLevels = sequence.levels;
    this.tapePulseIndex = 0;
    this.tapeEarLevel = Boolean(this.tapePulseLevels[0]);
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
    this.tapePulseLevels = new Uint8Array();
    this.tapePulseIndex = 0;
    this.tapeNextPulseTState = 0;
    this.tapePlaybackEndCursor = this.tapeCursor;
    this.tapeEarLevel = false;
    this.tapePlaying = false;
  }

  buildTapePulseSequence(startIndex, initialPauseMs) {
    const durations = [];
    const levels = [];
    let level = false;
    const pushInterval = (duration) => {
      if (duration <= 0) return;
      durations.push(duration); levels.push(level ? 1 : 0);
    };
    const pushPulse = (duration) => {
      if (duration <= 0) return;
      pushInterval(duration); level = !level;
    };
    const appendSymbol = (symbol) => {
      switch (symbol.flags & 0x03) {
        case 0: level = !level; break;
        case 1: break;
        case 2: level = false; break;
        case 3: level = true; break;
      }
      const zero = symbol.pulses.indexOf(0);
      const pulses = zero < 0 ? symbol.pulses : symbol.pulses.slice(0, zero);
      for (let pulse = 0; pulse < pulses.length; pulse += 1) {
        pushInterval(pulses[pulse]);
        if (pulse < pulses.length - 1) level = !level;
      }
    };

    if (initialPauseMs > 0) pushInterval(Math.round(initialPauseMs * T_STATES_PER_MS));
    for (let index = startIndex; index < this.tapeBlocks.length; index += 1) {
      const block = this.tapeBlocks[index];
      if (!block.checksumValid) continue;
      if (block.generalized) this.appendGeneralizedBlockPulses(appendSymbol, block.generalized);
      else this.appendDataBlockPulses(pushPulse, block);
      if (block.pauseMs > 0) pushInterval(Math.round(block.pauseMs * T_STATES_PER_MS));
    }
    return { durations: Uint32Array.from(durations), levels: Uint8Array.from(levels) };
  }

  appendDataBlockPulses(pushPulse, block) {
    if (block.flag === null) return;
    const timing = block.timing ?? {
      pilotPulse: PILOT_PULSE_T_STATES,
      sync1: SYNC_PULSE_T_STATES[0], sync2: SYNC_PULSE_T_STATES[1],
      zero: ZERO_BIT_PULSE_T_STATES, one: ONE_BIT_PULSE_T_STATES,
      pilotCount: block.flag < 0x80 ? HEADER_PILOT_PULSES : DATA_PILOT_PULSES,
      usedBitsLastByte: 8
    };
    for (let pulse = 0; pulse < timing.pilotCount; pulse += 1) pushPulse(timing.pilotPulse);
    pushPulse(timing.sync1); pushPulse(timing.sync2);
    const bytes = [block.flag, ...block.payload, block.checksum ?? 0];
    const lastBits = timing.usedBitsLastByte === 0 ? 8 : timing.usedBitsLastByte;
    for (let byteIndex = 0; byteIndex < bytes.length; byteIndex += 1) {
      const bits = byteIndex === bytes.length - 1 ? lastBits : 8;
      for (let bit = 7; bit >= 8 - bits; bit -= 1) {
        const pulseLength = (bytes[byteIndex] & (1 << bit)) === 0 ? timing.zero : timing.one;
        pushPulse(pulseLength); pushPulse(pulseLength);
      }
    }
  }

  appendGeneralizedBlockPulses(appendSymbol, generalized) {
    for (const entry of generalized.pilotStream) {
      const symbol = generalized.pilotSymbols[entry.symbol];
      if (!symbol) throw new Error("Missing TZX pilot symbol " + entry.symbol);
      for (let repetition = 0; repetition < entry.repetitions; repetition += 1) appendSymbol(symbol);
    }
    const width = generalized.dataBitsPerSymbol;
    for (let symbolIndex = 0; symbolIndex < generalized.dataSymbolCount; symbolIndex += 1) {
      let value = 0;
      for (let bit = 0; bit < width; bit += 1) {
        const streamBit = (symbolIndex * width) + bit;
        const byte = generalized.dataStream[streamBit >> 3] ?? 0;
        value = (value << 1) | ((byte >> (7 - (streamBit & 7))) & 1);
      }
      const symbol = generalized.dataSymbols[value];
      if (!symbol) throw new Error("Missing TZX data symbol " + value);
      appendSymbol(symbol);
    }
  }

  readTapeEarBit() {
    this.advanceTapePlayback();
    if (!this.tapePlaying) return 0x40;
    return this.tapeEarLevel ? 0x40 : 0x00;
  }

  advanceTapePlayback() {
    while (this.tapePlaying && this.cpu.tStates >= this.tapeNextPulseTState) {
      this.tapePulseIndex += 1;
      if (this.tapePulseIndex >= this.tapePulseDurations.length) {
        this.tapeCursor = this.tapePlaybackEndCursor;
        this.stopTapePlayback();
        return;
      }
      this.tapeEarLevel = Boolean(this.tapePulseLevels[this.tapePulseIndex]);
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
    return this.getRasterPositionAt(this.cpu.tStates);
  }

  readFloatingBus(tState = this.cpu.tStates) {
    const raster = this.getRasterPositionAt(tState);
    if (raster.displayLine < 0 || raster.displayLine >= Spectrum48.SCREEN_HEIGHT) return 0xff;
    if (raster.displayColumn < 0 || raster.displayColumn >= 128) return 0xff;
    const xByte = Math.floor(raster.displayColumn / 4);
    const phase = raster.displayColumn & 0x03;
    if (phase < 2) return this.read8(this.screenByteAddress(xByte, raster.displayLine));
    return this.read8(0x5800 + ((raster.displayLine >> 3) * 32) + xByte);
  }

  getRasterPositionAt(tState) {
    const tStateInFrame = ((tState % Spectrum48.T_STATES_PER_FRAME) + Spectrum48.T_STATES_PER_FRAME) % Spectrum48.T_STATES_PER_FRAME;
    const line = Math.floor(tStateInFrame / Spectrum48.T_STATES_PER_LINE);
    const column = tStateInFrame % Spectrum48.T_STATES_PER_LINE;
    const displayLine = line - Spectrum48.DISPLAY_FIRST_LINE;
    const displayColumn = column - Spectrum48.DISPLAY_FIRST_COLUMN;
    const visibleColumn = column >= 112 ? column - 112 : column + 112;
    const visibleLine = line - 40;
    return {
      tStateInFrame,
      line,
      column,
      displayLine,
      displayColumn,
      visibleX: visibleColumn >= 0 && visibleColumn < 160 ? visibleColumn * 2 : -1,
      visibleY: visibleLine >= 0 && visibleLine < Spectrum48.FRAME_HEIGHT ? visibleLine : -1,
      inVisibleFrame: visibleColumn >= 0 && visibleColumn < 160 && visibleLine >= 0 && visibleLine < Spectrum48.FRAME_HEIGHT,
      inDisplay: displayLine >= 0 && displayLine < Spectrum48.SCREEN_HEIGHT && displayColumn >= 0 && displayColumn < 128
    };
  }

  contentionDelay(address, tState = this.cpu.tStates) {
    const mappedAddress = address & 0xffff;
    if (mappedAddress < 0x4000 || mappedAddress >= 0x8000) return 0;
    const raster = this.getRasterPositionAt(tState);
    if (raster.displayLine < 0 || raster.displayLine >= Spectrum48.SCREEN_HEIGHT) return 0;
    if (raster.displayColumn < 0 || raster.displayColumn >= 128) return 0;
    return ULA_CONTENTION_PATTERN[raster.displayColumn & 0x07];
  }

  trackMemoryAccess(address) {
    if (!this.cpuExecuting) return;
    const delay = this.contentionDelay(address, this.busTState);
    this.pendingContention += delay;
    this.busTState += (this.busAccessCount === 0 ? 4 : 3) + delay;
    this.busAccessCount += 1;
  }

  step() {
    const tapeCycles = this.interceptRomTapeLoad();
    if (tapeCycles !== 0) return tapeCycles;
    this.cpuExecuting = true;
    this.busTState = this.cpu.tStates;
    this.pendingContention = 0;
    this.busAccessCount = 0;
    let cycles;
    try {
      cycles = this.cpu.step();
    } finally {
      this.cpuExecuting = false;
    }
    this.cpu.tStates += this.pendingContention;
    return cycles + this.pendingContention;
  }

  interceptRomTapeLoad() {
    if (this.cpu.PC !== 0x0556 || this.tapeCursor >= this.tapeBlocks.length) return 0;

    const block = this.tapeBlocks[this.tapeCursor];
    const expectedFlag = this.cpu.A & 0xff;
    const requestedLength = this.cpu.DE & 0xffff;
    if (!block.fastLoadable || !block.checksumValid || block.flag !== expectedFlag || block.payload.length !== requestedLength) {
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

  runRecordedFrame({ fetchCount, inputs }) {
    const target = this.cpu.instructionFetches + fetchCount;
    this.inputPlayback = {
      values: inputs instanceof Uint8Array ? inputs : Uint8Array.from(inputs ?? []),
      index: 0
    };

    try {
      while (this.cpu.instructionFetches < target) this.step();
      if (this.cpu.instructionFetches !== target) {
        throw new Error("RZX frame ended between opcode fetches");
      }
      if (this.inputPlayback.index !== this.inputPlayback.values.length) {
        throw new Error(
          `RZX frame used ${this.inputPlayback.index} of ${this.inputPlayback.values.length} recorded input reads`
        );
      }
    } finally {
      this.inputPlayback = null;
    }

    this.cpu.requestInterrupt(0xff);
    this.frame += 1;
  }

  saveState() {
    return {
      version: 1,
      machine: "spectrum48",
      cpu: this.cpu.getState(),
      ram: Uint8Array.from(this.ram),
      borderColor: this.borderColor,
      beeperOn: this.beeperOn,
      beeperEvents: this.beeperEvents.map((event) => ({ ...event })),
      frame: this.frame,
      keyboardRows: Uint8Array.from(this.keyboardRows),
      tape: {
        cursor: this.tapeCursor,
        pulseIndex: this.tapePulseIndex,
        nextPulseTState: this.tapeNextPulseTState,
        playbackEndCursor: this.tapePlaybackEndCursor,
        earLevel: this.tapeEarLevel,
        playing: this.tapePlaying
      }
    };
  }

  restoreState(state) {
    if (state?.machine !== "spectrum48" || state.version !== 1) {
      throw new Error("Incompatible ZX Spectrum machine state");
    }
    if (!state.ram || state.ram.length !== this.ram.length) {
      throw new Error("ZX Spectrum machine state requires 48K RAM");
    }

    this.cpu.setState(state.cpu);
    this.ram.set(state.ram);
    this.borderColor = state.borderColor & 0x07;
    this.beeperOn = Boolean(state.beeperOn);
    this.beeperEvents = (state.beeperEvents ?? []).map((event) => ({ ...event }));
    this.frame = state.frame ?? 0;
    this.keyboardRows.set(state.keyboardRows ?? new Uint8Array(8).fill(0x1f));
    this.tapeCursor = state.tape?.cursor ?? 0;
    this.tapePulseIndex = state.tape?.pulseIndex ?? 0;
    this.tapeNextPulseTState = state.tape?.nextPulseTState ?? 0;
    this.tapePlaybackEndCursor = state.tape?.playbackEndCursor ?? 0;
    this.tapeEarLevel = Boolean(state.tape?.earLevel);
    this.tapePlaying = Boolean(state.tape?.playing);
    this.inputPlayback = null;
  }

  reset() {
    this.cpu.reset();
    this.frame = 0;
    this.beeperEvents = [];
  }
}
