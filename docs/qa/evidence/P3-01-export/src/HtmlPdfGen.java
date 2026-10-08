package exp;

import java.io.ByteArrayInputStream;
import java.io.OutputStream;

import com.openhtmltopdf.pdfboxout.PdfRendererBuilder;

/** openhtmltopdf: HTML·CSS 서식(템플릿)을 PDF로. 글꼴은 useFont로 등록해 부분 내장. */
public final class HtmlPdfGen {
	public static String html(String family) {
		StringBuilder rows = new StringBuilder();
		for (Sample.Row r : Sample.ROWS) {
			rows.append("<tr><td class='c'>").append(esc(r.no())).append("</td><td>").append(esc(r.task()))
					.append("</td><td>").append(esc(r.result())).append("</td><td class='c'>").append(esc(r.time())).append("</td></tr>");
		}
		StringBuilder plan = new StringBuilder();
		for (String p : Sample.PLAN) plan.append("<li>").append(esc(p)).append("</li>");
		String appr = Sample.APPROVERS.stream().map(a -> "<th>" + a + "</th>").reduce("", String::concat);
		String sign = Sample.APPROVERS.stream().map(a -> "<td class='sign'></td>").reduce("", String::concat);
		return """
				<!DOCTYPE html><html><head><meta charset="UTF-8"/><style>
				@page { size: A4; margin: 14mm; }
				body { font-family: '%1$s'; font-size: 10pt; word-break: keep-all; }
				.top { width: 100%%; border-collapse: collapse; }
				h1 { font-size: 18pt; font-weight: bold; margin: 0; }
				table.grid { border-collapse: collapse; width: 100%%; }
				table.grid th, table.grid td { border: 0.6pt solid #333; padding: 3pt 4pt; vertical-align: middle; word-wrap: break-word; }
				table.grid th { background: #eee; font-weight: bold; }
				table.appr { width: 60mm; margin-left: auto; }
				td.sign { height: 14mm; }
				.c { text-align: center; }
				h2 { font-size: 10pt; font-weight: bold; margin: 10pt 0 4pt; }
				</style></head><body>
				<table class="top"><tr><td><h1>%2$s</h1></td><td>
				<table class="grid appr"><tr>%3$s</tr><tr>%4$s</tr></table></td></tr></table>
				<p>일자: %5$s &#160;&#160; 작성자: %6$s</p>
				<h2>오늘 실적</h2>
				<table class="grid"><colgroup><col style="width:6%%"/><col style="width:58%%"/><col style="width:24%%"/><col style="width:12%%"/></colgroup>
				<tr><th>No</th><th>업무</th><th>결과</th><th>소요</th></tr>%7$s</table>
				<h2>다음 근무일 계획</h2><ul>%8$s</ul>
				<p>%9$s</p>
				</body></html>
				""".formatted(family, esc(Sample.TITLE), appr, sign, esc(Sample.DATE), esc(Sample.WRITER), rows, plan, esc(Sample.NOTE));
	}

	public static void write(String family, OutputStream out) throws Exception {
		PdfRendererBuilder b = new PdfRendererBuilder();
		b.useFastMode();
		b.useFont(() -> new ByteArrayInputStream(Fonts.bytes(family + "-Regular.ttf")), family, 400, PdfRendererBuilder.FontStyle.NORMAL, true);
		b.useFont(() -> new ByteArrayInputStream(Fonts.bytes(family + "-Bold.ttf")), family, 700, PdfRendererBuilder.FontStyle.NORMAL, true);
		b.withHtmlContent(html(family), null);
		b.toStream(out);
		b.run();
	}

	static String esc(String s) {
		return s.replace("&", "&amp;").replace("<", "&lt;").replace(">", "&gt;").replace("\"", "&quot;").replace("'", "&#39;");
	}

	private HtmlPdfGen() {}
}
