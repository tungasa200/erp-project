#!/usr/bin/env node
// 사용 설명서 생성 (D-216 ①·보완): docs/manual/00~10 Markdown → HTML(WY-design 틀) → headless Chrome 인쇄 PDF + 웹 페이지.
// 사용: node manual/build-manual.js [--edition YYYY-MM-DD] [--keep-html]
// 결과: docs/manual/worklog-manual.pdf, docs/manual/web/(index.html·web.css·images·fonts·PDF).
// 발행 때 docs/manual/web/을 통째로 frontend/public/manual/에 복사한다.
'use strict';
const fs = require('fs');
const path = require('path');
const os = require('os');
const { execFileSync } = require('child_process');
const { pathToFileURL } = require('url');

const ROOT = path.resolve(__dirname, '..', '..', '..');
const MANUAL = path.join(ROOT, 'docs', 'manual');
const PRINT = path.join(MANUAL, 'print');
const TEMPLATE = path.join(PRINT, 'template.html');
const FONT_CSS = path.join(ROOT, 'frontend', 'node_modules', 'pretendard', 'dist', 'web', 'variable', 'pretendardvariable.css');
const HTML_OUT = path.join(PRINT, 'worklog-manual.html'); // 틀의 상대경로(print.css·글꼴·../images)가 그대로 풀리도록 틀 옆에 만든다
const PDF_OUT = path.join(MANUAL, 'worklog-manual.pdf');
const WEB_TEMPLATE = path.join(PRINT, 'web.html');
const WEB_OUT = path.join(MANUAL, 'web');
const TITLE = 'WY Worklog 사용 설명서';

function fail(msg) {
  console.error('[중단] ' + msg);
  process.exit(1);
}

function arg(name) {
  const i = process.argv.indexOf(name);
  return i > 0 ? process.argv[i + 1] : undefined;
}

// ---------- Markdown → HTML (원고에 쓰는 문법만: 제목·문단·목록·인용·코드·표·그림·굵게·코드·링크) ----------

const esc = (s) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

function inline(text) {
  const codes = [];
  let s = text.replace(/`([^`]+)`/g, (_, c) => `\u0000${codes.push(c) - 1}\u0000`);
  s = esc(s);
  s = s.replace(/!\[([^\]]*)\]\(([^)\s]+)\)/g, (_, alt, src) => `<img src="${imgSrc(src)}" alt="${alt}">`);
  s = s.replace(/\[([^\]]+)\]\(([^)\s]+)\)/g, (_, t, href) => `<a href="${linkHref(href)}">${t}</a>`);
  s = s.replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>');
  return s.replace(/\u0000(\d+)\u0000/g, (_, i) => `<code>${esc(codes[i])}</code>`);
}

// 원고는 docs/manual/ 기준 상대경로, HTML은 docs/manual/print/에 생긴다
const imgSrc = (src) => (/^[a-z]+:/i.test(src) ? src : '../' + src);
function linkHref(href) {
  const m = href.match(/^(\d\d)-[^/]*\.md$/); // 다른 장 원고로 가는 링크는 PDF 안 장으로
  return m ? '#ch-' + m[1] : href;
}

const missing = [];
function figure(alt, src) {
  const kind = /_M(_|\.)/.test(path.basename(src)) ? 'shot-M' : 'shot-W';
  const cap = `<figcaption>${esc(alt)}</figcaption>`;
  if (/\.svg$/i.test(src) && fs.existsSync(path.join(MANUAL, src))) {
    // SVG는 인라인: <img> 안의 SVG는 페이지 글꼴(Pretendard)을 못 쓴다
    const svg = fs.readFileSync(path.join(MANUAL, src), 'utf8').replace(/<\?xml[\s\S]*?\?>|<!DOCTYPE[\s\S]*?>|<!--[\s\S]*?-->/g, '').trim();
    return `<figure class="shot ${kind}" role="img" aria-label="${esc(alt)}">${svg}${cap}</figure>`;
  }
  if (/^[a-z]+:/i.test(src) || fs.existsSync(path.join(MANUAL, src))) {
    return `<figure class="shot ${kind}"><img src="${imgSrc(src)}" alt="${esc(alt)}">${cap}</figure>`;
  }
  missing.push(src);
  return `<figure class="shot ${kind} pending"><div class="shot-pending"><span>촬영 예정</span><code>${esc(src)}</code></div>${cap}</figure>`;
}

const LIST_RE = /^( *)([-*]|\d+\.) +(.*)$/;

function blocks(lines, ctx) {
  const out = [];
  let i = 0;
  const para = [];
  const flush = () => {
    if (para.length) out.push(`<p>${inline(para.join('\n'))}</p>`);
    para.length = 0;
  };
  while (i < lines.length) {
    const line = lines[i];
    let m;
    if (!line.trim()) { flush(); i++; continue; }
    if (/^```/.test(line)) {
      flush();
      const body = [];
      for (i++; i < lines.length && !/^```/.test(lines[i]); i++) body.push(lines[i]);
      i++;
      out.push(`<pre><code>${esc(body.join('\n'))}</code></pre>`);
      continue;
    }
    if ((m = line.match(/^(#{1,6}) +(.*?) *#*$/))) {
      flush();
      const level = Math.max(1, m[1].length - ctx.shift);
      const id = level === 1 ? '' : ` id="${ctx.id}-s${++ctx.n}"`;
      out.push(`<h${level}${id}>${inline(m[2])}</h${level}>`);
      if (level === 1) ctx.title = m[2];
      i++;
      continue;
    }
    if (/^ {0,3}(-{3,}|\*{3,})$/.test(line)) { flush(); out.push('<hr>'); i++; continue; }
    if ((m = line.match(/^ *!\[([^\]]*)\]\(([^)\s]+)\) *$/))) { flush(); out.push(figure(m[1], m[2])); i++; continue; }
    if (/^>/.test(line)) {
      flush();
      const body = [];
      for (; i < lines.length && /^>/.test(lines[i]); i++) body.push(lines[i].replace(/^> ?/, ''));
      out.push(`<blockquote class="note">${blocks(body, ctx)}</blockquote>`);
      continue;
    }
    if (/^\|/.test(line) && i + 1 < lines.length && /^\|? *:?-{2,}/.test(lines[i + 1])) {
      flush();
      const cells = (l) => l.trim().replace(/^\||\|$/g, '').split(/(?<!\\)\|/).map((c) => inline(c.trim().replace(/\\\|/g, '|')));
      const head = cells(line);
      const rows = [];
      for (i += 2; i < lines.length && /^\|/.test(lines[i]); i++) rows.push(cells(lines[i]));
      out.push('<table><thead><tr>' + head.map((c) => `<th>${c}</th>`).join('') + '</tr></thead><tbody>' +
        rows.map((r) => '<tr>' + r.map((c) => `<td>${c}</td>`).join('') + '</tr>').join('') + '</tbody></table>');
      continue;
    }
    if ((m = line.match(LIST_RE)) && m[1].length === 0) {
      flush();
      const r = list(lines, i, ctx);
      out.push(r.html);
      i = r.next;
      continue;
    }
    para.push(line.trim());
    i++;
  }
  flush();
  return out.join('\n');
}

// 목록: 같은 들여쓰기의 항목을 모으고, 더 들여쓴 줄은 그 항목 안의 내용(하위 목록 등)으로 넘긴다
function list(lines, start, ctx) {
  const first = lines[start].match(LIST_RE);
  const indent = first[1].length;
  const ordered = /\d/.test(first[2]);
  const items = [];
  let i = start;
  while (i < lines.length) {
    const m = lines[i].match(LIST_RE);
    if (!m || m[1].length !== indent || /\d/.test(m[2]) !== ordered) break;
    const body = [m[3]];
    for (i++; i < lines.length; i++) {
      const l = lines[i];
      if (!l.trim()) {
        const nxt = lines.slice(i + 1).find((x) => x.trim());
        if (nxt && nxt.match(/^ */)[0].length > indent) { body.push(''); continue; }
        break;
      }
      if (l.match(/^ */)[0].length <= indent) break;
      body.push(l.slice(Math.min(l.match(/^ */)[0].length, indent + (ordered ? 3 : 2))));
    }
    const inner = blocks(body, ctx);
    items.push(`<li>${inner.replace(/^<p>([\s\S]*?)<\/p>/, '$1')}</li>`); // 첫 문단은 p 없이
    while (i < lines.length && !lines[i].trim()) {
      const nxt = lines.slice(i).find((x) => x.trim());
      const nm = nxt && nxt.match(LIST_RE);
      if (nm && nm[1].length === indent) i++; else break;
    }
  }
  const startAttr = ordered && first[2] !== '1.' ? ` start="${parseInt(first[2], 10)}"` : '';
  return { html: ordered ? `<ol${startAttr}>${items.join('')}</ol>` : `<ul>${items.join('')}</ul>`, next: i };
}

// ---------- 원고 읽기 ----------

function readChapter(file) {
  const raw = fs.readFileSync(path.join(MANUAL, file), 'utf8').replace(/\r\n/g, '\n');
  return raw.replace(/<!--[\s\S]*?-->\n?/g, ''); // 원고 주석(담당·근거·촬영 목록)은 PDF에 넣지 않는다
}

function build(edition) {
  const files = fs.readdirSync(MANUAL).filter((f) => /^\d\d-.+\.md$/.test(f)).sort();
  if (!files.length || !files[0].startsWith('00-')) fail('docs/manual/00-표지.md를 찾지 못했습니다');
  const chapters = [];
  let cover = '';
  for (const f of files) {
    const no = f.slice(0, 2);
    let md = readChapter(f).replace(/\{발행일\}/g, edition);
    let shift = 0;
    if (no === '00') {
      // 표지: 첫 ## 앞(제목·부제·기준 화면 줄)은 {{COVER}}, 나머지('이 설명서 읽는 법')는 한 단계 올려 ch-00
      const cut = md.search(/^## /m);
      cover = blocks(md.slice(0, cut).split('\n'), { id: 'cover', shift: 0, n: 0 });
      md = md.slice(cut);
      shift = 1;
    }
    const ctx = { id: 'ch-' + no, shift, n: 0, title: '' };
    const html = blocks(md.split('\n'), ctx);
    chapters.push({ no, title: ctx.title, html });
  }
  return { cover, chapters };
}

function render(template, edition, doc, pages) {
  const toc = '<nav class="toc"><ol>' + doc.chapters.map((c) =>
    `<li><a href="#ch-${c.no}"><span class="toc-title">${inline(c.title)}</span><span class="toc-page">${pages ? pages[c.no] || '' : '0'}</span></a></li>`,
  ).join('') + '</ol></nav>';
  const body = doc.chapters.map((c) => `<section class="chapter" id="ch-${c.no}">\n${c.html}\n</section>`).join('\n');
  const fill = { TITLE: esc(TITLE), EDITION: esc(edition), COVER: doc.cover, TOC: toc, BODY: body };
  return template
    .replace(/<!--[\s\S]*?-->/g, '') // 틀 주석에 적힌 자리 표시까지 채우지 않도록
    .replace(/\{\{(TITLE|EDITION|COVER|TOC|BODY|PDF_HREF)\}\}/g, (_, k) => (k === 'PDF_HREF' ? path.basename(PDF_OUT) : fill[k]));
}

// ---------- Chrome 인쇄 ----------

function chromePath() {
  const c = [process.env.CHROME_PATH,
    'C:/Program Files/Google/Chrome/Application/chrome.exe',
    'C:/Program Files (x86)/Google/Chrome/Application/chrome.exe',
    path.join(os.homedir(), 'AppData/Local/Google/Chrome/Application/chrome.exe')];
  const found = c.find((p) => p && fs.existsSync(p));
  if (!found) fail('Chrome을 찾지 못했습니다(CHROME_PATH로 지정)');
  return found;
}

function print(chrome, htmlFile, pdfFile) {
  const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'wy-manual-chrome-'));
  try {
    execFileSync(chrome, [
      '--headless=new', '--disable-gpu', '--no-first-run', '--no-default-browser-check',
      '--allow-file-access-from-files', `--user-data-dir=${profile}`,
      '--no-pdf-header-footer', '--generate-pdf-document-outline', '--virtual-time-budget=10000',
      `--print-to-pdf=${pdfFile}`, pathToFileURL(htmlFile).href,
    ], { stdio: 'pipe', timeout: 180000 });
  } finally {
    fs.rmSync(profile, { recursive: true, force: true });
  }
  if (!fs.existsSync(pdfFile)) fail('Chrome이 PDF를 만들지 못했습니다');
}

// ---------- PDF 읽기: 쪽 수와 장 위치(목차 링크의 이름 붙은 목적지) ----------

function pdfInfo(file) {
  const s = fs.readFileSync(file).toString('latin1');
  const objs = new Map();
  for (const m of s.matchAll(/(\d+) 0 obj\b([\s\S]*?)endobj/g)) objs.set(m[1], m[2]);
  const kids = (id) => {
    const o = objs.get(id) || '';
    if (/\/Type\s*\/Pages\b/.test(o)) {
      const k = o.match(/\/Kids\s*\[([^\]]*)\]/);
      return k ? [...k[1].matchAll(/(\d+) 0 R/g)].flatMap((x) => kids(x[1])) : [];
    }
    return [id];
  };
  const root = s.match(/\/Root\s+(\d+) 0 R/);
  const pagesRef = root && (objs.get(root[1]) || '').match(/\/Pages\s+(\d+) 0 R/);
  const order = pagesRef ? kids(pagesRef[1]) : [];
  const pageNo = new Map(order.map((id, i) => [id, i + 1]));
  const dests = {};
  // Chrome은 /Dests 사전에 '/ch-01 [295 0 R /XYZ …]'처럼 이름 객체로 적는다(문자열 '(ch-01)'도 받아 둠)
  for (const m of s.matchAll(/(?:\/|\()(ch-\d\d)\)?\s*\[\s*(\d+) 0 R/g)) dests[m[1].slice(3)] = pageNo.get(m[2]);
  return { pages: order.length, dests };
}

// ---------- 웹 페이지 (D-216 보완): 그림은 images/… 상대경로, 쪽 번호 없음 ----------

function buildWeb(edition, doc) {
  if (!fs.existsSync(WEB_TEMPLATE)) {
    console.warn('[주의] 웹 틀이 없어 웹 페이지를 건너뜀: docs/manual/print/web.html (WY-design)');
    return;
  }
  fs.rmSync(WEB_OUT, { recursive: true, force: true });
  fs.mkdirSync(WEB_OUT, { recursive: true });
  const html = render(fs.readFileSync(WEB_TEMPLATE, 'utf8'), edition, doc, {}).replace(/(src|href)="\.\.\/images\//g, '$1="images/');
  fs.writeFileSync(path.join(WEB_OUT, 'index.html'), html);
  const copy = (from, to) => {
    fs.mkdirSync(path.dirname(to), { recursive: true });
    fs.copyFileSync(from, to);
  };
  const css = path.join(PRINT, 'web.css');
  if (fs.existsSync(css)) copy(css, path.join(WEB_OUT, 'web.css'));
  for (const m of html.matchAll(/src="(images\/[^"]+)"/g)) copy(path.join(MANUAL, m[1]), path.join(WEB_OUT, m[1]));
  copy(PDF_OUT, path.join(WEB_OUT, path.basename(PDF_OUT)));
  // 글꼴: 저장소에 넣을지는 결정 대기(WY-design → pm). 웹 결과는 생성물이라 일단 복사만 한다
  copy(FONT_CSS, path.join(WEB_OUT, 'fonts', 'pretendardvariable.css'));
  copy(path.join(path.dirname(FONT_CSS), 'woff2', 'PretendardVariable.woff2'), path.join(WEB_OUT, 'fonts', 'woff2', 'PretendardVariable.woff2'));
  console.log(`웹: ${path.relative(ROOT, WEB_OUT)}/index.html`);
}

// ---------- 실행 ----------

function main() {
  const edition = arg('--edition') || new Date(Date.now() + 9 * 3600e3).toISOString().slice(0, 10); // KST 오늘
  if (!/^\d{4}-\d\d-\d\d$/.test(edition)) fail('--edition은 YYYY-MM-DD');
  if (!fs.existsSync(TEMPLATE)) fail('틀이 없습니다: docs/manual/print/template.html (WY-design)');
  if (!fs.existsSync(FONT_CSS)) fail('Pretendard 글꼴이 없습니다: frontend에서 npm install을 먼저 하세요');
  const template = fs.readFileSync(TEMPLATE, 'utf8');
  const chrome = chromePath();
  const doc = build(edition);

  // 1차: 목차 쪽 번호 자리를 채워 인쇄해 장 위치를 읽고, 2차: 실제 쪽 번호로 다시 인쇄
  fs.writeFileSync(HTML_OUT, render(template, edition, doc, null));
  const tmp = path.join(os.tmpdir(), `wy-manual-pass1-${process.pid}.pdf`);
  print(chrome, HTML_OUT, tmp);
  const first = pdfInfo(tmp);
  fs.rmSync(tmp, { force: true });
  const lost = doc.chapters.filter((c) => !first.dests[c.no]).map((c) => c.no);
  if (lost.length) console.warn(`[주의] 장 위치를 못 읽음: ${lost.join(', ')} — 목차 쪽 번호가 빕니다`);

  fs.writeFileSync(HTML_OUT, render(template, edition, doc, first.dests));
  print(chrome, HTML_OUT, PDF_OUT);
  const final = pdfInfo(PDF_OUT);
  const moved = doc.chapters.filter((c) => final.dests[c.no] !== first.dests[c.no]).map((c) => c.no);
  if (moved.length) console.warn(`[주의] 2차 인쇄에서 장 위치가 바뀜: ${moved.join(', ')} — 목차 쪽 번호를 확인하세요`);
  if (!process.argv.includes('--keep-html')) fs.rmSync(HTML_OUT, { force: true });

  buildWeb(edition, doc);

  console.log(`PDF: ${path.relative(ROOT, PDF_OUT)} (${final.pages}쪽, 기준 날짜 ${edition})`);
  console.log('목차: ' + doc.chapters.map((c) => `${c.title} p.${final.dests[c.no] ?? '?'}`).join(' / '));
  const uniq = [...new Set(missing)];
  console.log(`촬영 예정 그림: ${uniq.length}개` + (uniq.length ? ' (자리 상자로 넣음)' : ''));
}

main();
