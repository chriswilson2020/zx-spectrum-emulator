export class MachineHistory {
  constructor({ limit = 512 } = {}) {
    if (!Number.isInteger(limit) || limit < 1) throw new Error("History limit must be a positive integer");
    this.limit = limit;
    this.entries = [];
  }

  get size() {
    return this.entries.length;
  }

  clear() {
    this.entries.length = 0;
  }

  capture(machine, label = "Step", metadata = null) {
    this.entries.push({ label, metadata, state: machine.saveState() });
    if (this.entries.length > this.limit) this.entries.splice(0, this.entries.length - this.limit);
    return this.size;
  }

  stepBack(machine) {
    const entry = this.entries.pop();
    if (!entry) return null;
    machine.restoreState(entry.state);
    return entry;
  }
}
