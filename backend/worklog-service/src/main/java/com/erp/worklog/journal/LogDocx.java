package com.erp.worklog.journal;

import com.erp.worklog.journal.LogDocument.InfoRow;
import com.erp.worklog.journal.LogDocument.Kind;
import com.erp.worklog.journal.LogDocument.Section;
import com.erp.worklog.journal.LogDocument.Table;
import org.apache.poi.wp.usermodel.HeaderFooterType;
import org.apache.poi.xwpf.usermodel.ParagraphAlignment;
import org.apache.poi.xwpf.usermodel.TableRowHeightRule;
import org.apache.poi.xwpf.usermodel.XWPFDocument;
import org.apache.poi.xwpf.usermodel.XWPFFooter;
import org.apache.poi.xwpf.usermodel.XWPFParagraph;
import org.apache.poi.xwpf.usermodel.XWPFRun;
import org.apache.poi.xwpf.usermodel.XWPFTable;
import org.apache.poi.xwpf.usermodel.XWPFTable.XWPFBorderType;
import org.apache.poi.xwpf.usermodel.XWPFTableCell;
import org.apache.poi.xwpf.usermodel.XWPFTableCell.XWPFVertAlign;
import org.apache.poi.xwpf.usermodel.XWPFTableRow;
import org.apache.xmlbeans.XmlException;
import org.openxmlformats.schemas.wordprocessingml.x2006.main.CTBorder;
import org.openxmlformats.schemas.wordprocessingml.x2006.main.CTSectPr;
import org.openxmlformats.schemas.wordprocessingml.x2006.main.CTTblGrid;
import org.openxmlformats.schemas.wordprocessingml.x2006.main.CTTcBorders;
import org.openxmlformats.schemas.wordprocessingml.x2006.main.CTTcPr;
import org.openxmlformats.schemas.wordprocessingml.x2006.main.STBorder;
import org.openxmlformats.schemas.wordprocessingml.x2006.main.STFldCharType;
import org.openxmlformats.schemas.wordprocessingml.x2006.main.STMerge;
import org.openxmlformats.schemas.wordprocessingml.x2006.main.STTabJc;
import org.openxmlformats.schemas.wordprocessingml.x2006.main.STTblLayoutType;
import org.openxmlformats.schemas.wordprocessingml.x2006.main.STTblWidth;
import org.openxmlformats.schemas.wordprocessingml.x2006.main.StylesDocument;

import java.io.ByteArrayOutputStream;
import java.io.IOException;
import java.io.UncheckedIOException;
import java.math.BigInteger;
import java.util.List;
import java.util.function.Consumer;

/**
 * Word (서식 명세 3.2). 표는 Word 표(칸 폭 고정, 머리 행 반복, 행은 쪽 사이에서 자르지 않음), 서식은 스타일로,
 * 쪽 번호는 바닥글의 PAGE / NUMPAGES 필드. 글꼴은 '맑은 고딕' 이름만 지정한다(POI는 글꼴을 넣지 못함, D-111).
 */
final class LogDocx {

	private static final String TITLE = "WyLogTitle";
	private static final String HEADING = "WyLogHeading";
	private static final String BODY = "WyLogBody";
	private static final String GRAY = "595959";
	private static final String SUB = "404040";
	private static final String LINE = "BFBFBF";
	private static final String HEAD_BG = "F2F2F2";

	/** 스타일: 기본 글꼴(동아시아 포함), 제목, 구분(제목 1 기반·개요 수준 1), 본문(줄 간격 1.4). 크기는 반 pt. */
	private static final String STYLES = """
			<w:styles xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">
			  <w:docDefaults>
			    <w:rPrDefault><w:rPr><w:rFonts w:ascii="맑은 고딕" w:hAnsi="맑은 고딕" w:eastAsia="맑은 고딕" w:cs="맑은 고딕"/>
			      <w:sz w:val="20"/><w:szCs w:val="20"/><w:lang w:val="ko-KR" w:eastAsia="ko-KR"/></w:rPr></w:rPrDefault>
			    <w:pPrDefault><w:pPr><w:spacing w:after="0" w:line="240" w:lineRule="auto"/></w:pPr></w:pPrDefault>
			  </w:docDefaults>
			  <w:style w:type="paragraph" w:default="1" w:styleId="Normal"><w:name w:val="Normal"/></w:style>
			  <w:style w:type="paragraph" w:styleId="Heading1"><w:name w:val="heading 1"/><w:basedOn w:val="Normal"/>
			    <w:next w:val="Normal"/><w:qFormat/><w:pPr><w:keepNext/><w:outlineLvl w:val="0"/></w:pPr>
			    <w:rPr><w:b/><w:sz w:val="28"/></w:rPr></w:style>
			  <w:style w:type="paragraph" w:customStyle="1" w:styleId="WyLogTitle"><w:name w:val="업무일지 제목"/>
			    <w:basedOn w:val="Normal"/><w:qFormat/><w:rPr><w:b/><w:spacing w:val="120"/><w:sz w:val="40"/><w:szCs w:val="40"/></w:rPr></w:style>
			  <w:style w:type="paragraph" w:customStyle="1" w:styleId="WyLogHeading"><w:name w:val="업무일지 구분"/>
			    <w:basedOn w:val="Heading1"/><w:next w:val="WyLogBody"/><w:qFormat/>
			    <w:pPr><w:keepNext/><w:spacing w:before="397" w:after="113"/><w:outlineLvl w:val="0"/></w:pPr>
			    <w:rPr><w:b/><w:color w:val="000000"/><w:sz w:val="22"/><w:szCs w:val="22"/></w:rPr></w:style>
			  <w:style w:type="paragraph" w:customStyle="1" w:styleId="WyLogBody"><w:name w:val="업무일지 본문"/>
			    <w:basedOn w:val="Normal"/><w:qFormat/><w:pPr><w:spacing w:line="336" w:lineRule="auto"/></w:pPr>
			    <w:rPr><w:sz w:val="20"/><w:szCs w:val="20"/></w:rPr></w:style>
			</w:styles>""";

	private final XWPFDocument doc;

	private LogDocx(XWPFDocument doc) {
		this.doc = doc;
	}

	static byte[] write(LogDocument d) {
		try (XWPFDocument doc = new XWPFDocument()) {
			doc.createStyles().setStyles(StylesDocument.Factory.parse(STYLES).getStyles());
			LogDocx w = new LogDocx(doc);
			w.page(d);
			w.head(d);
			w.info(d.info());
			for (Section s : d.sections()) {
				w.section(s);
			}
			ByteArrayOutputStream out = new ByteArrayOutputStream();
			doc.write(out);
			return out.toByteArray();
		} catch (IOException e) {
			throw new UncheckedIOException(e);
		} catch (XmlException e) {
			throw new IllegalStateException(e);
		}
	}

	// ---- 쪽 (1.1)

	private void page(LogDocument d) {
		CTSectPr sect = doc.getDocument().getBody().addNewSectPr();
		sect.addNewPgSz().setW(BigInteger.valueOf(11906));
		sect.getPgSz().setH(BigInteger.valueOf(16838));
		var mar = sect.addNewPgMar();
		mar.setTop(BigInteger.valueOf(twips(18)));
		mar.setBottom(BigInteger.valueOf(twips(16)));
		mar.setLeft(BigInteger.valueOf(twips(18)));
		mar.setRight(BigInteger.valueOf(twips(18)));
		mar.setFooter(BigInteger.valueOf(twips(7)));
		mar.setHeader(BigInteger.valueOf(twips(8)));

		XWPFFooter footer = doc.createFooter(HeaderFooterType.DEFAULT);
		XWPFParagraph p = footer.createParagraph();
		var tabs = p.getCTP().addNewPPr().addNewTabs();
		var center = tabs.addNewTab();
		center.setVal(STTabJc.CENTER);
		center.setPos(BigInteger.valueOf(twips(87)));
		var right = tabs.addNewTab();
		right.setVal(STTabJc.RIGHT);
		right.setPos(BigInteger.valueOf(twips(174)));
		small(p.createRun(), d.footerLeft());
		small(p.createRun(), "\t");
		field(p, "PAGE");
		small(p.createRun(), " / ");
		field(p, "NUMPAGES");
		small(p.createRun(), "\t");
		small(p.createRun(), "worklog");
	}

	private static void field(XWPFParagraph p, String instr) {
		small(p.createRun(), null).getCTR().addNewFldChar().setFldCharType(STFldCharType.BEGIN);
		small(p.createRun(), null).getCTR().addNewInstrText().setStringValue(" " + instr + " ");
		small(p.createRun(), null).getCTR().addNewFldChar().setFldCharType(STFldCharType.SEPARATE);
		small(p.createRun(), "1");
		small(p.createRun(), null).getCTR().addNewFldChar().setFldCharType(STFldCharType.END);
	}

	private static XWPFRun small(XWPFRun r, String text) {
		r.setFontSize(8);
		r.setColor(GRAY);
		if ("\t".equals(text)) {
			r.addTab();
		}
		else if (text != null) {
			r.setText(text);
		}
		return r;
	}

	// ---- 머리 (2.1): 한 표 안에 제목(왼쪽, 선 없음)과 결재란(오른쪽 3칸 × 2행)

	private void head(LogDocument d) {
		XWPFTable t = table(new float[] { 114, 20, 20, 20 }, 2);
		none(t);
		XWPFTableRow r1 = t.getRow(0);
		XWPFTableRow r2 = t.getRow(1);
		r1.setHeight(twips(6));
		r1.setHeightRule(TableRowHeightRule.EXACT);
		r2.setHeight(twips(16));
		r2.setHeightRule(TableRowHeightRule.EXACT);

		XWPFTableCell title = r1.getCell(0);
		title.getCTTc().getTcPr().addNewVMerge().setVal(STMerge.RESTART);
		r2.getCell(0).getCTTc().getTcPr().addNewVMerge().setVal(STMerge.CONTINUE);
		title.setVerticalAlignment(XWPFVertAlign.CENTER);
		XWPFParagraph p = title.getParagraphs().getFirst();
		p.setStyle(TITLE);
		p.createRun().setText(d.title());
		if (d.draft()) {
			p.createRun().setText("   ");
			XWPFRun box = p.createRun();
			box.setText(" 초안 ");
			box.setBold(true);
			box.setFontSize(9);
			box.setCharacterSpacing(0);
			CTBorder b = box.getCTR().getRPr().addNewBdr();
			b.setVal(STBorder.SINGLE);
			b.setSz(BigInteger.valueOf(8));
			b.setColor("000000");
		}
		String[] names = { "담당", "팀장", "부서장" };
		for (int i = 0; i < 3; i++) {
			XWPFTableCell c = r1.getCell(i + 1);
			fill(c);
			box(c, 6, "000000", 6, "000000");
			c.setVerticalAlignment(XWPFVertAlign.CENTER);
			text(c, names[i], true, false, 9, null);
			box(r2.getCell(i + 1), 6, "000000", 6, "000000");
		}
		XWPFParagraph gap = doc.createParagraph();
		gap.setSpacingAfter(twips(2));
	}

	// ---- 정보표 (2.2)

	private void info(InfoRow[] info) {
		XWPFTable t = table(new float[] { 20, 67, 20, 67 }, info.length);
		borders(t, true);
		for (int i = 0; i < info.length; i++) {
			XWPFTableRow row = t.getRow(i);
			row.setCantSplitRow(true);
			String[] v = { info[i].label1(), info[i].value1(), info[i].label2(), info[i].value2() };
			for (int k = 0; k < 4; k++) {
				XWPFTableCell c = row.getCell(k);
				boolean label = k % 2 == 0;
				if (label) {
					fill(c);
				}
				text(c, v[k], label, label, label ? 9.5 : 10, null);
			}
		}
	}

	// ---- 구분 (2.3~2.8)

	private void section(Section s) {
		if (s.kind() == Kind.DAYS) {
			doc.createParagraph().setSpacingAfter(0);
			if (s.table() == null) {
				paragraph(s.line(), 9, SUB);
				return;
			}
			Table tt = s.table();
			XWPFTable t = table(tt.widths(), 2);
			borders(t, false);
			for (int i = 0; i < tt.headers().size(); i++) {
				text(t.getRow(0).getCell(i), tt.headers().get(i), false, true, 9, SUB);
				text(t.getRow(1).getCell(i), tt.rows().getFirst().get(i), s.boldCells().get(i), true, 9, null);
			}
			t.getRow(0).setCantSplitRow(true);
			t.getRow(1).setCantSplitRow(true);
			if (s.note() != null) {
				paragraph(s.note(), 9, GRAY);
			}
			return;
		}
		XWPFParagraph h = doc.createParagraph();
		h.setStyle(HEADING);
		h.createRun().setText(s.heading());
		if (s.kind() == Kind.BOX) {
			XWPFTable t = table(new float[] { 174 }, 1);
			none(t);
			XWPFTableCell c = t.getRow(0).getCell(0);
			box(c, 6, "000000", 6, "000000");
			t.getRow(0).setHeight(twips(20));
			t.getRow(0).setHeightRule(TableRowHeightRule.AT_LEAST);
			text(c, s.box(), false, false, 10, null);
			return;
		}
		if (s.line() != null) {
			keepNext(paragraph(s.line(), 10, LogDocument.NONE.equals(s.line()) ? GRAY : null), s.table() != null);
		}
		if (s.table() != null) {
			rows(s.table());
		}
		else if (s.line() == null) {
			paragraph(LogDocument.NONE, 10, GRAY);
		}
		if (s.note() != null) {
			paragraph(s.note(), 9, GRAY);
		}
	}

	private void rows(Table tt) {
		int n = tt.rows().size();
		XWPFTable t = table(tt.widths(), n + 1);
		borders(t, false);
		XWPFTableRow head = t.getRow(0);
		head.setRepeatHeader(true);
		head.setCantSplitRow(true);
		for (int i = 0; i < tt.headers().size(); i++) {
			XWPFTableCell c = head.getCell(i);
			fill(c);
			bottom(c, 6, "000000");
			text(c, tt.headers().get(i), true, true, 9.5, null);
		}
		for (int k = 0; k < n; k++) {
			XWPFTableRow row = t.getRow(k + 1);
			row.setCantSplitRow(true);
			boolean total = tt.total() && k == n - 1;
			List<String> cells = tt.rows().get(k);
			for (int i = 0; i < cells.size(); i++) {
				XWPFTableCell c = row.getCell(i);
				if (total) {
					top(c, 6, "000000");
				}
				text(c, cells.get(i), total, tt.center()[i], 10, null);
			}
		}
	}

	// ---- 조각

	/** 칸 폭 고정 표. widths mm. 칸 안쪽 여백 위아래 1.5mm·좌우 2mm (1.4). */
	private XWPFTable table(float[] widths, int rows) {
		XWPFTable t = doc.createTable(rows, widths.length);
		var pr = t.getCTTbl().getTblPr();
		pr.addNewTblLayout().setType(STTblLayoutType.FIXED);
		var w = pr.isSetTblW() ? pr.getTblW() : pr.addNewTblW();
		w.setType(STTblWidth.DXA);
		int total = 0;
		for (float f : widths) {
			total += twips(f);
		}
		w.setW(BigInteger.valueOf(total));
		CTTblGrid grid = t.getCTTbl().getTblGrid() != null ? t.getCTTbl().getTblGrid() : t.getCTTbl().addNewTblGrid();
		while (grid.sizeOfGridColArray() > 0) {
			grid.removeGridCol(0);
		}
		for (float f : widths) {
			grid.addNewGridCol().setW(BigInteger.valueOf(twips(f)));
		}
		for (XWPFTableRow row : t.getRows()) {
			for (int i = 0; i < widths.length; i++) {
				CTTcPr tc = tcPr(row.getCell(i));
				var tcw = tc.isSetTcW() ? tc.getTcW() : tc.addNewTcW();
				tcw.setType(STTblWidth.DXA);
				tcw.setW(BigInteger.valueOf(twips(widths[i])));
			}
		}
		t.setCellMargins(twips(1.5f), twips(2), twips(1.5f), twips(2));
		return t;
	}

	/** 구분 표 선 (1.4): 위 1.5pt 검정, 아래 0.75pt 검정, 행 사이 0.5pt 회색. 세로선은 정보표만. */
	private static void borders(XWPFTable t, boolean vertical) {
		t.setTopBorder(XWPFBorderType.SINGLE, 12, 0, "000000");
		t.setBottomBorder(XWPFBorderType.SINGLE, 6, 0, "000000");
		t.setInsideHBorder(XWPFBorderType.SINGLE, 4, 0, LINE);
		t.setLeftBorder(XWPFBorderType.NONE, 0, 0, "auto");
		t.setRightBorder(XWPFBorderType.NONE, 0, 0, "auto");
		if (vertical) {
			t.setInsideVBorder(XWPFBorderType.SINGLE, 4, 0, LINE);
		}
		else {
			t.setInsideVBorder(XWPFBorderType.NONE, 0, 0, "auto");
		}
	}

	private static void none(XWPFTable t) {
		t.setTopBorder(XWPFBorderType.NONE, 0, 0, "auto");
		t.setBottomBorder(XWPFBorderType.NONE, 0, 0, "auto");
		t.setLeftBorder(XWPFBorderType.NONE, 0, 0, "auto");
		t.setRightBorder(XWPFBorderType.NONE, 0, 0, "auto");
		t.setInsideHBorder(XWPFBorderType.NONE, 0, 0, "auto");
		t.setInsideVBorder(XWPFBorderType.NONE, 0, 0, "auto");
	}

	private static void box(XWPFTableCell c, int size, String color, int size2, String color2) {
		CTTcBorders b = tcBorders(c);
		edge(b.isSetTop() ? b.getTop() : b.addNewTop(), size, color);
		edge(b.isSetBottom() ? b.getBottom() : b.addNewBottom(), size, color);
		edge(b.isSetLeft() ? b.getLeft() : b.addNewLeft(), size2, color2);
		edge(b.isSetRight() ? b.getRight() : b.addNewRight(), size2, color2);
	}

	private static void bottom(XWPFTableCell c, int size, String color) {
		CTTcBorders b = tcBorders(c);
		edge(b.isSetBottom() ? b.getBottom() : b.addNewBottom(), size, color);
	}

	private static void top(XWPFTableCell c, int size, String color) {
		CTTcBorders b = tcBorders(c);
		edge(b.isSetTop() ? b.getTop() : b.addNewTop(), size, color);
	}

	private static CTTcBorders tcBorders(XWPFTableCell c) {
		CTTcPr pr = tcPr(c);
		return pr.isSetTcBorders() ? pr.getTcBorders() : pr.addNewTcBorders();
	}

	private static void edge(CTBorder e, int size, String color) {
		e.setVal(STBorder.SINGLE);
		e.setSz(BigInteger.valueOf(size));
		e.setSpace(BigInteger.ZERO);
		e.setColor(color);
	}

	private static CTTcPr tcPr(XWPFTableCell c) {
		return c.getCTTc().isSetTcPr() ? c.getCTTc().getTcPr() : c.getCTTc().addNewTcPr();
	}

	private static void fill(XWPFTableCell c) {
		c.setColor(HEAD_BG);
	}

	/** 칸 글자: 본문 스타일, 줄바꿈은 줄 나눔으로. */
	private static void text(XWPFTableCell c, String value, boolean bold, boolean center, double size, String color) {
		XWPFParagraph p = c.getParagraphs().getFirst();
		p.setStyle(BODY);
		p.setSpacingBetween(1.4);
		if (center) {
			p.setAlignment(ParagraphAlignment.CENTER);
		}
		lines(p, value, r -> {
			r.setBold(bold);
			if (size != 10) {
				r.setFontSize(size);
			}
			if (color != null) {
				r.setColor(color);
			}
		});
	}

	private XWPFParagraph paragraph(String value, double size, String color) {
		XWPFParagraph p = doc.createParagraph();
		p.setStyle(BODY);
		p.setSpacingBefore(57);
		lines(p, value, r -> {
			if (size != 10) {
				r.setFontSize(size);
			}
			if (color != null) {
				r.setColor(color);
			}
		});
		return p;
	}

	private static void keepNext(XWPFParagraph p, boolean keep) {
		if (keep) {
			p.getCTP().getPPr().addNewKeepNext();
		}
	}

	private static void lines(XWPFParagraph p, String value, Consumer<XWPFRun> format) {
		String[] parts = (value == null ? "" : value).split("\n", -1);
		XWPFRun r = p.createRun();
		format.accept(r);
		for (int i = 0; i < parts.length; i++) {
			if (i > 0) {
				r.addBreak();
			}
			r.setText(parts[i]);
		}
	}

	private static int twips(float mm) {
		return Math.round(mm * 1440 / 25.4f);
	}
}
