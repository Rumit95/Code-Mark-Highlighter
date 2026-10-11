// src/highlightNavigator.ts
// Jump to next/previous highlight in the current file

import * as vscode from "vscode";
import { Highlight } from "./types";
import { findRangeInDocument } from "./highlightMatcher";
import { getHighlightsForFile } from "./storage";

interface ResolvedHighlight {
  highlight: Highlight;
  range: vscode.Range;
}

function getWorkspaceRelativePath(uri: vscode.Uri): string {
  const folders = vscode.workspace.workspaceFolders;
  if (folders && folders.length > 0) {
    return vscode.workspace.asRelativePath(uri, false);
  }
  return uri.fsPath;
}

function resolveHighlightsInEditor(
  editor: vscode.TextEditor,
  highlights: Highlight[],
  fuzzyThreshold: number
): ResolvedHighlight[] {
  const resolved: ResolvedHighlight[] = [];
  for (const h of highlights) {
    const range = findRangeInDocument(
      editor.document,
      h.codeSnippet,
      h.codeHash,
      fuzzyThreshold,
      h.contextBefore,
      h.contextAfter
    );
    if (range) {
      resolved.push({ highlight: h, range });
    }
  }
  // Sort by start position
  return resolved.sort((a, b) =>
    a.range.start.line - b.range.start.line ||
    a.range.start.character - b.range.start.character
  );
}

function getFuzzyThreshold(): number {
  return vscode.workspace
    .getConfiguration("codemark")
    .get<number>("fuzzyMatchThreshold", 0.75);
}

export async function nextHighlight(
  context: vscode.ExtensionContext
): Promise<void> {
  const editor = vscode.window.activeTextEditor;
  if (!editor) { return; }

  const filePath = getWorkspaceRelativePath(editor.document.uri);
  const fileHighlights = getHighlightsForFile(context, filePath);

  if (fileHighlights.length === 0) {
    vscode.window.setStatusBarMessage("$(bookmark) Code Mark: No highlights in this file.", 2500);
    return;
  }

  const resolved = resolveHighlightsInEditor(editor, fileHighlights, getFuzzyThreshold());
  if (resolved.length === 0) {
    vscode.window.setStatusBarMessage(
      "$(warning) Code Mark: No matches could be resolved in this file. The code may have changed significantly.",
      3500
    );
    return;
  }

  const cursor = editor.selection.active;

  // Find first highlight after cursor
  let target = resolved.find(
    (r) => r.range.start.isAfter(cursor)
  );

  // Wrap around to beginning
  if (!target) { target = resolved[0]; }

  revealHighlight(editor, target);

  const tag = target.highlight.tag || "No tag";
  vscode.window.setStatusBarMessage(`$(arrow-down) Code Mark: → [${tag}]`, 2500);
}

export async function prevHighlight(
  context: vscode.ExtensionContext
): Promise<void> {
  const editor = vscode.window.activeTextEditor;
  if (!editor) { return; }

  const filePath = getWorkspaceRelativePath(editor.document.uri);
  const fileHighlights = getHighlightsForFile(context, filePath);

  if (fileHighlights.length === 0) {
    vscode.window.setStatusBarMessage("$(bookmark) Code Mark: No highlights in this file.", 2500);
    return;
  }

  const resolved = resolveHighlightsInEditor(editor, fileHighlights, getFuzzyThreshold());
  if (resolved.length === 0) {
    vscode.window.setStatusBarMessage(
      "$(warning) Code Mark: No matches could be resolved in this file. The code may have changed significantly.",
      3500
    );
    return;
  }

  const cursor = editor.selection.active;

  // Find last highlight before cursor (in reverse)
  const beforeCursor = resolved.filter((r) => r.range.end.isBefore(cursor));
  let target = beforeCursor.length > 0
    ? beforeCursor[beforeCursor.length - 1]
    : resolved[resolved.length - 1]; // wrap to end

  revealHighlight(editor, target);

  const tag = target.highlight.tag || "No tag";
  vscode.window.setStatusBarMessage(`$(arrow-up) Code Mark: ← [${tag}]`, 2500);
}

export async function jumpToHighlight(
  filePath: string,
  snippet: string,
  codeHash: string,
  fuzzyThreshold: number = 0.75,
  contextBefore: string = "",
  contextAfter: string = ""
): Promise<void> {
  // Open the file
  const folders = vscode.workspace.workspaceFolders;
  if (!folders) { return; }

  const absPath = vscode.Uri.joinPath(folders[0].uri, filePath);
  const doc = await vscode.workspace.openTextDocument(absPath);
  const editor = await vscode.window.showTextDocument(doc);

  const range = findRangeInDocument(
    doc,
    snippet,
    codeHash,
    fuzzyThreshold,
    contextBefore,
    contextAfter
  );
  if (!range) {
    vscode.window.showWarningMessage(
      "Code Mark: Could not locate this highlight in the file. The code may have changed, been moved, or been edited significantly. The highlight remains saved for reference."
    );
    return;
  }

  // Select and reveal the range
  editor.selection = new vscode.Selection(range.start, range.end);
  editor.revealRange(range, vscode.TextEditorRevealType.InCenterIfOutsideViewport);
}

function revealHighlight(
  editor: vscode.TextEditor,
  resolved: ResolvedHighlight
): void {
  editor.selection = new vscode.Selection(
    resolved.range.start,
    resolved.range.end
  );
  editor.revealRange(
    resolved.range,
    vscode.TextEditorRevealType.InCenterIfOutsideViewport
  );
}
