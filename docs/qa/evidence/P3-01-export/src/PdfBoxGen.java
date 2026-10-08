package exp;

import java.io.ByteArrayInputStream;
import java.io.IOException;
import java.io.OutputStream;
import java.util.ArrayList;
import java.util.List;

import org.apache.pdfbox.pdmodel.PDDocument;
import org.apache.pdfbox.pdmodel.PDPage;
import org.apache.pdfbox.pdmodel.PDPageContentStream;
import org.apache.pdfbox.pdmodel.common.PDRectangle;
import org.apache.pdfbox.pdmodel.font.PDType0Font;

/** PDFBox 저수준 API: 좌표·줄바꿈·표 선을 직접 그린다(쪽 넘김은 이 시험에서 생략). */
public final class PdfBoxGen {
	private static final float M = 40, SIZE = 10, LEAD = 13, PAD = 4;

	private static final java.util.Map<String, org.apache.fontbox.ttf.TrueTypeFont> PARSED = new java.util.concurrent.ConcurrentHashMap<>();

	private static org.apache.fontbox.ttf.TrueTypeFont parsed(String file) {
		return PARSED.computeIfAbsent(file, k -> {
			try {
				return new org.apache.fontbox.ttf.TTFParser().parse(new org.apache.pdfbox.io.RandomAccessReadBuffer(Fonts.bytes(k)));
			} catch (IOException e) {
				throw new java.io.UncheckedIOException(e);
			}
		});
	}

	public static void write(String family, OutputStream out) throws IOException {
		write(family, false, out);
	}

	/** cached=true면 글꼴 파싱 결과(TrueTypeFont)를 문서 사이에 재사용한다. */
	public static void write(String family, boolean cached, OutputStream out) throws IOException {
		try (PDDocument doc = new PDDocument()) {
			PDType0Font reg = cached ? PDType0Font.load(doc, parsed(family + "-Regular.ttf"), true)
					: PDType0Font.load(doc, new ByteArrayInputStream(Fonts.bytes(family + "-Regular.ttf")), true);
			PDType0Font bold = cached ? PDType0Font.load(doc, parsed(family + "-Bold.ttf"), true)
					: PDType0Font.load(doc, new ByteArrayInputStream(Fonts.bytes(family + "-Bold.ttf")), true);
			PDPage page = new PDPage(PDRectangle.A4);
			doc.addPage(page);
			float w = page.getMediaBox().getWidth() - 2 * M;
			float y = page.getMediaBox().getHeight() - M;
			try (PDPageContentStream cs = new PDPageContentStream(doc, page)) {
				cs.setLineWidth(0.6f);
				// 결재란 (오른쪽)
				float aw = 170, ax = M + w - aw, cw = aw / Sample.APPROVERS.size();
				for (int i = 0; i < Sample.APPROVERS.size(); i++) {
					cs.addRect(ax + i * cw, y - 16, cw, 16);
					cs.addRect(ax + i * cw, y - 56, cw, 40);
					text(cs, bold, SIZE, ax + i * cw + (cw - width(bold, SIZE, safe(bold, Sample.APPROVERS.get(i)))) / 2, y - 12, Sample.APPROVERS.get(i));
				}
				cs.stroke();
				text(cs, bold, 18, M, y - 34, Sample.TITLE);
				y -= 76;
				text(cs, reg, SIZE, M, y, "일자: " + Sample.DATE + "    작성자: " + Sample.WRITER);
				y -= 24;
				text(cs, bold, SIZE, M, y, "오늘 실적");
				y -= 8;
				float[] cols = {0.06f * w, 0.58f * w, 0.24f * w, 0.12f * w};
				y = row(cs, bold, cols, y, Sample.HEADERS.toArray(String[]::new));
				for (Sample.Row r : Sample.ROWS) y = row(cs, reg, cols, y, r.no(), r.task(), r.result(), r.time());
				y -= 20;
				text(cs, bold, SIZE, M, y, "다음 근무일 계획");
				for (String p : Sample.PLAN) {
					y -= LEAD + 2;
					text(cs, reg, SIZE, M + 6, y, "• " + p);
				}
				y -= 24;
				for (String l : wrap(reg, SIZE, safe(reg, Sample.NOTE), w)) {
					text(cs, reg, SIZE, M, y, l);
					y -= LEAD;
				}
			}
			doc.save(out);
		}
	}

	private static float row(PDPageContentStream cs, PDType0Font f, float[] cols, float top, String... cells) throws IOException {
		List<List<String>> lines = new ArrayList<>();
		int max = 1;
		for (int i = 0; i < cells.length; i++) {
			lines.add(wrap(f, SIZE, safe(f, cells[i]), cols[i] - 2 * PAD));
			max = Math.max(max, lines.get(i).size());
		}
		float h = max * LEAD + 2 * PAD, x = M;
		for (int i = 0; i < cells.length; i++) {
			cs.addRect(x, top - h, cols[i], h);
			cs.stroke();
			float ty = top - PAD - SIZE;
			for (String l : lines.get(i)) {
				text(cs, f, SIZE, x + PAD, ty, l);
				ty -= LEAD;
			}
			x += cols[i];
		}
		return top - h;
	}

	/** 글자 단위 줄바꿈 (한글은 낱자마다 끊을 수 있다고 보고 단순화). */
	static List<String> wrap(PDType0Font f, float size, String s, float max) throws IOException {
		List<String> out = new ArrayList<>();
		StringBuilder cur = new StringBuilder();
		for (int i = 0; i < s.length(); ) {
			int cp = s.codePointAt(i);
			String ch = new String(Character.toChars(cp));
			if (width(f, size, cur + ch) > max && !cur.isEmpty()) {
				out.add(cur.toString());
				cur.setLength(0);
			}
			cur.append(ch);
			i += Character.charCount(cp);
		}
		out.add(cur.toString());
		return out;
	}

	static float width(PDType0Font f, float size, String s) throws IOException {
		return f.getStringWidth(s) / 1000 * size;
	}

	/** 글꼴에 없는 글자는 showText가 예외를 던지므로 □로 바꾼다(실서비스는 대체 글꼴로 나눠 그려야 함). */
	static String safe(PDType0Font f, String s) {
		StringBuilder b = new StringBuilder();
		s.codePoints().forEach(cp -> {
			String ch = new String(Character.toChars(cp));
			try {
				f.encode(ch);
				b.append(ch);
			} catch (Exception e) {
				b.append('□');
			}
		});
		return b.toString();
	}

	private static void text(PDPageContentStream cs, PDType0Font f, float size, float x, float y, String s) throws IOException {
		s = safe(f, s);
		cs.beginText();
		cs.setFont(f, size);
		cs.newLineAtOffset(x, y);
		cs.showText(s);
		cs.endText();
	}

	private PdfBoxGen() {}
}
