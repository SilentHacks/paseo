import { useCallback, useState } from "react";
import { useTranslation } from "react-i18next";
import { Text, View } from "react-native";
import { StyleSheet } from "react-native-unistyles";
import { Button } from "@/components/ui/button";
import { EditingTextInput as TextInput } from "@/components/ui/text-input";
import { isWeb } from "@/constants/platform";
import { parseTerminalScrollbackLines, useAppSettings } from "@/hooks/use-settings";
import { settingsStyles } from "@/styles/settings";
import { mergeTerminalAppearance } from "@/terminal/apply-terminal-appearance";
import { parseGhosttyConfig, type GhosttyImportResult } from "@/terminal/ghostty-config";

type Phase = "idle" | "input" | "preview";

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

// Inline import flow for the Terminal settings section: pick or paste a Ghostty
// config, review the keys that will apply vs. the ones we can't render, then
// commit. Applied values land as a sparse patch — keys absent from the file are
// never touched.
export function GhosttyImportCard() {
  const { t } = useTranslation();
  const { settings, updateSettings } = useAppSettings();
  const [phase, setPhase] = useState<Phase>("idle");
  const [draft, setDraft] = useState("");
  const [result, setResult] = useState<GhosttyImportResult | null>(null);

  const parse = useCallback((text: string) => {
    setResult(parseGhosttyConfig(text));
    setPhase("preview");
  }, []);

  const chooseFile = useCallback(() => {
    readConfigFile((text) => {
      setDraft(text);
      parse(text);
    });
  }, [parse]);

  const openInput = useCallback(() => {
    setPhase("input");
  }, []);

  const handleParse = useCallback(() => {
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
          <Text style={settingsStyles.rowHint}>{t("settings.appearance.terminal.importHint")}</Text>
        </View>
        <Button variant="outline" size="sm" testID="ghostty-import-open" onPress={openInput}>
          {t("settings.appearance.terminal.importAction")}
        </Button>
      </View>
    );
  }

  if (phase === "input") {
    return (
      <View style={styles.inputBlock}>
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
