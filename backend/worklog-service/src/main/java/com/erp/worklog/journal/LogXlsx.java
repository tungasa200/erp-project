package com.erp.worklog.journal;

import com.erp.worklog.journal.LogDocument.InfoRow;
import com.erp.worklog.journal.LogDocument.Kind;
import com.erp.worklog.journal.LogDocument.Section;
import com.erp.worklog.journal.LogDocument.Table;
import com.erp.worklog.journal.RecordExportRows.Line;
import org.apache.poi.ss.usermodel.BorderStyle;
import org.apache.poi.ss.usermodel.Cell;
import org.apache.poi.ss.usermodel.CellStyle;
import org.apache.poi.ss.usermodel.FillPatternType;
import org.apache.poi.ss.usermodel.Font;
import org.apache.poi.ss.usermodel.HorizontalAlignment;
import org.apache.poi.ss.usermodel.PrintSetup;
import org.apache.poi.ss.usermodel.Row;
import org.apache.poi.ss.usermodel.Sheet;
import org.apache.poi.ss.usermodel.VerticalAlignment;
import org.apache.poi.ss.usermodel.Workbook;
import org.apache.poi.ss.util.CellRangeAddress;
import org.apache.poi.xssf.streaming.SXSSFWorkbook;
import org.apache.poi.xssf.usermodel.XSSFCellStyle;
import org.apache.poi.xssf.usermodel.XSSFColor;
import org.apache.poi.xssf.usermodel.XSSFFont;

import java.io.ByteArrayOutputStream;
import java.io.IOException;
import java.io.UncheckedIOException;
import java.time.Instant;
import java.time.ZoneId;
import java.util.ArrayList;
import java.util.List;

/**
 * Excel (서식 명세 3.3). 시트 1 "업무일지"는 PDF와 같은 순서의 제출용, 시트 2 "기록"은 그 기간 원본 기록.
 * 글꼴은 '맑은 고딕' 이름만 지정한다(xlsx는 내장 불가, D-111). 열 너비는 고정값(autoSizeColumn은 AWT 글꼴 측정이라 쓰지 않음).
 */
final class LogXlsx {

	private static final String FONT = "맑은 고딕";
	private static final int[] WIDTHS = { 5, 12, 30, 28, 9, 9, 9 };
	private static final byte[] LINE = { (byte) 0xBF, (byte) 0xBF, (byte) 0xBF };
	private static final byte[] HEAD_BG = { (byte) 0xF2, (byte) 0xF2, (byte) 0xF2 };
	private static final byte[] GRAY = { 0x59, 0x59, 0x59 };
	private static final byte[] SUB = { 0x40, 0x40, 0x40 };
	private static final String[] RECORD_HEADERS = { "날짜", "내용", "업무", "프로젝트", "상태", "결과", "결과 칩", "진행률", "시작", "종료",
			"소요시간(분)" };
	private static final int[] RECORD_WIDTHS = { 12, 40, 20, 16, 10, 24, 10, 8, 17, 17, 12 };

	private final Workbook wb;
	private final CellStyle title;
	private final CellStyle heading;
	private final CellStyle body;
	private final CellStyle sub;
	private final CellStyle gray;
	private final CellStyle note;
	private final CellStyle approval;
	private final CellStyle sign;

	private LogXlsx(Workbook wb) {
		this.wb = wb;
		title = style(font(20, true, null), false);
		heading = style(font(11, true, null), false);
		body = style(font(10, false, null), false);
		sub = style(font(9, false, SUB), false);
		gray = style(font(10, false, GRAY), false);
		note = style(font(9, false, GRAY), false);
		approval = style(font(9, true, null), true);
		fill(approval);
		thinBox(approval);
		sign = style(font(10, false, null), true);
		thinBox(sign);
		title.setVerticalAlignment(VerticalAlignment.CENTER);
	}

	/** 일지 파일: 시트 1 업무일지 + 시트 2 기록. */
	static byte[] write(LogDocument d, List<Line> records, ZoneId zone) {
		try (SXSSFWorkbook wb = new SXSSFWorkbook(200)) {
			LogXlsx x = new LogXlsx(wb);
			x.logSheet(d);
			x.recordSheet(records, zone);
			return bytes(wb);
		} catch (IOException e) {
			throw new UncheckedIOException(e);
		}
	}

	/** 기간 업무 기록 파일: 시트 "기록"만 (GET /records/export). */
	static byte[] writeRecords(List<Line> records, ZoneId zone) {
		try (SXSSFWorkbook wb = new SXSSFWorkbook(200)) {
			new LogXlsx(wb).recordSheet(records, zone);
			return bytes(wb);
		} catch (IOException e) {
			throw new UncheckedIOException(e);
		}
	}

	// ---- 시트 1

	private void logSheet(LogDocument d) {
		Sheet s = wb.createSheet("업무일지");
		for (int i = 0; i < WIDTHS.length; i++) {
			s.setColumnWidth(i, WIDTHS[i] * 256);
		}
		PrintSetup ps = s.getPrintSetup();
		ps.setPaperSize(PrintSetup.A4_PAPERSIZE);
		ps.setLandscape(false);
		ps.setFitWidth((short) 1);
		ps.setFitHeight((short) 0);
		s.setFitToPage(true);
		s.setAutobreaks(true);
		s.setMargin(Sheet.TopMargin, 18 / 25.4);
		s.setMargin(Sheet.BottomMargin, 16 / 25.4);
		s.setMargin(Sheet.LeftMargin, 18 / 25.4);
		s.setMargin(Sheet.RightMargin, 18 / 25.4);

		// 1~3행: 제목 + 결재란
		Row r1 = s.createRow(0);
		Row r2 = s.createRow(1);
		Row r3 = s.createRow(2);
		r2.setHeightInPoints(22.7f);
		r3.setHeightInPoints(22.7f);
		put(r1, 0, d.title() + (d.draft() ? "   [초안]" : ""), title);
		s.addMergedRegion(new CellRangeAddress(0, 2, 0, 3));
		String[] names = { "담당", "팀장", "부서장" };
		for (int i = 0; i < 3; i++) {
			put(r1, 4 + i, names[i], approval);
			put(r2, 4 + i, "", sign);
			put(r3, 4 + i, "", sign);
			s.addMergedRegion(new CellRangeAddress(1, 2, 4 + i, 4 + i));
		}

		// 5~6행: 정보표
		int r = 4;
		InfoRow[] info = d.info();
		for (int i = 0; i < info.length; i++) {
			Row row = s.createRow(r);
			boolean first = i == 0;
			boolean last = i == info.length - 1;
			CellStyle label = line(font(9.5f, true, null), first, last, false, true);
			fill(label);
			CellStyle value = line(font(10, false, null), first, last, false, false);
			span(s, row, 0, 1, info[i].label1(), label);
			span(s, row, 2, 2, info[i].value1(), value);
			span(s, row, 3, 3, info[i].label2(), label);
			span(s, row, 4, 6, info[i].value2(), value);
			r++;
		}
		r++;

		for (Section sec : d.sections()) {
			r = section(s, r, sec) + 1;
		}
	}

	private int section(Sheet s, int r, Section sec) {
		if (sec.kind() == Kind.DAYS) {
			if (sec.table() == null) {
				return text(s, r, sec.line(), sub);
			}
			Table t = sec.table();
			Row h = s.createRow(r++);
			Row v = s.createRow(r++);
			for (int i = 0; i < t.headers().size() && i < 7; i++) {
				put(h, i, t.headers().get(i), line(font(9, false, null), true, false, true, false));
				put(v, i, t.rows().getFirst().get(i), line(font(9, sec.boldCells().get(i), null), false, true, true, false));
			}
			if (sec.note() != null) {
				r = text(s, r, sec.note(), note);
			}
			return r;
		}
		put(s.createRow(r++), 0, sec.heading(), heading);
		if (sec.kind() == Kind.BOX) {
			Row row = s.createRow(r);
			CellStyle box = line(font(10, false, null), true, true, false, false);
			span(s, row, 0, 6, sec.box(), box);
			row.setHeightInPoints(Math.max(57, lines(sec.box(), 102) * 15f));
			return r + 1;
		}
		if (sec.line() != null) {
			r = text(s, r, sec.line(), LogDocument.NONE.equals(sec.line()) ? gray : body);
		}
		if (sec.table() != null) {
			r = table(s, r, sec.table());
		}
		else if (sec.line() == null) {
			r = text(s, r, LogDocument.NONE, gray);
		}
		if (sec.note() != null) {
			r = text(s, r, sec.note(), note);
		}
		return r;
	}

	private int table(Sheet s, int r, Table t) {
		int[][] spans = spans(t.headers());
		Row h = s.createRow(r++);
		for (int i = 0; i < t.headers().size(); i++) {
			CellStyle st = line(font(9.5f, true, null), true, false, true, false);
			fill(st);
			span(s, h, spans[i][0], spans[i][1], t.headers().get(i), st);
		}
		for (int k = 0; k < t.rows().size(); k++) {
			boolean last = k == t.rows().size() - 1;
			boolean total = t.total() && last;
			List<String> cells = t.rows().get(k);
			Row row = s.createRow(r++);
			float lines = 1;
			for (int i = 0; i < cells.size(); i++) {
				CellStyle st = line(font(10, total, null), total, last, t.center()[i], false);
				span(s, row, spans[i][0], spans[i][1], cells.get(i), st);
				int width = 0;
				for (int c = spans[i][0]; c <= spans[i][1]; c++) {
					width += WIDTHS[c];
				}
				lines = Math.max(lines, lines(cells.get(i), width));
			}
			row.setHeightInPoints(Math.max(15, lines * 15f));
		}
		return r;
	}

	/** 표 칸 → 열(A=0..G=6) 범위 (3.3). */
	private static int[][] spans(List<String> headers) {
		if ("No".equals(headers.getFirst()) && headers.contains("예정")) {
			return new int[][] { { 0, 0 }, { 1, 3 }, { 4, 6 } };
		}
		if ("No".equals(headers.getFirst())) {
			List<int[]> result = new ArrayList<>();
			result.add(new int[] { 0, 0 });
			boolean project = "프로젝트".equals(headers.get(1));
			if (project) {
				result.add(new int[] { 1, 1 });
				result.add(new int[] { 2, 2 });
			}
			else {
				result.add(new int[] { 1, 2 });
			}
			result.add(new int[] { 3, 3 });
			boolean extra = headers.size() == (project ? 6 : 5);
			if (extra) {
				result.add(new int[] { 4, 4 });
				result.add(new int[] { 5, 6 });
			}
			else {
				result.add(new int[] { 4, 6 });
			}
			return result.toArray(new int[0][]);
		}
		if ("업무".equals(headers.get(1))) { // 소요시간 표
			return new int[][] { { 0, 1 }, { 2, 3 }, { 4, 5 }, { 6, 6 } };
		}
		// 프로젝트별 실적
		return headers.size() == 5 ? new int[][] { { 0, 2 }, { 3, 3 }, { 4, 4 }, { 5, 5 }, { 6, 6 } }
				: new int[][] { { 0, 2 }, { 3, 3 }, { 4, 6 } };
	}

	// ---- 시트 2

	private void recordSheet(List<Line> records, ZoneId zone) {
		Sheet s = wb.createSheet("기록");
		for (int i = 0; i < RECORD_WIDTHS.length; i++) {
			s.setColumnWidth(i, RECORD_WIDTHS[i] * 256);
		}
		CellStyle head = style(font(10, true, null), true);
		fill(head);
		head.setBorderBottom(BorderStyle.THIN);
		CellStyle text = style(font(10, false, null), false);
		CellStyle number = style(font(10, false, null), false);
		number.setWrapText(false);
		CellStyle date = style(font(10, false, null), false);
		date.setDataFormat(wb.createDataFormat().getFormat("yyyy-mm-dd"));
		CellStyle time = style(font(10, false, null), false);
		time.setDataFormat(wb.createDataFormat().getFormat("yyyy-mm-dd hh:mm"));

		Row h = s.createRow(0);
		for (int i = 0; i < RECORD_HEADERS.length; i++) {
			put(h, i, RECORD_HEADERS[i], head);
		}
		s.createFreezePane(0, 1);
		int r = 1;
		for (Line l : records) {
			Row row = s.createRow(r++);
			Cell d = row.createCell(0);
			d.setCellValue(l.workDate());
			d.setCellStyle(date);
			put(row, 1, l.content(), text);
			put(row, 2, l.taskTitle(), text);
			put(row, 3, l.projectName(), text);
			put(row, 4, status(l.status()), text);
			put(row, 5, l.result(), text);
			put(row, 6, LogDocument.progress(l.outcome(), null), text);
			number(row, 7, l.progress(), number);
			instant(row, 8, l.startAt(), zone, time);
			instant(row, 9, l.endAt(), zone, time);
			number(row, 10, l.durationMin(), number);
		}
	}

	private static String status(String s) {
		return switch (s) {
			case "CONFIRMED" -> "확정";
			case "PENDING" -> "확인 대기";
			case "DISMISSED" -> "안 했어요";
			default -> s;
		};
	}

	// ---- 조각

	private int text(Sheet s, int r, String value, CellStyle st) {
		Row row = s.createRow(r);
		span(s, row, 0, 6, value, st);
		row.setHeightInPoints(Math.max(15, lines(value, 102) * 15f));
		return r + 1;
	}

	/** 같은 스타일을 범위 안 모든 칸에 넣고 합친다(병합 칸 선이 끊기지 않게). */
	private static void span(Sheet s, Row row, int from, int to, String value, CellStyle st) {
		put(row, from, value, st);
		for (int c = from + 1; c <= to; c++) {
			put(row, c, "", st);
		}
		if (to > from) {
			s.addMergedRegion(new CellRangeAddress(row.getRowNum(), row.getRowNum(), from, to));
		}
	}

	private static void put(Row row, int col, String value, CellStyle st) {
		Cell c = row.createCell(col);
		if (value != null) {
			c.setCellValue(value);
		}
		c.setCellStyle(st);
	}

	private static void number(Row row, int col, Integer value, CellStyle st) {
		Cell c = row.createCell(col);
		if (value != null) {
			c.setCellValue(value);
		}
		c.setCellStyle(st);
	}

	private static void instant(Row row, int col, Instant value, ZoneId zone, CellStyle st) {
		Cell c = row.createCell(col);
		if (value != null) {
			c.setCellValue(value.atZone(zone).toLocalDateTime());
		}
		c.setCellStyle(st);
	}

	/** 줄 수 어림: 한글·전각은 2, 나머지는 1 너비로 세어 열 너비(문자)로 나눈다. 병합 칸은 Excel이 높이를 맞추지 않는다. */
	private static float lines(String s, int widthChars) {
		if (s == null || s.isEmpty()) {
			return 1;
		}
		int total = 0;
		for (String part : s.split("\n", -1)) {
			int w = 0;
			for (int i = 0; i < part.length(); i++) {
				w += part.charAt(i) > 0x2E80 ? 2 : 1;
			}
			total += Math.max(1, (int) Math.ceil(w / (double) Math.max(1, widthChars - 1)));
		}
		return total;
	}

	private Font font(float size, boolean bold, byte[] color) {
		XSSFFont f = (XSSFFont) wb.createFont();
		f.setFontName(FONT);
		f.setCharSet(129); // HANGEUL
		f.setFontHeight(size);
		f.setBold(bold);
		if (color != null) {
			f.setColor(new XSSFColor(color, null));
		}
		return f;
	}

	private CellStyle style(Font f, boolean center) {
		CellStyle st = wb.createCellStyle();
		st.setFont(f);
		st.setWrapText(true);
		st.setVerticalAlignment(VerticalAlignment.TOP);
		st.setAlignment(center ? HorizontalAlignment.CENTER : HorizontalAlignment.LEFT);
		return st;
	}

	/** 선 (1.4): top이면 위 굵은 검정, last면 아래 가는 검정, 아니면 아래 회색. 세로선은 정보표만(vertical). */
	private CellStyle line(Font f, boolean top, boolean last, boolean center, boolean vertical) {
		XSSFCellStyle st = (XSSFCellStyle) style(f, center);
		if (top) {
			st.setBorderTop(BorderStyle.MEDIUM);
		}
		st.setBorderBottom(last ? BorderStyle.THIN : BorderStyle.HAIR);
		if (!last) {
			st.setBottomBorderColor(new XSSFColor(LINE, null));
		}
		if (vertical) {
			st.setBorderRight(BorderStyle.HAIR);
			st.setRightBorderColor(new XSSFColor(LINE, null));
		}
		return st;
	}

	private static void fill(CellStyle st) {
		((XSSFCellStyle) st).setFillForegroundColor(new XSSFColor(HEAD_BG, null));
		st.setFillPattern(FillPatternType.SOLID_FOREGROUND);
	}

	private static void thinBox(CellStyle st) {
		st.setBorderTop(BorderStyle.THIN);
		st.setBorderBottom(BorderStyle.THIN);
		st.setBorderLeft(BorderStyle.THIN);
		st.setBorderRight(BorderStyle.THIN);
		st.setVerticalAlignment(VerticalAlignment.CENTER);
	}

	private static byte[] bytes(SXSSFWorkbook wb) throws IOException {
		ByteArrayOutputStream out = new ByteArrayOutputStream();
		wb.write(out);
		return out.toByteArray();
	}
}
