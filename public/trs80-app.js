import { Trs80Model3Machine } from "../src/trs80-model3.js";
import { disassembleWindow, hexByte, hexWord } from "./debugger.js";
import { Trs80KeyLatch, keyEventToTrs80Key } from "./trs80-keyboard.js";

const screenElement = document.querySelector("#trs80Screen");
const statusOutput = document.querySelector("#trs80Status");
const romFileInput = document.querySelector("#trs80RomFile");
const runPauseButton = document.querySelector("#trs80RunPause");
const stepFrameButton = document.querySelector("#trs80StepFrame");
const stepInstructionButton = document.querySelector("#trs80StepInstruction");
const resetButton = document.querySelector("#trs80Reset");
const registerGrid = document.querySelector("#trs80RegisterGrid");
const flagGrid = document.querySelector("#trs80FlagGrid");
const disassemblyList = document.querySelector("#trs80Disassembly");
const keyboardState = document.querySelector("#trs80KeyboardState");
const displayState = document.querySelector("#trs80DisplayState");

let machine;
let keyLatch;
let running = false;
let animationFrame = 0;
const DEFAULT_ROM_URL = new URL("../ROM/Model3-RevC-2EF8.bin", import.meta.url);

const FLAG_BITS = [
  ["S", 0x80],
  ["Z", 0x40],
  ["Y", 0x20],
  ["H", 0x10],
  ["X", 0x08],
  ["P/V", 0x04],
  ["N", 0x02],
  ["C", 0x01]
];

function setControlsEnabled(enabled) {
  runPauseButton.disabled = !enabled;
  stepFrameButton.disabled = !enabled;
  stepInstructionButton.disabled = !enabled;
  resetButton.disabled = !enabled;
}

async function loadDefaultRom() {
  try {
    const response = await fetch(DEFAULT_ROM_URL);
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    mountRom(new Uint8Array(await response.arrayBuffer()), "Bundled ROM loaded");
  } catch {
    statusOutput.value = "Load a 14K Model III ROM";
    renderUnavailableScreen();
  }
}

function mountRom(bytes, message) {
  try {
    machine = new Trs80Model3Machine({ rom: bytes });
    keyLatch = new Trs80KeyLatch(machine);
    running = true;
    runPauseButton.textContent = "Pause";
    runPauseButton.setAttribute("aria-label", "Pause");
    setControlsEnabled(true);
    statusOutput.value = message;
    screenElement.focus();
    render();
  } catch (error) {
    machine = undefined;
    keyLatch = undefined;
    running = false;
    setControlsEnabled(false);
    statusOutput.value = error.message;
    renderUnavailableScreen();
  }
}

function renderUnavailableScreen() {
  screenElement.textContent = Array.from({ length: 16 }, (_, row) =>
    row === 7 ? "LOAD MODEL III ROM".padEnd(64, " ") : " ".repeat(64)
  ).join("\n");
  registerGrid.replaceChildren();
  flagGrid.replaceChildren();
  disassemblyList.replaceChildren();
  keyboardState.replaceChildren();
  displayState.replaceChildren();
}

function render() {
  if (!machine) {
    renderUnavailableScreen();
    return;
  }

  screenElement.textContent = machine.renderTextDisplay().join("\n");
  updateDebugDrawer();
}

function updateDebugDrawer() {
  const state = machine.getDebugState();
  const registers = state.cpu.registers;
  const pairs = [
    ["AF", registers.AF],
    ["BC", registers.BC],
    ["DE", registers.DE],
    ["HL", registers.HL],
    ["IX", registers.IX],
    ["IY", registers.IY],
    ["SP", registers.SP],
    ["PC", registers.PC],
    ["T", state.cpu.tStates],
    ["IM", state.cpu.interruptMode],
    ["IFF1", state.cpu.iff1 ? 1 : 0],
    ["IFF2", state.cpu.iff2 ? 1 : 0]
  ];

  registerGrid.replaceChildren(...pairs.map(([name, value]) => makeCell(name, name === "T" ? String(value) : hexWord(value))));
  flagGrid.replaceChildren(...FLAG_BITS.map(([name, mask]) => {
    const flag = document.createElement("span");
    flag.className = `flag${(registers.F & mask) !== 0 ? " on" : ""}`;
    flag.textContent = name;
    return flag;
  }));

  disassemblyList.replaceChildren(...disassembleWindow((address) => machine.read8(address), registers.PC, { beforeBytes: 6, count: 9 }).map((row) => {
    const item = document.createElement("li");
    if (row.isPc) item.classList.add("current");

    const address = document.createElement("span");
    address.className = "addr";
    address.textContent = hexWord(row.address);

    const bytes = document.createElement("span");
    bytes.className = "bytes";
    bytes.textContent = row.bytes.map(hexByte).join(" ");

    const asm = document.createElement("span");
    asm.className = "asm";
    asm.textContent = row.text;

    item.append(address, bytes, asm);
    return item;
  }));

  keyboardState.replaceChildren(
    makeCell("Held", state.keyboard.pressedKeys.join(" ") || "-"),
    makeCell("Count", String(state.keyboard.pressedKeys.length))
  );
  displayState.replaceChildren(
    makeCell("Frame", String(state.frame)),
    makeCell("Size", `${state.display.columns}x${state.display.rows}`),
    makeCell("Video", hexWord(state.display.videoStart))
  );
}

function makeCell(label, value) {
  const cell = document.createElement("div");
  cell.className = "basic-cell";
  const name = document.createElement("span");
  name.textContent = label;
  const content = document.createElement("strong");
  content.textContent = value;
  cell.append(name, content);
  return cell;
}

function setKeyFromEvent(event, pressed) {
  if (!machine || !keyLatch || event.target instanceof HTMLInputElement) return;
  const key = keyEventToTrs80Key(event);
  if (!key) return;

  event.preventDefault();
  if (pressed) keyLatch.press(key);
  else keyLatch.release(key);
  render();
}

function tick() {
  if (running && machine) {
    machine.runFrame();
    keyLatch?.advanceFrame();
    render();
  }
  animationFrame = requestAnimationFrame(tick);
}

runPauseButton.addEventListener("click", () => {
  running = !running;
  runPauseButton.textContent = running ? "Pause" : "Run";
  runPauseButton.setAttribute("aria-label", running ? "Pause" : "Run");
});

stepFrameButton.addEventListener("click", () => {
  if (!machine) return;
  running = false;
  runPauseButton.textContent = "Run";
  runPauseButton.setAttribute("aria-label", "Run");
  machine.runFrame();
  render();
});

stepInstructionButton.addEventListener("click", () => {
  if (!machine) return;
  running = false;
  runPauseButton.textContent = "Run";
  runPauseButton.setAttribute("aria-label", "Run");
  machine.step();
  render();
});

resetButton.addEventListener("click", () => {
  if (!machine) return;
  machine.reset();
  running = true;
  runPauseButton.textContent = "Pause";
  runPauseButton.setAttribute("aria-label", "Pause");
  render();
  screenElement.focus();
});

romFileInput.addEventListener("change", async () => {
  const file = romFileInput.files?.[0];
  if (!file) return;
  mountRom(new Uint8Array(await file.arrayBuffer()), `${file.name} loaded`);
});

screenElement.addEventListener("keydown", (event) => setKeyFromEvent(event, true));
screenElement.addEventListener("keyup", (event) => setKeyFromEvent(event, false));
window.addEventListener("blur", () => {
  if (!machine || !keyLatch) return;
  keyLatch.releaseAll();
  render();
});

renderUnavailableScreen();
loadDefaultRom();
animationFrame = requestAnimationFrame(tick);

window.addEventListener("pagehide", () => cancelAnimationFrame(animationFrame));
