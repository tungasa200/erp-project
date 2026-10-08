package exp;

import java.io.OutputStream;

import org.apache.poi.ss.usermodel.BorderStyle;
import org.apache.poi.ss.usermodel.CellStyle;
import org.apache.poi.ss.usermodel.FillPatternType;
import org.apache.poi.ss.usermodel.Font;
import org.apache.poi.ss.usermodel.HorizontalAlignment;
import org.apache.poi.ss.usermodel.IndexedColors;
import org.apache.poi.ss.usermodel.Row;
import org.apache.poi.ss.usermodel.Sheet;
import org.apache.poi.ss.usermodel.VerticalAlignment;
import org.apache.poi.ss.util.CellRangeAddress;
import org.apache.poi.xssf.streaming.SXSSFWorkbook;

/**
 * Apache POI로 .xlsx. xlsx는 글꼴을 내장할 수 없어 글꼴 이름만 지정하고 보는 PC 글꼴에 맡긴다.
 * autoSizeColumn은 AWT 글꼴 측정을 써서 글꼴 없는 Linux 컨테이너에서 실패·오측정하므로 열 너비를 고정한다.
 */
public final class XlsxGen {
	public static void write(String fontName, OutputStream out) throws Exception {
		try (SXSSFWorkbook wb = new SXSSFWorkbook()) {
			Font f = wb.createFont();
			f.setFontName(fontName);
			f.setCharSet(129); // HANGEUL
			f.setFontHeightInPoints((short) 10);
			Font fb = wb.createFont();
			fb.setFontName(fontName);
			fb.setCharSet(129);
			fb.setBold(true);
			fb.setFontHeightInPoints((short) 10);
			Font ft = wb.createFont();
			ft.setFontName(fontName);
			ft.setCharSet(129);
			ft.setBold(true);
			ft.setFontHeightInPoints((short) 16);

			CellStyle body = border(wb.createCellStyle());
			body.setFont(f);
			body.setWrapText(true);
			body.setVerticalAlignment(VerticalAlignment.CENTER);
			CellStyle center = wb.createCellStyle();
			center.cloneStyleFrom(body);
			center.setAlignment(HorizontalAlignment.CENTER);
			CellStyle head = wb.createCellStyle();
			head.cloneStyleFrom(center);
			head.setFont(fb);
			head.setFillForegroundColor(IndexedColors.GREY_25_PERCENT.getIndex());
			head.setFillPattern(FillPatternType.SOLID_FOREGROUND);
			CellStyle title = wb.createCellStyle();
			title.setFont(ft);
			CellStyle plain = wb.createCellStyle();
			plain.setFont(f);
			CellStyle bold = wb.createCellStyle();
			bold.setFont(fb);

			Sheet s = wb.createSheet("일간 일지");
			int[] widths = {6, 60, 26, 10};
			for (int i = 0; i < widths.length; i++) s.setColumnWidth(i, widths[i] * 256);

			Row r0 = s.createRow(0);
			cell(r0, 0, Sample.TITLE, title);
			s.addMergedRegion(new CellRangeAddress(0, 1, 0, 1));
			// 결재란: C~D열에 담당·팀장·부서장을 넣기엔 칸이 모자라 F~H열에 둔다
			for (int i = 0; i < Sample.APPROVERS.size(); i++) {
				s.setColumnWidth(5 + i, 10 * 256);
				cell(r0, 5 + i, Sample.APPROVERS.get(i), head);
			}
			Row sign = s.createRow(1);
			sign.setHeightInPoints(36);
			for (int i = 0; i < Sample.APPROVERS.size(); i++) cell(sign, 5 + i, "", center);

			cell(s.createRow(3), 0, "일자: " + Sample.DATE + "    작성자: " + Sample.WRITER, plain);
			cell(s.createRow(5), 0, "오늘 실적", bold);
			Row h = s.createRow(6);
			for (int i = 0; i < 4; i++) cell(h, i, Sample.HEADERS.get(i), head);
			int ri = 7;
			for (Sample.Row row : Sample.ROWS) {
				Row x = s.createRow(ri++);
				cell(x, 0, row.no(), center);
				cell(x, 1, row.task(), body);
				cell(x, 2, row.result(), body);
				cell(x, 3, row.time(), center);
			}
			cell(s.createRow(++ri), 0, "다음 근무일 계획", bold);
			for (String p : Sample.PLAN) cell(s.createRow(++ri), 0, "• " + p, plain);
			cell(s.createRow(ri + 2), 0, Sample.NOTE, plain);
			wb.write(out);
		}
	}

	private static CellStyle border(CellStyle c) {
		c.setBorderTop(BorderStyle.THIN);
		c.setBorderBottom(BorderStyle.THIN);
		c.setBorderLeft(BorderStyle.THIN);
		c.setBorderRight(BorderStyle.THIN);
		return c;
	}

	private static void cell(Row r, int i, String v, CellStyle st) {
		var c = r.createCell(i);
		c.setCellValue(v);
		c.setCellStyle(st);
	}

	private XlsxGen() {}
}
