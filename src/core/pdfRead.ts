// Extracts the text and positions of every page of a PDF with pdf.js. The pdf.js module is
// passed in, so the app can load it only when a PDF is chosen and the tests can use the Node build.

import type { PdfPage } from './pdfStatement';

// Minimal shape of the parts of pdf.js used here
interface TextItemLike {
  str?: string;
  transform?: number[];
  width?: number;
  height?: number;
}
interface PdfJsLike {
  getDocument(src: Record<string, unknown>): { promise: Promise<DocLike>; destroy?: () => Promise<void> | void };
}
interface DocLike {
  numPages: number;
  getPage(n: number): Promise<{ getTextContent(): Promise<{ items: TextItemLike[] }>; cleanup?: () => void }>;
  destroy?: () => Promise<void> | void;
  cleanup?: () => Promise<void> | void;
}

export class PdfReadError extends Error {}

export async function readPdfPages(pdfjs: PdfJsLike, bytes: Uint8Array, maxPages = 40): Promise<PdfPage[]> {
  const task = pdfjs.getDocument({
    data: bytes,
    isEvalSupported: false, // the app's security policy forbids generated code
    disableFontFace: true,
    useSystemFonts: false,
    stopAtErrors: false,
    enableXfa: false,
  });
  let doc: DocLike;
  try {
    doc = await task.promise;
  } catch (e) {
    const name = (e as { name?: string }).name ?? '';
    if (name === 'PasswordException') throw new PdfReadError('This PDF is protected by a password. Open it, save a copy without the password, then choose that copy.');
    if (name === 'InvalidPDFException') throw new PdfReadError('This file is not a valid PDF.');
    throw new PdfReadError('The PDF could not be read: ' + ((e as Error).message || name));
  }
  try {
    if (doc.numPages > maxPages) throw new PdfReadError(`This PDF has ${doc.numPages} pages, more than a monthly statement usually has.`);
    const pages: PdfPage[] = [];
    for (let n = 1; n <= doc.numPages; n++) {
      const page = await doc.getPage(n);
      const content = await page.getTextContent();
      pages.push({
        items: content.items
          .filter((i) => typeof i.str === 'string' && Array.isArray(i.transform))
          .map((i) => {
            const t = i.transform!;
            const size = Math.hypot(t[2], t[3]) || i.height || 10;
            return { str: i.str!, x: t[4], y: t[5], w: i.width ?? 0, h: size };
          }),
      });
      page.cleanup?.();
    }
    return pages;
  } finally {
    // Free the reader (the method name changed across pdf.js versions)
    try {
      if (typeof task.destroy === 'function') await task.destroy();
      else if (typeof doc.destroy === 'function') await doc.destroy();
    } catch {
      /* already closed */
    }
  }
}
