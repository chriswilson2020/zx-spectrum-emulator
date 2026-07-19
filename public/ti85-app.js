import { Ti85Machine } from "../src/ti85.js";
import { disassembleWindow, hexByte, hexWord, readMemoryRows } from "./debugger.js";

const canvas = document.querySelector("#ti85Screen");
const context = canvas.getContext("2d");
const statusOutput = document.querySelector("#ti85Status");
const romFileInput = document.querySelector("#ti85RomFile");
const runPauseButton = document.querySelector("#ti85RunPause");
const stepFrameButton = document.querySelector("#ti85StepFrame");
const stepInstructionButton = document.querySelector("#ti85StepInstruction");
const resetButton = document.querySelector("#ti85Reset");
const onButton = document.querySelector("#ti85On");
const registerGrid = document.querySelector("#ti85RegisterGrid");
const flagGrid = document.querySelector("#ti85FlagGrid");
const disassemblyList = document.querySelector("#ti85Disassembly");
const machineState = document.querySelector("#ti85MachineState");
const keyboardState = document.querySelector("#ti85KeyboardState");
const displayState = document.querySelector("#ti85DisplayState");
const memoryInspector = document.querySelector("#ti85MemoryInspector");

let machine;
let running = false;
let animationFrame = 0;
const DEFAULT_ROM_URL = new URL("../ROM/TI85.ROM", import.meta.url);

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

const TI85_MEMORY_SECTIONS = [
  ["ROM0", 0x0000, 4],
  ["ROMB", 0x4000, 4],
  ["RAM", 0x8000, 4],
  ["LCD", 0xfc00, 4]
];

function setControlsEnabled(enabled) {
  runPauseButton.disabled = !enabled;
  stepFrameButton.disabled = !enabled;
  stepInstructionButton.disabled = !enabled;
  resetButton.disabled = !enabled;
  onButton.disabled = !enabled;
}

async function loadDefaultRom() {
  try {
    const response = await fetch(DEFAULT_ROM_URL);
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    mountRom(new Uint8Array(await response.arrayBuffer()), "Bundled ROM loaded");
  } catch {
    statusOutput.value = "Load a 128K TI-85 ROM";
    setControlsEnabled(false);
    drawUnavailableScreen();
  }
}

function mountRom(bytes, message) {
  try {
    machine = new Ti85Machine({ rom: bytes });
    running = true;
    runPauseButton.textContent = "Pause";
    runPauseButton.setAttribute("aria-label", "Pause");
    setControlsEnabled(true);
    statusOutput.value = message;
    canvas.focus();
    render();
    startLoop();
  } catch (error) {
    machine = undefined;
    running = false;
    setControlsEnabled(false);
    statusOutput.value = error.message;
    drawUnavailableScreen();
  }
}

function drawUnavailableScreen() {
  context.fillStyle = "#aecdb0";
  context.fillRect(0, 0, canvas.width, canvas.height);
  context.fillStyle = "#2f413a";
  context.font = "8px monospace";
  context.fillText("LOAD TI-85 ROM", 26, 34);
  registerGrid.replaceChildren();
  flagGrid.replaceChildren();
  disassemblyList.replaceChildren();
  machineState.replaceChildren();
  keyboardState.replaceChildren();
  displayState.replaceChildren();
  memoryInspector.replaceChildren();
}

function render() {
  if (!machine) {
    drawUnavailableScreen();
    return;
  }
  drawTi85Screen();
  updateDebugDrawer();
}

function drawTi85Screen() {
  const frame = machine.renderLcdRgba();
  context.putImageData(new ImageData(frame.rgba, frame.width, frame.height), 0, 0);
}

function updateDebugDrawer() {
  const state = machine.getDebugState();
  const registers = state.cpu.registers;
  renderKeyValueGrid(registerGrid, [
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
    ["IFF1", state.cpu.IFF1 ? 1 : 0],
    ["IFF2", state.cpu.IFF2 ? 1 : 0]
  ].map(([name, value]) => [name, name === "T" ? String(value) : hexWord(value)]), "register-cell");

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

  renderKeyValueGrid(machineState, [
    ["Run", running ? "yes" : "no"],
    ["Halt", state.halted ? "yes" : "no"],
    ["Frame", String(state.frame)],
    ["Bank", String(state.memory.romBank)],
    ["Power", hexByte(state.powerMode)]
  ]);
  renderKeyValueGrid(keyboardState, [
    ["Held", state.keyboard.pressedKeys.join(" ") || "-"],
    ["Mask", hexByte(state.keyboard.mask)],
    ["ON", state.interrupts.onPressed ? "down" : "up"]
  ]);
  renderKeyValueGrid(displayState, [
    ["LCD", state.lcd.enabled ? "on" : "off"],
    ["Base", hexWord(state.lcd.baseAddress)],
    ["Contrast", String(state.lcd.contrast)],
    ["Lit", String(state.display.litPixelCount)],
    ["Checksum", state.display.checksum.toString(16).padStart(8, "0").toUpperCase()]
  ]);
  renderMemoryInspector(state.lcd.baseAddress);
}

function renderKeyValueGrid(container, rows, className = "basic-cell") {
  container.replaceChildren(
    ...rows.map(([label, value]) => {
      const cell = document.createElement("div");
      cell.className = className;
      const name = document.createElement("span");
      name.textContent = label;
      const content = document.createElement("strong");
      content.textContent = value;
      cell.append(name, content);
      return cell;
    })
  );
}

function renderMemoryInspector(lcdBaseAddress) {
  memoryInspector.replaceChildren(...readMemoryRows((address) => machine.read8(address), [
    ...TI85_MEMORY_SECTIONS,
    ["LCD*", lcdBaseAddress, 4]
  ]).map((row) => {
    const item = document.createElement("div");
    const label = document.createElement("span");
    label.textContent = `${row.label} ${hexWord(row.address)}`;
    const bytes = document.createElement("code");
    bytes.textContent = row.bytes.map(hexByte).join(" ");
    item.append(label, bytes);
    return item;
  }));
}

function runMachineFrame() {
  machine.runFrame();
}

function startLoop() {
  cancelAnimationFrame(animationFrame);
  const tick = () => {
    if (machine && running) runMachineFrame();
    render();
    animationFrame = requestAnimationFrame(tick);
  };
  animationFrame = requestAnimationFrame(tick);
}

function pressOn() {
  if (!machine) return;
  machine.pressKey("ON");
  statusOutput.value = "ON held";
}

function releaseOn() {
  if (!machine) return;
  machine.releaseKey("ON");
  statusOutput.value = "ON released";
}

runPauseButton.addEventListener("click", () => {
  running = !running;
  runPauseButton.textContent = running ? "Pause" : "Run";
  runPauseButton.setAttribute("aria-label", running ? "Pause" : "Run");
  statusOutput.value = running ? "Running" : "Paused";
  render();
});

stepFrameButton.addEventListener("click", () => {
  if (!machine) return;
  running = false;
  runPauseButton.textContent = "Run";
  machine.runFrame();
  statusOutput.value = "Frame stepped";
  render();
});

stepInstructionButton.addEventListener("click", () => {
  if (!machine) return;
  running = false;
  runPauseButton.textContent = "Run";
  machine.step();
  statusOutput.value = "Instruction stepped";
  render();
});

resetButton.addEventListener("click", () => {
  if (!machine) return;
  machine.reset();
  running = true;
  runPauseButton.textContent = "Pause";
  statusOutput.value = "Reset";
  render();
});

onButton.addEventListener("pointerdown", (event) => {
  event.preventDefault();
  pressOn();
});
onButton.addEventListener("pointerup", releaseOn);
onButton.addEventListener("pointercancel", releaseOn);
onButton.addEventListener("pointerleave", releaseOn);
onButton.addEventListener("keydown", (event) => {
  if (event.repeat || (event.key !== " " && event.key !== "Enter")) return;
  event.preventDefault();
  pressOn();
});
onButton.addEventListener("keyup", (event) => {
  if (event.key !== " " && event.key !== "Enter") return;
  event.preventDefault();
  releaseOn();
});

romFileInput.addEventListener("change", async () => {
  const file = romFileInput.files?.[0];
  if (!file) return;
  mountRom(new Uint8Array(await file.arrayBuffer()), `Loaded ${file.name}`);
});

loadDefaultRom();
