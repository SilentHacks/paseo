import { useCallback, useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { Text, View } from "react-native";
import { StyleSheet } from "react-native-unistyles";
import { Button } from "@/components/ui/button";
import { EditingTextInput as TextInput } from "@/components/ui/text-input";
import { getIsElectron, isWeb } from "@/constants/platform";
import { invokeDesktopCommand } from "@/desktop/electron/invoke";
import { parseTerminalScrollbackLines, useAppSettings } from "@/hooks/use-settings";
import { settingsStyles } from "@/styles/settings";
import { mergeTerminalAppearance } from "@/terminal/apply-terminal-appearance";
import { parseGhosttyConfig, type GhosttyImportResult } from "@/terminal/ghostty-config";

type Phase = "idle" | "input" | "preview";
type AutoLocate = "idle" | "pending" | "found" | "failed" | "unavailable";

function readConfigFile(onRead: (text: string) => void): void {
  const input = document.createElement("input");
  input.type = "file";
  input.accept = "*/*";
  input.addEventListener("change", () => {
    const file = input.files?.[0];
    if (!file) return;
    void file.text().then(onRead);
  });
  input.click();
}

// Inline import flow for the Terminal settings section. On desktop the card
// auto-locates the Ghostty config at its standard paths on mount; picking a
// file or pasting remains available as a manual override everywhere. Applied
// values land as a sparse patch — keys absent from the file are never touched.
export function GhosttyImportCard() {
  const { t } = useTranslation();
  const { settings, updateSettings } = useAppSettings();
  const [phase, setPhase] = useState<Phase>("idle");
  const [draft, setDraft] = useState("");
  const [result, setResult] = useState<GhosttyImportResult | null>(null);
  const [sourcePath, setSourcePath] = useState<string | null>(null);
  const [locatedText, setLocatedText] = useState<string | null>(null);
  const [autoLocate, setAutoLocate] = useState<AutoLocate>("idle");
  const mountedRef = useRef(true);
  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);

  const parse = useCallback((text: string) => {
    setResult(parseGhosttyConfig(text));
    setPhase("preview");
  }, []);

  const tryAutoLocate = useCallback(
    async (enterInputOnMiss: boolean) => {
      if (!getIsElectron()) {
        setAutoLocate("unavailable");
        return;
      }
      setAutoLocate("pending");
      try {
        const found = await invokeDesktopCommand<{ path: string; contents: string } | null>(
          "desktop_read_ghostty_config",
        );
        if (!mountedRef.current) return;
        if (found && found.contents.trim().length > 0) {
          setSourcePath(found.path);
          setLocatedText(found.contents);
          setAutoLocate("found");
          parse(found.contents);
          return;
        }
      } catch {
        if (!mountedRef.current) return;
      }
      setAutoLocate("failed");
      if (enterInputOnMiss) setPhase("input");
    },
    [parse],
  );

  useEffect(() => {
    void tryAutoLocate(false);
  }, [tryAutoLocate]);

  const chooseFile = useCallback(() => {
    readConfigFile((text) => {
      setSourcePath(null);
      setDraft(text);
      parse(text);
    });
  }, [parse]);

  const openInput = useCallback(() => {
    setPhase("input");
  }, []);

  const startImport = useCallback(() => {
    if (autoLocate === "found" && locatedText !== null) {
      parse(locatedText);
      return;
    }
    if (getIsElectron()) {
      void tryAutoLocate(true);
      return;
    }
    setPhase("input");
  }, [autoLocate, locatedText, parse, tryAutoLocate]);

  const handleParse = useCallback(() => {
    setSourcePath(null);
    parse(draft);
  }, [parse, draft]);

  const apply = useCallback(() => {
    if (!result) return;
    const patch = result.settings;
    const appearance = patch.terminalAppearance;
    const scrollback =
      patch.terminalScrollbackLines !== undefined
        ? parseTerminalScrollbackLines(patch.terminalScrollbackLines)
        : undefined;
    void updateSettings({
      ...(patch.terminalFontFamily !== undefined
        ? { terminalFontFamily: patch.terminalFontFamily }
        : {}),
      ...(patch.terminalFontSize !== undefined ? { terminalFontSize: patch.terminalFontSize } : {}),
      ...(scrollback !== undefined && scrollback !== null
        ? { terminalScrollbackLines: scrollback }
        : {}),
      ...(appearance
        ? { terminalAppearance: mergeTerminalAppearance(settings.terminalAppearance, appearance) }
        : {}),
    });
    setPhase("idle");
    setResult(null);
    setDraft("");
  }, [result, settings.terminalAppearance, updateSettings]);

  const cancel = useCallback(() => {
    setPhase("idle");
    setResult(null);
    setDraft("");
  }, []);

  if (phase === "idle") {
    return (
      <View style={styles.rowNoBorder}>
        <View style={settingsStyles.rowContent}>
          <Text style={settingsStyles.rowTitle}>
            {t("settings.appearance.terminal.importTitle")}
          </Text>
          <Text style={settingsStyles.rowHint}>
            {autoLocate === "found" && sourcePath
              ? t("settings.appearance.terminal.importFoundHint", { path: sourcePath })
              : t("settings.appearance.terminal.importHint")}
          </Text>
        </View>
        <Button
          variant="outline"
          size="sm"
          testID="ghostty-import-open"
          onPress={startImport}
          disabled={autoLocate === "pending"}
        >
          {autoLocate === "found"
            ? t("settings.appearance.terminal.importReview")
            : t("settings.appearance.terminal.importAction")}
        </Button>
      </View>
    );
  }

  if (phase === "input") {
    return (
      <View style={styles.inputBlock}>
        {autoLocate === "failed" ? (
          <Text style={styles.unsupportedText}>
            {t("settings.appearance.terminal.importNoConfig")}
          </Text>
        ) : null}
        {isWeb ? (
          <Button variant="secondary" size="sm" testID="ghostty-import-file" onPress={chooseFile}>
            {t("settings.appearance.terminal.importChooseFile")}
          </Button>
        ) : null}
        <TextInput
          initialValue={draft}
          onChangeText={setDraft}
          placeholder={t("settings.appearance.terminal.importPastePlaceholder")}
          placeholderTextColor={styles.placeholderColor.color}
          multiline
          autoCapitalize="none"
          autoCorrect={false}
          spellCheck={false}
          style={styles.pasteInput}
          accessibilityLabel={t("settings.appearance.terminal.importPastePlaceholder")}
        />
        <View style={styles.actions}>
          <Button variant="default" size="sm" testID="ghostty-import-parse" onPress={handleParse}>
            {t("settings.appearance.terminal.importParse")}
          </Button>
          <Button variant="outline" size="sm" testID="ghostty-import-cancel" onPress={cancel}>
            {t("settings.appearance.terminal.importCancel")}
          </Button>
        </View>
      </View>
    );
  }

  const appliedCount = result?.applied.length ?? 0;
  const unsupported = result?.unsupported ?? [];
  return (
    <View style={styles.inputBlock}>
      {sourcePath ? (
        <Text style={styles.unsupportedText}>
          {t("settings.appearance.terminal.importFoundPath", { path: sourcePath })}
        </Text>
      ) : null}
      {appliedCount > 0 ? (
        <Text style={styles.appliedText}>
          {t("settings.appearance.terminal.importApplied", {
            keys: result?.applied.join(", "),
          })}
        </Text>
      ) : (
        <Text style={styles.appliedText}>{t("settings.appearance.terminal.importEmpty")}</Text>
      )}
      {unsupported.length > 0 ? (
        <Text style={styles.unsupportedText}>
          {t("settings.appearance.terminal.importUnsupported", {
            keys: unsupported.join(", "),
          })}
        </Text>
      ) : null}
      <View style={styles.actions}>
        <Button variant="outline" size="sm" testID="ghostty-import-different" onPress={openInput}>
          {t("settings.appearance.terminal.importSpecifyFile")}
        </Button>
        <Button
          variant="default"
          size="sm"
          testID="ghostty-import-apply"
          onPress={apply}
          disabled={appliedCount === 0}
        >
          {t("settings.appearance.terminal.importApply")}
        </Button>
        <Button variant="outline" size="sm" testID="ghostty-import-back" onPress={cancel}>
          {t("settings.appearance.terminal.importCancel")}
        </Button>
      </View>
    </View>
  );
}

const styles = StyleSheet.create((theme) => ({
  rowNoBorder: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingVertical: theme.spacing[4],
    paddingHorizontal: theme.spacing[4],
  },
  inputBlock: {
    paddingVertical: theme.spacing[4],
    paddingHorizontal: theme.spacing[4],
    gap: theme.spacing[3],
  },
  pasteInput: {
    minHeight: 96,
    maxHeight: 160,
    paddingVertical: theme.spacing[2],
    paddingHorizontal: theme.spacing[3],
    borderRadius: theme.borderRadius.md,
    borderWidth: theme.borderWidth[1],
    borderColor: theme.colors.border,
    backgroundColor: theme.colors.surface2,
    color: theme.colors.foreground,
    fontSize: theme.fontSize.sm,
    fontFamily: theme.fontFamily.mono,
    textAlignVertical: "top",
  },
  actions: {
    flexDirection: "row",
    gap: theme.spacing[2],
    justifyContent: "flex-end",
  },
  appliedText: {
    color: theme.colors.foreground,
    fontSize: theme.fontSize.sm,
  },
  unsupportedText: {
    color: theme.colors.foregroundMuted,
    fontSize: theme.fontSize.sm,
  },
  placeholderColor: {
    color: theme.colors.foregroundMuted,
  },
}));
