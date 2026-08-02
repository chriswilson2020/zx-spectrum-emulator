export class MachineHistory {
  constructor({ limit = 6000, byteLimit = 64 * 1024 * 1024 } = {}) {
    if (!Number.isInteger(limit) || limit < 1) throw new Error("History limit must be a positive integer");
    if (!Number.isInteger(byteLimit) || byteLimit < 0x10000) throw new Error("History byte limit must be at least 64K");
    this.limit = limit;
    this.byteLimit = byteLimit;
    this.bytesUsed = 0;
    this.entries = [];
  }

  get size() {
    return this.entries.length;
  }

  clear() {
    this.entries.length = 0;
    this.bytesUsed = 0;
  }

  capture(machine, label = "Step", metadata = null) {
    this.compactLatest(machine);
    const state = machine.saveState();
    const entry = { label, metadata, state, byteSize: state.ram.length + 1024 };
    this.entries.push(entry);
    this.bytesUsed += entry.byteSize;
    this.trim();
    return this.size;
  }

  compactLatest(machine) {
    const entry = this.entries.at(-1);
    if (!entry?.state?.ram) return;
    const oldRam = entry.state.ram;
    const offsets = [];
    const values = [];
    for (let index = 0; index < oldRam.length; index += 1) {
      if (oldRam[index] === machine.ram[index]) continue;
      offsets.push(index);
      values.push(oldRam[index]);
    }
    entry.ramOffsets = Uint16Array.from(offsets);
    entry.ramValues = Uint8Array.from(values);
    delete entry.state.ram;
    this.bytesUsed -= entry.byteSize;
    entry.byteSize = (entry.ramOffsets.byteLength + entry.ramValues.byteLength) + 1024;
    this.bytesUsed += entry.byteSize;
  }

  trim() {
    while (this.entries.length > this.limit || this.bytesUsed > this.byteLimit) {
      const removed = this.entries.shift();
      this.bytesUsed -= removed?.byteSize ?? 0;
    }
  }

  stepBack(machine) {
    const entry = this.entries.pop();
    if (!entry) return null;
    this.bytesUsed -= entry.byteSize ?? 0;
    if (entry.state.ram) {
      machine.restoreState(entry.state);
    } else {
      const ram = Uint8Array.from(machine.ram);
      for (let index = 0; index < entry.ramOffsets.length; index += 1) {
        ram[entry.ramOffsets[index]] = entry.ramValues[index];
      }
      machine.restoreState({ ...entry.state, ram });
    }
    return entry;
  }
}
