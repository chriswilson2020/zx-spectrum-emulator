import assert from "node:assert/strict";
import test from "node:test";
import { CpmTerminal, keyEventToCpmInput } from "../public/cpm-terminal.js";

function makeElement() {
  return {
    scrollHeight: 0,
    scrollTop: 0,
    textContent: ""
  };
}

test("CP/M terminal renders carriage returns, new lines, backspace, and cursor", () => {
  const element = makeElement();
  const terminal = new CpmTerminal(element, { columns: 80, rows: 24 });

  terminal.write("A>DIR\r\r\nFILE\bS");

  assert.equal(element.textContent, "A>DIR\nFILS█");
});

test("CP/M terminal keeps the most recent rows", () => {
  const element = makeElement();
  const terminal = new CpmTerminal(element, { columns: 80, rows: 2 });

  terminal.write("one\ntwo\nthree");

  assert.equal(element.textContent, "two\nthree█");
});

test("CP/M terminal supports WordStar-style cursor addressing", () => {
  const element = makeElement();
  const terminal = new CpmTerminal(element, { columns: 12, rows: 4 });

  terminal.write("Top\r\nBottom\x1b=!!X");

  assert.equal(element.textContent, "Top\nBX█tom");
});

test("CP/M terminal clears the screen and erases to end of line", () => {
  const element = makeElement();
  const terminal = new CpmTerminal(element, { columns: 12, rows: 4 });

  terminal.write("abcdef\x1a12345\x1b= \"\x0bZ");

  assert.equal(element.textContent, "12Z█");
});

test("CP/M terminal ignores unsupported control bytes instead of printing boxes", () => {
  const element = makeElement();
  const terminal = new CpmTerminal(element, { columns: 12, rows: 4 });

  terminal.write("\x01A\x0eB\x0fC");

  assert.equal(element.textContent, "ABC█");
});

test("key events translate to CP/M console bytes", () => {
  assert.equal(keyEventToCpmInput({ key: "Enter" }), "\r");
  assert.equal(keyEventToCpmInput({ key: "Backspace" }), "\b");
  assert.equal(keyEventToCpmInput({ key: "Escape" }), "\x1b");
  assert.equal(keyEventToCpmInput({ key: "c", ctrlKey: true }), "\x03");
  assert.equal(keyEventToCpmInput({ key: "A", ctrlKey: false, metaKey: false, altKey: false }), "A");
  assert.equal(keyEventToCpmInput({ key: "ArrowLeft" }), "");
});
