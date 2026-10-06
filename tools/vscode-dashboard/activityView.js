// 활동 탭(작업창 webview): 세션 간 메시지 피드·세션 상태·결함 흐름 묶음(OPS-09). 담당 WY-backend3(운영 도구 구현 계획 3.3).
// 지금은 빈 틀이다. extension.js는 register(context)만 부른다.
const vscode = require('vscode');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const VIEW_TYPE = 'wyActivity';
const OPEN_COMMAND = 'wyActivity.open';

class ActivityView {
  constructor(context) {
    this.context = context;
    this.panel = undefined;
  }

  open() {
    if (this.panel) {
      this.panel.reveal();
      return;
    }
    const media = vscode.Uri.joinPath(this.context.extensionUri, 'media');
    this.attach(vscode.window.createWebviewPanel(VIEW_TYPE, 'WY 활동', vscode.ViewColumn.Active, { enableScripts: true, localResourceRoots: [media] }));
  }

  attach(panel) {
    const media = vscode.Uri.joinPath(this.context.extensionUri, 'media');
    this.panel = panel;
    panel.webview.options = { enableScripts: true, localResourceRoots: [media] };
    panel.webview.html = this.html(panel.webview, media);
    panel.webview.onDidReceiveMessage((msg) => this.onMessage(msg));
    panel.onDidDispose(() => {
      this.panel = undefined;
    });
  }

  onMessage(msg) {
    if (msg.type === 'ready') this.post({ type: 'state', state: { feed: [], sessions: [], bundles: [] } });
  }

  html(webview, media) {
    const nonce = crypto.randomBytes(16).toString('base64');
    const uri = (f) => webview.asWebviewUri(vscode.Uri.joinPath(media, f)).toString();
    const csp = ["default-src 'none'", `style-src ${webview.cspSource}`, `script-src 'nonce-${nonce}'`, `img-src ${webview.cspSource}`].join('; ');
    return fs
      .readFileSync(path.join(media.fsPath, 'activity.html'), 'utf8')
      .replace(/{{csp}}/g, csp)
      .replace(/{{nonce}}/g, nonce)
      .replace(/{{css}}/g, uri('activity.css'))
      .replace(/{{js}}/g, uri('activity.js'));
  }

  post(msg) {
    if (this.panel) this.panel.webview.postMessage(msg);
  }
}

function register(context) {
  const view = new ActivityView(context);
  context.subscriptions.push(
    vscode.commands.registerCommand(OPEN_COMMAND, () => view.open()),
    vscode.window.registerWebviewPanelSerializer(VIEW_TYPE, { deserializeWebviewPanel: async (panel) => view.attach(panel) }),
  );
  return view;
}

module.exports = { register, VIEW_TYPE, OPEN_COMMAND };
