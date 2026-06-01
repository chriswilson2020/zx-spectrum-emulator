import { RawCpmDisk } from "../src/cpm-disk.js";
import { CpmFileSystem, detectCpmDiskGeometry, normalizeCpmName } from "../src/cpm-filesystem.js";
import { Cpm22Machine } from "../src/cpm22.js";
import { RawZ80Mbc2Disk, Z80Mbc2Machine } from "../src/z80mbc2.js";
import { createZip, jsonBytes, parseJsonBytes, readZip } from "./cpm-session.js";
import { CpmTerminal, keyEventToCpmInput } from "./cpm-terminal.js";

const terminalElement = document.querySelector("#cpmTerminal");
const statusOutput = document.querySelector("#cpmStatus");
const machineProfileSelect = document.querySelector("#cpmMachineProfile");
const resetButton = document.querySelector("#cpmReset");
const loadDiskButton = document.querySelector("#cpmLoadDisk");
const saveDiskButton = document.querySelector("#cpmSaveDisk");
const restoreDiskButton = document.querySelector("#cpmRestoreDisk");
const clearLocalDisksButton = document.querySelector("#cpmClearLocalDisks");
const saveSessionButton = document.querySelector("#cpmSaveSession");
const loadSessionButton = document.querySelector("#cpmLoadSession");
const diskFileInput = document.querySelector("#cpmDiskFile");
const sessionFileInput = document.querySelector("#cpmSessionFile");
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
const LOCAL_DISK_DB = "z80-machine-lab-cpm-disks";
const LOCAL_DISK_STORE = "disk-images";
const LOCAL_DISK_VERSION = 1;
const SESSION_FORMAT = "z80lab-cpm-session";
const SESSION_VERSION = 1;
let mountedDisks;
let machine;
let running = false;
let foreignFileSystem;
let foreignDiskName = "";
let activeProfile;
let activeBundledDriveImages = [];
let localDiskOverrides = new Set();
const localSaveTimers = new Map();

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
    driveLabels: ["A: DS0N00", "B: DS0N01", "C: DS0N02", "D: DS0N03", "E: DS0N04", "F: DS0N05 Work", "G: DS0N06 Scratch"],
    fileDriveLabels: ["A: DS0N00", "B: DS0N01", "C: DS0N02", "D: DS0N03", "E: DS0N04", "F: DS0N05 Work", "G: DS0N06 Scratch"],
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
    },
    autoPersistDrive(driveIndex) {
      return driveIndex >= 5;
    },
    defaultSelectedDrive: 5
  }
};

function openLocalDiskDb() {
  if (!("indexedDB" in globalThis)) return Promise.resolve(undefined);

  return new Promise((resolve, reject) => {
    const request = indexedDB.open(LOCAL_DISK_DB, LOCAL_DISK_VERSION);
    request.onupgradeneeded = () => {
      request.result.createObjectStore(LOCAL_DISK_STORE, { keyPath: "key" });
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

async function withLocalDiskStore(mode, callback) {
  const db = await openLocalDiskDb();
  if (!db) return undefined;

  return new Promise((resolve, reject) => {
    const transaction = db.transaction(LOCAL_DISK_STORE, mode);
    const store = transaction.objectStore(LOCAL_DISK_STORE);
    const result = callback(store);
    transaction.oncomplete = () => {
      db.close();
      resolve(result);
    };
    transaction.onerror = () => {
      db.close();
      reject(transaction.error);
    };
  });
}

function localDiskKey(profileId, driveIndex) {
  return `${profileId}:${driveIndex}`;
}

function readStoreRecord(store, key) {
  return new Promise((resolve, reject) => {
    const request = store.get(key);
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

async function loadLocalDisk(profileId, driveIndex) {
  return withLocalDiskStore("readonly", async (store) => {
    const record = await readStoreRecord(store, localDiskKey(profileId, driveIndex));
    return record?.bytes ? new Uint8Array(record.bytes) : undefined;
  });
}

async function saveLocalDisk(profileId, driveIndex, bytes) {
  await withLocalDiskStore("readwrite", (store) => {
    store.put({ key: localDiskKey(profileId, driveIndex), profileId, driveIndex, bytes: Uint8Array.from(bytes), savedAt: Date.now() });
  });
}

async function deleteLocalDisk(profileId, driveIndex) {
  await withLocalDiskStore("readwrite", (store) => {
    store.delete(localDiskKey(profileId, driveIndex));
  });
}

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
  clearLocalSaveTimers();
  activeProfile = profiles[profileId];
  machineProfileSelect.value = profileId;
  statusOutput.value = `Loading ${activeProfile.label}`;
  running = false;
  diskDriveSelect.dataset.preferProfileDefault = "true";
  fileDriveSelect.dataset.preferProfileDefault = "true";
  setDriveOptions(diskDriveSelect, activeProfile.driveLabels);
  setDriveOptions(fileDriveSelect, activeProfile.fileDriveLabels);
  activeBundledDriveImages = await activeProfile.defaultDriveImages();
  localDiskOverrides = new Set();
  const driveImages = [];
  for (let driveIndex = 0; driveIndex < activeBundledDriveImages.length; driveIndex += 1) {
    const local = await loadLocalDisk(activeProfile.id, driveIndex);
    driveImages.push(local ?? activeBundledDriveImages[driveIndex]);
    if (local) localDiskOverrides.add(driveIndex);
  }
  resetMachine(driveImages);
  refreshDriveLabels();
}

function setDriveOptions(select, labels) {
  const preferredSource = select.dataset.preferProfileDefault === "true" ? activeProfile.defaultSelectedDrive : Number.parseInt(select.value, 10);
  const preferred = Math.min(preferredSource ?? 1, labels.length - 1);
  delete select.dataset.preferProfileDefault;
  select.replaceChildren(
    ...labels.map((label, index) => {
      const option = document.createElement("option");
      option.value = String(index);
      option.textContent = label;
      return option;
    })
  );
  select.value = String(preferred);
  refreshDriveLabels();
}

function driveLabel(label, driveIndex) {
  return localDiskOverrides.has(driveIndex) ? `${label} local` : label;
}

function refreshDriveLabels() {
  if (!activeProfile) return;
  for (const [index, label] of activeProfile.driveLabels.entries()) {
    if (diskDriveSelect.options[index]) diskDriveSelect.options[index].textContent = driveLabel(label, index);
  }
  for (const [index, label] of activeProfile.fileDriveLabels.entries()) {
    if (fileDriveSelect.options[index]) fileDriveSelect.options[index].textContent = driveLabel(label, index);
  }
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

function selectedDiskLetter(driveIndex) {
  return String.fromCharCode(65 + driveIndex);
}

function clearLocalSaveTimers() {
  for (const timer of localSaveTimers.values()) clearTimeout(timer);
  localSaveTimers.clear();
}

async function persistDriveIfUseful(driveIndex, { force = false } = {}) {
  if (!mountedDisks?.[driveIndex]) return;
  if (!force && !activeProfile.autoPersistDrive?.(driveIndex)) return;
  await saveLocalDisk(activeProfile.id, driveIndex, mountedDisks[driveIndex].toBytes());
  mountedDisks[driveIndex].dirty = false;
  localDiskOverrides.add(driveIndex);
  refreshDriveLabels();
}

function schedulePersistDrive(driveIndex, options) {
  if (localSaveTimers.has(driveIndex)) return;
  const timer = setTimeout(() => {
    localSaveTimers.delete(driveIndex);
    persistDriveIfUseful(driveIndex, options).catch((error) => {
      statusOutput.value = "Local save failed";
      terminal.write(`\nLocal disk save error: ${error.message}\n`);
    });
  }, 250);
  localSaveTimers.set(driveIndex, timer);
}

function scheduleDirtyDiskPersistence() {
  if (!mountedDisks || !activeProfile.autoPersistDrive) return;
  mountedDisks.forEach((disk, driveIndex) => {
    if (disk.dirty && activeProfile.autoPersistDrive(driveIndex)) schedulePersistDrive(driveIndex);
  });
}

function remountMachine() {
  resetMachine(mountedDisks.map((disk) => disk.toBytes()));
}

function sessionTimestamp() {
  return new Date().toISOString().replace(/[-:]/g, "").replace(/\..+$/, "Z");
}

function drivePath(driveIndex) {
  return `drives/${selectedDiskLetter(driveIndex)}.dsk`;
}

function makeSessionManifest() {
  return {
    format: SESSION_FORMAT,
    version: SESSION_VERSION,
    createdAt: new Date().toISOString(),
    profile: activeProfile.id,
    selectedDiskDrive: selectedDiskIndex(diskDriveSelect),
    selectedFileDrive: selectedDiskIndex(fileDriveSelect),
    localDiskOverrides: [...localDiskOverrides],
    drives: mountedDisks.map((_, driveIndex) => ({
      index: driveIndex,
      letter: selectedDiskLetter(driveIndex),
      name: activeProfile.diskName(driveIndex),
      path: drivePath(driveIndex)
    }))
  };
}

function requireSessionEntry(entries, path) {
  const bytes = entries.get(path);
  if (!bytes) throw new Error(`Session is missing ${path}`);
  return bytes;
}

async function saveSession() {
  if (!machine || !mountedDisks) return;
  const manifest = makeSessionManifest();
  const entries = [
    { name: "manifest.json", bytes: jsonBytes(manifest) },
    { name: "machine/state.json", bytes: jsonBytes(machine.saveState()) },
    { name: "machine/ram.bin", bytes: machine.memory.bytes },
    { name: "terminal.json", bytes: jsonBytes(terminal.saveState()) },
    ...mountedDisks.map((disk, driveIndex) => ({ name: drivePath(driveIndex), bytes: disk.toBytes() }))
  ];
  const zip = await createZip(entries);
  downloadBytes(zip, `cpm-session-${activeProfile.id}-${sessionTimestamp()}.zip`);
  statusOutput.value = `Saved ${activeProfile.label} session`;
}

async function loadSession(bytes) {
  const entries = await readZip(bytes);
  const manifestBytes = entries.get("manifest.json");
  if (!manifestBytes) throw new Error("Session is missing manifest.json");
  const manifest = parseJsonBytes(manifestBytes);
  if (manifest.format !== SESSION_FORMAT || manifest.version !== SESSION_VERSION) throw new Error("Unsupported CP/M session format");
  if (!profiles[manifest.profile]) throw new Error(`Unknown CP/M profile ${manifest.profile}`);
  if (!Array.isArray(manifest.drives) || manifest.drives.length === 0) throw new Error("Session manifest does not list any drives");

  await switchProfile(manifest.profile);
  const driveImages = manifest.drives.map((drive) => {
    return requireSessionEntry(entries, drive.path);
  });
  resetMachine(driveImages);
  const ram = requireSessionEntry(entries, "machine/ram.bin");
  const machineState = parseJsonBytes(requireSessionEntry(entries, "machine/state.json"));
  if (!ram || ram.length !== machine.memory.bytes.length) throw new Error("Session RAM image has the wrong size");
  machine.memory.bytes.set(ram);
  machine.restoreState(machineState);
  const terminalState = entries.get("terminal.json");
  if (terminalState) terminal.restoreState(parseJsonBytes(terminalState));
  localDiskOverrides = new Set(manifest.localDiskOverrides ?? []);
  diskDriveSelect.value = String(manifest.selectedDiskDrive ?? activeProfile.defaultSelectedDrive ?? 1);
  fileDriveSelect.value = String(manifest.selectedFileDrive ?? activeProfile.defaultSelectedDrive ?? 1);
  refreshDriveLabels();
  refreshFileList();
  running = !machine.halted;
  statusOutput.value = `Loaded ${activeProfile.label} session`;
  terminalElement.focus();
}

function runSlice() {
  if (!running || !machine) return;

  const start = performance.now();
  let instructions = 0;
  while (performance.now() - start < 8 && instructions < 20_000 && !machine.halted) {
    machine.step();
    instructions += 1;
  }
  scheduleDirtyDiskPersistence();

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
  const driveName = selectedDiskLetter(driveIndex);
  downloadBytes(disk.toBytes(), activeProfile.diskName(driveIndex));
  statusOutput.value = disk.dirty ? `Downloaded ${driveName}: dirty disk` : `Downloaded ${driveName}: disk`;
});

restoreDiskButton.addEventListener("click", async () => {
  const driveIndex = selectedDiskIndex(diskDriveSelect);
  if (!activeBundledDriveImages[driveIndex]) return;
  const timer = localSaveTimers.get(driveIndex);
  if (timer) clearTimeout(timer);
  localSaveTimers.delete(driveIndex);

  try {
    await deleteLocalDisk(activeProfile.id, driveIndex);
    localDiskOverrides.delete(driveIndex);
    const driveImages = mountedDisks.map((disk, index) => (index === driveIndex ? activeBundledDriveImages[index] : disk.toBytes()));
    resetMachine(driveImages);
    refreshDriveLabels();
    statusOutput.value = `Restored bundled ${selectedDiskLetter(driveIndex)}:`;
  } catch (error) {
    statusOutput.value = "Restore failed";
    terminal.write(`\nRestore bundled disk error: ${error.message}\n`);
  }
});

clearLocalDisksButton.addEventListener("click", async () => {
  if (!activeProfile || localDiskOverrides.size === 0) return;
  if (!confirm(`Clear local CP/M disk changes for ${activeProfile.label}?`)) return;
  clearLocalSaveTimers();

  try {
    await Promise.all([...localDiskOverrides].map((driveIndex) => deleteLocalDisk(activeProfile.id, driveIndex)));
    localDiskOverrides.clear();
    resetMachine(activeBundledDriveImages);
    refreshDriveLabels();
    statusOutput.value = "Local CP/M disks cleared";
  } catch (error) {
    statusOutput.value = "Clear local failed";
    terminal.write(`\nClear local disk error: ${error.message}\n`);
  }
});

saveSessionButton.addEventListener("click", () => {
  saveSession().catch((error) => {
    statusOutput.value = "Session save failed";
    terminal.write(`\nSession save error: ${error.message}\n`);
  });
});

loadSessionButton.addEventListener("click", () => {
  sessionFileInput.click();
});

sessionFileInput.addEventListener("change", async () => {
  const file = sessionFileInput.files?.[0];
  sessionFileInput.value = "";
  if (!file) return;

  try {
    await loadSession(new Uint8Array(await file.arrayBuffer()));
  } catch (error) {
    statusOutput.value = "Session load failed";
    terminal.write(`\nSession load error: ${error.message}\n`);
  }
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
    await persistDriveIfUseful(drive, { force: true });
    refreshFileList();
    statusOutput.value = `Loaded ${file.name} into ${selectedDiskLetter(drive)}: local`;
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
    schedulePersistDrive(drive);
    statusOutput.value = `Imported ${name} to ${selectedDiskLetter(drive)}:${activeProfile.autoPersistDrive?.(drive) ? " local" : ""}`;
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
    const drive = selectedDiskIndex(fileDriveSelect);
    remountMachine();
    schedulePersistDrive(drive);
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
    schedulePersistDrive(drive);
    statusOutput.value = `Copied ${names.length} file${names.length === 1 ? "" : "s"} from ${foreignDiskName} to ${selectedDiskLetter(drive)}:${activeProfile.autoPersistDrive?.(drive) ? " local" : ""}`;
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
