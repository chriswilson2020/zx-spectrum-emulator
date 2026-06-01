import { RawCpmDisk } from "./cpm-disk.js";
import { FlatMemory } from "./memory.js";
import { Z80 } from "./z80.js";

const PORT_CONSOLE_STATUS = 0x00;
const PORT_CONSOLE_DATA = 0x01;
const PORT_FDC_DRIVE = 0x0a;
const PORT_FDC_TRACK = 0x0b;
const PORT_FDC_SECTOR_LOW = 0x0c;
const PORT_FDC_COMMAND = 0x0d;
const PORT_FDC_STATUS = 0x0e;
const PORT_DMA_LOW = 0x0f;
const PORT_DMA_HIGH = 0x10;
const PORT_FDC_SECTOR_HIGH = 0x11;

export class Cpm22Machine {
  constructor({ drives = [] } = {}) {
    this.memory = new FlatMemory();
    this.drives = drives.map((drive) => (drive instanceof RawCpmDisk ? drive : RawCpmDisk.z80simFloppy(drive)));
    this.consoleInput = [];
    this.consoleOutput = [];
    this.halted = false;
    this.cpu = new Z80(this.memory, {
      read: (port) => this.readPort(port),
      write: (port, value) => this.writePort(port, value)
    });
    this.reset();
  }

  reset() {
    this.memory.bytes.fill(0);
    this.resetIoState();
    this.loadBootSector();
    this.cpu.reset();
    this.halted = false;
  }

  resetIoState() {
    this.drive = 0;
    this.track = 0;
    this.sector = 1;
    this.fdcStatus = 0;
    this.dmaAddress = 0;
  }

  loadBootSector() {
    const bootDrive = this.drives[0];
    if (!bootDrive) throw new Error("CP/M boot requires drive A");
    this.memory.load(0x0000, bootDrive.readSector(0, 1));
  }

  read8(address) {
    return this.memory.read8(address);
  }

  write8(address, value) {
    this.memory.write8(address, value);
  }

  read16(address) {
    return this.memory.read16(address);
  }

  write16(address, value) {
    this.memory.write16(address, value);
  }

  step() {
    if (this.shouldWaitForConsoleInput()) {
      const cycles = 4;
      this.cpu.tStates += cycles;
      return cycles;
    }

    const cycles = this.cpu.step();
    this.halted = this.cpu.halted;
    return cycles;
  }

  shouldWaitForConsoleInput() {
    return (
      this.consoleInput.length === 0 &&
      this.memory.read8(this.cpu.PC) === 0xdb &&
      this.memory.read8(this.cpu.PC + 1) === PORT_CONSOLE_DATA
    );
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
      case PORT_CONSOLE_STATUS:
        return this.consoleInput.length > 0 ? 0xff : 0x00;
      case PORT_CONSOLE_DATA:
        return this.consoleInput.length > 0 ? this.consoleInput.shift() : 0x00;
      case PORT_FDC_DRIVE:
        return this.drive;
      case PORT_FDC_TRACK:
        return this.track;
      case PORT_FDC_SECTOR_LOW:
        return this.sector & 0xff;
      case PORT_FDC_COMMAND:
        return 0x00;
      case PORT_FDC_STATUS:
        return this.fdcStatus;
      case PORT_DMA_LOW:
        return this.dmaAddress & 0xff;
      case PORT_DMA_HIGH:
        return (this.dmaAddress >> 8) & 0xff;
      case PORT_FDC_SECTOR_HIGH:
        return (this.sector >> 8) & 0xff;
      default:
        return 0xff;
    }
  }

  writePort(port, value) {
    const data = value & 0xff;
    switch (port & 0xff) {
      case PORT_CONSOLE_DATA:
        this.consoleOutput.push(data);
        return;
      case PORT_FDC_DRIVE:
        this.drive = data;
        return;
      case PORT_FDC_TRACK:
        this.track = data;
        return;
      case PORT_FDC_SECTOR_LOW:
        this.sector = (this.sector & 0xff00) | data;
        return;
      case PORT_FDC_COMMAND:
        this.runFdcCommand(data);
        return;
      case PORT_DMA_LOW:
        this.dmaAddress = (this.dmaAddress & 0xff00) | data;
        return;
      case PORT_DMA_HIGH:
        this.dmaAddress = ((data << 8) | (this.dmaAddress & 0xff)) & 0xffff;
        return;
      case PORT_FDC_SECTOR_HIGH:
        this.sector = ((data << 8) | (this.sector & 0xff)) & 0xffff;
        return;
      default:
        return;
    }
  }

  runFdcCommand(command) {
    const disk = this.drives[this.drive];
    if (!disk) {
      this.fdcStatus = 1;
      return;
    }
    if (this.track < 0 || this.track >= disk.geometry.tracks) {
      this.fdcStatus = 2;
      return;
    }
    if (this.sector < 1 || this.sector > disk.geometry.sectorsPerTrack) {
      this.fdcStatus = 3;
      return;
    }

    if (command === 0) {
      this.readDiskSector(disk);
    } else if (command === 1) {
      this.writeDiskSector(disk);
    } else {
      this.fdcStatus = 7;
    }
  }

  readDiskSector(disk) {
    const bytes = disk.readSector(this.track, this.sector);
    for (let offset = 0; offset < bytes.length; offset += 1) {
      this.memory.write8(this.dmaAddress + offset, bytes[offset]);
    }
    this.fdcStatus = 0;
  }

  writeDiskSector(disk) {
    const bytes = new Uint8Array(disk.geometry.sectorSize);
    for (let offset = 0; offset < bytes.length; offset += 1) {
      bytes[offset] = this.memory.read8(this.dmaAddress + offset);
    }
    disk.writeSector(this.track, this.sector, bytes);
    this.fdcStatus = 0;
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

  saveState() {
    return {
      kind: "cpm22",
      cpu: this.cpu.getState(),
      halted: this.halted,
      consoleInput: [...this.consoleInput],
      consoleOutput: [...this.consoleOutput],
      io: {
        drive: this.drive,
        track: this.track,
        sector: this.sector,
        fdcStatus: this.fdcStatus,
        dmaAddress: this.dmaAddress
      }
    };
  }

  restoreState(state) {
    this.cpu.setState(state.cpu);
    this.halted = Boolean(state.halted);
    this.cpu.halted = this.halted;
    this.consoleInput = [...(state.consoleInput ?? [])];
    this.consoleOutput = [...(state.consoleOutput ?? [])];
    this.drive = state.io?.drive ?? 0;
    this.track = state.io?.track ?? 0;
    this.sector = state.io?.sector ?? 1;
    this.fdcStatus = state.io?.fdcStatus ?? 0;
    this.dmaAddress = state.io?.dmaAddress ?? 0;
  }
}
