package exp;

import java.awt.image.BufferedImage;
import java.io.ByteArrayOutputStream;
import java.io.File;
import java.lang.management.ManagementFactory;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.LinkedHashMap;
import java.util.Map;
import java.util.TreeSet;

import javax.imageio.ImageIO;

import org.apache.fontbox.ttf.TTFParser;
import org.apache.fontbox.ttf.TrueTypeFont;
import org.apache.pdfbox.Loader;
import org.apache.pdfbox.io.RandomAccessReadBuffer;
import org.apache.pdfbox.pdmodel.PDDocument;
import org.apache.pdfbox.pdmodel.PDResources;
import org.apache.pdfbox.pdmodel.font.PDFont;
import org.apache.pdfbox.pdmodel.font.PDType0Font;
import org.apache.pdfbox.rendering.PDFRenderer;
import org.apache.pdfbox.text.PDFTextStripper;

public final class Main {
	interface Gen { byte[] run() throws Exception; }

	public static void main(String[] args) throws Exception {
		Path out = Path.of(args.length > 0 ? args[0] : "out");
		Files.createDirectories(out);
		System.out.println("java " + System.getProperty("java.version") + ", os " + System.getProperty("os.name") + ", headless " + java.awt.GraphicsEnvironment.isHeadless());

		coverage("Pretendard");
		coverage("NanumGothic");

		Map<String, Gen> gens = new LinkedHashMap<>();
		gens.put("pdf-openpdf-Pretendard.pdf", () -> bytes(o -> OpenPdfGen.write("Pretendard", o)));
		gens.put("pdf-pdfbox-Pretendard.pdf", () -> bytes(o -> PdfBoxGen.write("Pretendard", o)));
		gens.put("pdf-pdfbox-Pretendard-cachedfont.pdf", () -> bytes(o -> PdfBoxGen.write("Pretendard", true, o)));
		gens.put("pdf-pdfbox-NanumGothic.pdf", () -> bytes(o -> PdfBoxGen.write("NanumGothic", o)));
		gens.put("pdf-openpdf-NanumGothic.pdf", () -> bytes(o -> OpenPdfGen.write("NanumGothic", o)));
		gens.put("pdf-openhtmltopdf-Pretendard.pdf", () -> bytes(o -> HtmlPdfGen.write("Pretendard", o)));
		gens.put("pdf-openhtmltopdf-NanumGothic.pdf", () -> bytes(o -> HtmlPdfGen.write("NanumGothic", o)));
		gens.put("docx-malgun-noembed.docx", () -> bytes(o -> DocxGen.write("맑은 고딕", "Pretendard", DocxGen.Embed.NONE, o)));
		gens.put("docx-pretendard-embed-full.docx", () -> bytes(o -> DocxGen.write("Pretendard", "Pretendard", DocxGen.Embed.FULL, o)));
		gens.put("docx-pretendard-embed-subset.docx", () -> bytes(o -> DocxGen.write("Pretendard", "Pretendard", DocxGen.Embed.SUBSET, o)));
		gens.put("xlsx-malgun.xlsx", () -> bytes(o -> XlsxGen.write("맑은 고딕", o)));

		var mx = (com.sun.management.ThreadMXBean) ManagementFactory.getThreadMXBean();
		long tid = Thread.currentThread().threadId();
		System.out.printf("%-38s %9s %9s %10s %10s%n", "file", "cold ms", "warm ms", "alloc MB", "size KB");
		for (var e : gens.entrySet()) {
			long a0 = mx.getThreadAllocatedBytes(tid), t0 = System.nanoTime();
			byte[] data;
			try {
				data = e.getValue().run();
			} catch (Exception ex) {
				System.out.printf("%-38s FAILED: %s%n", e.getKey(), ex);
				continue;
			}
			long cold = (System.nanoTime() - t0) / 1_000_000, alloc = mx.getThreadAllocatedBytes(tid) - a0;
			long t1 = System.nanoTime();
			for (int i = 0; i < 5; i++) e.getValue().run();
			long warm = (System.nanoTime() - t1) / 5_000_000;
			Files.write(out.resolve(e.getKey()), data);
			System.out.printf("%-38s %9d %9d %10.1f %10.1f%n", e.getKey(), cold, warm, alloc / 1048576.0, data.length / 1024.0);
		}
		Runtime rt = Runtime.getRuntime();
		System.out.printf("heap used after all: %.1f MB (max %.0f MB)%n", (rt.totalMemory() - rt.freeMemory()) / 1048576.0, rt.maxMemory() / 1048576.0);

		for (File f : out.toFile().listFiles((d, n) -> n.endsWith(".pdf"))) inspectPdf(f, out);
	}

	interface Body { void accept(java.io.OutputStream o) throws Exception; }

	static byte[] bytes(Body b) throws Exception {
		ByteArrayOutputStream o = new ByteArrayOutputStream();
		b.accept(o);
		return o.toByteArray();
	}

	/** 샘플에 쓴 글자 중 글꼴에 없는 것, 글꼴 내장 허용(OS/2 fsType). */
	static void coverage(String family) throws Exception {
		StringBuilder all = new StringBuilder(Sample.TITLE + Sample.DATE + Sample.WRITER + Sample.NOTE + "•");
		Sample.ROWS.forEach(r -> all.append(r.task()).append(r.result()).append(r.time()));
		Sample.PLAN.forEach(all::append);
		try (TrueTypeFont ttf = new TTFParser().parse(new RandomAccessReadBuffer(Fonts.bytes(family + "-Regular.ttf")))) {
			var cmap = ttf.getUnicodeCmapLookup();
			TreeSet<String> missing = new TreeSet<>();
			all.codePoints().filter(cp -> cp > ' ' && cmap.getGlyphId(cp) == 0).forEach(cp -> missing.add(new String(Character.toChars(cp)) + String.format("(U+%04X)", cp)));
			System.out.printf("font %s: name=%s glyphs=%d fsType=0x%04X missing=%s%n", family, ttf.getName(), ttf.getNumberOfGlyphs(), ttf.getOS2Windows().getFsType(), missing);
		}
	}

	/** PDF 글꼴 내장·부분 내장 여부, 글자 추출(검색·복사), 1쪽 PNG. */
	static void inspectPdf(File f, Path out) throws Exception {
		try (PDDocument doc = Loader.loadPDF(f)) {
			PDResources res = doc.getPage(0).getResources();
			StringBuilder fonts = new StringBuilder();
			for (var n : res.getFontNames()) {
				PDFont font = res.getFont(n);
				boolean embedded = font.isEmbedded();
				if (font instanceof PDType0Font t0) embedded = t0.getDescendantFont().isEmbedded();
				fonts.append(font.getName()).append(embedded ? "[embedded]" : "[NOT embedded]").append(' ');
			}
			String text = new PDFTextStripper().getText(doc);
			boolean ok = text.contains("업무일지") && text.contains("부서장") && text.contains("₩1,250,000") && text.contains("메모리 누수");
			System.out.printf("%s: pages=%d fonts=%s textExtractOK=%s%n", f.getName(), doc.getNumberOfPages(), fonts.toString().trim(), ok);
			BufferedImage img = new PDFRenderer(doc).renderImageWithDPI(0, 110);
			ImageIO.write(img, "png", out.resolve(f.getName().replace(".pdf", ".png")).toFile());
		}
	}

	private Main() {}
}
