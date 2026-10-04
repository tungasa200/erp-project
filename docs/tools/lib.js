const {
  Document, Paragraph, TextRun, Table, TableRow, TableCell, WidthType, ShadingType,
  HeadingLevel, AlignmentType, BorderStyle, LevelFormat, Footer, Header, PageNumber,
} = require('docx');

const FONT = 'Malgun Gothic';
const CONTENT_W = 9026; // A4 width 11906 - 2 * 1440 margins
const ACCENT = '1F4E79';
const HEAD_FILL = 'DCE6F1';

const p = (text, opts = {}) => new Paragraph({
  spacing: { after: 120, line: 300 },
  ...opts,
  children: [new TextRun({ text, ...(opts.run || {}) })],
});
const h1 = (text) => new Paragraph({ heading: HeadingLevel.HEADING_1, children: [new TextRun(text)] });
const h2 = (text) => new Paragraph({ heading: HeadingLevel.HEADING_2, children: [new TextRun(text)] });
const bullet = (text) => new Paragraph({
  numbering: { reference: 'bullets', level: 0 },
  spacing: { after: 60, line: 300 },
  children: [new TextRun(text)],
});
const gap = () => new Paragraph({ spacing: { after: 120 }, children: [] });
// 고정폭 블록 (디렉토리 트리 등)
const code = (lines) => lines.map((line, i) => new Paragraph({
  spacing: { after: 0, line: 260 },
  shading: { type: ShadingType.CLEAR, color: 'auto', fill: 'F2F2F2' },
  indent: { left: 200 },
  ...(i === lines.length - 1 ? { spacing: { after: 160, line: 260 } } : {}),
  children: [new TextRun({ text: line || ' ', font: 'Consolas', size: 18 })],
}));

const border = { style: BorderStyle.SINGLE, size: 4, color: 'A6A6A6' };
const borders = { top: border, bottom: border, left: border, right: border };

function cell(text, width, { header = false, center = false } = {}) {
  return new TableCell({
    width: { size: width, type: WidthType.DXA },
    borders,
    margins: { top: 60, bottom: 60, left: 100, right: 100 },
    shading: header ? { type: ShadingType.CLEAR, color: 'auto', fill: HEAD_FILL } : undefined,
    children: String(text).split('\n').map((line) => new Paragraph({
      alignment: center ? AlignmentType.CENTER : AlignmentType.LEFT,
      spacing: { after: 0, line: 276 },
      children: [new TextRun({ text: line, bold: header, size: 18 })],
    })),
  });
}

// ratios: 상대 열 너비, centerCols: 가운데 정렬할 열 인덱스
function table(headers, rows, ratios, centerCols = []) {
  const total = ratios.reduce((a, b) => a + b, 0);
  const widths = ratios.map((r) => Math.floor((CONTENT_W * r) / total));
  widths[widths.length - 1] += CONTENT_W - widths.reduce((a, b) => a + b, 0);
  return new Table({
    width: { size: CONTENT_W, type: WidthType.DXA },
    columnWidths: widths,
    rows: [
      new TableRow({ tableHeader: true, children: headers.map((h, i) => cell(h, widths[i], { header: true, center: true })) }),
      ...rows.map((r) => new TableRow({ children: r.map((c, i) => cell(c, widths[i], { center: centerCols.includes(i) })) })),
    ],
  });
}

function makeDoc({ title, headerText, children }) {
  return new Document({
    creator: 'worklog',
    title,
    styles: {
      default: { document: { run: { font: FONT, size: 20 } } },
      paragraphStyles: [
        { id: 'Heading1', name: 'Heading 1', basedOn: 'Normal', next: 'Normal', quickFormat: true,
          run: { font: FONT, size: 30, bold: true, color: ACCENT },
          paragraph: { spacing: { before: 360, after: 160 }, outlineLevel: 0,
            border: { bottom: { style: BorderStyle.SINGLE, size: 6, color: ACCENT, space: 4 } } } },
        { id: 'Heading2', name: 'Heading 2', basedOn: 'Normal', next: 'Normal', quickFormat: true,
          run: { font: FONT, size: 24, bold: true, color: '262626' },
          paragraph: { spacing: { before: 240, after: 120 }, outlineLevel: 1 } },
      ],
    },
    numbering: {
      config: [{ reference: 'bullets', levels: [{ level: 0, format: LevelFormat.BULLET, text: '•',
        alignment: AlignmentType.LEFT, style: { paragraph: { indent: { left: 560, hanging: 280 } } } }] }],
    },
    sections: [{
      properties: { page: { size: { width: 11906, height: 16838 }, margin: { top: 1440, bottom: 1440, left: 1440, right: 1440 } } },
      headers: { default: new Header({ children: [new Paragraph({ alignment: AlignmentType.RIGHT,
        children: [new TextRun({ text: headerText, size: 16, color: '808080' })] })] }) },
      footers: { default: new Footer({ children: [new Paragraph({ alignment: AlignmentType.CENTER,
        children: [new TextRun({ children: [PageNumber.CURRENT, ' / ', PageNumber.TOTAL_PAGES], size: 16, color: '808080' })] })] }) },
      children,
    }],
  });
}

// 이미 있는 버전 파일은 덮어쓰지 않는다 (발행된 버전 보호). 미발행 버전을 다시 만들 때만 --force
function writeNew(out, buf) {
  const fs = require('fs');
  if (fs.existsSync(out) && !process.argv.includes('--force')) {
    console.error(`skip: ${out} 이(가) 이미 있습니다. VERSION을 올렸는지 확인하세요. 미발행 버전을 다시 만들 때만 --force를 붙입니다.`);
    process.exitCode = 1;
    return;
  }
  fs.writeFileSync(out, buf);
  console.log('wrote', out, buf.length, 'bytes');
}

module.exports = { p, h1, h2, bullet, gap, code, table, makeDoc, writeNew, ACCENT };
