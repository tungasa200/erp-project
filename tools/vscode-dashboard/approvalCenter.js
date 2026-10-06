// WY 승인 센터: 작업창 탭 + 상태 표시줄 '승인 대기 N'. 데이터는 approvalStore.js의 파일 저장소.
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
      // 인자 { id }(요청 id)를 주면 탭을 열고 그 카드를 고른다(활동 탭의 "카드 열기", 계획 2.2)
      vscode.commands.registerCommand(OPEN_COMMAND, (arg) => this.open(arg)),
      vscode.window.registerWebviewPanelSerializer(VIEW_TYPE, {
        // VS Code를 다시 열면 탭을 되살린다
        deserializeWebviewPanel: async (panel) => this.attach(panel),
      }),
      { dispose: () => this.dispose() },
    );

    // 이 창의 워크스페이스가 속한 프로젝트의 승인 폴더(설정이 없으면 이전처럼 바탕 폴더)
    const folder = vscode.workspace.workspaceFolders && vscode.workspace.workspaceFolders[0];
    this.root = store.rootFor(folder && folder.uri.fsPath);
    store.ensureDirs(this.root);
    this.watch();
    this.timer = setInterval(() => this.reload(), POLL);
    this.reload();
  }

  watch() {
    const p = store.paths(this.root);
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
      state = store.readState(this.root);
      state.notice = this.legacyNotice();
      state.error = '';
    } catch (err) {
      state = { ...(this.state || { pending: [], recent: [], root: this.root }), error: String(err.message || err) };
    }
    this.state = state;
    this.renderStatus();
    this.post({ type: 'state', state: { ...state, kinds: store.KINDS, routineKinds: store.ROUTINE_KINDS } });
  }

  // 프로젝트 폴더로 옮긴 뒤 옛 바탕 폴더에 요청이 남아 있으면 알린다(그 요청은 이 탭에 보이지 않는다)
  legacyNotice() {
    if (this.root === store.ROOT) return '';
    const n = store.countPending(store.ROOT);
    return n ? `옛 승인 폴더(${store.ROOT}\\requests)에 결정 안 된 요청 ${n}건이 있습니다. 이 프로젝트의 요청은 ${this.root}\\requests에 써야 이 탭에 보입니다.` : '';
  }

  renderStatus() {
    const n = this.state.pending.length;
    const choices = this.state.pending.filter((r) => r.kind === 'choice').length;
    const broken = this.state.pending.filter((r) => r.broken).length;
    const parts = [n - choices - broken && `승인 ${n - choices - broken}건`, choices && `결정 ${choices}건`, broken && `형식 오류 ${broken}건`].filter(Boolean).join(' · ');
    this.status.text = n ? `$(bell-dot) 승인 대기 ${n}` : '$(check) 승인 대기 없음';
    this.status.tooltip = n ? `WY 승인 센터: ${parts} — 눌러서 열기` : 'WY 승인 센터 열기';
    this.status.backgroundColor = n ? new vscode.ThemeColor('statusBarItem.warningBackground') : undefined;
    this.status.accessibilityInformation = { label: n ? `승인 대기 ${parts}, 승인 센터 열기` : '승인 대기 없음, 승인 센터 열기' };
    this.status.show();
  }

  open(arg) {
    this.selectId = arg && typeof arg.id === 'string' ? arg.id : undefined;
    if (this.panel) {
      this.panel.reveal();
      if (this.selectId) this.post({ type: 'select', id: this.selectId });
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
      if (msg.type === 'ready') {
        this.reload();
        if (this.selectId) this.post({ type: 'select', id: this.selectId }); // 화면에서 카드 고르기는 B2-5
      }
      else if (msg.type === 'decide') {
        store.decide(msg.id, msg.decision, { reason: msg.reason, root: this.root });
        this.reload();
      } else if (msg.type === 'answer') {
        store.answer(msg.id, msg.answers, { note: msg.note, root: this.root });
        this.reload();
      } else if (msg.type === 'openFolder') {
        vscode.env.openExternal(vscode.Uri.file(this.root));
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
