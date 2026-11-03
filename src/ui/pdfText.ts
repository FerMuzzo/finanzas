// Loads the PDF reader only when a PDF is chosen. It runs on the phone; the file never leaves it.
// The reader's worker is a file of the app itself, as the security policy allows no other source.

import workerUrl from 'pdfjs-dist/build/pdf.worker.min.mjs?url';
import { readPdfPages } from '../core/pdfRead';
import { parsePdfStatement, type ParsedPdf } from '../core/pdfStatement';
import { hash53 } from '../core/text';

let loaded: Promise<typeof import('pdfjs-dist')> | null = null;

function pdfjs(): Promise<typeof import('pdfjs-dist')> {
  if (!loaded) {
    loaded = import('pdfjs-dist').then((m) => {
      m.GlobalWorkerOptions.workerSrc = workerUrl;
      return m;
    });
  }
  return loaded;
}

export interface ReadPdf {
  fileName: string;
  fileHash: string;
  parsed: ParsedPdf;
}

export async function readStatementPdf(file: File): Promise<ReadPdf> {
  const bytes = new Uint8Array(await file.arrayBuffer());
  const lib = await pdfjs();
  const pages = await readPdfPages(lib as never, bytes);
  const parsed = parsePdfStatement(pages);
  // The hash of the text lets the app notice a statement imported before, without keeping the file
  const fileHash = hash53(pages.map((p) => p.items.map((i) => i.str).join(' ')).join('\n'), 7);
  return { fileName: file.name, fileHash, parsed };
}

export function isPdf(file: File): boolean {
  return file.type === 'application/pdf' || /\.pdf$/i.test(file.name);
}
