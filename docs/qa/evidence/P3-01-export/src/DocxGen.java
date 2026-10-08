package exp;

import java.io.ByteArrayInputStream;
import java.io.ByteArrayOutputStream;
import java.io.IOException;
import java.io.OutputStream;
import java.nio.charset.StandardCharsets;
import java.util.HexFormat;
import java.util.UUID;
import java.util.zip.ZipEntry;
import java.util.zip.ZipInputStream;
import java.util.zip.ZipOutputStream;

import org.apache.fontbox.ttf.TTFParser;
import org.apache.fontbox.ttf.TTFSubsetter;
import org.apache.fontbox.ttf.TrueTypeFont;
import org.apache.pdfbox.io.RandomAccessReadBuffer;
import org.apache.poi.xwpf.usermodel.ParagraphAlignment;
import org.apache.poi.xwpf.usermodel.TableRowAlign;
import org.apache.poi.xwpf.usermodel.XWPFDocument;
import org.apache.poi.xwpf.usermodel.XWPFParagraph;
import org.apache.poi.xwpf.usermodel.XWPFRun;
import org.apache.poi.xwpf.usermodel.XWPFTable;
import org.apache.poi.xwpf.usermodel.XWPFTableCell;

/**
 * Apache POI XWPF로 .docx를 만든다. 글꼴 내장은 POI에 고수준 API가 없어
 * 저장한 zip에 word/fontTable.xml·word/fonts/*.odttf(ECMA-376 17.8.1 난독화)를 덧붙인다.
 */
public final class DocxGen {
	public enum Embed { NONE, FULL, SUBSET }

	public static void write(String fontName, String family, Embed embed, OutputStream out) throws IOException {
		ByteArrayOutputStream raw = new ByteArrayOutputStream();
		try (XWPFDocument doc = new XWPFDocument()) {
			XWPFTable top = doc.createTable(2, Sample.APPROVERS.size());
			top.setTableAlignment(TableRowAlign.RIGHT);
			top.setWidth("2400");
			for (int i = 0; i < Sample.APPROVERS.size(); i++) {
				cell(top.getRow(0).getCell(i), Sample.APPROVERS.get(i), fontName, true, ParagraphAlignment.CENTER);
				cell(top.getRow(1).getCell(i), "", fontName, false, ParagraphAlignment.CENTER);
			}
			top.getRow(1).setHeight(800);

			XWPFParagraph t = doc.createParagraph();
			t.setAlignment(ParagraphAlignment.CENTER);
			run(t, Sample.TITLE, fontName, true, 18);
			run(doc.createParagraph(), "일자: " + Sample.DATE + "    작성자: " + Sample.WRITER, fontName, false, 10);
			run(doc.createParagraph(), "오늘 실적", fontName, true, 10);

			XWPFTable rows = doc.createTable(Sample.ROWS.size() + 1, 4);
			rows.setWidth("100%");
			int[] widths = {500, 5400, 2300, 900};
			for (int c = 0; c < 4; c++) {
				for (int r = 0; r <= Sample.ROWS.size(); r++) rows.getRow(r).getCell(c).setWidth(String.valueOf(widths[c]));
				cell(rows.getRow(0).getCell(c), Sample.HEADERS.get(c), fontName, true, ParagraphAlignment.CENTER);
			}
			for (int r = 0; r < Sample.ROWS.size(); r++) {
				Sample.Row row = Sample.ROWS.get(r);
				cell(rows.getRow(r + 1).getCell(0), row.no(), fontName, false, ParagraphAlignment.CENTER);
				cell(rows.getRow(r + 1).getCell(1), row.task(), fontName, false, ParagraphAlignment.LEFT);
				cell(rows.getRow(r + 1).getCell(2), row.result(), fontName, false, ParagraphAlignment.LEFT);
				cell(rows.getRow(r + 1).getCell(3), row.time(), fontName, false, ParagraphAlignment.CENTER);
			}
			run(doc.createParagraph(), "다음 근무일 계획", fontName, true, 10);
			for (String p : Sample.PLAN) run(doc.createParagraph(), "• " + p, fontName, false, 10);
			run(doc.createParagraph(), Sample.NOTE, fontName, false, 10);
			doc.write(raw);
		}
		if (embed == Embed.NONE) {
			out.write(raw.toByteArray());
		} else {
			embedFonts(raw.toByteArray(), fontName, family, embed == Embed.SUBSET, out);
		}
	}

	private static void cell(XWPFTableCell c, String text, String font, boolean bold, ParagraphAlignment align) {
		XWPFParagraph p = c.getParagraphs().get(0);
		p.setAlignment(align);
		run(p, text, font, bold, 10);
	}

	private static void run(XWPFParagraph p, String text, String font, boolean bold, int size) {
		XWPFRun r = p.createRun();
		r.setText(text);
		r.setBold(bold);
		r.setFontSize(size);
		r.setFontFamily(font); // ascii·hAnsi·eastAsia·cs 모두
	}

	// ---- 글꼴 내장 ----
	private static final String FONT_REL = "http://schemas.openxmlformats.org/officeDocument/2006/relationships/font";

	private static void embedFonts(byte[] docx, String fontName, String family, boolean subset, OutputStream out) throws IOException {
		String kReg = "{" + UUID.randomUUID().toString().toUpperCase() + "}";
		String kBold = "{" + UUID.randomUUID().toString().toUpperCase() + "}";
		byte[] reg = obfuscate(prepare(family + "-Regular.ttf", subset), kReg);
		byte[] bold = obfuscate(prepare(family + "-Bold.ttf", subset), kBold);
		String fontTable = """
				<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
				<w:fonts xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">
				<w:font w:name="%s"><w:charset w:val="81"/><w:family w:val="swiss"/><w:pitch w:val="variable"/>
				<w:embedRegular r:id="rIdF1" w:fontKey="%s"/><w:embedBold r:id="rIdF2" w:fontKey="%s"/></w:font></w:fonts>
				""".formatted(fontName, kReg, kBold).strip();
		String fontRels = """
				<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
				<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
				<Relationship Id="rIdF1" Type="%1$s" Target="fonts/font1.odttf"/><Relationship Id="rIdF2" Type="%1$s" Target="fonts/font2.odttf"/></Relationships>
				""".formatted(FONT_REL).strip();

		try (ZipInputStream zin = new ZipInputStream(new ByteArrayInputStream(docx)); ZipOutputStream zout = new ZipOutputStream(out)) {
			for (ZipEntry e; (e = zin.getNextEntry()) != null; ) {
				String name = e.getName();
				String s = null;
				byte[] data = zin.readAllBytes();
				if (name.equals("[Content_Types].xml")) {
					s = new String(data, StandardCharsets.UTF_8);
					if (s.contains("fontTable")) throw new IllegalStateException("POI가 이미 fontTable을 만듦");
					s = s.replace("</Types>",
							"<Default Extension=\"odttf\" ContentType=\"application/vnd.openxmlformats-officedocument.obfuscatedFont\"/>"
									+ "<Override PartName=\"/word/fontTable.xml\" ContentType=\"application/vnd.openxmlformats-officedocument.wordprocessingml.fontTable+xml\"/></Types>");
				} else if (name.equals("word/_rels/document.xml.rels")) {
					s = new String(data, StandardCharsets.UTF_8).replace("</Relationships>",
							"<Relationship Id=\"rIdFontTable\" Type=\"http://schemas.openxmlformats.org/officeDocument/2006/relationships/fontTable\" Target=\"fontTable.xml\"/></Relationships>");
				} else if (name.equals("word/settings.xml")) {
					s = new String(data, StandardCharsets.UTF_8);
					s = insertEmbedFlags(s, subset);
				}
				zout.putNextEntry(new ZipEntry(name));
				zout.write(s != null ? s.getBytes(StandardCharsets.UTF_8) : data);
				zout.closeEntry();
			}
			put(zout, "word/fontTable.xml", fontTable.getBytes(StandardCharsets.UTF_8));
			put(zout, "word/_rels/fontTable.xml.rels", fontRels.getBytes(StandardCharsets.UTF_8));
			put(zout, "word/fonts/font1.odttf", reg);
			put(zout, "word/fonts/font2.odttf", bold);
		}
	}

	/** settings 요소 순서상 embedTrueTypeFonts는 zoom 등 앞쪽 요소 바로 뒤. */
	private static String insertEmbedFlags(String s, boolean subset) {
		String flags = "<w:embedTrueTypeFonts/>" + (subset ? "<w:saveSubsetFonts/>" : "");
		if (s.strip().endsWith("main\"/>")) { // POI 기본 settings는 빈 요소
			int i = s.lastIndexOf("/>");
			return s.substring(0, i) + ">" + flags + "</w:settings>";
		}
		int z = s.indexOf("<w:zoom");
		if (z < 0) throw new IllegalStateException("settings.xml 구조가 예상과 다름: " + s);
		int end = s.indexOf("/>", z) + 2;
		return s.substring(0, end) + flags + s.substring(end);
	}

	private static byte[] prepare(String file, boolean subset) throws IOException {
		byte[] data = Fonts.bytes(file);
		if (!subset) return data;
		TrueTypeFont ttf = new TTFParser().parse(new RandomAccessReadBuffer(data));
		TTFSubsetter sub = new TTFSubsetter(ttf);
		StringBuilder all = new StringBuilder(Sample.TITLE + Sample.DATE + Sample.WRITER + Sample.NOTE + "오늘 실적다음 근무일 계획일자: 작성자• ");
		Sample.APPROVERS.forEach(all::append);
		Sample.HEADERS.forEach(all::append);
		Sample.PLAN.forEach(all::append);
		Sample.ROWS.forEach(r -> all.append(r.no()).append(r.task()).append(r.result()).append(r.time()));
		all.codePoints().forEach(sub::add);
		ByteArrayOutputStream o = new ByteArrayOutputStream();
		sub.writeToStream(o);
		ttf.close();
		return o.toByteArray();
	}

	/** ECMA-376 Part 1 17.8.1: GUID 16바이트를 거꾸로 한 키로 앞 32바이트를 XOR. */
	static byte[] obfuscate(byte[] font, String guid) {
		byte[] key = HexFormat.of().parseHex(guid.replaceAll("[{}-]", ""));
		byte[] out = font.clone();
		for (int i = 0; i < 32; i++) out[i] ^= key[15 - (i % 16)];
		return out;
	}

	private static void put(ZipOutputStream z, String name, byte[] data) throws IOException {
		z.putNextEntry(new ZipEntry(name));
		z.write(data);
		z.closeEntry();
	}

	private DocxGen() {}
}
