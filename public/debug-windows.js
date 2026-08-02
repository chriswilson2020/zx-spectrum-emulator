const STORAGE_KEY = "zx-spectrum-debug-windows-v1";

function loadLayout() {
  try {
    return JSON.parse(localStorage.getItem(STORAGE_KEY) || "{}");
  } catch {
    return {};
  }
}

function saveLayout(layout) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(layout));
  } catch {
    // Private browsing and embedded contexts may disable persistent storage.
  }
}

function copyPanel(panel) {
  const clone = panel.cloneNode(true);
  clone.classList.remove("floating-debug-window");
  clone.querySelectorAll(".window-tools, input, button").forEach((node) => node.remove());
  const sourceCanvases = panel.querySelectorAll("canvas");
  clone.querySelectorAll("canvas").forEach((canvas, index) => {
    const image = document.createElement("img");
    image.alt = sourceCanvases[index]?.getAttribute("aria-label") || "Emulated display";
    image.src = sourceCanvases[index]?.toDataURL() || "";
    image.style.maxWidth = "100%";
    canvas.replaceWith(image);
  });
  return clone;
}

export function initializeDebugWindows({ onStatus = () => {} } = {}) {
  const layout = loadLayout();
  const popouts = new Map();
  const panels = Array.from(document.querySelectorAll("[data-window-id]"));

  function persist(panel) {
    const id = panel.dataset.windowId;
    layout[id] = {
      floating: panel.classList.contains("floating-debug-window"),
      left: panel.style.left,
      top: panel.style.top,
      width: panel.style.width,
      height: panel.style.height
    };
    saveLayout(layout);
  }

  function setFloating(panel, floating) {
    panel.classList.toggle("floating-debug-window", floating);
    const button = panel.querySelector("[data-window-float]");
    if (button) button.textContent = floating ? "Dock" : "Float";
    if (floating && !panel.style.left) {
      const rect = panel.getBoundingClientRect();
      panel.style.left = `${Math.max(8, rect.left)}px`;
      panel.style.top = `${Math.max(8, rect.top)}px`;
      panel.style.width = `${rect.width}px`;
      panel.style.height = `${rect.height}px`;
    }
    persist(panel);
  }

  for (const panel of panels) {
    const id = panel.dataset.windowId;
    const saved = layout[id];
    if (saved) {
      panel.style.left = saved.left || "";
      panel.style.top = saved.top || "";
      panel.style.width = saved.width || "";
      panel.style.height = saved.height || "";
      panel.classList.toggle("floating-debug-window", Boolean(saved.floating));
    }

    const tools = document.createElement("div");
    tools.className = "window-tools";
    const floatButton = document.createElement("button");
    floatButton.type = "button";
    floatButton.dataset.windowFloat = "";
    floatButton.textContent = saved?.floating ? "Dock" : "Float";
    floatButton.addEventListener("click", () => setFloating(panel, !panel.classList.contains("floating-debug-window")));
    const popoutButton = document.createElement("button");
    popoutButton.type = "button";
    popoutButton.textContent = "Pop out";
    popoutButton.addEventListener("click", () => {
      const existing = popouts.get(id);
      if (existing && !existing.closed) {
        existing.focus();
        return;
      }
      const popup = window.open("", `zx-debug-${id}`, "popup,width=640,height=480,resizable=yes,scrollbars=yes");
      if (!popup) {
        onStatus("Pop-up blocked; allow pop-ups for separate debugger windows");
        return;
      }
      popup.document.title = `ZX Spectrum · ${id}`;
      const stylesheet = popup.document.createElement("link");
      stylesheet.rel = "stylesheet";
      stylesheet.href = new URL("./public/styles.css", location.href).href;
      popup.document.head.append(stylesheet);
      popup.document.body.className = "debug-popout-body";
      popouts.set(id, popup);
      onStatus(`Opened ${id} in a separate window`);
    });
    tools.append(floatButton, popoutButton);
    panel.prepend(tools);

    const dragHandle = panel.querySelector("h2, .window-header");
    dragHandle?.addEventListener("pointerdown", (event) => {
      if (!panel.classList.contains("floating-debug-window") || event.target.closest("button, input, label")) return;
      const rect = panel.getBoundingClientRect();
      const offsetX = event.clientX - rect.left;
      const offsetY = event.clientY - rect.top;
      dragHandle.setPointerCapture(event.pointerId);
      const move = (moveEvent) => {
        panel.style.left = `${Math.max(0, moveEvent.clientX - offsetX)}px`;
        panel.style.top = `${Math.max(0, moveEvent.clientY - offsetY)}px`;
      };
      const end = () => {
        dragHandle.removeEventListener("pointermove", move);
        dragHandle.removeEventListener("pointerup", end);
        persist(panel);
      };
      dragHandle.addEventListener("pointermove", move);
      dragHandle.addEventListener("pointerup", end);
    });

    new ResizeObserver(() => persist(panel)).observe(panel);
  }

  const timer = window.setInterval(() => {
    for (const panel of panels) {
      const popup = popouts.get(panel.dataset.windowId);
      if (!popup || popup.closed) continue;
      popup.document.body.replaceChildren(copyPanel(panel));
    }
  }, 250);

  window.addEventListener("pagehide", () => window.clearInterval(timer), { once: true });
  return { panels, popouts };
}
