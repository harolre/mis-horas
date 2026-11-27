import type {
  Color,
  PDFDocument,
  PDFFont,
  PDFPage,
} from 'pdf-lib';
import { formatDayNumber, formatWeekday } from '../domain/date';
import { formatDuration, formatTime } from '../domain/time';
import type { PeriodReport, ReportDay } from './periodReport';

const PAGE_WIDTH = 595.28;
const PAGE_HEIGHT = 841.89;
const MARGIN = 40;
const CONTENT_WIDTH = PAGE_WIDTH - MARGIN * 2;
const BOTTOM_MARGIN = 48;

type Palette = {
  text: Color;
  muted: Color;
  line: Color;
  light: Color;
  primary: Color;
  warning: Color;
  vacation: Color;
  personal: Color;
  holiday: Color;
  sick: Color;
  medical: Color;
};

let COLORS: Palette;

type Fonts = {
  regular: PDFFont;
  bold: PDFFont;
};

type Cursor = {
  doc: PDFDocument;
  page: PDFPage;
  fonts: Fonts;
  y: number;
  continuation: string;
};

function truncate(
  text: string,
  font: PDFFont,
  size: number,
  maxWidth: number,
): string {
  if (font.widthOfTextAtSize(text, size) <= maxWidth) return text;
  let result = text;
  while (
    result.length > 1 &&
    font.widthOfTextAtSize(`${result}…`, size) > maxWidth
  ) {
    result = result.slice(0, -1);
  }
  return `${result}…`;
}

function drawText(
  page: PDFPage,
  text: string,
  options: {
    x: number;
    y: number;
    size: number;
    font: PDFFont;
    color?: Color;
    maxWidth?: number;
  },
): void {
  const content = options.maxWidth
    ? truncate(text, options.font, options.size, options.maxWidth)
    : text;
  page.drawText(content, {
    x: options.x,
    y: options.y,
    size: options.size,
    font: options.font,
    color: options.color ?? COLORS.text,
  });
}

function addPage(cursor: Cursor): void {
  cursor.page = cursor.doc.addPage([PAGE_WIDTH, PAGE_HEIGHT]);
  cursor.y = PAGE_HEIGHT - 52;
  drawText(cursor.page, 'MIS HORAS', {
    x: MARGIN,
    y: cursor.y,
    size: 11,
    font: cursor.fonts.bold,
    color: COLORS.primary,
  });
  drawText(cursor.page, cursor.continuation, {
    x: MARGIN + 88,
    y: cursor.y,
    size: 9,
    font: cursor.fonts.regular,
    color: COLORS.muted,
    maxWidth: CONTENT_WIDTH - 88,
  });
  cursor.y -= 20;
  cursor.page.drawLine({
    start: { x: MARGIN, y: cursor.y },
    end: { x: PAGE_WIDTH - MARGIN, y: cursor.y },
    thickness: 0.7,
    color: COLORS.line,
  });
  cursor.y -= 18;
}

function ensure(cursor: Cursor, height: number): void {
  if (cursor.y - height < BOTTOM_MARGIN) addPage(cursor);
}

function drawSectionTitle(
  cursor: Cursor,
  title: string,
): void {
  ensure(cursor, 32);
  drawText(cursor.page, title, {
    x: MARGIN,
    y: cursor.y,
    size: 12,
    font: cursor.fonts.bold,
    color: COLORS.text,
  });
  cursor.y -= 16;
}

function drawSummaryBoxes(cursor: Cursor, report: PeriodReport): void {
  const boxWidth = (CONTENT_WIDTH - 20) / 3;
  const boxHeight = 48;
  const values = [
    ['TRABAJADAS', formatDuration(report.worked)],
    ['OBJETIVO', formatDuration(report.target)],
    ['EXTRA', report.extra > 0 ? `+${formatDuration(report.extra)}` : '—'],
  ];
  values.forEach(([label, value], index) => {
    const x = MARGIN + index * (boxWidth + 10);
    cursor.page.drawRectangle({
      x,
      y: cursor.y - boxHeight,
      width: boxWidth,
      height: boxHeight,
      color: COLORS.light,
      borderColor: COLORS.line,
      borderWidth: 0.6,
    });
    drawText(cursor.page, label, {
      x: x + 10,
      y: cursor.y - 17,
      size: 7,
      font: cursor.fonts.bold,
      color: COLORS.muted,
    });
    drawText(cursor.page, value, {
      x: x + 10,
      y: cursor.y - 36,
      size: 14,
      font: cursor.fonts.bold,
      color: label === 'EXTRA' ? COLORS.warning : COLORS.text,
      maxWidth: boxWidth - 20,
    });
  });
  cursor.y -= boxHeight + 12;
}

function drawMeta(cursor: Cursor, report: PeriodReport): void {
  const parts = [
    `${report.daysWithHours} ${report.daysWithHours === 1 ? 'día' : 'días'} con horas`,
  ];
  if (report.absences.vacation > 0) {
    parts.push(
      `${report.absences.vacation} ${
        report.absences.vacation === 1 ? 'día' : 'días'
      } de vacaciones`,
    );
  }
  if (report.absences.personal > 0) {
    parts.push(
      `${report.absences.personal} ${
        report.absences.personal === 1 ? 'día' : 'días'
      } de asunto propio`,
    );
  }
  if (report.absences.sick > 0) {
    parts.push(
      `${report.absences.sick} ${
        report.absences.sick === 1 ? 'día' : 'días'
      } de baja`,
    );
  }
  if (report.medicalMinutes > 0) {
    parts.push(`${formatDuration(report.medicalMinutes)} de médico`);
  }

  drawText(cursor.page, parts.join(' · '), {
    x: MARGIN,
    y: cursor.y,
    size: 8.5,
    font: cursor.fonts.regular,
    color: COLORS.muted,
    maxWidth: CONTENT_WIDTH,
  });
  cursor.y -= 18;
}

const TABLE = {
  date: MARGIN,
  status: MARGIN + 55,
  schedule: MARGIN + 125,
  total: MARGIN + 475,
  right: PAGE_WIDTH - MARGIN,
};

function drawTableHeader(cursor: Cursor): void {
  ensure(cursor, 30);
  drawText(cursor.page, 'DÍA', {
    x: TABLE.date,
    y: cursor.y,
    size: 7.5,
    font: cursor.fonts.bold,
    color: COLORS.muted,
  });
  drawText(cursor.page, 'ESTADO', {
    x: TABLE.status,
    y: cursor.y,
    size: 7.5,
    font: cursor.fonts.bold,
    color: COLORS.muted,
  });
  drawText(cursor.page, 'HORARIO', {
    x: TABLE.schedule,
    y: cursor.y,
    size: 7.5,
    font: cursor.fonts.bold,
    color: COLORS.muted,
  });
  drawText(cursor.page, 'TOTAL', {
    x: TABLE.total,
    y: cursor.y,
    size: 7.5,
    font: cursor.fonts.bold,
    color: COLORS.muted,
  });
  cursor.y -= 8;
  cursor.page.drawLine({
    start: { x: MARGIN, y: cursor.y },
    end: { x: TABLE.right, y: cursor.y },
    thickness: 0.7,
    color: COLORS.line,
  });
  cursor.y -= 14;
}

function statusColor(day: ReportDay): Color {
  if (day.kind === 'vacation') return COLORS.vacation;
  if (day.kind === 'personal') return COLORS.personal;
  if (day.kind === 'holiday') return COLORS.holiday;
  if (day.kind === 'sick') return COLORS.sick;
  return COLORS.text;
}

function drawDayRow(
  cursor: Cursor,
  day: ReportDay,
  index: number,
): void {
  const lineCount = Math.max(1, day.movements.length);
  const rowHeight = 18 + (lineCount - 1) * 14;
  ensure(cursor, rowHeight + 4);
  if (index % 2 === 0) {
    cursor.page.drawRectangle({
      x: MARGIN,
      y: cursor.y - rowHeight + 4,
      width: CONTENT_WIDTH,
      height: rowHeight,
      color: COLORS.light,
    });
  }
  drawText(cursor.page, `${formatWeekday(day.date)} ${formatDayNumber(day.date)}`, {
    x: TABLE.date,
    y: cursor.y,
    size: 8.5,
    font: cursor.fonts.bold,
    color: COLORS.text,
  });
  drawText(
    cursor.page,
    day.kind === 'work' && day.movements.length === 0
      ? '—'
      : day.kindLabel,
    {
      x: TABLE.status,
      y: cursor.y,
      size: 8,
      font: cursor.fonts.regular,
      color:
        day.kind === 'work' && day.movements.length === 0
          ? COLORS.muted
          : statusColor(day),
      maxWidth: 70,
    },
  );
  if (day.movements.length === 0) {
    drawText(cursor.page, '—', {
      x: TABLE.schedule,
      y: cursor.y,
      size: 8,
      font: cursor.fonts.regular,
      color: COLORS.muted,
    });
    drawText(cursor.page, '—', {
      x: TABLE.total,
      y: cursor.y,
      size: 8,
      font: cursor.fonts.regular,
      color: COLORS.muted,
    });
  } else {
    day.movements.forEach((movement, line) => {
      const y = cursor.y - line * 14;
      const prefix = movement.category === 'medical' ? 'Médico · ' : '';
      const schedule = `${prefix}${formatTime(movement.startMin)}–${formatTime(
        movement.endMin,
      )}${movement.breakMin > 0 ? `  ·  pausa ${movement.breakMin}m` : ''}`;
      drawText(cursor.page, schedule, {
        x: TABLE.schedule,
        y,
        size: 7.7,
        font: cursor.fonts.regular,
        color:
          movement.category === 'medical' ? COLORS.medical : COLORS.text,
        maxWidth: 330,
      });
      if (line === 0) {
        drawText(cursor.page, formatDuration(day.total), {
          x: TABLE.total,
          y,
          size: 8.5,
          font: cursor.fonts.bold,
          color: COLORS.text,
          maxWidth: 70,
        });
      }
    });
  }

  const separatorY = cursor.y - (lineCount - 1) * 14 - 7;
  cursor.page.drawLine({
    start: { x: MARGIN, y: separatorY },
    end: { x: TABLE.right, y: separatorY },
    thickness: 0.4,
    color: COLORS.line,
  });
  cursor.y -= rowHeight;
}

function drawDaysTable(cursor: Cursor, report: PeriodReport): void {
  drawSectionTitle(cursor, 'Detalle por días');
  drawTableHeader(cursor);
  report.days.forEach((day, index) => {
    const lineCount = Math.max(1, day.movements.length);
    const rowHeight = 18 + (lineCount - 1) * 14;
    if (cursor.y - (rowHeight + 4) < BOTTOM_MARGIN) {
      addPage(cursor);
      drawTableHeader(cursor);
    }
    drawDayRow(cursor, day, index);
  });
  if (report.period === 'month') {
    ensure(cursor, 20);
    drawText(cursor.page, 'Se muestran los días con actividad o ausencia.', {
      x: MARGIN,
      y: cursor.y,
      size: 7,
      font: cursor.fonts.regular,
      color: COLORS.muted,
      maxWidth: CONTENT_WIDTH,
    });
    cursor.y -= 16;
  }
}

function drawYearTable(cursor: Cursor, report: PeriodReport): void {
  drawSectionTitle(cursor, 'Resumen por meses');
  const cols = {
    month: MARGIN,
    worked: MARGIN + 75,
    target: MARGIN + 145,
    extra: MARGIN + 215,
    vacation: MARGIN + 285,
    personal: MARGIN + 320,
    sick: MARGIN + 365,
    medical: MARGIN + 405,
  };
  const header = () => {
    ensure(cursor, 24);
    drawText(cursor.page, 'MES', {
      x: cols.month,
      y: cursor.y,
      size: 7,
      font: cursor.fonts.bold,
      color: COLORS.muted,
    });
    drawText(cursor.page, 'TRABAJADAS', {
      x: cols.worked,
      y: cursor.y,
      size: 7,
      font: cursor.fonts.bold,
      color: COLORS.muted,
    });
    drawText(cursor.page, 'OBJETIVO', {
      x: cols.target,
      y: cursor.y,
      size: 7,
      font: cursor.fonts.bold,
      color: COLORS.muted,
    });
    drawText(cursor.page, 'EXTRA', {
      x: cols.extra,
      y: cursor.y,
      size: 7,
      font: cursor.fonts.bold,
      color: COLORS.muted,
    });
    drawText(cursor.page, 'VAC.', {
      x: cols.vacation,
      y: cursor.y,
      size: 7,
      font: cursor.fonts.bold,
      color: COLORS.muted,
    });
    drawText(cursor.page, 'ASUNT.', {
      x: cols.personal,
      y: cursor.y,
      size: 7,
      font: cursor.fonts.bold,
      color: COLORS.muted,
    });
    drawText(cursor.page, 'BAJAS', {
      x: cols.sick,
      y: cursor.y,
      size: 7,
      font: cursor.fonts.bold,
      color: COLORS.muted,
    });
    drawText(cursor.page, 'MÉDICO', {
      x: cols.medical,
      y: cursor.y,
      size: 7,
      font: cursor.fonts.bold,
      color: COLORS.muted,
    });
    cursor.y -= 8;
    cursor.page.drawLine({
      start: { x: MARGIN, y: cursor.y },
      end: { x: TABLE.right, y: cursor.y },
      thickness: 0.7,
      color: COLORS.line,
    });
    cursor.y -= 14;
  };
  header();
  report.months.forEach((month, index) => {
    ensure(cursor, 20);
    if (index % 2 === 0) {
      cursor.page.drawRectangle({
        x: MARGIN,
        y: cursor.y - 12,
        width: CONTENT_WIDTH,
        height: 18,
        color: COLORS.light,
      });
    }
    drawText(cursor.page, month.label, {
      x: cols.month,
      y: cursor.y,
      size: 8,
      font: cursor.fonts.regular,
      color: COLORS.text,
    });
    drawText(cursor.page, formatDuration(month.worked), {
      x: cols.worked,
      y: cursor.y,
      size: 7.8,
      font: cursor.fonts.regular,
      color: COLORS.text,
    });
    drawText(cursor.page, formatDuration(month.target), {
      x: cols.target,
      y: cursor.y,
      size: 7.8,
      font: cursor.fonts.regular,
      color: COLORS.muted,
    });
    drawText(cursor.page, month.extra > 0 ? `+${formatDuration(month.extra)}` : '—', {
      x: cols.extra,
      y: cursor.y,
      size: 7.8,
      font: cursor.fonts.regular,
      color: COLORS.text,
    });
    drawText(cursor.page, month.vacation > 0 ? String(month.vacation) : '—', {
      x: cols.vacation,
      y: cursor.y,
      size: 7.8,
      font: cursor.fonts.regular,
      color: COLORS.vacation,
    });
    drawText(cursor.page, month.personal > 0 ? String(month.personal) : '—', {
      x: cols.personal,
      y: cursor.y,
      size: 7.8,
      font: cursor.fonts.regular,
      color: COLORS.personal,
    });
    drawText(cursor.page, month.sick > 0 ? String(month.sick) : '—', {
      x: cols.sick,
      y: cursor.y,
      size: 7.8,
      font: cursor.fonts.regular,
      color: COLORS.sick,
    });
    drawText(cursor.page, month.medicalMinutes > 0 ? formatDuration(month.medicalMinutes) : '—', {
      x: cols.medical,
      y: cursor.y,
      size: 7.8,
      font: cursor.fonts.regular,
      color: COLORS.medical,
    });
    cursor.y -= 18;
  });
}

function drawAbsences(cursor: Cursor, report: PeriodReport): void {
  drawSectionTitle(cursor, 'Vacaciones y ausencias');
  const rows: Array<[string, number, Color]> = [];
  if (report.absences.vacation > 0) {
    rows.push(['Vacaciones', report.absences.vacation, COLORS.vacation]);
  }
  if (report.absences.personal > 0) {
    rows.push(['Asunto propio', report.absences.personal, COLORS.personal]);
  }
  if (report.absences.sick > 0) {
    rows.push(['Baja', report.absences.sick, COLORS.sick]);
  }
  if (report.absences.holiday > 0) {
    rows.push(['Festivos', report.absences.holiday, COLORS.holiday]);
  }
  if (report.medicalMinutes > 0) {
    rows.push(['Tiempo de médico', report.medicalMinutes, COLORS.medical]);
  }
  if (rows.length === 0) {
    drawText(cursor.page, 'Sin ausencias ni tiempo de médico en este periodo.', {
      x: MARGIN,
      y: cursor.y,
      size: 8.5,
      font: cursor.fonts.regular,
      color: COLORS.muted,
    });
    cursor.y -= 16;
    return;
  }
  for (const [label, value, color] of rows) {
    ensure(cursor, 18);
    cursor.page.drawCircle({
      x: MARGIN + 4,
      y: cursor.y + 3,
      size: 3,
      color,
    });
    drawText(cursor.page, label, {
      x: MARGIN + 16,
      y: cursor.y,
      size: 8.5,
      font: cursor.fonts.regular,
      color: COLORS.text,
    });
    drawText(
      cursor.page,
      label === 'Tiempo de médico'
        ? formatDuration(value)
        : `${value} ${value === 1 ? 'día' : 'días'}`,
      {
        x: MARGIN + 200,
        y: cursor.y,
        size: 8.5,
        font: cursor.fonts.bold,
        color: COLORS.text,
      },
    );
    cursor.y -= 16;
  }
  cursor.y -= 4;
}

function drawFooter(
  page: PDFPage,
  fonts: Fonts,
  index: number,
  total: number,
): void {
  page.drawLine({
    start: { x: MARGIN, y: 38 },
    end: { x: PAGE_WIDTH - MARGIN, y: 38 },
    thickness: 0.5,
    color: COLORS.line,
  });
  drawText(page, `Generado el ${new Date().toLocaleDateString('es-ES')} · Mis Horas`, {
    x: MARGIN,
    y: 26,
    size: 7,
    font: fonts.regular,
    color: COLORS.muted,
  });
  const label = `Página ${index + 1} de ${total}`;
  drawText(page, label, {
    x: PAGE_WIDTH - MARGIN - fonts.regular.widthOfTextAtSize(label, 7),
    y: 26,
    size: 7,
    font: fonts.regular,
    color: COLORS.muted,
  });
}

export async function createPeriodPdf(report: PeriodReport): Promise<Blob> {
  const { PDFDocument, StandardFonts, rgb } = await import('pdf-lib');
  COLORS = {
    text: rgb(0.06, 0.09, 0.16),
    muted: rgb(0.4, 0.45, 0.52),
    line: rgb(0.88, 0.91, 0.95),
    light: rgb(0.97, 0.98, 0.99),
    primary: rgb(0.15, 0.39, 0.92),
    warning: rgb(0.71, 0.33, 0.04),
    vacation: rgb(0.01, 0.52, 0.78),
    personal: rgb(0.05, 0.58, 0.53),
    holiday: rgb(0.49, 0.23, 0.93),
    sick: rgb(0.86, 0.15, 0.15),
    medical: rgb(0.86, 0.15, 0.47),
  };
  const doc = await PDFDocument.create();
  doc.setTitle(report.title);
  doc.setSubject(report.subtitle);
  doc.setCreator('Mis Horas');
  doc.setProducer('Mis Horas');
  const fonts: Fonts = {
    regular: await doc.embedFont(StandardFonts.Helvetica),
    bold: await doc.embedFont(StandardFonts.HelveticaBold),
  };
  const cursor: Cursor = {
    doc,
    page: doc.addPage([PAGE_WIDTH, PAGE_HEIGHT]),
    fonts,
    y: PAGE_HEIGHT - 52,
    continuation: report.title,
  };

  drawText(cursor.page, 'MIS HORAS', {
    x: MARGIN,
    y: cursor.y,
    size: 20,
    font: fonts.bold,
    color: COLORS.primary,
  });
  drawText(cursor.page, report.title, {
    x: MARGIN,
    y: cursor.y - 24,
    size: 13,
    font: fonts.bold,
    color: COLORS.text,
    maxWidth: CONTENT_WIDTH,
  });
  drawText(cursor.page, report.subtitle, {
    x: MARGIN,
    y: cursor.y - 40,
    size: 8.5,
    font: fonts.regular,
    color: COLORS.muted,
  });
  cursor.y -= 58;
  drawSummaryBoxes(cursor, report);
  drawMeta(cursor, report);

  if (report.period === 'year') {
    drawYearTable(cursor, report);
  } else {
    drawDaysTable(cursor, report);
  }
  drawAbsences(cursor, report);

  const pages = doc.getPages();
  pages.forEach((page, index) => {
    drawFooter(page, fonts, index, pages.length);
  });

  const bytes = await doc.save();
  return new Blob([bytes], { type: 'application/pdf' });
}

export function periodPdfFileName(report: PeriodReport): string {
  if (report.period === 'week') {
    return `mis-horas-semana-${report.from}.pdf`;
  }
  if (report.period === 'month') {
    return `mis-horas-mes-${report.from.slice(0, 7)}.pdf`;
  }
  return `mis-horas-ano-${report.from.slice(0, 4)}.pdf`;
}
