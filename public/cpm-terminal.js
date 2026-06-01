const DEFAULT_COLUMNS = 80;
const DEFAULT_ROWS = 24;
const ESC = "\x1b";

export class CpmTerminal {
  constructor(element, { columns = DEFAULT_COLUMNS, rows = DEFAULT_ROWS } = {}) {
    this.element = element;
    this.columns = columns;
    this.rows = rows;
    this.cursorVisible = true;
    this.clear();
  }

  clear() {
    this.screen = Array.from({ length: this.rows }, () => this.blankRow());
    this.cursorRow = 0;
    this.cursorColumn = 0;
    this.escapeState = null;
    this.render();
  }

  blankRow() {
    return new Array(this.columns).fill(" ");
  }

  write(text) {
    for (const char of String(text)) {
      this.writeChar(char);
    }
    this.render();
  }

  writeChar(char) {
    if (this.consumeEscape(char)) return;

    if (char === ESC) {
      this.escapeState = { command: "" };
      return;
    }

    const code = char.charCodeAt(0);
    if (code < 0x20 || code === 0x7f) {
      this.writeControl(code);
      return;
    }

    this.writePrintable(char);
  }

  consumeEscape(char) {
    if (!this.escapeState) return false;

    if (!this.escapeState.command) {
      this.escapeState.command = char;
      if (char === "=" || char === "Y") {
        this.escapeState.params = "";
        return true;
      }
      this.runEscapeCommand(char);
      this.escapeState = null;
      return true;
    }

    this.escapeState.params += char;
    if (this.escapeState.params.length === 2) {
      const row = this.escapeState.params.charCodeAt(0) - 0x20;
      const column = this.escapeState.params.charCodeAt(1) - 0x20;
      this.moveCursor(row, column);
      this.escapeState = null;
    }
    return true;
  }

  runEscapeCommand(command) {
    if (command === "*" || command === "+") this.clearScreen();
    if (command === "T") this.clearToEndOfLine();
    if (command === "Y") this.escapeState = { command, params: "" };
  }

  writeControl(code) {
    switch (code) {
      case 0x08:
        this.moveCursor(this.cursorRow, this.cursorColumn - 1);
        break;
      case 0x09:
        this.moveCursor(this.cursorRow, Math.min(this.columns - 1, this.cursorColumn + (8 - (this.cursorColumn % 8))));
        break;
      case 0x0a:
        this.lineFeed();
        this.cursorColumn = 0;
        break;
      case 0x0b:
        this.clearToEndOfLine();
        break;
      case 0x0c:
      case 0x1a:
        this.clearScreen();
        break;
      case 0x0d:
        this.moveCursor(this.cursorRow, 0);
        break;
      default:
        break;
    }
  }

  writePrintable(char) {
    this.screen[this.cursorRow][this.cursorColumn] = char;
    if (this.cursorColumn === this.columns - 1) {
      this.cursorColumn = 0;
      this.lineFeed();
    } else {
      this.cursorColumn += 1;
    }
  }

  lineFeed() {
    if (this.cursorRow === this.rows - 1) {
      this.screen.shift();
      this.screen.push(this.blankRow());
    } else {
      this.cursorRow += 1;
    }
  }

  clearScreen() {
    this.screen = Array.from({ length: this.rows }, () => this.blankRow());
    this.moveCursor(0, 0);
  }

  clearToEndOfLine() {
    this.screen[this.cursorRow].fill(" ", this.cursorColumn);
  }

  moveCursor(row, column) {
    this.cursorRow = Math.max(0, Math.min(this.rows - 1, row));
    this.cursorColumn = Math.max(0, Math.min(this.columns - 1, column));
  }

  render() {
    const renderedRows = this.screen.map((row, rowIndex) => {
      const copy = [...row];
      if (this.cursorVisible && rowIndex === this.cursorRow) copy[this.cursorColumn] = "\u2588";
      return copy.join("").trimEnd();
    });

    while (renderedRows.length > 1 && renderedRows[renderedRows.length - 1] === "") {
      renderedRows.pop();
    }

    this.element.textContent = renderedRows.join("\n");
    this.element.scrollTop = this.element.scrollHeight;
  }

  saveState() {
    return {
      columns: this.columns,
      rows: this.rows,
      cursorVisible: this.cursorVisible,
      cursorRow: this.cursorRow,
      cursorColumn: this.cursorColumn,
      screen: this.screen.map((row) => row.join(""))
    };
  }

  restoreState(state) {
    this.columns = state.columns ?? this.columns;
    this.rows = state.rows ?? this.rows;
    this.cursorVisible = state.cursorVisible ?? this.cursorVisible;
    this.screen = Array.from({ length: this.rows }, (_, rowIndex) => {
      const source = state.screen?.[rowIndex] ?? "";
      return Array.from({ length: this.columns }, (_, columnIndex) => source[columnIndex] ?? " ");
    });
    this.cursorRow = Math.max(0, Math.min(this.rows - 1, state.cursorRow ?? 0));
    this.cursorColumn = Math.max(0, Math.min(this.columns - 1, state.cursorColumn ?? 0));
    this.escapeState = null;
    this.render();
  }
}

export function keyEventToCpmInput(event) {
  if (event.key === "Enter") return "\r";
  if (event.key === "Backspace") return "\b";
  if (event.key === "Tab") return "\t";
  if (event.key === "Escape") return "\x1b";
  if (event.ctrlKey && event.key.length === 1) {
    const code = event.key.toUpperCase().charCodeAt(0);
    if (code >= 0x40 && code <= 0x5f) return String.fromCharCode(code - 0x40);
  }
  if (event.key.length === 1 && !event.metaKey && !event.altKey) return event.key;
  return "";
}
