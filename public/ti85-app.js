import { Ti85Machine } from "../src/ti85.js";
import { TI85_KEY_LAYOUT } from "../src/ti85-keys.js";
import { isActiveFree85Rom } from "../src/rom-identity.js";
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
const calculatorFrame = document.querySelector(".ti85-frame");
const registerGrid = document.querySelector("#ti85RegisterGrid");
const flagGrid = document.querySelector("#ti85FlagGrid");
const disassemblyList = document.querySelector("#ti85Disassembly");
const machineState = document.querySelector("#ti85MachineState");
const keyboardState = document.querySelector("#ti85KeyboardState");
const displayState = document.querySelector("#ti85DisplayState");
const memoryInspector = document.querySelector("#ti85MemoryInspector");
const workspace = document.querySelector("#ti85Workspace");
const docsSection = document.querySelector("#ti85Docs");
const docReader = document.querySelector("#ti85DocReader");
const docReaderTitle = document.querySelector("#ti85DocReaderTitle");
const docFrame = document.querySelector("#ti85DocFrame");
const docNewTab = document.querySelector("#ti85DocNewTab");
const docCloseButton = document.querySelector("#ti85DocClose");
const docHandleButton = document.querySelector("#ti85DocHandle");

const DOCUMENTATION = {
  manual: {
    title: "Getting Started Manual",
    url: "./public/free85/Release_3.0/Free85-Manual-typeset.html"
  },
  guidebook: {
    title: "The Free85 Guidebook",
    url: "./public/free85/Release_3.0/Free85-Guidebook-typeset.html"
  },
  companion: {
    title: "Explorations with Free85",
    url: "./public/free85/Release_3.0/Free85-Companion-typeset.html"
  }
};
const compactDocReaderQuery = window.matchMedia("(max-width: 1100px)");

let machine;
let running = false;
let animationFrame = 0;
let romLoadSequence = 0;
let free85DocumentationActive = false;
let activeDocumentation = "manual";
const DEFAULT_ROM_CANDIDATES = [
  { url: new URL("../ROM/TI85.ROM", import.meta.url), message: "TI-85 ROM loaded" },
  { url: new URL("../ROM/FREE85.ROM", import.meta.url), message: "Free85 ROM loaded" }
];
const MISSING_ROM_MESSAGE = "Use your own 128K TI-85 ROM file";

function setFree85DocumentationVisible(visible) {
  free85DocumentationActive = visible;
  docsSection.hidden = !visible;
  document.body.classList.toggle("free85-rom-active", visible);
  if (!visible) deactivateDocumentation();
}

function deactivateDocumentation() {
  workspace.classList.remove("docs-open", "docs-parked");
  document.body.classList.remove("doc-reader-open");
  docReader.hidden = true;
  docReader.inert = true;
  docReader.setAttribute("aria-hidden", "true");
  docHandleButton.hidden = true;
  docHandleButton.setAttribute("aria-expanded", "false");
  docFrame.removeAttribute("src");
  delete docFrame.dataset.loadedBook;
  activeDocumentation = "manual";
  document.querySelectorAll("[data-doc-book]").forEach((button) => {
    button.setAttribute("aria-pressed", "false");
    button.setAttribute("aria-expanded", "false");
  });
}

function updateDocumentationCloseControl() {
  const compactReader = compactDocReaderQuery.matches;
  docCloseButton.textContent = compactReader ? "Hide" : "Close";
  docCloseButton.setAttribute("aria-label", compactReader ? "Slide documentation aside" : "Close documentation");
}

function openDocumentation(book) {
  if (!free85DocumentationActive) return;
  const entry = DOCUMENTATION[book];
  if (!entry) return;

  activeDocumentation = book;
  docReader.hidden = false;
  docReader.inert = false;
  docReader.removeAttribute("aria-hidden");
  workspace.classList.add("docs-open");
  workspace.classList.remove("docs-parked");
  document.body.classList.add("doc-reader-open");
  docHandleButton.hidden = true;
  docHandleButton.setAttribute("aria-expanded", "true");
  updateDocumentationCloseControl();
  if (!compactDocReaderQuery.matches) workspace.scrollIntoView({ block: "start" });
  docReaderTitle.textContent = entry.title;
  docFrame.title = entry.title;
  docNewTab.href = entry.url;
  if (docFrame.dataset.loadedBook !== book) {
    docFrame.src = `${entry.url}?embed=1`;
    docFrame.dataset.loadedBook = book;
  }
  document.querySelectorAll("[data-doc-book]").forEach((button) => {
    const selected = button.dataset.docBook === book;
    button.setAttribute("aria-pressed", String(selected));
    button.setAttribute("aria-expanded", String(selected));
  });
}

function closeDocumentation() {
  workspace.classList.remove("docs-open");
  document.body.classList.remove("doc-reader-open");
  const compactReader = compactDocReaderQuery.matches;
  if (compactReader) {
    workspace.classList.add("docs-parked");
    docReader.inert = true;
    docReader.setAttribute("aria-hidden", "true");
    docHandleButton.hidden = false;
    docHandleButton.setAttribute("aria-expanded", "false");
  } else {
    docReader.hidden = true;
    workspace.classList.remove("docs-parked");
    docHandleButton.hidden = true;
    docHandleButton.setAttribute("aria-expanded", "false");
  }
  document.querySelectorAll("[data-doc-book]").forEach((button) => {
    button.setAttribute("aria-expanded", "false");
  });
  document.querySelectorAll(".ti85-doc-actions [data-doc-book]").forEach((button) => {
    button.setAttribute("aria-pressed", "false");
  });
  if (compactReader) {
    calculatorFrame.scrollIntoView({ block: "start" });
    docHandleButton.focus({ preventScroll: true });
  } else {
    canvas.focus();
  }
}

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
  keypadElement.querySelectorAll("button").forEach((button) => {
    button.disabled = !enabled;
  });
}

async function loadDefaultRom() {
  for (const candidate of DEFAULT_ROM_CANDIDATES) {
    try {
      const response = await fetch(candidate.url);
      if (!response.ok) continue;
      await mountRom(new Uint8Array(await response.arrayBuffer()), candidate.message);
      return;
    } catch {
      // Keep trying later public ROM candidates before falling back to upload.
    }
  }
  statusOutput.value = MISSING_ROM_MESSAGE;
  setControlsEnabled(false);
  drawUnavailableScreen();
}

async function mountRom(bytes, message) {
  const loadSequence = ++romLoadSequence;
  setFree85DocumentationVisible(false);
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
    return;
  }

  try {
    const isFree85 = await isActiveFree85Rom(bytes);
    if (loadSequence === romLoadSequence) setFree85DocumentationVisible(isFree85);
  } catch {
    if (loadSequence === romLoadSequence) setFree85DocumentationVisible(false);
  }
}

function drawUnavailableScreen() {
  context.fillStyle = "#aecdb0";
  context.fillRect(0, 0, canvas.width, canvas.height);
  context.fillStyle = "#2f413a";
  context.font = "8px monospace";
  context.fillText("USE YOUR OWN", 22, 29);
  context.fillText("TI-85 ROM FILE", 18, 39);
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
  await mountRom(new Uint8Array(await file.arrayBuffer()), `Loaded ${file.name}`);
});

document.querySelectorAll("[data-doc-book]").forEach((button) => {
  button.addEventListener("click", () => openDocumentation(button.dataset.docBook));
});
docCloseButton.addEventListener("click", () => closeDocumentation());
docHandleButton.addEventListener("click", () => openDocumentation(activeDocumentation));
compactDocReaderQuery.addEventListener("change", () => {
  if (workspace.classList.contains("docs-open")) updateDocumentationCloseControl();
});
document.addEventListener("keydown", (event) => {
  if (event.key === "Escape" && workspace.classList.contains("docs-open")) closeDocumentation();
});

renderTi85Keypad();
loadDefaultRom();
