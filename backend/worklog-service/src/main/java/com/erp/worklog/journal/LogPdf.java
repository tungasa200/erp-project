package com.erp.worklog.journal;

import com.erp.worklog.journal.LogDocument.InfoRow;
import com.erp.worklog.journal.LogDocument.Kind;
import com.erp.worklog.journal.LogDocument.Section;
import com.erp.worklog.journal.LogDocument.Table;
import org.openpdf.text.Chunk;
import org.openpdf.text.Document;
import org.openpdf.text.Element;
import org.openpdf.text.Font;
import org.openpdf.text.PageSize;
import org.openpdf.text.Paragraph;
import org.openpdf.text.Phrase;
import org.openpdf.text.Rectangle;
import org.openpdf.text.SplitCharacter;
import org.openpdf.text.pdf.BaseFont;
import org.openpdf.text.pdf.ColumnText;
import org.openpdf.text.pdf.DefaultSplitCharacter;
import org.openpdf.text.pdf.PdfChunk;
import org.openpdf.text.pdf.PdfContentByte;
import org.openpdf.text.pdf.PdfPCell;
import org.openpdf.text.pdf.PdfPTable;
import org.openpdf.text.pdf.PdfPageEventHelper;
import org.openpdf.text.pdf.PdfTemplate;
import org.openpdf.text.pdf.PdfWriter;

import java.awt.Color;
import java.io.ByteArrayOutputStream;
import java.io.IOException;
import java.io.InputStream;
import java.io.UncheckedIOException;
import java.util.List;

/**
 * PDF (서식 명세 1·2·3.1). OpenPDF로 표를 직접 배치하고 Pretendard를 부분 내장한다(Identity-H, D-111).
 * Pretendard에 없는 글자는 Noto Sans Symbols 2로, 거기에도 없으면 □로 쓴다. 글꼴은 jar 리소스만 쓴다(시스템 글꼴 없음).
 */
final class LogPdf {

	private static final Color BLACK = Color.BLACK;
	private static final Color LINE = new Color(0xBF, 0xBF, 0xBF);
	private static final Color HEAD_BG = new Color(0xF2, 0xF2, 0xF2);
	private static final Color SUB = new Color(0x40, 0x40, 0x40);
	private static final Color GRAY = new Color(0x59, 0x59, 0x59);
	private static final char MISSING = '□';

	/**
	 * 띄어쓰기에서만 줄을 바꾼다(화면의 word-break: keep-all). OpenPDF 기본은 한글 음절·'-' 사이 어디서나 끊어 좁은 칸에서
	 * "고객관리 시 / 스템개편"처럼 낱말이 갈린다. 칸보다 긴 낱말은 끊을 곳이 없으면 OpenPDF가 칸 끝에서 자른다.
	 */
	private static final SplitCharacter KEEP_ALL = new DefaultSplitCharacter() {
		@Override
		public boolean isSplitCharacter(int start, int current, int end, char[] cc, PdfChunk[] ck) {
			char c = getCurrentCharacter(current, cc, ck);
			return c <= ' ' || (c >= '\u2002' && c <= '\u200b');
		}
	};

	private static final byte[] REGULAR = font("Pretendard-Regular.ttf");
	private static final byte[] BOLD = font("Pretendard-Bold.ttf");
	private static final byte[] SYMBOLS = font("NotoSansSymbols2-Regular.ttf");

	private final BaseFont regular;
	private final BaseFont bold;
	private final BaseFont symbols;

	private LogPdf() throws IOException {
		regular = BaseFont.createFont("Pretendard-Regular.ttf", BaseFont.IDENTITY_H, BaseFont.EMBEDDED, true, REGULAR, null);
		bold = BaseFont.createFont("Pretendard-Bold.ttf", BaseFont.IDENTITY_H, BaseFont.EMBEDDED, true, BOLD, null);
		symbols = BaseFont.createFont("NotoSansSymbols2-Regular.ttf", BaseFont.IDENTITY_H, BaseFont.EMBEDDED, true, SYMBOLS,
				null);
	}

	static byte[] write(LogDocument d, String fileTitle) {
		try {
			return new LogPdf().render(d, fileTitle);
		} catch (IOException e) {
			throw new UncheckedIOException(e);
		}
	}

	private byte[] render(LogDocument d, String fileTitle) {
		ByteArrayOutputStream out = new ByteArrayOutputStream();
		Document doc = new Document(PageSize.A4, mm(18), mm(18), mm(18), mm(16));
		PdfWriter writer = PdfWriter.getInstance(doc, out);
		writer.setPageEvent(new Footer(d.footerLeft()));
		doc.addTitle(fileTitle);
		doc.addAuthor(d.author());
		doc.open();

		doc.add(head(d));
		doc.add(info(d.info()));
		for (Section s : d.sections()) {
			section(doc, writer, s);
		}
		doc.close();
		return out.toByteArray();
	}

	// ---- 머리 (2.1)

	private PdfPTable head(LogDocument d) {
		PdfPTable t = new PdfPTable(d.draft() ? new float[] { 94, 20, 60 } : new float[] { 114, 60 });
		t.setTotalWidth(mm(174));
		t.setLockedWidth(true);
		Phrase title = text(d.title(), 20, true, BLACK);
		title.getChunks().forEach(c -> ((Chunk) c).setCharacterSpacing(6));
		PdfPCell tc = new PdfPCell(title);
		tc.setBorder(Rectangle.NO_BORDER);
		tc.setVerticalAlignment(Element.ALIGN_MIDDLE);
		tc.setFixedHeight(mm(22));
		t.addCell(tc);
		if (d.draft()) {
			PdfPTable box = new PdfPTable(1);
			box.setTotalWidth(mm(12));
			box.setLockedWidth(true);
			PdfPCell b = new PdfPCell(text("초안", 9, true, BLACK));
			b.setBorderWidth(1);
			b.setHorizontalAlignment(Element.ALIGN_CENTER);
			b.setPaddingBottom(mm(1));
			box.addCell(b);
			PdfPCell bc = new PdfPCell(box);
			bc.setBorder(Rectangle.NO_BORDER);
			bc.setVerticalAlignment(Element.ALIGN_MIDDLE);
			t.addCell(bc);
		}
		PdfPTable appr = new PdfPTable(3);
		appr.setTotalWidth(mm(60));
		appr.setLockedWidth(true);
		for (String a : List.of("담당", "팀장", "부서장")) {
			PdfPCell c = new PdfPCell(text(a, 9, true, BLACK));
			c.setBorderWidth(0.75f);
			c.setBackgroundColor(HEAD_BG);
			c.setFixedHeight(mm(6));
			c.setHorizontalAlignment(Element.ALIGN_CENTER);
			c.setVerticalAlignment(Element.ALIGN_MIDDLE);
			appr.addCell(c);
		}
		for (int i = 0; i < 3; i++) {
			PdfPCell c = new PdfPCell(new Phrase(""));
			c.setBorderWidth(0.75f);
			c.setFixedHeight(mm(16));
			appr.addCell(c);
		}
		PdfPCell ac = new PdfPCell(appr);
		ac.setBorder(Rectangle.NO_BORDER);
		ac.setHorizontalAlignment(Element.ALIGN_RIGHT);
		t.addCell(ac);
		t.setSpacingAfter(mm(6));
		return t;
	}

	// ---- 정보표 (2.2)

	private PdfPTable info(InfoRow[] rows) {
		PdfPTable t = table(new float[] { 20, 67, 20, 67 });
		for (int r = 0; r < rows.length; r++) {
			InfoRow row = rows[r];
			String[] cells = { row.label1(), row.value1(), row.label2(), row.value2() };
			for (int i = 0; i < 4; i++) {
				boolean label = i % 2 == 0;
				PdfPCell c = cell(cells[i], label ? 9.5f : 10, label, BLACK, false);
				c.setBorderWidthTop(r == 0 ? 1.5f : 0.5f);
				c.setBorderColorTop(r == 0 ? BLACK : LINE);
				c.setBorderWidthBottom(r == rows.length - 1 ? 0.75f : 0);
				c.setBorderColorBottom(BLACK);
				c.setBorderWidthLeft(i == 0 ? 0 : 0.5f);
				c.setBorderColorLeft(LINE);
				if (label) {
					c.setBackgroundColor(HEAD_BG);
				}
				t.addCell(c);
			}
		}
		return t;
	}

	// ---- 구분 (2.3~2.8)

	private void section(Document doc, PdfWriter writer, Section s) {
		if (s.kind() == Kind.DAYS) {
			if (s.table() == null) {
				doc.add(paragraph(s.line(), 9, false, SUB, mm(4), 0));
				return;
			}
			PdfPTable t = table(s.table().widths());
			t.setSpacingBefore(mm(4));
			Table days = s.table();
			for (int i = 0; i < days.headers().size(); i++) {
				PdfPCell c = cell(days.headers().get(i), 9, false, BLACK, true);
				c.setBorderWidthTop(1.5f);
				c.setBorderWidthBottom(0.5f);
				c.setBorderColorBottom(LINE);
				t.addCell(c);
			}
			for (int i = 0; i < days.rows().getFirst().size(); i++) {
				PdfPCell c = cell(days.rows().getFirst().get(i), 9, s.boldCells().get(i), BLACK, true);
				c.setBorderWidthBottom(0.75f);
				t.addCell(c);
			}
			doc.add(t);
			if (s.note() != null) {
				doc.add(paragraph(s.note(), 8, false, GRAY, mm(1), 0));
			}
			return;
		}
		// 구분 제목은 뒤 표의 첫 행과 같은 쪽에 (1.5): 남은 높이가 모자라면 쪽을 넘긴다
		if (writer.getVerticalPosition(true) - doc.bottom() < mm(30)) {
			doc.newPage();
		}
		doc.add(paragraph(s.heading(), 11, true, BLACK, mm(7), mm(2)));
		if (s.kind() == Kind.BOX) {
			PdfPTable box = table(new float[] { 174 });
			PdfPCell c = cell(s.box(), 10, false, BLACK, false);
			c.setBorderWidthTop(1.5f);
			c.setBorderWidthBottom(0.75f);
			c.setMinimumHeight(mm(20));
			box.addCell(c);
			doc.add(box);
			return;
		}
		if (s.line() != null) {
			doc.add(paragraph(s.line(), 10, false, LogDocument.NONE.equals(s.line()) ? GRAY : BLACK, 0, mm(1)));
		}
		if (s.table() != null) {
			doc.add(rows(s.table()));
		}
		else if (s.line() == null) {
			doc.add(paragraph(LogDocument.NONE, 10, false, GRAY, 0, 0));
		}
		if (s.note() != null) {
			doc.add(paragraph(s.note(), 9, false, GRAY, mm(1), 0));
		}
	}

	private PdfPTable rows(Table data) {
		PdfPTable t = table(data.widths());
		t.setHeaderRows(1);
		for (int i = 0; i < data.headers().size(); i++) {
			PdfPCell c = cell(data.headers().get(i), 9.5f, true, BLACK, true);
			c.setBackgroundColor(HEAD_BG);
			c.setBorderWidthTop(1.5f);
			c.setBorderWidthBottom(0.75f);
			t.addCell(c);
		}
		for (int r = 0; r < data.rows().size(); r++) {
			boolean last = r == data.rows().size() - 1;
			boolean total = data.total() && last;
			List<String> row = data.rows().get(r);
			for (int i = 0; i < row.size(); i++) {
				PdfPCell c = cell(row.get(i), 10, total, BLACK, data.center()[i]);
				if (total) {
					c.setBorderWidthTop(0.75f);
				}
				c.setBorderWidthBottom(last ? 0.75f : 0.5f);
				c.setBorderColorBottom(last ? BLACK : LINE);
				t.addCell(c);
			}
		}
		return t;
	}

	// ---- 조각

	private PdfPTable table(float[] widthsMm) {
		PdfPTable t = new PdfPTable(widthsMm);
		t.setTotalWidth(mm(174));
		t.setLockedWidth(true);
		return t;
	}

	/** 선은 위·아래만 (세로선 없음, 1.4). 부르는 쪽이 굵기를 정한다. */
	private PdfPCell cell(String s, float size, boolean bold, Color color, boolean center) {
		PdfPCell c = new PdfPCell(text(s, size, bold, color));
		c.setBorder(Rectangle.TOP | Rectangle.BOTTOM | Rectangle.LEFT);
		c.setBorderWidthTop(0);
		c.setBorderWidthBottom(0);
		c.setBorderWidthLeft(0);
		c.setBorderColor(BLACK);
		c.setPaddingTop(mm(1.5f));
		c.setPaddingBottom(mm(1.5f) + 2);
		c.setPaddingLeft(mm(2));
		c.setPaddingRight(mm(2));
		c.setLeading(0, 1.4f);
		c.setHorizontalAlignment(center ? Element.ALIGN_CENTER : Element.ALIGN_LEFT);
		c.setVerticalAlignment(Element.ALIGN_TOP);
		return c;
	}

	private Paragraph paragraph(String s, float size, boolean bold, Color color, float before, float after) {
		Paragraph p = new Paragraph(text(s, size, bold, color));
		p.setLeading(0, 1.4f);
		p.setSpacingBefore(before);
		p.setSpacingAfter(after);
		return p;
	}

	/** 글자마다 글꼴을 고른다: Pretendard → Noto Sans Symbols 2 → □. */
	Phrase text(String s, float size, boolean isBold, Color color) {
		Font main = new Font(isBold ? bold : regular, size, Font.NORMAL, color);
		Font sym = new Font(symbols, size, Font.NORMAL, color);
		Phrase p = new Phrase();
		p.setFont(main);
		StringBuilder run = new StringBuilder();
		Font runFont = main;
		for (int i = 0; i < s.length(); ) {
			int cp = s.codePointAt(i);
			i += Character.charCount(cp);
			Font f;
			String out;
			if (cp == '\n' || cp == '\r' || cp == '\t' || main.getBaseFont().charExists(cp)) {
				f = main;
				out = new String(Character.toChars(cp));
			}
			else if (symbols.charExists(cp)) {
				f = sym;
				out = new String(Character.toChars(cp));
			}
			else {
				f = main;
				out = String.valueOf(MISSING);
			}
			if (f != runFont && !run.isEmpty()) {
				p.add(chunk(run.toString(), runFont));
				run.setLength(0);
			}
			runFont = f;
			run.append(out);
		}
		if (!run.isEmpty()) {
			p.add(chunk(run.toString(), runFont));
		}
		return p;
	}

	private static Chunk chunk(String s, Font f) {
		Chunk c = new Chunk(s, f);
		c.setSplitCharacter(KEEP_ALL);
		return c;
	}

	static float mm(float mm) {
		return mm * 72f / 25.4f;
	}

	private static byte[] font(String file) {
		try (InputStream in = LogPdf.class.getResourceAsStream("/fonts/" + file)) {
			if (in == null) {
				throw new IllegalStateException("글꼴 리소스 없음: " + file);
			}
			return in.readAllBytes();
		} catch (IOException e) {
			throw new UncheckedIOException(e);
		}
	}

	/** 바닥글 (1.1): 왼쪽 확정·초안, 가운데 "1 / 3", 오른쪽 worklog. 전체 쪽 수는 닫을 때 채운다. */
	private final class Footer extends PdfPageEventHelper {

		private final String left;
		private PdfTemplate total;

		Footer(String left) {
			this.left = left;
		}

		@Override
		public void onOpenDocument(PdfWriter writer, Document document) {
			total = writer.getDirectContent().createTemplate(mm(20), mm(5));
		}

		@Override
		public void onEndPage(PdfWriter writer, Document document) {
			PdfContentByte cb = writer.getDirectContent();
			float y = mm(8);
			ColumnText.showTextAligned(cb, Element.ALIGN_LEFT, text(left, 8, false, GRAY), document.left(), y, 0);
			ColumnText.showTextAligned(cb, Element.ALIGN_RIGHT, text("worklog", 8, false, GRAY), document.right(), y, 0);
			Phrase page = text(writer.getPageNumber() + " / ", 8, false, GRAY);
			float center = (document.left() + document.right()) / 2;
			float width = regular.getWidthPoint(writer.getPageNumber() + " / ", 8);
			ColumnText.showTextAligned(cb, Element.ALIGN_LEFT, page, center - width, y, 0);
			cb.addTemplate(total, center, y - mm(1.2f));
		}

		@Override
		public void onCloseDocument(PdfWriter writer, Document document) {
			ColumnText.showTextAligned(total, Element.ALIGN_LEFT, text(String.valueOf(writer.getPageNumber() - 1), 8, false, GRAY),
					0, mm(1.2f), 0);
		}
	}

}
