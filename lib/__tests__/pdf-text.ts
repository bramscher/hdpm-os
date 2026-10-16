import { inflateSync } from 'node:zlib';
/** PDF source with every Flate stream inflated, so tests can look for drawn text in compressed PDFs. */
export function pdfText(pdf: Buffer): string {
  const raw = pdf.toString('latin1');
  return raw.replace(/stream\r?\n([\s\S]*?)\r?\nendstream/g, (whole, body: string) => {
    try { return `stream\n${inflateSync(Buffer.from(body, 'latin1')).toString('latin1')}\nendstream`; } catch { return whole; }
  });
}
