import type { PDFDocumentProxy, PDFPageProxy } from 'pdfjs-dist';
import {
  MAX_PDF_PAGES,
  PDF_JPEG_QUALITY,
  PDF_RASTER_DPI,
  PDF_THUMB_DIMENSION,
} from './constants';
import { canvasToBlob, createCanvas } from './image';

type PdfJsModule = typeof import('pdfjs-dist/legacy/build/pdf.mjs');

let pdfjsPromise: Promise<PdfJsModule> | null = null;

async function getPdfJs(): Promise<PdfJsModule> {
  if (!pdfjsPromise) {
    pdfjsPromise = (async () => {
      const pdfjs = await import('pdfjs-dist/legacy/build/pdf.mjs');
      const worker = await import('pdfjs-dist/legacy/build/pdf.worker.min.mjs?url');
      pdfjs.GlobalWorkerOptions.workerSrc = worker.default;
      return pdfjs;
    })();
  }
  return pdfjsPromise;
}

export interface PdfProgress {
  stage: 'analizando' | 'comprimiendo';
  page: number;
  total: number;
  percent: number;
}

export interface CompressedPdf {
  blob: Blob;
  thumb: Blob | null;
  pageCount: number;
  mode: 'lossless' | 'rasterized' | 'original';
}

function throwIfAborted(signal?: AbortSignal): void {
  if (signal?.aborted) {
    throw new DOMException('Cancelado', 'AbortError');
  }
}

async function renderThumb(page: PDFPageProxy): Promise<Blob | null> {
  try {
    const base = page.getViewport({ scale: 1 });
    const scale = Math.min(
      1,
      PDF_THUMB_DIMENSION / Math.max(base.width, base.height),
    );
    const viewport = page.getViewport({ scale });
    const canvas = createCanvas(viewport.width, viewport.height);
    const context = canvas.getContext('2d');
    if (!context) return null;
    context.fillStyle = '#ffffff';
    context.fillRect(0, 0, canvas.width, canvas.height);
    await page.render({ canvasContext: context, viewport }).promise;
    const blob = await canvasToBlob(canvas, 'image/jpeg', 0.72);
    canvas.width = 0;
    canvas.height = 0;
    return blob;
  } catch {
    return null;
  }
}

function stripMetadata(document: import('pdf-lib').PDFDocument): void {
  document.setTitle('');
  document.setAuthor('');
  document.setSubject('');
  document.setKeywords([]);
  document.setProducer('');
  document.setCreator('');
}

export async function compressPdf(
  file: File,
  options: {
    onProgress?: (progress: PdfProgress) => void;
    signal?: AbortSignal;
  } = {},
): Promise<CompressedPdf> {
  throwIfAborted(options.signal);
  const bytes = new Uint8Array(await file.arrayBuffer());
  const pdfjs = await getPdfJs();

  let document: PDFDocumentProxy;
  try {
    // PDF.js transfiere este búfer al worker: le damos una copia para que
    // `pdf-lib` pueda seguir usando los bytes originales sin perderlos.
    const loadingTask = pdfjs.getDocument({
      data: bytes.slice(),
      isEvalSupported: false,
      useSystemFonts: true,
    });
    document = await loadingTask.promise;
  } catch (error) {
    const name = (error as { name?: string }).name;
    if (name === 'PasswordException') {
      throw new Error(
        'El PDF está protegido con contraseña. Quita la protección e inténtalo de nuevo.',
      );
    }
    throw new Error('No se pudo leer el PDF. Puede estar dañado.');
  }

  try {
    if (document.numPages > MAX_PDF_PAGES) {
      throw new Error(
        `El PDF tiene ${document.numPages} páginas. El máximo es ${MAX_PDF_PAGES}.`,
      );
    }

    let textCharacters = 0;
    for (let pageNumber = 1; pageNumber <= document.numPages; pageNumber += 1) {
      throwIfAborted(options.signal);
      const page = await document.getPage(pageNumber);
      const content = await page.getTextContent();
      for (const item of content.items) {
        if ('str' in item) textCharacters += item.str.trim().length;
      }
      page.cleanup();
      options.onProgress?.({
        stage: 'analizando',
        page: pageNumber,
        total: document.numPages,
        percent: (pageNumber / document.numPages) * 0.25,
      });
    }

    const hasText = textCharacters >= 40;
    const { PDFDocument } = await import('pdf-lib');

    if (hasText) {
      try {
        const pdf = await PDFDocument.load(bytes, { updateMetadata: false });
        stripMetadata(pdf);
        const saved = await pdf.save({ useObjectStreams: true });
        const blob = new Blob([new Uint8Array(saved)], {
          type: 'application/pdf',
        });
        const firstPage = await document.getPage(1);
        const thumb = await renderThumb(firstPage);
        firstPage.cleanup();
        if (blob.size < file.size) {
          return {
            blob,
            thumb,
            pageCount: document.numPages,
            mode: 'lossless',
          };
        }
        return {
          blob: file,
          thumb,
          pageCount: document.numPages,
          mode: 'original',
        };
      } catch (error) {
        if ((error as { name?: string }).name === 'AbortError') throw error;
        // Si pdf-lib no puede reescribir el documento, probamos la
        // rasterización antes de descartar el adjunto.
      }
    }

    const output = await PDFDocument.create();
    stripMetadata(output);
    let thumb: Blob | null = null;

    for (let pageNumber = 1; pageNumber <= document.numPages; pageNumber += 1) {
      throwIfAborted(options.signal);
      const page = await document.getPage(pageNumber);
      const base = page.getViewport({ scale: 1 });
      const scale = Math.min(
        PDF_RASTER_DPI / 72,
        2200 / Math.max(base.width, base.height),
      );
      const viewport = page.getViewport({ scale });
      const canvas = createCanvas(viewport.width, viewport.height);
      const context = canvas.getContext('2d');
      if (!context) throw new Error('El navegador no permite procesar el PDF.');
      context.fillStyle = '#ffffff';
      context.fillRect(0, 0, canvas.width, canvas.height);
      await page.render({ canvasContext: context, viewport }).promise;

      if (pageNumber === 1) {
        thumb = await renderThumb(page);
      }

      const jpeg = await canvasToBlob(canvas, 'image/jpeg', PDF_JPEG_QUALITY);
      const image = await output.embedJpg(
        new Uint8Array(await jpeg.arrayBuffer()),
      );
      const outputPage = output.addPage([base.width, base.height]);
      outputPage.drawImage(image, {
        x: 0,
        y: 0,
        width: base.width,
        height: base.height,
      });
      canvas.width = 0;
      canvas.height = 0;
      page.cleanup();

      options.onProgress?.({
        stage: 'comprimiendo',
        page: pageNumber,
        total: document.numPages,
        percent: 0.25 + (pageNumber / document.numPages) * 0.75,
      });
    }

    const saved = await output.save({ useObjectStreams: true });
    const blob = new Blob([new Uint8Array(saved)], { type: 'application/pdf' });
    if (blob.size < file.size) {
      return {
        blob,
        thumb,
        pageCount: document.numPages,
        mode: 'rasterized',
      };
    }
    return {
      blob: file,
      thumb,
      pageCount: document.numPages,
      mode: 'original',
    };
  } finally {
    await document.destroy();
  }
}
