package exp;

import java.io.OutputStream;

import org.openpdf.text.Document;
import org.openpdf.text.Element;
import org.openpdf.text.Font;
import org.openpdf.text.PageSize;
import org.openpdf.text.Paragraph;
import org.openpdf.text.Phrase;
import org.openpdf.text.pdf.BaseFont;
import org.openpdf.text.pdf.PdfPCell;
import org.openpdf.text.pdf.PdfPTable;
import org.openpdf.text.pdf.PdfWriter;

/** OpenPDF: 표·문단 API로 직접 배치. Identity-H + EMBEDDED면 쓴 글자만 부분 내장. */
public final class OpenPdfGen {
	public static void write(String family, OutputStream out) throws Exception {
		BaseFont reg = BaseFont.createFont(family + "-Regular.ttf", BaseFont.IDENTITY_H, BaseFont.EMBEDDED, true, Fonts.bytes(family + "-Regular.ttf"), null);
		BaseFont bold = BaseFont.createFont(family + "-Bold.ttf", BaseFont.IDENTITY_H, BaseFont.EMBEDDED, true, Fonts.bytes(family + "-Bold.ttf"), null);
		Font body = new Font(reg, 10);
		Font head = new Font(bold, 10);
		Font title = new Font(bold, 18);

		Document doc = new Document(PageSize.A4, 40, 40, 40, 40);
		PdfWriter.getInstance(doc, out);
		doc.open();

		PdfPTable top = new PdfPTable(new float[] {3, 2});
		top.setWidthPercentage(100);
		PdfPCell t = new PdfPCell(new Phrase(Sample.TITLE, title));
		t.setBorder(0);
		t.setVerticalAlignment(Element.ALIGN_MIDDLE);
		top.addCell(t);
		PdfPTable appr = new PdfPTable(Sample.APPROVERS.size());
		for (String a : Sample.APPROVERS) appr.addCell(center(a, head, 0));
		for (int i = 0; i < Sample.APPROVERS.size(); i++) appr.addCell(center("", body, 40));
		PdfPCell ac = new PdfPCell(appr);
		ac.setBorder(0);
		top.addCell(ac);
		doc.add(top);

		doc.add(new Paragraph("일자: " + Sample.DATE + "    작성자: " + Sample.WRITER, body));
		doc.add(new Paragraph(" ", body));
		doc.add(new Paragraph("오늘 실적", head));

		PdfPTable rows = new PdfPTable(new float[] {0.6f, 6, 2.6f, 1.2f});
		rows.setWidthPercentage(100);
		rows.setSpacingBefore(4);
		rows.setHeaderRows(1);
		for (String h : Sample.HEADERS) rows.addCell(center(h, head, 0));
		for (Sample.Row r : Sample.ROWS) {
			rows.addCell(center(r.no(), body, 0));
			rows.addCell(new PdfPCell(new Phrase(r.task(), body)));
			rows.addCell(new PdfPCell(new Phrase(r.result(), body)));
			rows.addCell(center(r.time(), body, 0));
		}
		doc.add(rows);

		doc.add(new Paragraph(" ", body));
		doc.add(new Paragraph("다음 근무일 계획", head));
		for (String p : Sample.PLAN) doc.add(new Paragraph("• " + p, body));
		doc.add(new Paragraph(" ", body));
		doc.add(new Paragraph(Sample.NOTE, body));
		doc.close();
	}

	private static PdfPCell center(String s, Font f, float minHeight) {
		PdfPCell c = new PdfPCell(new Phrase(s, f));
		c.setHorizontalAlignment(Element.ALIGN_CENTER);
		c.setVerticalAlignment(Element.ALIGN_MIDDLE);
		if (minHeight > 0) c.setMinimumHeight(minHeight);
		return c;
	}

	private OpenPdfGen() {}
}
