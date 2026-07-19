import { Ti85Machine } from "../../src/ti85.js";

const DEFAULT_ROM_PATH = "ROM/TI85.ROM";
const TAP_HOLD_FRAMES = 3;
const TAP_GAP_FRAMES = 5;
const FINAL_SETTLE_FRAMES = 20;

export class Ti85RomHarness {
  static fromBundledRom() {
    return new Ti85RomHarness(Ti85Machine.fromRomFile(DEFAULT_ROM_PATH));
  }

  constructor(machine) {
    this.machine = machine;
  }

  powerOn() {
    this.waitForHalt();
    this.hold("ON", 4, 4);
    this.waitForLitPixels();
    this.runFrames(FINAL_SETTLE_FRAMES);
  }

  runWorkflow(keys) {
    for (const key of keys) this.tap(key);
    this.runFrames(FINAL_SETTLE_FRAMES);
  }

  tap(key) {
    this.hold(key, TAP_HOLD_FRAMES, TAP_GAP_FRAMES);
  }

  hold(key, holdFrames, gapFrames) {
    this.machine.pressKey(key);
    this.runFrames(holdFrames);
    this.machine.releaseKey(key);
    this.runFrames(gapFrames);
  }

  runFrames(count) {
    for (let index = 0; index < count; index += 1) {
      this.machine.runFrame();
    }
  }

  waitForHalt(maxFrames = 100) {
    for (let index = 0; index < maxFrames && !this.machine.halted; index += 1) {
      this.machine.runFrame();
    }
  }

  waitForLitPixels(maxFrames = 300) {
    for (let index = 0; index < maxFrames; index += 1) {
      this.machine.runFrame();
      if (this.machine.renderLcdBitmap().litPixelCount > 0) return;
    }
  }

  signature() {
    const frame = this.machine.renderLcdBitmap();
    const state = this.machine.getDebugState();
    return {
      lcdEnabled: state.lcd.enabled,
      baseAddress: state.lcd.baseAddress,
      litPixelCount: frame.litPixelCount,
      checksum: frame.checksum.toString(16).padStart(8, "0").toUpperCase()
    };
  }

  failureDetails(name, keys) {
    return JSON.stringify({
      workflow: name,
      keys,
      signature: this.signature(),
      debug: this.machine.getDebugState()
    }, null, 2);
  }
}
