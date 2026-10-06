// WY 승인 센터: 작업창 탭 + 상태 표시줄 '승인 대기 N'. 데이터는 approvals.js의 파일 저장소.
const vscode = require('vscode');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const store = require('./approvalStore');

const VIEW_TYPE = 'wyApprovals';
const OPEN_COMMAND = 'wyApprovals.open';
const POLL = 15000; // 파일 감시가 놓친 변경을 잡는 느린 주기

class ApprovalCenter {
  constructor(context) {
    this.context = context;
    this.panel = undefined;
    this.state = undefined;
    this.watchers = [];
    this.timer = undefined;
    this.debounce = undefined;

    this.status = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left, 100);
    this.status.command = OPEN_COMMAND;
    this.status.name = 'WY 승인 대기';

    context.subscriptions.push(
      this.status,
      vscode.commands.registerCommand(OPEN_COMMAND, () => this.open()),
      vscode.window.registerWebviewPanelSerializer(VIEW_TYPE, {
        // VS Code를 다시 열면 탭을 되살린다
        deserializeWebviewPanel: async (panel) => this.attach(panel),
      }),
      { dispose: () => this.dispose() },
    );

    store.ensureDirs();
    this.watch();
    this.timer = setInterval(() => this.reload(), POLL);
    this.reload();
  }

  watch() {
    const p = store.paths();
    for (const target of [p.root, p.requests, p.decisions]) {
      try {
        this.watchers.push(fs.watch(target, () => this.schedule()));
      } catch {
        // 감시를 못 걸면 느린 주기만으로 갱신한다
      }
    }
  }

  schedule() {
    clearTimeout(this.debounce);
    this.debounce = setTimeout(() => this.reload(), 150);
  }

  reload() {
    let state;
    try {
      state = store.readState();
      // 토글이 켜진 종류는 바로 승인하고 다시 읽는다
      if (store.autoApprove(state).length) state = store.readState();
      state.error = '';
    } catch (err) {
      state = { ...(this.state || { pending: [], recent: [], config: store.readConfig(), root: store.ROOT }), error: String(err.message || err) };
    }
    this.state = state;
    this.renderStatus();
    this.post({ type: 'state', state: { ...state, kinds: store.KINDS, autoKinds: store.AUTO_KINDS } });
  }

  renderStatus() {
    const n = this.state.pending.length;
    this.status.text = n ? `$(bell-dot) 승인 대기 ${n}` : '$(check) 승인 대기 없음';
    this.status.tooltip = n ? `WY 승인 센터: 대기 ${n}건 — 눌러서 열기` : 'WY 승인 센터 열기';
    this.status.backgroundColor = n ? new vscode.ThemeColor('statusBarItem.warningBackground') : undefined;
    this.status.accessibilityInformation = { label: n ? `승인 대기 ${n}건, 승인 센터 열기` : '승인 대기 없음, 승인 센터 열기' };
    this.status.show();
  }

  open() {
    if (this.panel) {
      this.panel.reveal();
      return;
    }
    const panel = vscode.window.createWebviewPanel(VIEW_TYPE, 'WY 승인 센터', vscode.ViewColumn.Active, {
      enableScripts: true,
      localResourceRoots: [vscode.Uri.joinPath(this.context.extensionUri, 'media')],
    });
    this.attach(panel);
  }

  attach(panel) {
    const media = vscode.Uri.joinPath(this.context.extensionUri, 'media');
    this.panel = panel;
    panel.webview.options = { enableScripts: true, localResourceRoots: [media] };
    panel.iconPath = vscode.Uri.joinPath(media, 'approvals-icon.svg');
    panel.webview.html = this.html(panel.webview, media);
    panel.webview.onDidReceiveMessage((msg) => this.onMessage(msg));
    panel.onDidDispose(() => {
      this.panel = undefined;
    });
  }

  onMessage(msg) {
    try {
      if (msg.type === 'ready') this.reload();
      else if (msg.type === 'toggle') {
        if (!store.AUTO_KINDS.includes(msg.kind)) throw new Error('자동 승인할 수 없는 종류');
        const config = store.readConfig();
        config.autoApprove[msg.kind] = !!msg.value;
        store.writeConfig(config);
        this.reload();
      } else if (msg.type === 'decide') {
        store.decide(msg.id, msg.decision, { reason: msg.reason, by: 'user' });
        this.reload();
      } else if (msg.type === 'openFolder') {
        vscode.env.openExternal(vscode.Uri.file(store.ROOT));
      }
    } catch (err) {
      this.post({ type: 'error', id: msg.id, message: String(err.message || err) });
      this.reload();
    }
  }

  html(webview, media) {
    const nonce = crypto.randomBytes(16).toString('base64');
    const uri = (f) => webview.asWebviewUri(vscode.Uri.joinPath(media, f)).toString();
    const csp = ["default-src 'none'", `style-src ${webview.cspSource}`, `script-src 'nonce-${nonce}'`, `img-src ${webview.cspSource}`].join('; ');
    return fs
      .readFileSync(path.join(media.fsPath, 'approvals.html'), 'utf8')
      .replace(/{{csp}}/g, csp)
      .replace(/{{nonce}}/g, nonce)
      .replace(/{{css}}/g, uri('approvals.css'))
      .replace(/{{js}}/g, uri('approvals.js'));
  }

  post(msg) {
    if (this.panel) this.panel.webview.postMessage(msg);
  }

  dispose() {
    clearInterval(this.timer);
    clearTimeout(this.debounce);
    this.watchers.forEach((w) => w.close());
    this.watchers = [];
  }
}

module.exports = { ApprovalCenter, VIEW_TYPE, OPEN_COMMAND };
