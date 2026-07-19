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
const keypadElement = document.querySelector("#ti85Keypad");
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

const TI85_KEY_LAYOUT = [
  [
    { key: "F1", label: "F1", shift: "M1", className: "function" },
    { key: "F2", label: "F2", shift: "M2", className: "function" },
    { key: "F3", label: "F3", shift: "M3", className: "function" },
    { key: "F4", label: "F4", shift: "M4", className: "function" },
    { key: "F5", label: "F5", shift: "M5", className: "function" }
  ],
  [
    { key: "2ND", label: "2nd", className: "modifier second" },
    { key: "EXIT", label: "EXIT", shift: "QUIT" },
    { key: "MORE", label: "MORE", shift: "MODE" },
    { key: "UP", label: "▲", className: "arrow offset-left" }
  ],
  [
    { key: "ALPHA", label: "ALPHA", shift: "alpha", className: "modifier alpha" },
    { key: "X-VAR", label: "x-VAR", shift: "LINK", alpha: "x" },
    { key: "DEL", label: "DEL", shift: "INS" },
    { key: "LEFT", label: "◀", className: "arrow" },
    { key: "RIGHT", label: "▶", className: "arrow" }
  ],
  [
    { key: "GRAPH", label: "GRAPH", shift: "SOLVER" },
    { key: "STAT", label: "STAT", shift: "SIMULT" },
    { key: "PRGM", label: "PRGM", shift: "POLY" },
    { key: "CUSTOM", label: "CUSTOM", shift: "CATALOG" },
    { key: "CLEAR", label: "CLEAR", shift: "TOLER" }
  ],
  [
    { key: "LOG", label: "LOG", shift: "10^x", alpha: "A" },
    { key: "SIN", label: "SIN", shift: "SIN^-1", alpha: "B" },
    { key: "COS", label: "COS", shift: "COS^-1", alpha: "C" },
    { key: "TAN", label: "TAN", shift: "TAN^-1", alpha: "D" },
    { key: "^", label: "^", shift: "π", alpha: "E", className: "operator" }
  ],
  [
    { key: "LN", label: "LN", shift: "e^x", alpha: "F" },
    { key: "EE", label: "EE", shift: "x^-1", alpha: "G" },
    { key: "(", label: "(", shift: "[", alpha: "H" },
    { key: ")", label: ")", shift: "]", alpha: "I" },
    { key: "/", label: "÷", shift: "CALC", alpha: "J", className: "operator" }
  ],
  [
    { key: "X^2", label: "x²", shift: "√", alpha: "K" },
    { key: "7", label: "7", shift: "MATRX", alpha: "L", className: "number" },
    { key: "8", label: "8", shift: "VECTR", alpha: "M", className: "number" },
    { key: "9", label: "9", shift: "CPLX", alpha: "N", className: "number" },
    { key: "*", label: "×", shift: "MATH", alpha: "O", className: "operator" }
  ],
  [
    { key: ",", label: ",", shift: "∠", alpha: "P" },
    { key: "4", label: "4", shift: "CONS", alpha: "Q", className: "number" },
    { key: "5", label: "5", shift: "CONV", alpha: "R", className: "number" },
    { key: "6", label: "6", shift: "STRNG", alpha: "S", className: "number" },
    { key: "-", label: "-", shift: "LIST", alpha: "T", className: "operator" }
  ],
  [
    { key: "STO", label: "STO▶", shift: "RCL" },
    { key: "1", label: "1", shift: "BASE", alpha: "U", className: "number" },
    { key: "2", label: "2", shift: "TEST", alpha: "V", className: "number" },
    { key: "3", label: "3", shift: "VARS", alpha: "W", className: "number" },
    { key: "+", label: "+", shift: "MEM", alpha: "X", className: "operator" }
  ],
  [
    { key: "ON", label: "ON", shift: "OFF", className: "on" },
    { key: "0", label: "0", shift: "CHAR", alpha: "Y", className: "number" },
    { key: ".", label: ".", shift: ":", alpha: "Z", className: "number" },
    { key: "(-)", label: "(-)", shift: "ANS", className: "operator" },
    { key: "ENTER", label: "ENTER", shift: "ENTRY", className: "enter" }
  ]
];

function setControlsEnabled(enabled) {
  runPauseButton.disabled = !enabled;
  stepFrameButton.disabled = !enabled;
  stepInstructionButton.disabled = !enabled;
  resetButton.disabled = !enabled;
  keypadElement.querySelectorAll("button").forEach((button) => {
    button.disabled = !enabled;
  });
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

function pressTi85Key(key) {
  if (!machine) return;
  machine.pressKey(key);
  statusOutput.value = `${key} held`;
}

function releaseTi85Key(key) {
  if (!machine) return;
  machine.releaseKey(key);
  statusOutput.value = `${key} released`;
}

function bindTi85KeyButton(button, key) {
  let activePointerId = undefined;
  button.addEventListener("pointerdown", (event) => {
    event.preventDefault();
    activePointerId = event.pointerId;
    button.setPointerCapture?.(event.pointerId);
    pressTi85Key(key);
  });
  button.addEventListener("pointerup", (event) => {
    button.releasePointerCapture?.(event.pointerId);
    activePointerId = undefined;
    releaseTi85Key(key);
  });
  button.addEventListener("pointercancel", () => {
    activePointerId = undefined;
    releaseTi85Key(key);
  });
  button.addEventListener("pointerleave", () => {
    if (activePointerId !== undefined) return;
    releaseTi85Key(key);
  });
  button.addEventListener("keydown", (event) => {
    if (event.repeat || (event.key !== " " && event.key !== "Enter")) return;
    event.preventDefault();
    pressTi85Key(key);
  });
  button.addEventListener("keyup", (event) => {
    if (event.key !== " " && event.key !== "Enter") return;
    event.preventDefault();
    releaseTi85Key(key);
  });
}

function createTi85KeyButton(definition) {
  const button = document.createElement("button");
  button.type = "button";
  button.disabled = true;
  button.className = `ti85-key ${definition.className ?? ""}`.trim();
  button.setAttribute("data-ti85-key", definition.key);
  button.setAttribute("aria-label", definition.key);
  if (definition.key === "ON") button.id = "ti85On";

  const top = document.createElement("span");
  top.className = "ti85-key-top";
  const shift = document.createElement("span");
  shift.className = "ti85-key-shift";
  shift.textContent = definition.shift ?? "";
  const alpha = document.createElement("span");
  alpha.className = "ti85-key-alpha";
  alpha.textContent = definition.alpha ?? "";
  top.append(shift, alpha);

  const label = document.createElement("span");
  label.className = "ti85-key-label";
  label.textContent = definition.label;
  button.append(top, label);
  bindTi85KeyButton(button, definition.key);
  return button;
}

function renderTi85Keypad() {
  keypadElement.replaceChildren(...TI85_KEY_LAYOUT.map((row) => {
    const rowElement = document.createElement("div");
    rowElement.className = "ti85-key-row";
    rowElement.replaceChildren(...row.map(createTi85KeyButton));
    return rowElement;
  }));
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

romFileInput.addEventListener("change", async () => {
  const file = romFileInput.files?.[0];
  if (!file) return;
  mountRom(new Uint8Array(await file.arrayBuffer()), `Loaded ${file.name}`);
});

renderTi85Keypad();
loadDefaultRom();
