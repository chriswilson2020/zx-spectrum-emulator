import { RawCpmDisk } from "../src/cpm-disk.js";
import { CpmFileSystem, detectCpmDiskGeometry, normalizeCpmName } from "../src/cpm-filesystem.js";
import { Cpm22Machine } from "../src/cpm22.js";
import { RawZ80Mbc2Disk, Z80Mbc2Machine } from "../src/z80mbc2.js";
import { CpmTerminal, keyEventToCpmInput } from "./cpm-terminal.js";

const terminalElement = document.querySelector("#cpmTerminal");
const statusOutput = document.querySelector("#cpmStatus");
const machineProfileSelect = document.querySelector("#cpmMachineProfile");
const resetButton = document.querySelector("#cpmReset");
const loadDiskButton = document.querySelector("#cpmLoadDisk");
const saveDiskButton = document.querySelector("#cpmSaveDisk");
const diskFileInput = document.querySelector("#cpmDiskFile");
const diskDriveSelect = document.querySelector("#cpmDiskDrive");
const refreshFilesButton = document.querySelector("#cpmRefreshFiles");
const fileDriveSelect = document.querySelector("#cpmFileDrive");
const fileList = document.querySelector("#cpmFileList");
const importFileButton = document.querySelector("#cpmImportFile");
const downloadFileButton = document.querySelector("#cpmDownloadFile");
const deleteFileButton = document.querySelector("#cpmDeleteFile");
const hostFileInput = document.querySelector("#cpmHostFile");
const loadForeignDiskButton = document.querySelector("#cpmLoadForeignDisk");
const foreignDiskFileInput = document.querySelector("#cpmForeignDiskFile");
const foreignFileList = document.querySelector("#cpmForeignFileList");
const copyForeignFilesButton = document.querySelector("#cpmCopyForeignFiles");
const copyAllForeignFilesButton = document.querySelector("#cpmCopyAllForeignFiles");
const clearForeignDiskButton = document.querySelector("#cpmClearForeignDisk");

const terminal = new CpmTerminal(terminalElement);
let mountedDisks;
let machine;
let running = false;
let foreignFileSystem;
let foreignDiskName = "";
let activeProfile;

const profiles = {
  z80pack: {
    id: "z80pack",
    label: "z80pack",
    paths: ["../ROM/cpm22-1.dsk", null, "../ROM/cpm22-2.dsk"],
    driveLabels: ["A: System Disk", "B: Work Disk", "C: Companion Disk"],
    fileDriveLabels: ["A: System", "B: Work", "C: Companion"],
    async defaultDriveImages() {
      return [
        await loadDiskAsset("../ROM/cpm22-1.dsk"),
        RawCpmDisk.blankZ80simFloppy().toBytes(),
        await loadDiskAsset("../ROM/cpm22-2.dsk")
      ];
    },
    createDisk(bytes) {
      return RawCpmDisk.z80simFloppy(bytes);
    },
    createMachine(drives) {
      return new Cpm22Machine({ drives });
    },
    createFileSystem(disk) {
      return new CpmFileSystem(disk);
    },
    diskName(driveIndex) {
      return `cpm22-drive-${String.fromCharCode(97 + driveIndex)}.dsk`;
    }
  },
  z80mbc2: {
    id: "z80mbc2",
    label: "Z80-MBC2",
    driveLabels: ["A: DS0N00", "B: DS0N01", "C: DS0N02", "D: DS0N03", "E: DS0N04", "F: DS0N05", "G: DS0N06"],
    fileDriveLabels: ["A: DS0N00", "B: DS0N01", "C: DS0N02", "D: DS0N03", "E: DS0N04", "F: DS0N05", "G: DS0N06"],
    async defaultDriveImages() {
      return Promise.all([
        loadDiskAsset("../ROM/DS0N00.DSK"),
        loadDiskAsset("../ROM/DS0N01.DSK"),
        loadDiskAsset("../ROM/DS0N02.DSK"),
        loadDiskAsset("../ROM/DS0N03.DSK"),
        loadDiskAsset("../ROM/DS0N04.DSK"),
        loadDiskAsset("../ROM/DS0N05.DSK"),
        loadDiskAsset("../ROM/DS0N06.DSK")
      ]);
    },
    createDisk(bytes) {
      return RawZ80Mbc2Disk.fromImage(bytes);
    },
    createMachine(drives) {
      return new Z80Mbc2Machine({ drives });
    },
    createFileSystem(disk, driveIndex) {
      return new CpmFileSystem(disk, { geometry: driveIndex === 0 ? "z80mbc2-d0" : "z80mbc2-d1" });
    },
    diskName(driveIndex) {
      return `DS0N0${driveIndex}.DSK`;
    }
  }
};

async function loadDiskAsset(path) {
  const response = await fetch(new URL(path, import.meta.url));
  if (!response.ok) throw new Error(`CP/M disk load failed: ${response.status}`);
  return new Uint8Array(await response.arrayBuffer());
}

function createMachine(driveImages = mountedDisks?.map((disk) => disk.toBytes())) {
  mountedDisks = driveImages.map((bytes) => activeProfile.createDisk(bytes));
  mountedDisks.forEach((disk, driveIndex) => activeProfile.createFileSystem(disk, driveIndex).repairFullExtentRecordCounts());
  return activeProfile.createMachine(mountedDisks);
}

function resetMachine(driveImages = mountedDisks.map((disk) => disk.toBytes())) {
  machine = createMachine(driveImages);
  terminal.clear();
  refreshFileList();
  running = true;
  statusOutput.value = "Booting";
  terminalElement.focus();
}

async function switchProfile(profileId) {
  activeProfile = profiles[profileId];
  machineProfileSelect.value = profileId;
  statusOutput.value = `Loading ${activeProfile.label}`;
  running = false;
  setDriveOptions(diskDriveSelect, activeProfile.driveLabels);
  setDriveOptions(fileDriveSelect, activeProfile.fileDriveLabels);
  resetMachine(await activeProfile.defaultDriveImages());
}

function setDriveOptions(select, labels) {
  const preferred = Math.min(Number.parseInt(select.value, 10) || 1, labels.length - 1);
  select.replaceChildren(
    ...labels.map((label, index) => {
      const option = document.createElement("option");
      option.value = String(index);
      option.textContent = label;
      return option;
    })
  );
  select.value = String(preferred);
}

function hasDirtyDisks() {
  return mountedDisks?.some((disk) => disk.dirty) ?? false;
}

function currentFileSystem() {
  return activeProfile.createFileSystem(selectedFileDisk(), selectedDiskIndex(fileDriveSelect));
}

function refreshFileList() {
  if (!mountedDisks) return;
  const selected = fileList.value;
  const files = currentFileSystem().listFiles();
  fileList.replaceChildren(
    ...files.map((file) => {
      const option = document.createElement("option");
      option.value = file.name;
      option.textContent = `${file.name.padEnd(12, " ")} ${file.size.toString().padStart(6, " ")} bytes`;
      return option;
    })
  );
  if (selected && [...fileList.options].some((option) => option.value === selected)) {
    fileList.value = selected;
  } else if (fileList.options.length > 0) {
    fileList.selectedIndex = 0;
  }
}

function refreshForeignFileList() {
  const files = foreignFileSystem?.listFiles() ?? [];
  foreignFileList.replaceChildren(
    ...files.map((file) => {
      const option = document.createElement("option");
      option.value = file.name;
      option.textContent = `${file.name.padEnd(12, " ")} ${file.size.toString().padStart(7, " ")} bytes`;
      return option;
    })
  );
}

function selectedFileName() {
  return fileList.value || "";
}

function hostFileNameToCpmName(name) {
  const cleaned = String(name)
    .trim()
    .toUpperCase()
    .replace(/[^A-Z0-9_$~!#%&'()@^`{}.-]+/g, "");
  const lastDot = cleaned.lastIndexOf(".");
  const baseSource = lastDot > 0 ? cleaned.slice(0, lastDot) : cleaned;
  const extensionSource = lastDot > 0 ? cleaned.slice(lastDot + 1) : "";
  const base = baseSource.replace(/\./g, "").slice(0, 8) || "HOSTFILE";
  const extension = extensionSource.replace(/\./g, "").slice(0, 3);
  return normalizeCpmName(extension ? `${base}.${extension}` : base);
}

function selectedDiskIndex(select) {
  return Number.parseInt(select.value, 10) || 0;
}

function selectedDiskImageDisk() {
  return mountedDisks[selectedDiskIndex(diskDriveSelect)];
}

function selectedFileDisk() {
  return mountedDisks[selectedDiskIndex(fileDriveSelect)];
}

function remountMachine() {
  resetMachine(mountedDisks.map((disk) => disk.toBytes()));
}

function runSlice() {
  if (!running || !machine) return;

  const start = performance.now();
  let instructions = 0;
  while (performance.now() - start < 8 && instructions < 20_000 && !machine.halted) {
    machine.step();
    instructions += 1;
  }

  const output = machine.drainOutput();
  if (output) {
    terminal.write(output);
    if (output.includes("A>")) statusOutput.value = "Ready";
  }

  if (machine.halted) {
    running = false;
    statusOutput.value = "Halted";
  }
}

function frame() {
  runSlice();
  requestAnimationFrame(frame);
}

terminalElement.addEventListener("keydown", (event) => {
  if (!machine || machine.halted) return;
  const input = keyEventToCpmInput(event);
  if (!input) return;
  event.preventDefault();
  machine.queueInput(input);
});

terminalElement.addEventListener("pointerdown", () => {
  terminalElement.focus();
});

resetButton.addEventListener("click", () => resetMachine());

machineProfileSelect.addEventListener("change", async () => {
  if (hasDirtyDisks() && !confirm("Current CP/M disks have unsaved changes. Switch machine profile anyway?")) {
    machineProfileSelect.value = activeProfile.id;
    return;
  }
  await switchProfile(machineProfileSelect.value);
});

loadDiskButton.addEventListener("click", () => {
  diskFileInput.click();
});

saveDiskButton.addEventListener("click", () => {
  const disk = selectedDiskImageDisk();
  if (!disk) return;
  const driveIndex = selectedDiskIndex(diskDriveSelect);
  const driveName = String.fromCharCode(65 + driveIndex);
  downloadBytes(disk.toBytes(), activeProfile.diskName(driveIndex));
  statusOutput.value = disk.dirty ? `Downloaded ${driveName}: dirty disk` : `Downloaded ${driveName}: disk`;
});

diskFileInput.addEventListener("change", async () => {
  const file = diskFileInput.files?.[0];
  diskFileInput.value = "";
  if (!file) return;

  try {
    const bytes = new Uint8Array(await file.arrayBuffer());
    activeProfile.createDisk(bytes);
    const drive = selectedDiskIndex(diskDriveSelect);
    const driveImages = mountedDisks.map((disk, index) => (index === drive ? bytes : disk.toBytes()));
    resetMachine(driveImages);
    refreshFileList();
    statusOutput.value = `Loaded ${file.name} into ${String.fromCharCode(65 + drive)}:`;
  } catch (error) {
    statusOutput.value = "Disk rejected";
    terminal.write(`\nDisk load error: ${error.message}\n`);
  }
});

refreshFilesButton.addEventListener("click", refreshFileList);
fileDriveSelect.addEventListener("change", refreshFileList);

importFileButton.addEventListener("click", () => {
  hostFileInput.click();
});

hostFileInput.addEventListener("change", async () => {
  const file = hostFileInput.files?.[0];
  hostFileInput.value = "";
  if (!file || !mountedDisks) return;

  try {
    const name = hostFileNameToCpmName(file.name);
    currentFileSystem().writeFile(name, new Uint8Array(await file.arrayBuffer()));
    const drive = selectedDiskIndex(fileDriveSelect);
    remountMachine();
    statusOutput.value = `Imported ${name} to ${String.fromCharCode(65 + drive)}:`;
  } catch (error) {
    statusOutput.value = "Import rejected";
    terminal.write(`\nFile import error: ${error.message}\n`);
  }
});

downloadFileButton.addEventListener("click", () => {
  const name = selectedFileName();
  if (!name || !mountedDisks) return;

  try {
    downloadBytes(currentFileSystem().readFile(name, { trimCtrlZ: true }), name.toLowerCase());
    statusOutput.value = `Downloaded ${name}`;
  } catch (error) {
    statusOutput.value = "Download failed";
    terminal.write(`\nFile download error: ${error.message}\n`);
  }
});

deleteFileButton.addEventListener("click", () => {
  const name = selectedFileName();
  if (!name || !mountedDisks) return;
  if (currentFileSystem().deleteFile(name)) {
    remountMachine();
    statusOutput.value = `Deleted ${name}`;
  }
});

loadForeignDiskButton.addEventListener("click", () => {
  foreignDiskFileInput.click();
});

foreignDiskFileInput.addEventListener("change", async () => {
  const file = foreignDiskFileInput.files?.[0];
  foreignDiskFileInput.value = "";
  if (!file) return;

  try {
    const bytes = new Uint8Array(await file.arrayBuffer());
    const geometry = detectCpmDiskGeometry(bytes, file.name);
    foreignFileSystem = new CpmFileSystem({ bytes, dirty: false }, { geometry });
    foreignDiskName = file.name;
    refreshForeignFileList();
    statusOutput.value = `Loaded ${geometry.label}: ${file.name}`;
  } catch (error) {
    foreignFileSystem = undefined;
    foreignDiskName = "";
    refreshForeignFileList();
    statusOutput.value = "Foreign disk rejected";
    terminal.write(`\nForeign disk load error: ${error.message}\n`);
  }
});

copyForeignFilesButton.addEventListener("click", () => {
  copyForeignFiles([...foreignFileList.selectedOptions].map((option) => option.value));
});

copyAllForeignFilesButton.addEventListener("click", () => {
  copyForeignFiles([...foreignFileList.options].map((option) => option.value));
});

clearForeignDiskButton.addEventListener("click", () => {
  foreignFileSystem = undefined;
  foreignDiskName = "";
  refreshForeignFileList();
  statusOutput.value = "Foreign disk cleared";
});

function copyForeignFiles(names) {
  if (!foreignFileSystem || names.length === 0) return;

  try {
    const target = currentFileSystem();
    for (const name of names) target.writeFile(name, foreignFileSystem.readFile(name));
    const drive = selectedDiskIndex(fileDriveSelect);
    remountMachine();
    statusOutput.value = `Copied ${names.length} file${names.length === 1 ? "" : "s"} from ${foreignDiskName} to ${String.fromCharCode(65 + drive)}:`;
  } catch (error) {
    statusOutput.value = "Foreign copy failed";
    terminal.write(`\nForeign disk copy error: ${error.message}\n`);
  }
}

function downloadBytes(bytes, filename) {
  const blob = new Blob([bytes], { type: "application/octet-stream" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  link.click();
  URL.revokeObjectURL(url);
}

async function main() {
  await switchProfile("z80pack");
  requestAnimationFrame(frame);
}

main().catch((error) => {
  running = false;
  statusOutput.value = "Error";
  terminal.write(`CP/M error: ${error.message}\n`);
});
