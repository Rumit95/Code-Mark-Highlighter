// src/sidebarProvider.ts
// Sidebar webview panel — shows all highlights with filter, navigation and CRUD actions.

import * as vscode from "vscode";
import { Highlight } from "./types";
import { loadHighlights, removeHighlight } from "./storage";

export class SidebarProvider implements vscode.WebviewViewProvider {
  public static readonly VIEW_ID = "codemark.highlightsPanel";
  private _view?: vscode.WebviewView;

  constructor(
    private readonly _extensionUri: vscode.Uri,
    private readonly _context: vscode.ExtensionContext,
    private readonly _onAction: (action: string, data: unknown) => void
  ) {}

  resolveWebviewView(
    webviewView: vscode.WebviewView,
    _ctx: vscode.WebviewViewResolveContext,
    _token: vscode.CancellationToken
  ): void {
    this._view = webviewView;

    webviewView.webview.options = {
      enableScripts: true,
      localResourceRoots: [this._extensionUri],
    };

    webviewView.webview.html = this._buildHtml();
    this._setMessageListener(webviewView.webview);
    this.refresh();
  }

  public refresh(): void {
    if (!this._view) { return; }
    const highlights = loadHighlights(this._context);
    this._view.webview.postMessage({
      type: "update",
      highlights,
      backgroundsState: highlights.length === 0 || highlights.every((h) => h.backgroundVisible !== false)
        ? "on"
        : highlights.every((h) => h.backgroundVisible === false)
          ? "off"
          : "mixed",
      defaultOpacity: vscode.workspace
        .getConfiguration("codemark")
        .get<number>("highlightOpacity", 0.28),
    });
  }

  public reveal(): void {
    this._view?.show?.(true);
  }

  private _setMessageListener(webview: vscode.Webview): void {
    webview.onDidReceiveMessage(
      async (msg: { command: string; id?: string; filePath?: string; snippet?: string; hash?: string; backgroundVisible?: string; opacity?: string }) => {
        switch (msg.command) {
          case "jumpTo":
            this._onAction("jumpTo", {
              filePath: msg.filePath,
              snippet: msg.snippet,
              hash: msg.hash,
            });
            break;
          case "delete":
            if (msg.id) {
              removeHighlight(this._context, msg.id);
              this.refresh();
              this._onAction("refresh", {});
            }
            break;
          case "editTag":
            this._onAction("editTag", { id: msg.id });
            break;
          case "changeColor":
            this._onAction("changeColor", { id: msg.id });
            break;
          case "toggleBackground":
            this._onAction("toggleBackground", {});
            break;
          case "setBackgroundVisible":
            if (msg.id && msg.backgroundVisible !== undefined) {
              this._onAction("setBackgroundVisible", {
                id: msg.id,
                backgroundVisible: msg.backgroundVisible,
              });
            }
            break;
          case "setOpacity":
            if (msg.id && msg.opacity !== undefined) {
              this._onAction("setOpacity", {
                id: msg.id,
                opacity: msg.opacity,
              });
            }
            break;
          case "ready":
            this.refresh();
            break;
        }
      },
      undefined,
      this._context.subscriptions
    );
  }

  private _buildHtml(): string {
    const nonce = getNonce();
    return /* html */ `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'nonce-${nonce}'; script-src 'nonce-${nonce}';">
  <title>Code Mark Highlighter</title>
  <style nonce="${nonce}">
    *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }

    :root {
      --dm-bg: var(--vscode-sideBar-background, #1e1e2e);
      --dm-fg: var(--vscode-foreground, #cdd6f4);
      --dm-muted: var(--vscode-descriptionForeground, #7f849c);
      --dm-border: var(--vscode-panel-border, #313244);
      --dm-input-bg: var(--vscode-input-background, #181825);
      --dm-hover: var(--vscode-list-hoverBackground, #2a2a3c);
      --dm-accent: var(--vscode-focusBorder, #89b4fa);
      --dm-btn: var(--vscode-button-background, #89b4fa);
      --dm-btn-fg: var(--vscode-button-foreground, #1e1e2e);
      --dm-danger: #f38ba8;
      --dm-radius: 8px;
      --dm-font: var(--vscode-font-family, 'Segoe UI', system-ui, sans-serif);
      --dm-mono: var(--vscode-editor-font-family, 'Cascadia Code', 'Fira Code', monospace);
    }

    body {
      font-family: var(--dm-font);
      font-size: 13px;
      color: var(--dm-fg);
      background: var(--dm-bg);
      overflow-x: hidden;
      height: 100vh;
      display: flex;
      flex-direction: column;
    }

    /* ── Header ── */
    .header {
      display: flex;
      align-items: center;
      gap: 8px;
      padding: 12px 12px 8px;
      border-bottom: 1px solid var(--dm-border);
      flex-shrink: 0;
    }
    .header-logo {
      font-size: 16px;
    }
    .header-title {
      font-weight: 700;
      font-size: 13px;
      letter-spacing: 0.5px;
      flex: 1;
    }
    .header-count {
      font-size: 11px;
      color: var(--dm-muted);
      background: var(--dm-input-bg);
      border-radius: 10px;
      padding: 2px 7px;
    }
    .header-toggle {
      flex-shrink: 0;
      padding: 3px 6px;
      border: 1px solid var(--dm-border);
      border-radius: 4px;
      background: transparent;
      color: var(--dm-fg);
      font: inherit;
      font-size: 10px;
      cursor: pointer;
    }
    .header-toggle:hover, .header-toggle:focus-visible {
      border-color: var(--dm-accent);
      outline: none;
    }

    /* ── Filter Bar ── */
    .filter-bar {
      padding: 8px 12px;
      display: flex;
      gap: 6px;
      flex-shrink: 0;
      border-bottom: 1px solid var(--dm-border);
    }
    .filter-bar input {
      flex: 1;
      background: var(--dm-input-bg);
      border: 1px solid var(--dm-border);
      border-radius: 6px;
      color: var(--dm-fg);
      font-family: var(--dm-font);
      font-size: 12px;
      padding: 5px 8px;
      outline: none;
      transition: border-color 0.15s;
    }
    .filter-bar input:focus {
      border-color: var(--dm-accent);
    }
    .filter-bar select {
      background: var(--dm-input-bg);
      border: 1px solid var(--dm-border);
      border-radius: 6px;
      color: var(--dm-fg);
      font-family: var(--dm-font);
      font-size: 12px;
      padding: 5px 6px;
      outline: none;
      cursor: pointer;
    }

    /* ── List ── */
    .list {
      flex: 1;
      overflow-y: auto;
      padding: 6px 0;
    }
    .list::-webkit-scrollbar { width: 4px; }
    .list::-webkit-scrollbar-track { background: transparent; }
    .list::-webkit-scrollbar-thumb { background: var(--dm-border); border-radius: 4px; }

    /* ── Highlight Card ── */
    .card {
      display: flex;
      flex-direction: column;
      gap: 4px;
      margin: 3px 8px;
      padding: 8px 10px 8px 12px;
      background: var(--dm-input-bg);
      border: 1px solid var(--dm-border);
      border-radius: var(--dm-radius);
      border-left-width: 3px;
      cursor: pointer;
      transition: background 0.12s, transform 0.1s;
      position: relative;
      animation: fadeIn 0.2s ease;
    }
    .card:hover {
      background: var(--dm-hover);
      transform: translateX(1px);
    }

    @keyframes fadeIn {
      from { opacity: 0; transform: translateY(4px); }
      to   { opacity: 1; transform: translateY(0); }
    }

    .card-top {
      display: flex;
      align-items: center;
      gap: 6px;
    }
    .card-color-dot {
      width: 8px;
      height: 8px;
      border-radius: 50%;
      flex-shrink: 0;
    }
    .card-tag {
      font-size: 10px;
      font-weight: 700;
      letter-spacing: 0.6px;
      text-transform: uppercase;
      padding: 1px 6px;
      border-radius: 4px;
      opacity: 0.9;
      flex-shrink: 0;
    }
    .card-file {
      font-size: 10px;
      color: var(--dm-muted);
      margin-left: auto;
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
      max-width: 120px;
    }

    .card-snippet {
      font-family: var(--dm-mono);
      font-size: 10.5px;
      color: var(--dm-muted);
      white-space: pre;
      overflow: hidden;
      text-overflow: ellipsis;
      line-clamp: 2;
      -webkit-line-clamp: 2;
      display: -webkit-box;
      -webkit-box-orient: vertical;
      background: var(--dm-bg);
      padding: 4px 6px;
      border-radius: 4px;
      border: 1px solid var(--dm-border);
      max-height: 40px;
    }

    .card-actions {
      display: flex;
      flex-wrap: wrap;
      gap: 6px;
      margin-top: 2px;
    }

    .btn {
      min-height: 30px;
      font-size: 12px;
      font-family: var(--dm-font);
      padding: 4px 9px;
      border-radius: 4px;
      border: 1px solid var(--dm-border);
      background: var(--dm-hover);
      color: var(--dm-fg);
      cursor: pointer;
      transition: background 0.12s, border-color 0.12s;
    }
    .btn:hover { background: var(--dm-accent); color: var(--dm-btn-fg); border-color: var(--dm-accent); }
    .btn-danger:hover { background: var(--dm-danger); color: #fff; border-color: var(--dm-danger); }
    .btn-jump { font-weight: 600; }
    .btn-delete { min-width: 32px; font-size: 15px; }

    .card-display-controls {
      display: flex;
      flex-direction: column;
      gap: 6px;
      padding-top: 2px;
    }
    .card-background-toggle {
      align-self: flex-start;
    }
    .opacity-control {
      display: grid;
      grid-template-columns: auto minmax(40px, 1fr) 34px;
      align-items: center;
      gap: 7px;
      color: var(--dm-muted);
      font-size: 11px;
    }
    .opacity-control input {
      width: 100%;
      min-width: 0;
      accent-color: var(--dm-accent);
      cursor: pointer;
    }
    .opacity-value {
      color: var(--dm-fg);
      text-align: right;
      font-variant-numeric: tabular-nums;
    }

    /* ── Empty State ── */
    .empty {
      display: flex;
      flex-direction: column;
      align-items: center;
      justify-content: center;
      gap: 10px;
      padding: 40px 20px;
      color: var(--dm-muted);
      text-align: center;
    }
    .empty-icon { font-size: 40px; opacity: 0.5; }
    .empty-title { font-size: 13px; font-weight: 600; }
    .empty-sub { font-size: 11px; line-height: 1.5; }

    /* ── Stats Bar ── */
    .stats-bar {
      display: flex;
      padding: 6px 12px;
      gap: 8px;
      font-size: 10px;
      color: var(--dm-muted);
      border-top: 1px solid var(--dm-border);
      flex-shrink: 0;
    }
    .stats-bar span { display: flex; align-items: center; gap: 3px; }
  </style>
</head>
<body>

  <!-- Header -->
  <div class="header">
    <span class="header-logo">🔖</span>
    <span class="header-title">Code Mark</span>
    <button class="header-toggle" id="background-toggle" type="button" aria-pressed="true" title="Hide highlight backgrounds">BG On</button>
    <span class="header-count" id="count">0</span>
  </div>

  <!-- Filter Bar -->
  <div class="filter-bar">
    <input id="search" type="text" placeholder="Search tags, code…" />
    <select id="filter-tag">
      <option value="">All tags</option>
    </select>
  </div>

  <!-- Highlight List -->
  <div class="list" id="list">
    <div class="empty">
      <div class="empty-icon">✨</div>
      <div class="empty-title">No highlights yet</div>
      <div class="empty-sub">Select code → right-click<br>→ <strong>Code Mark: Highlight Code</strong></div>
    </div>
  </div>

  <!-- Stats Bar -->
  <div class="stats-bar" id="stats-bar" style="display:none">
    <span id="stat-total">0 highlights</span>
    <span>·</span>
    <span id="stat-files">0 files</span>
  </div>

  <script nonce="${nonce}">
    const vscode = acquireVsCodeApi();
    let allHighlights = [];
    let searchQuery = '';
    let filterTag = '';
    let defaultOpacity = 0.28;

    const listEl = document.getElementById('list');
    const countEl = document.getElementById('count');
    const statsBar = document.getElementById('stats-bar');
    const statTotal = document.getElementById('stat-total');
    const statFiles = document.getElementById('stat-files');
    const filterTagEl = document.getElementById('filter-tag');
    const searchEl = document.getElementById('search');
    const backgroundToggleEl = document.getElementById('background-toggle');

    // Notify extension we're ready
    vscode.postMessage({ command: 'ready' });

    // Receive updates from extension
    window.addEventListener('message', (event) => {
      const msg = event.data;
      if (msg.type === 'update') {
        allHighlights = msg.highlights || [];
        defaultOpacity = msg.defaultOpacity ?? defaultOpacity;
        updateBackgroundToggle(msg.backgroundsState);
        rebuildTagFilter();
        render();
      }
    });

    backgroundToggleEl.addEventListener('click', () => {
      vscode.postMessage({ command: 'toggleBackground' });
    });

    function updateBackgroundToggle(state) {
      backgroundToggleEl.textContent = state === 'mixed' ? 'BG Mixed' : state === 'on' ? 'BG On' : 'BG Off';
      backgroundToggleEl.title = state === 'on'
        ? 'Hide all highlight backgrounds'
        : 'Show all highlight backgrounds';
      backgroundToggleEl.setAttribute('aria-pressed', String(state === 'on'));
    }

    // Search / filter
    searchEl.addEventListener('input', (e) => {
      searchQuery = e.target.value.toLowerCase();
      render();
    });
    filterTagEl.addEventListener('change', (e) => {
      filterTag = e.target.value;
      render();
    });

    function rebuildTagFilter() {
      const tags = [...new Set(allHighlights.map(h => h.tag).filter(Boolean))].sort();
      const current = filterTagEl.value;
      filterTagEl.innerHTML = '<option value="">All tags</option>' +
        tags.map(t => \`<option value="\${esc(t)}" \${t === current ? 'selected' : ''}>\${esc(t)}</option>\`).join('');
    }

    function filteredHighlights() {
      return allHighlights.filter(h => {
        if (filterTag && h.tag !== filterTag) return false;
        if (searchQuery) {
          const haystack = ((h.tag || '') + ' ' + (h.codeSnippet || '') + ' ' + (h.filePath || '')).toLowerCase();
          if (!haystack.includes(searchQuery)) return false;
        }
        return true;
      });
    }

    function render() {
      const items = filteredHighlights();
      countEl.textContent = items.length;

      if (items.length === 0) {
        if (allHighlights.length === 0) {
          listEl.innerHTML = \`<div class="empty">
            <div class="empty-icon">✨</div>
            <div class="empty-title">No highlights yet</div>
            <div class="empty-sub">Select code → right-click<br>→ <strong>Code Mark: Highlight Code</strong></div>
          </div>\`;
        } else {
          listEl.innerHTML = \`<div class="empty">
            <div class="empty-icon">🔍</div>
            <div class="empty-title">No results</div>
            <div class="empty-sub">Try a different search or filter.</div>
          </div>\`;
        }
        statsBar.style.display = 'none';
        return;
      }

      // Sort: by file then by tag
      const sorted = [...items].sort((a, b) =>
        a.filePath.localeCompare(b.filePath) || (a.tag || '').localeCompare(b.tag || '')
      );

      listEl.innerHTML = sorted.map(h => renderCard(h)).join('');

      // Stats
      const uniqueFiles = new Set(items.map(h => h.filePath)).size;
      statTotal.textContent = items.length + ' highlight' + (items.length !== 1 ? 's' : '');
      statFiles.textContent = uniqueFiles + ' file' + (uniqueFiles !== 1 ? 's' : '');
      statsBar.style.display = 'flex';

      // Bind card events
      listEl.querySelectorAll('.card').forEach(card => {
        const id = card.dataset.id;
        const h = allHighlights.find(x => x.id === id);
        if (!h) return;

        card.addEventListener('click', (e) => {
          if (e.target.closest('.card-actions, .card-display-controls')) return;
          vscode.postMessage({ command: 'jumpTo', filePath: h.filePath, snippet: h.codeSnippet, hash: h.codeHash });
        });

        card.querySelector('.btn-jump')?.addEventListener('click', (e) => {
          e.stopPropagation();
          vscode.postMessage({ command: 'jumpTo', filePath: h.filePath, snippet: h.codeSnippet, hash: h.codeHash });
        });
        card.querySelector('.btn-tag')?.addEventListener('click', (e) => {
          e.stopPropagation();
          vscode.postMessage({ command: 'editTag', id: h.id });
        });
        card.querySelector('.btn-color')?.addEventListener('click', (e) => {
          e.stopPropagation();
          vscode.postMessage({ command: 'changeColor', id: h.id });
        });
        card.querySelector('.btn-delete')?.addEventListener('click', (e) => {
          e.stopPropagation();
          vscode.postMessage({ command: 'delete', id: h.id });
        });
        card.querySelector('.card-background-toggle')?.addEventListener('click', (e) => {
          e.stopPropagation();
          vscode.postMessage({
            command: 'setBackgroundVisible',
            id: h.id,
            backgroundVisible: String(h.backgroundVisible === false),
          });
        });
        const opacitySlider = card.querySelector('.opacity-slider');
        const opacityValue = card.querySelector('.opacity-value');
        opacitySlider?.addEventListener('input', (e) => {
          opacityValue.textContent = e.target.value + '%';
        });
        opacitySlider?.addEventListener('change', (e) => {
          e.stopPropagation();
          vscode.postMessage({
            command: 'setOpacity',
            id: h.id,
            opacity: String(Number(e.target.value) / 100),
          });
        });
      });
    }

    function renderCard(h) {
      const snippet = h.codeSnippet.split('\\n').slice(0, 3).join('\\n').slice(0, 200);
      const fileName = h.filePath.split(/[/\\\\]/).pop() || h.filePath;
      const tagColor = h.color;
      const tagBg = hexToRgba(h.color, 0.18);
      const opacity = Math.round((h.opacity ?? defaultOpacity) * 100);
      const backgroundVisible = h.backgroundVisible !== false;

      return \`<div class="card" data-id="\${esc(h.id)}" style="border-left-color:\${esc(h.color)}">
        <div class="card-top">
          <span class="card-color-dot" style="background:\${esc(h.color)}"></span>
          \${h.tag ? \`<span class="card-tag" style="background:\${tagBg};color:\${esc(tagColor)}">\${esc(h.tag)}</span>\` : ''}
          <span class="card-file" title="\${esc(h.filePath)}">\${esc(fileName)}</span>
        </div>
        <div class="card-snippet">\${esc(snippet)}</div>
        <div class="card-display-controls">
          <label class="opacity-control">
            <span>Opacity</span>
            <input class="opacity-slider" type="range" min="0" max="100" step="1" value="\${opacity}" aria-label="Highlight opacity">
            <span class="opacity-value">\${opacity}%</span>
          </label>
        </div>
        <div class="card-actions">
          <button class="btn btn-jump">↗ Jump</button>
          <button class="btn btn-tag">🏷 Tag</button>
          <button class="btn btn-color">🎨 Color</button>
          <button class="btn card-background-toggle" type="button" aria-pressed="\${backgroundVisible}" title="Toggle this highlight's background">BG \${backgroundVisible ? 'On' : 'Off'}</button>
          <button class="btn btn-danger btn-delete">🗑</button>
        </div>
      </div>\`;
    }

    function esc(str) {
      return String(str)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#039;');
    }

    function hexToRgba(hex, alpha) {
      const clean = hex.replace('#', '');
      const r = parseInt(clean.substring(0, 2), 16);
      const g = parseInt(clean.substring(2, 4), 16);
      const b = parseInt(clean.substring(4, 6), 16);
      return \`rgba(\${r},\${g},\${b},\${alpha})\`;
    }
  </script>
</body>
</html>`;
  }
}

function getNonce(): string {
  let text = "";
  const possible =
    "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789";
  for (let i = 0; i < 32; i++) {
    text += possible.charAt(Math.floor(Math.random() * possible.length));
  }
  return text;
}
