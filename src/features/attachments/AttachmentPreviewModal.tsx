import { useEffect, useState } from 'react';
import type { Attachment } from '../../types';
import { getAttachmentFile } from '../../db/repos';
import { Modal } from '../../components/Modal';
import { Icon } from '../../components/Icon';
import { downloadBlob } from '../../utils/download';
import { formatFileSize } from '../../domain/time';

interface AttachmentPreviewModalProps {
  attachment: Attachment;
  onClose: () => void;
}

export function AttachmentPreviewModal({
  attachment,
  onClose,
}: AttachmentPreviewModalProps) {
  const [url, setUrl] = useState<string | null>(null);
  const [blob, setBlob] = useState<Blob | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  useEffect(() => {
    let active = true;
    let objectUrl: string | null = null;
    setLoading(true);
    getAttachmentFile(attachment.id)
      .then((file) => {
        if (!active) return;
        if (!file) {
          setError('No se encontró el archivo. Puede que se haya borrado.');
          return;
        }
        objectUrl = URL.createObjectURL(file);
        setBlob(file);
        setUrl(objectUrl);
      })
      .catch(() => {
        if (active) setError('No se pudo abrir el adjunto.');
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [attachment.id]);

  async function shareOrDownload() {
    if (!blob) return;
    const file = new File([blob], attachment.name, { type: attachment.mime });
    const canShareFiles =
      typeof navigator.canShare === 'function' &&
      navigator.canShare({ files: [file] });
    if (canShareFiles && typeof navigator.share === 'function') {
      try {
        await navigator.share({ files: [file], title: attachment.name });
        return;
      } catch {
        // El usuario canceló o no se pudo compartir: descargamos.
      }
    }
    downloadBlob(blob, attachment.name);
  }

  const isPdf = attachment.mime === 'application/pdf';

  return (
    <Modal
      title={attachment.name}
      subtitle={`${isPdf ? 'PDF' : 'Imagen'} · ${formatFileSize(attachment.size)}`}
      onClose={onClose}
      footer={
        <>
          <button
            type="button"
            className="btn btn-secondary"
            onClick={() => {
              if (blob) downloadBlob(blob, attachment.name);
            }}
            disabled={!blob}
          >
            <Icon name="download" size={17} />
            Descargar
          </button>
          <button
            type="button"
            className="btn btn-primary"
            onClick={() => void shareOrDownload()}
            disabled={!blob}
          >
            <Icon name="share" size={17} />
            Compartir
          </button>
        </>
      }
    >
      {loading ? (
        <div className="empty">
          <span className="spinner" />
          <p className="small muted">Abriendo adjunto…</p>
        </div>
      ) : null}
      {error ? (
        <div className="banner danger">
          <Icon name="alert" size={16} />
          <span>{error}</span>
        </div>
      ) : null}
      {!loading && url && !isPdf ? (
        <img className="attach-preview" src={url} alt={attachment.name} />
      ) : null}
      {!loading && url && isPdf ? (
        <>
          <iframe
            className="attach-preview-frame"
            src={url}
            title={attachment.name}
          />
          <p className="field-hint">
            Si la vista previa no se muestra, usa «Compartir» para abrirlo en
            Vista Previa o guardarlo en Archivos.
          </p>
        </>
      ) : null}
    </Modal>
  );
}
