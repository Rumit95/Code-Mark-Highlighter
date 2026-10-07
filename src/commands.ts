// src/commands.ts
// Implements all Code Mark commands

import * as vscode from "vscode";
import * as crypto from "crypto";
import { Highlight, PRESET_COLORS, DEFAULT_TAGS } from "./types";
import {
  loadHighlights,
  addHighlight,
  removeHighlight,
  updateHighlight,
  getHighlightsForFile,
  removeHighlightsForFile,
} from "./storage";
import { hashText } from "./highlightMatcher";
import { applyHighlightsToEditor, findHighlightAtCursor } from "./decorationManager";
import { SidebarProvider } from "./sidebarProvider";

function getFuzzyThreshold(): number {
  return vscode.workspace
    .getConfiguration("codemark")
    .get<number>("fuzzyMatchThreshold", 0.75);
}

function getWorkspaceRelativePath(uri: vscode.Uri): string {
  const folders = vscode.workspace.workspaceFolders;
  if (folders && folders.length > 0) {
    const rel = vscode.workspace.asRelativePath(uri, false);
    return rel;
  }
  return uri.fsPath;
}

/** Generate a UUID v4 */
function uuidv4(): string {
  return crypto.randomUUID();
}

/** Prompt user to choose a color from presets or enter custom hex */
async function pickColor(currentColor?: string): Promise<string | undefined> {
  const items = PRESET_COLORS.map((c) => ({
    label: `${c.emoji}  ${c.label}`,
    description: c.hex,
    hex: c.hex,
    picked: c.hex === currentColor,
  }));
  items.push({
    label: "✏️  Custom color…",
    description: "Enter a hex color code",
    hex: "__custom__",
    picked: false,
  });

  const picked = await vscode.window.showQuickPick(items, {
    placeHolder: "Choose a highlight color",
    title: "Code Mark — Pick Color",
  });

  if (!picked) { return undefined; }

  if (picked.hex === "__custom__") {
    const custom = await vscode.window.showInputBox({
      prompt: "Enter a hex color (e.g. #FF6B6B or #FF6B6B80)",
      value: currentColor ?? "#FFD700",
      validateInput: (v) =>
        /^#[0-9A-Fa-f]{6}([0-9A-Fa-f]{2})?$/.test(v)
          ? undefined
          : "Use #RRGGBB or #RRGGBBAA, such as #FF6B6B80",
    });
    return custom;
  }

  return picked.hex;
}

/** Prompt user to choose or enter a tag */
async function pickTag(currentTag?: string): Promise<string | undefined> {
  return new Promise((resolve) => {
    const quickPick = vscode.window.createQuickPick<
      vscode.QuickPickItem & { tag: string }
    >();
    const tags = [...new Set([...DEFAULT_TAGS, ...(currentTag ? [currentTag] : [])])];

    quickPick.items = tags.map((tag) => ({ label: tag, tag }));
    quickPick.value = currentTag ?? "";
    quickPick.placeholder = "Choose a suggested tag or type a note and press Enter";
    quickPick.title = "Code Mark — Set Tag or Note";
    quickPick.onDidAccept(() => {
      const selectedTag = quickPick.selectedItems[0]?.tag;
      resolve((selectedTag ?? quickPick.value).trim());
      quickPick.hide();
    });
    quickPick.onDidHide(() => {
      quickPick.dispose();
      resolve(undefined);
    });
    quickPick.show();
  });
}

// ─── Command: Highlight Code ──────────────────────────────────────────────────

export async function highlightCode(
  context: vscode.ExtensionContext,
  sidebar: SidebarProvider
): Promise<void> {
  const editor = vscode.window.activeTextEditor;
  if (!editor) {
    vscode.window.showWarningMessage("Code Mark: No active editor.");
    return;
  }

  const selection = editor.selection;
  if (selection.isEmpty) {
    vscode.window.showWarningMessage("Code Mark: Please select some code first.");
    return;
  }

  const snippet = editor.document.getText(selection);
  if (!snippet.trim()) {
    vscode.window.showWarningMessage("Code Mark: Selection is empty.");
    return;
  }

  // Pick color
  const color = await pickColor();
  if (!color) { return; }

  // Pick tag (optional)
  const tag = await pickTag();

  const now = new Date().toISOString();
  const highlight: Highlight = {
    id: uuidv4(),
    filePath: getWorkspaceRelativePath(editor.document.uri),
    codeSnippet: snippet,
    codeHash: hashText(snippet),
    tag: tag || "",
    color,
    createdAt: now,
    updatedAt: now,
  };

  addHighlight(context, highlight);

  // Reapply all highlights to this editor
  const fileHighlights = getHighlightsForFile(context, highlight.filePath);
  applyHighlightsToEditor(editor, fileHighlights, getFuzzyThreshold());

  sidebar.refresh();
  vscode.window.setStatusBarMessage(`$(bookmark) Code Mark: Highlight added — [${tag || "No tag"}]`, 3000);
}

// ─── Command: Remove Highlight ────────────────────────────────────────────────

export async function removeHighlightCmd(
  context: vscode.ExtensionContext,
  sidebar: SidebarProvider
): Promise<void> {
  const editor = vscode.window.activeTextEditor;
  if (!editor) { return; }

  const filePath = getWorkspaceRelativePath(editor.document.uri);
  const fileHighlights = getHighlightsForFile(context, filePath);
  const target = findHighlightAtCursor(editor, fileHighlights, getFuzzyThreshold());

  if (!target) {
    vscode.window.showInformationMessage("Code Mark: No highlight found at cursor.");
    return;
  }

  const confirm = await vscode.window.showQuickPick(["Yes, remove it", "Cancel"], {
    placeHolder: `Remove highlight: "${target.tag || target.codeSnippet.slice(0, 40)}..."?`,
    title: "Code Mark — Remove Highlight",
  });
  if (confirm !== "Yes, remove it") { return; }

  removeHighlight(context, target.id);

  const updated = getHighlightsForFile(context, filePath);
  applyHighlightsToEditor(editor, updated, getFuzzyThreshold());

  sidebar.refresh();
  vscode.window.setStatusBarMessage("$(trash) Code Mark: Highlight removed.", 3000);
}

// ─── Command: Edit Tag ────────────────────────────────────────────────────────

export async function editTagCmd(
  context: vscode.ExtensionContext,
  sidebar: SidebarProvider,
  highlightId?: string
): Promise<void> {
  const editor = vscode.window.activeTextEditor;
  if (!editor) { return; }

  let target: Highlight | undefined;

  if (highlightId) {
    target = loadHighlights(context).find((h) => h.id === highlightId);
  } else {
    const filePath = getWorkspaceRelativePath(editor.document.uri);
    const fileHighlights = getHighlightsForFile(context, filePath);
    target = findHighlightAtCursor(editor, fileHighlights, getFuzzyThreshold());
  }

  if (!target) {
    vscode.window.showInformationMessage("Code Mark: No highlight found at cursor.");
    return;
  }

  const newTag = await pickTag(target.tag);
  if (newTag === undefined) { return; }

  updateHighlight(context, target.id, { tag: newTag });

  const filePath = getWorkspaceRelativePath(editor.document.uri);
  applyHighlightsToEditor(editor, getHighlightsForFile(context, filePath), getFuzzyThreshold());
  sidebar.refresh();
  vscode.window.setStatusBarMessage(`$(tag) Code Mark: Tag updated to "${newTag}".`, 3000);
}

// ─── Command: Change Color ────────────────────────────────────────────────────

export async function changeColorCmd(
  context: vscode.ExtensionContext,
  sidebar: SidebarProvider,
  highlightId?: string
): Promise<void> {
  const editor = vscode.window.activeTextEditor;
  if (!editor) { return; }

  let target: Highlight | undefined;

  if (highlightId) {
    target = loadHighlights(context).find((h) => h.id === highlightId);
  } else {
    const filePath = getWorkspaceRelativePath(editor.document.uri);
    const fileHighlights = getHighlightsForFile(context, filePath);
    target = findHighlightAtCursor(editor, fileHighlights, getFuzzyThreshold());
  }

  if (!target) {
    vscode.window.showInformationMessage("Code Mark: No highlight found at cursor.");
    return;
  }

  const newColor = await pickColor(target.color);
  if (!newColor) { return; }

  updateHighlight(context, target.id, { color: newColor });

  const filePath = getWorkspaceRelativePath(editor.document.uri);
  applyHighlightsToEditor(editor, getHighlightsForFile(context, filePath), getFuzzyThreshold());
  sidebar.refresh();
  vscode.window.setStatusBarMessage("$(symbol-color) Code Mark: Color updated.", 3000);
}

// ─── Command: Clear All Highlights in File ────────────────────────────────────

export async function clearAllHighlightsCmd(
  context: vscode.ExtensionContext,
  sidebar: SidebarProvider
): Promise<void> {
  const editor = vscode.window.activeTextEditor;
  if (!editor) { return; }

  const filePath = getWorkspaceRelativePath(editor.document.uri);
  const fileHighlights = getHighlightsForFile(context, filePath);

  if (fileHighlights.length === 0) {
    vscode.window.showInformationMessage("Code Mark: No highlights in this file.");
    return;
  }

  const confirm = await vscode.window.showQuickPick(
    ["Yes, clear all", "Cancel"],
    {
      placeHolder: `Clear all ${fileHighlights.length} highlight(s) in this file?`,
      title: "Code Mark — Clear All",
    }
  );
  if (confirm !== "Yes, clear all") { return; }

  removeHighlightsForFile(context, filePath);
  applyHighlightsToEditor(editor, [], getFuzzyThreshold());
  sidebar.refresh();
  vscode.window.setStatusBarMessage("$(clear-all) Code Mark: All highlights cleared.", 3000);
}
