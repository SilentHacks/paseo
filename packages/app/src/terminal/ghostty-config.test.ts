import { describe, expect, it } from "vitest";
import { parseGhosttyConfig } from "./ghostty-config";

describe("parseGhosttyConfig", () => {
  it("parses font, colors, and palette entries from a typical config", () => {
    const result = parseGhosttyConfig(
      [
        "# my ghostty config",
        "font-family = SF Mono",
        "font-size = 14",
        "background = #0d1117",
        "foreground = #e6edf3",
        "cursor-color = #58a6ff",
        "cursor-text = #0d1117",
        "selection-background = #264f78",
        "palette = 0=#0d1117",
        "palette = 9=#ff7b72",
        "scrollback-limit = 50000",
        "cursor-style = underline",
        "cursor-style-blink = false",
      ].join("\n"),
    );

    expect(result.settings.terminalFontFamily).toBe("SF Mono");
    expect(result.settings.terminalFontSize).toBe(14);
    expect(result.settings.terminalScrollbackLines).toBe(50000);
    const appearance = result.settings.terminalAppearance;
    expect(appearance?.background).toBe("#0d1117");
    expect(appearance?.foreground).toBe("#e6edf3");
    expect(appearance?.cursorColor).toBe("#58a6ff");
    expect(appearance?.cursorText).toBe("#0d1117");
    expect(appearance?.selectionBackground).toBe("#264f78");
    expect(appearance?.cursorStyle).toBe("underline");
    expect(appearance?.cursorBlink).toBe(false);
    expect(appearance?.palette?.[0]).toBe("#0d1117");
    expect(appearance?.palette?.[9]).toBe("#ff7b72");
    expect(appearance?.palette?.length).toBe(16);
    expect(result.applied).toContain("palette");
    expect(result.unsupported).toEqual([]);
  });

  it("expands short hex and drops alpha channels", () => {
    const result = parseGhosttyConfig("background = #abc\nforeground = #aabbccdd");
    expect(result.settings.terminalAppearance?.background).toBe("#aabbcc");
    expect(result.settings.terminalAppearance?.foreground).toBe("#aabbcc");
  });

  it("reports keys it cannot render instead of dropping them", () => {
    const result = parseGhosttyConfig(
      [
        "keybind = cmd+t=new_tab",
        "theme = tokyonight",
        "macos-option-as-alt = true",
        "background-opacity = 0.9",
        "palette = 250=#ff0000",
      ].join("\n"),
    );
    expect(result.applied).toEqual([]);
    expect(result.unsupported).toContain("keybind");
    expect(result.unsupported).toContain("theme");
    expect(result.unsupported).toContain("macos-option-as-alt");
    expect(result.unsupported).toContain("background-opacity");
    expect(result.unsupported).toContain("palette 250");
  });

  it("omits unset fields so applying the patch never clobbers untouched settings", () => {
    const result = parseGhosttyConfig("font-family = JetBrains Mono");
    expect(result.settings.terminalFontFamily).toBe("JetBrains Mono");
    expect(result.settings.terminalFontSize).toBeUndefined();
    expect(result.settings.terminalScrollbackLines).toBeUndefined();
    expect(result.settings.terminalAppearance).toBeUndefined();
  });

  it("ignores comments, blank lines, and malformed entries", () => {
    const result = parseGhosttyConfig(
      ["", "# comment", "font-size = not-a-number", "= value", "font-size = 13"].join("\n"),
    );
    expect(result.settings.terminalFontSize).toBe(13);
    expect(result.unsupported).toContain("font-size");
  });
});
