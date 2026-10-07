// src/extension.ts
// Extension entry point — wires everything together.

import * as vscode from "vscode";
import { SidebarProvider } from "./sidebarProvider";
import {
  applyHighlightsToEditor,
  disposeAllDecorations,
} from "./decorationManager";
import {
  getHighlightsForFile,
  loadHighlights,
  setHighlightsBackgroundVisibility,
  updateHighlight,
} from "./storage";
import {
  highlightCode,
  removeHighlightCmd,
  editTagCmd,
  changeColorCmd,
  clearAllHighlightsCmd,
} from "./commands";
import { nextHighlight, prevHighlight, jumpToHighlight } from "./highlightNavigator";

let sidebar: SidebarProvider;

function getWorkspaceRelativePath(uri: vscode.Uri): string {
  const folders = vscode.workspace.workspaceFolders;
  if (folders && folders.length > 0) {
    return vscode.workspace.asRelativePath(uri, false);
  }
  return uri.fsPath;
}

function getFuzzyThreshold(): number {
  return vscode.workspace
    .getConfiguration("codemark")
    .get<number>("fuzzyMatchThreshold", 0.75);
}

export function activate(context: vscode.ExtensionContext): void {
  // ── Sidebar Provider ──────────────────────────────────────────────────────
  sidebar = new SidebarProvider(
    context.extensionUri,
    context,
    async (action: string, data: unknown) => {
      const d = data as Record<string, string>;
      switch (action) {
        case "toggleBackground":
          await vscode.commands.executeCommand("codemark.toggleHighlightBackground");
          break;
        case "jumpTo":
          await jumpToHighlight(
            d.filePath,
            d.snippet,
            d.hash,
            getFuzzyThreshold()
          );
          break;
        case "editTag":
          await editTagCmd(context, sidebar, d.id);
          break;
        case "changeColor":
          await changeColorCmd(context, sidebar, d.id);
          break;
        case "setBackgroundVisible": {
          const highlight = loadHighlights(context).find((item) => item.id === d.id);
          if (!highlight) { break; }
          updateHighlight(context, highlight.id, {
            backgroundVisible: d.backgroundVisible === "true",
          });
          refreshHighlightDisplay(context, highlight.filePath);
          break;
        }
        case "setOpacity": {
          const highlight = loadHighlights(context).find((item) => item.id === d.id);
          const opacity = Number(d.opacity);
          if (!highlight || !Number.isFinite(opacity)) { break; }
          updateHighlight(context, highlight.id, {
            opacity: Math.max(0, Math.min(1, opacity)),
          });
          refreshHighlightDisplay(context, highlight.filePath);
          break;
        }
        case "refresh":
          refreshActiveEditor(context);
          break;
      }
    }
  );
  context.subscriptions.push(
    vscode.window.registerWebviewViewProvider(
      SidebarProvider.VIEW_ID,
      sidebar,
      { webviewOptions: { retainContextWhenHidden: true } }
    )
  );

  // ── Commands ──────────────────────────────────────────────────────────────
  context.subscriptions.push(
    vscode.commands.registerCommand("codemark.highlightCode", () =>
      highlightCode(context, sidebar)
    ),

    vscode.commands.registerCommand("codemark.removeHighlight", () =>
      removeHighlightCmd(context, sidebar)
    ),

    vscode.commands.registerCommand("codemark.editTag", () =>
      editTagCmd(context, sidebar)
    ),

    vscode.commands.registerCommand("codemark.changeColor", () =>
      changeColorCmd(context, sidebar)
    ),

    vscode.commands.registerCommand("codemark.toggleHighlightBackground", async () => {
      const highlights = loadHighlights(context);
      const allVisible = highlights.length === 0 || highlights.every(
        (highlight) => highlight.backgroundVisible !== false
      );
      const visible = !allVisible;
      setHighlightsBackgroundVisibility(context, visible);
      for (const editor of vscode.window.visibleTextEditors) {
        applyForEditor(editor, context);
      }
      sidebar.refresh();
      vscode.window.setStatusBarMessage(
        `Code Mark: Highlight backgrounds ${visible ? "shown" : "hidden"}.`,
        2500
      );
    }),

    vscode.commands.registerCommand("codemark.showPanel", () => {
      sidebar.reveal();
      vscode.commands.executeCommand("codemark.highlightsPanel.focus");
    }),

    vscode.commands.registerCommand("codemark.nextHighlight", () =>
      nextHighlight(context)
    ),

    vscode.commands.registerCommand("codemark.prevHighlight", () =>
      prevHighlight(context)
    ),

    vscode.commands.registerCommand("codemark.clearAllHighlights", () =>
      clearAllHighlightsCmd(context, sidebar)
    )
  );

  // ── Editor Event Listeners ────────────────────────────────────────────────

  // Reapply when switching editors
  context.subscriptions.push(
    vscode.window.onDidChangeActiveTextEditor((editor) => {
      if (editor) {
        applyForEditor(editor, context);
      }
    })
  );

  // Reapply when a document is opened
  context.subscriptions.push(
    vscode.workspace.onDidOpenTextDocument((doc) => {
      const editor = vscode.window.visibleTextEditors.find(
        (e) => e.document === doc
      );
      if (editor) {
        applyForEditor(editor, context);
      }
    })
  );

  // Debounced reapply on text changes (handles edits above highlights)
  let debounceTimer: NodeJS.Timeout | undefined;
  context.subscriptions.push(
    vscode.workspace.onDidChangeTextDocument((event) => {
      const editor = vscode.window.visibleTextEditors.find(
        (e) => e.document === event.document
      );
      if (!editor) { return; }

      if (debounceTimer) { clearTimeout(debounceTimer); }
      debounceTimer = setTimeout(() => {
        applyForEditor(editor, context);
      }, 400);
    })
  );

  // Refresh decorations on save (positions may have shifted)
  context.subscriptions.push(
    vscode.workspace.onDidSaveTextDocument((doc) => {
      const editor = vscode.window.visibleTextEditors.find(
        (e) => e.document === doc
      );
      if (editor) {
        applyForEditor(editor, context);
        sidebar.refresh();
      }
    })
  );

  context.subscriptions.push(
    vscode.workspace.onDidChangeConfiguration((event) => {
      if (!event.affectsConfiguration("codemark.highlightOpacity")) { return; }
      disposeAllDecorations();
      for (const editor of vscode.window.visibleTextEditors) {
        applyForEditor(editor, context);
      }
    })
  );

  // Apply highlights to all currently visible editors on startup
  for (const editor of vscode.window.visibleTextEditors) {
    applyForEditor(editor, context);
  }

  console.log("Code Mark Highlighter extension activated ✓");
}

function applyForEditor(
  editor: vscode.TextEditor,
  context: vscode.ExtensionContext
): void {
  const filePath = getWorkspaceRelativePath(editor.document.uri);
  const highlights = getHighlightsForFile(context, filePath);
  applyHighlightsToEditor(editor, highlights, getFuzzyThreshold());
}

function refreshActiveEditor(context: vscode.ExtensionContext): void {
  const editor = vscode.window.activeTextEditor;
  if (editor) {
    applyForEditor(editor, context);
  }
}

function refreshHighlightDisplay(
  context: vscode.ExtensionContext,
  filePath: string
): void {
  for (const editor of vscode.window.visibleTextEditors) {
    if (getWorkspaceRelativePath(editor.document.uri) === filePath) {
      applyForEditor(editor, context);
    }
  }
  sidebar.refresh();
}

export function deactivate(): void {
  disposeAllDecorations();
}
