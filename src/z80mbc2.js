import { FlatMemory } from "./memory.js";
import { Z80 } from "./z80.js";

const DISK_SIZE = 8 * 1024 * 1024;
const SECTOR_SIZE = 512;
const SECTORS_PER_TRACK = 32;
const TRACKS = 512;
const CBASE = 0xd200;
const BIOS = 0xe800;
const CONST_MODE_FLAG = 0xea1e;
const SYSTEM_IMAGE_SIZE = 0x2000;

const PORT_EXECUTE = 0x00;
const PORT_OPCODE = 0x01;
const PORT_SERIAL_RX = 0x01;

const OPCODE_SERIAL_TX = 0x01;
const OPCODE_SELECT_DISK = 0x09;
const OPCODE_SELECT_TRACK = 0x0a;
const OPCODE_SELECT_SECTOR = 0x0b;
const OPCODE_WRITE_SECTOR = 0x0c;
const OPCODE_SYSTEM_FLAGS = 0x83;
const OPCODE_DISK_ERROR = 0x85;
const OPCODE_READ_SECTOR = 0x86;
const OPCODE_SD_MOUNT = 0x87;

export class RawZ80Mbc2Disk {
  constructor(bytes) {
    this.bytes = Uint8Array.from(bytes);
    if (this.bytes.length !== DISK_SIZE) throw new Error(`Invalid Z80-MBC2 disk image size: ${this.bytes.length}`);
    this.dirty = false;
  }

  static fromImage(bytes) {
    return new RawZ80Mbc2Disk(bytes);
  }

  readSector(track, sector) {
    const offset = this.sectorOffset(track, sector);
    return this.bytes.slice(offset, offset + SECTOR_SIZE);
  }

  writeSector(track, sector, values) {
    const bytes = Uint8Array.from(values);
    if (bytes.length !== SECTOR_SIZE) throw new Error(`Z80-MBC2 sector writes must be ${SECTOR_SIZE} bytes`);
    this.bytes.set(bytes, this.sectorOffset(track, sector));
    this.dirty = true;
  }

  toBytes() {
    return Uint8Array.from(this.bytes);
  }

  sectorOffset(track, sector) {
    if (!Number.isInteger(track) || track < 0 || track >= TRACKS) throw new Error(`Invalid Z80-MBC2 track ${track}`);
    if (!Number.isInteger(sector) || sector < 0 || sector >= SECTORS_PER_TRACK) throw new Error(`Invalid Z80-MBC2 sector ${sector}`);
    return ((track * SECTORS_PER_TRACK) + sector) * SECTOR_SIZE;
  }
}

export class Z80Mbc2Machine {
  constructor({ drives = [], consoleStatusMode = "blocking" } = {}) {
    if (drives.length === 0) throw new Error("Z80-MBC2 boot requires drive A");
    this.memory = new FlatMemory();
    this.drives = drives.map((drive) => (drive instanceof RawZ80Mbc2Disk ? drive : RawZ80Mbc2Disk.fromImage(drive)));
    this.consoleStatusMode = consoleStatusMode;
    this.consoleInput = [];
    this.consoleOutput = [];
    this.cpu = new Z80(this.memory, {
      read: (port) => this.readPort(port),
      write: (port, value) => this.writePort(port, value)
    });
    this.reset();
  }

  reset() {
    this.memory.bytes.fill(0);
    this.resetIoState();
    this.loadSystemImage();
    this.configureConsoleMode();
    this.cpu.reset();
    this.cpu.PC = BIOS;
    this.halted = false;
  }

  resetIoState() {
    this.opcode = 0;
    this.drive = 0;
    this.track = 0;
    this.trackLowPending = false;
    this.sector = 0;
    this.diskError = 0;
    this.readBuffer = new Uint8Array();
    this.readOffset = 0;
    this.writeBuffer = [];
  }

  loadSystemImage() {
    this.memory.load(CBASE, this.drives[0].bytes.slice(0, SYSTEM_IMAGE_SIZE));
  }

  configureConsoleMode() {
    if (this.consoleStatusMode === "blocking") this.memory.write8(CONST_MODE_FLAG, 1);
  }

  read8(address) {
    return this.memory.read8(address);
  }

  write8(address, value) {
    this.memory.write8(address, value);
  }

  step() {
    const cycles = this.cpu.step();
    this.halted = this.cpu.halted;
    return cycles;
  }

  run({ maxInstructions = 1_000_000, stopWhen } = {}) {
    let instructions = 0;
    while (instructions < maxInstructions) {
      if (stopWhen?.(this)) break;
      if (this.halted) break;
      this.step();
      instructions += 1;
    }
    return { instructions, output: this.getOutput(), halted: this.halted };
  }

  runUntilOutput(pattern, { maxInstructions = 1_000_000, fromOffset = 0 } = {}) {
    const matches = (output) => {
      const text = output.slice(fromOffset);
      if (typeof pattern === "string") return text.includes(pattern);
      return pattern.test(text);
    };
    const result = this.run({
      maxInstructions,
      stopWhen: (candidate) => matches(candidate.getOutput())
    });
    result.matched = matches(result.output);
    return result;
  }

  runCommand(command, { maxInstructions = 1_000_000 } = {}) {
    const normalizedCommand = command.endsWith("\r") || command.endsWith("\n") ? command : `${command}\r`;
    const startOffset = this.consoleOutput.length;
    this.queueInput(normalizedCommand);
    return this.runUntilOutput(/(?:^|\r\n)[A-P]>/, { maxInstructions, fromOffset: startOffset });
  }

  readPort(port) {
    switch (port & 0xff) {
      case PORT_EXECUTE:
        return this.readExecutePort();
      case PORT_SERIAL_RX:
        return this.consoleInput.length > 0 ? this.consoleInput.shift() : 0xff;
      default:
        return 0xff;
    }
  }

  writePort(port, value) {
    const data = value & 0xff;
    switch (port & 0xff) {
      case PORT_OPCODE:
        this.selectOpcode(data);
        return;
      case PORT_EXECUTE:
        this.writeExecutePort(data);
        return;
      default:
        return;
    }
  }

  selectOpcode(opcode) {
    this.opcode = opcode & 0xff;
    if (this.opcode === OPCODE_READ_SECTOR) this.prepareReadSector();
    if (this.opcode === OPCODE_WRITE_SECTOR) this.writeBuffer = [];
    if (this.opcode === OPCODE_SELECT_TRACK) this.trackLowPending = true;
    if (this.opcode === OPCODE_SD_MOUNT) this.diskError = 0;
  }

  readExecutePort() {
    switch (this.opcode) {
      case OPCODE_READ_SECTOR: {
        const value = this.readBuffer[this.readOffset] ?? 0xff;
        this.readOffset += 1;
        return value;
      }
      case OPCODE_DISK_ERROR:
        return this.diskError;
      case OPCODE_SYSTEM_FLAGS:
        if (this.consoleStatusMode === "blocking") return 0x08;
        return (this.consoleInput.length > 0 ? 0x04 : 0x08);
      case OPCODE_SD_MOUNT:
        return 0;
      default:
        return 0xff;
    }
  }

  writeExecutePort(value) {
    switch (this.opcode) {
      case OPCODE_SERIAL_TX:
        this.consoleOutput.push(value);
        return;
      case OPCODE_SELECT_DISK:
        this.drive = value;
        return;
      case OPCODE_SELECT_TRACK:
        if (this.trackLowPending) {
          this.track = (this.track & 0xff00) | value;
          this.trackLowPending = false;
        } else {
          this.track = ((value << 8) | (this.track & 0xff)) & 0xffff;
        }
        return;
      case OPCODE_SELECT_SECTOR:
        this.sector = value;
        return;
      case OPCODE_WRITE_SECTOR:
        this.writeBuffer.push(value);
        if (this.writeBuffer.length === SECTOR_SIZE) this.commitWriteSector();
        return;
      default:
        return;
    }
  }

  prepareReadSector() {
    try {
      const disk = this.selectedDisk();
      this.readBuffer = disk.readSector(this.track, this.sector);
      this.readOffset = 0;
      this.diskError = 0;
    } catch {
      this.readBuffer = new Uint8Array(SECTOR_SIZE).fill(0xff);
      this.readOffset = 0;
      this.diskError = 1;
    }
  }

  commitWriteSector() {
    try {
      const disk = this.selectedDisk();
      disk.writeSector(this.track, this.sector, Uint8Array.from(this.writeBuffer));
      this.diskError = 0;
    } catch {
      this.diskError = 1;
    }
  }

  selectedDisk() {
    const disk = this.drives[this.drive];
    if (!disk) throw new Error(`Invalid Z80-MBC2 drive ${this.drive}`);
    return disk;
  }

  queueInput(text) {
    for (let index = 0; index < text.length; index += 1) {
      this.consoleInput.push(text.charCodeAt(index) & 0xff);
    }
  }

  getOutput() {
    return String.fromCharCode(...this.consoleOutput);
  }

  drainOutput() {
    const output = this.getOutput();
    this.clearOutput();
    return output;
  }

  clearOutput() {
    this.consoleOutput = [];
  }

  getDebugState() {
    return {
      profile: "z80mbc2",
      cpu: this.cpu.getState(),
      halted: this.halted,
      io: {
        opcode: this.opcode,
        drive: this.drive,
        track: this.track,
        trackLowPending: this.trackLowPending,
        sector: this.sector,
        diskError: this.diskError,
        readBufferLength: this.readBuffer.length,
        readOffset: this.readOffset,
        writeBufferLength: this.writeBuffer.length
      },
      console: {
        inputQueueLength: this.consoleInput.length,
        outputQueueLength: this.consoleOutput.length,
        statusMode: this.consoleStatusMode
      }
    };
  }

  saveState() {
    return {
      kind: "z80mbc2",
      cpu: this.cpu.getState(),
      halted: this.halted,
      consoleStatusMode: this.consoleStatusMode,
      consoleInput: [...this.consoleInput],
      consoleOutput: [...this.consoleOutput],
      io: {
        opcode: this.opcode,
        drive: this.drive,
        track: this.track,
        trackLowPending: this.trackLowPending,
        sector: this.sector,
        diskError: this.diskError,
        readBuffer: [...this.readBuffer],
        readOffset: this.readOffset,
        writeBuffer: [...this.writeBuffer]
      }
    };
  }

  restoreState(state) {
    this.cpu.setState(state.cpu);
    this.halted = Boolean(state.halted);
    this.cpu.halted = this.halted;
    this.consoleStatusMode = state.consoleStatusMode ?? this.consoleStatusMode;
    this.consoleInput = [...(state.consoleInput ?? [])];
    this.consoleOutput = [...(state.consoleOutput ?? [])];
    this.opcode = state.io?.opcode ?? 0;
    this.drive = state.io?.drive ?? 0;
    this.track = state.io?.track ?? 0;
    this.trackLowPending = Boolean(state.io?.trackLowPending);
    this.sector = state.io?.sector ?? 0;
    this.diskError = state.io?.diskError ?? 0;
    this.readBuffer = Uint8Array.from(state.io?.readBuffer ?? []);
    this.readOffset = state.io?.readOffset ?? 0;
    this.writeBuffer = [...(state.io?.writeBuffer ?? [])];
  }
}
