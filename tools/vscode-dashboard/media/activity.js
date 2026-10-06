// 활동 탭 렌더링(빈 틀). 상태는 activityView.js가 postMessage로 보낸다.
(() => {
  const vscode = acquireVsCodeApi();
  window.addEventListener('message', () => {});
  vscode.postMessage({ type: 'ready' });
})();
