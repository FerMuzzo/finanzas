// A tiny PDF writer for tests: each text is its own positioned run in a standard font that is not
// embedded, as many statement generators do. Invented content only.

export interface Run {
  x: number;
  y: number; // from the bottom of the page
  text: string;
  size?: number;
  right?: boolean; // x is the right edge (amount columns)
}

function esc(s: string): string {
  return s.replace(/\\/g, '\\\\').replace(/\(/g, '\\(').replace(/\)/g, '\\)');
}

function latin1(s: string): number[] {
  return Array.from(s, (c) => {
    const code = c.charCodeAt(0);
    return code < 256 ? code : 63;
  });
}

export function buildPdf(pages: Run[][]): Uint8Array {
  const objs: string[] = [];
  const pageIds: number[] = [];
  // 1 catalog, 2 pages, 3 font, then a page and its content for each page
  pages.forEach((runs, i) => {
    const pageId = 4 + i * 2;
    pageIds.push(pageId);
    const content = runs
      .map((r) => {
        const size = r.size ?? 9;
        const x = r.right ? r.x - r.text.length * size * 0.52 : r.x;
        return `BT /F1 ${size} Tf ${x.toFixed(2)} ${r.y.toFixed(2)} Td (${esc(r.text)}) Tj ET`;
      })
      .join('\n');
    objs[pageId] = `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] /Resources << /Font << /F1 3 0 R >> >> /Contents ${pageId + 1} 0 R >>`;
    objs[pageId + 1] = `<< /Length ${latin1(content).length} >>\nstream\n${content}\nendstream`;
  });
  objs[1] = '<< /Type /Catalog /Pages 2 0 R >>';
  objs[2] = `<< /Type /Pages /Kids [${pageIds.map((id) => `${id} 0 R`).join(' ')}] /Count ${pages.length} >>`;
  objs[3] = '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>';

  let out = '%PDF-1.4\n';
  const offsets: number[] = [];
  for (let id = 1; id < objs.length; id++) {
    offsets[id] = latin1(out).length;
    out += `${id} 0 obj\n${objs[id]}\nendobj\n`;
  }
  const xref = latin1(out).length;
  out += `xref\n0 ${objs.length}\n0000000000 65535 f \n`;
  for (let id = 1; id < objs.length; id++) out += `${String(offsets[id]).padStart(10, '0')} 00000 n \n`;
  out += `trailer\n<< /Size ${objs.length} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
  return new Uint8Array(latin1(out));
}
