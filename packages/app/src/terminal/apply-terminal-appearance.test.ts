import type { ITheme } from "@xterm/xterm";
import { describe, expect, it } from "vitest";
import { DEFAULT_TERMINAL_APPEARANCE } from "@/hooks/use-settings";
import { applyTerminalAppearance } from "./apply-terminal-appearance";

const BASE: ITheme = {
  background: "#000000",
  foreground: "#ffffff",
  cursor: "#111111",
  cursorAccent: "#222222",
  selectionBackground: "#333333",
  black: "#444444",
  red: "#555555",
};

describe("applyTerminalAppearance", () => {
  it("returns the base theme untouched when no overrides are set", () => {
    expect(applyTerminalAppearance(BASE, DEFAULT_TERMINAL_APPEARANCE)).toEqual(BASE);
  });

  it("overrides base colors and maps cursor-text onto cursorAccent", () => {
    const merged = applyTerminalAppearance(BASE, {
      ...DEFAULT_TERMINAL_APPEARANCE,
      background: "#0d1117",
      cursorColor: "#58a6ff",
      cursorText: "#0d1117",
      selectionForeground: "#ff0000",
    });
    expect(merged.background).toBe("#0d1117");
    expect(merged.cursor).toBe("#58a6ff");
    expect(merged.cursorAccent).toBe("#0d1117");
    expect(merged.selectionForeground).toBe("#ff0000");
    expect(merged.foreground).toBe("#ffffff");
  });

  it("maps palette indices onto ANSI keys and leaves empty slots alone", () => {
    const palette = Array.from({ length: 16 }, () => "");
    palette[1] = "#ff7b72";
    palette[9] = "#ffa198";
    const merged = applyTerminalAppearance(BASE, { ...DEFAULT_TERMINAL_APPEARANCE, palette });
    expect(merged.red).toBe("#ff7b72");
    expect(merged.brightRed).toBe("#ffa198");
    expect(merged.black).toBe("#444444");
  });
});
