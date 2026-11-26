import { useState } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { Modal } from '../../components/Modal';
import { Icon } from '../../components/Icon';
import { Segmented } from '../../components/Segmented';
import { useToast } from '../../components/Toast';
import { addDays, addMonths, addYears } from '../../domain/date';
import { formatDuration } from '../../domain/time';
import { downloadBlob, shareBlob } from '../../utils/download';
import {
  buildPeriodReport,
  type PeriodReport,
  type ReportPeriod,
} from '../../reports/periodReport';
import {
  createPeriodPdf,
  periodPdfFileName,
} from '../../reports/pdf';

const PERIOD_OPTIONS = [
  { value: 'week', label: 'Semana' },
  { value: 'month', label: 'Mes' },
  { value: 'year', label: 'Año' },
];

interface ExportPdfModalProps {
  initialPeriod: ReportPeriod;
  initialAnchor: string;
  onClose: () => void;
}

export function ExportPdfModal({
  initialPeriod,
  initialAnchor,
  onClose,
}: ExportPdfModalProps) {
  const toast = useToast();
  const [period, setPeriod] = useState<ReportPeriod>(initialPeriod);
  const [anchor, setAnchor] = useState(initialAnchor);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [pdf, setPdf] = useState<{
    blob: Blob;
    filename: string;
  } | null>(null);

  const report = useLiveQuery(
    () => buildPeriodReport(period, anchor),
    [period, anchor],
    undefined as PeriodReport | undefined,
  );

  function shift(direction: -1 | 1) {
    if (period === 'week') setAnchor(addDays(anchor, direction * 7));
    else if (period === 'month') setAnchor(addMonths(anchor, direction));
    else setAnchor(addYears(anchor, direction));
  }

  async function preparePdf() {
    if (!report || busy) return;
    setError('');
    setBusy(true);
    try {
      const blob = await createPeriodPdf(report);
      setPdf({ blob, filename: periodPdfFileName(report) });
      toast('PDF preparado. Ya puedes compartirlo o descargarlo.', 'success');
    } catch (exportError) {
      setError(
        (exportError as Error).message ||
          'No se pudo crear el PDF. Inténtalo de nuevo.',
      );
    } finally {
      setBusy(false);
    }
  }

  async function sharePdf() {
    if (!pdf || busy) return;
    setError('');
    setBusy(true);
    try {
      const shared = await shareBlob(
        pdf.blob,
        pdf.filename,
        'Informe de horas de Mis Horas',
      );
      if (!shared) {
        downloadBlob(pdf.blob, pdf.filename);
        toast('El menú de compartir no está disponible. PDF descargado.', 'info');
      } else {
        toast('PDF compartido.', 'success');
      }
      onClose();
    } catch (shareError) {
      if ((shareError as Error).name === 'AbortError') return;
      downloadBlob(pdf.blob, pdf.filename);
      toast('No se pudo abrir el menú de compartir. PDF descargado.', 'info');
      onClose();
    } finally {
      setBusy(false);
    }
  }

  const periodLabel =
    period === 'week' ? 'semana' : period === 'month' ? 'mes' : 'año';

  return (
    <Modal
      title="Exportar PDF"
      subtitle="Elige el periodo que quieres compartir"
      onClose={onClose}
      dismissible={!busy}
      footer={
        <>
          <button
            type="button"
            className="btn btn-secondary"
            onClick={onClose}
            disabled={busy}
          >
            {pdf ? 'Cerrar' : 'Cancelar'}
          </button>
          <button
            type="button"
            className="btn btn-primary"
            onClick={() => void (pdf ? sharePdf() : preparePdf())}
            disabled={busy || (!report && !pdf)}
          >
            {busy ? (
              <span className="spinner on-primary" />
            ) : (
              <Icon name={pdf ? 'share' : 'download'} size={17} />
            )}
            {busy
              ? 'Preparando…'
              : pdf
                ? 'Compartir PDF'
                : 'Preparar PDF'}
          </button>
        </>
      }
    >
      {!pdf ? (
        <Segmented
          value={period}
          options={PERIOD_OPTIONS}
          onChange={(value) => setPeriod(value as ReportPeriod)}
          label="Periodo del PDF"
        />
      ) : null}

      {!pdf ? (
      <div className="export-period-nav">
        <button
          type="button"
          className="icon-button plain"
          onClick={() => shift(-1)}
          aria-label={`${periodLabel} anterior`}
          disabled={busy}
        >
          <Icon name="chevron-left" size={19} />
        </button>
        <div className="export-period-label">
          {report?.title ?? 'Cargando…'}
        </div>
        <button
          type="button"
          className="icon-button plain"
          onClick={() => shift(1)}
          aria-label={`${periodLabel} siguiente`}
          disabled={busy}
        >
          <Icon name="chevron-right" size={19} />
        </button>
      </div>
      ) : null}

      {pdf ? (
        <>
          <div className="banner success">
            <Icon name="check" size={16} />
            <span>
              PDF listo: {pdf.filename}. Pulsa «Compartir PDF» para guardarlo o
              enviarlo.
            </span>
          </div>
          <button
            type="button"
            className="btn btn-secondary btn-block"
            onClick={() => downloadBlob(pdf.blob, pdf.filename)}
          >
            <Icon name="download" size={17} />
            Descargar PDF
          </button>
        </>
      ) : report ? (
        <div className="export-preview">
          <div>
            <strong>{formatDuration(report.worked)}</strong>
            <span>trabajadas</span>
          </div>
          <div>
            <strong>{report.daysWithHours}</strong>
            <span>{report.daysWithHours === 1 ? 'día' : 'días'} con horas</span>
          </div>
          <div>
            <strong>{report.attachmentCount}</strong>
            <span>{report.attachmentCount === 1 ? 'adjunto' : 'adjuntos'}</span>
          </div>
        </div>
      ) : (
        <div className="row-center">
          <span className="spinner" />
          <span className="small muted">Preparando el periodo…</span>
        </div>
      )}

      {!pdf ? (
        <p className="field-hint">
          El PDF no incluye las fotos. Un clip indica que ese día tiene adjuntos.
        </p>
      ) : null}

      {error ? (
        <div className="banner danger" role="alert">
          <Icon name="alert" size={16} />
          <span>{error}</span>
        </div>
      ) : null}
    </Modal>
  );
}
