# TI-85 Clickable Faceplate Design

## Goal

Add the first clickable TI-85 browser faceplate on top of the existing headless
`Ti85Machine` and minimal LCD viewer.

## Scope

The first UI slice renders a calculator-body layout with semantic HTML buttons
for the TI-85 physical keys. Each button maps to an existing `Ti85Machine`
named key and uses pointer/keyboard press-and-release behavior. The goal is a
usable input surface, not final photo-accurate artwork.

## Design

`public/ti85.html` gains a keypad container below the LCD. `public/ti85-app.js`
owns a `TI85_KEY_LAYOUT` data structure and generates the buttons from it. This
keeps the physical layout separate from the emulator key matrix, while still
making every visible button addressable by `data-ti85-key`.

The page keeps the existing ROM, run, frame, step, reset, debug drawer, and LCD
canvas. The separate control-panel `ON` button is replaced by the physical
keypad `ON` button with the same `id="ti85On"` for test continuity.

The first visual styling uses CSS-rendered buttons with TI-85-like grouping and
colors. A later polish slice can use the uploaded TI-85 images to tune spacing,
labels, and casing or to add a photographic/calculator-shell skin.

## Testing

Static page tests assert that the TI-85 page exposes the keypad container, that
the app defines the key layout, and that key binding uses
`machine.pressKey(key)` and `machine.releaseKey(key)`. Browser verification
checks that clicking a physical key updates the displayed held-key debug state
and that `ON` still wakes the LCD.
