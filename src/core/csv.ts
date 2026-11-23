/** RFC 4180 uyumlu, bağımlılıksız CSV ayrıştırıcı. */
export function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let i = 0;
  const n = text.length;

  while (i < n) {
    let field: string;
    if (text.charCodeAt(i) === 34 /* " */) {
      let end = i + 1;
      let buf = '';
      for (;;) {
        const q = text.indexOf('"', end);
        if (q === -1) {
          buf += text.slice(end);
          end = n;
          break;
        }
        buf += text.slice(end, q);
        if (text.charCodeAt(q + 1) === 34) {
          buf += '"';
          end = q + 2;
        } else {
          end = q + 1;
          break;
        }
      }
      field = buf;
      i = end;
    } else {
      let end = i;
      while (end < n) {
        const c = text.charCodeAt(end);
        if (c === 44 || c === 10 || c === 13) break;
        end++;
      }
      field = text.slice(i, end);
      i = end;
    }
    row.push(field);

    const c = text.charCodeAt(i);
    if (c === 44) {
      i++;
      if (i === n) row.push('');
    } else if (c === 13 || c === 10 || i >= n) {
      if (c === 13 && text.charCodeAt(i + 1) === 10) i += 2;
      else if (i < n) i++;
      if (!(row.length === 1 && row[0] === '')) rows.push(row);
      row = [];
    }
  }
  if (row.length > 0 && !(row.length === 1 && row[0] === '')) rows.push(row);
  return rows;
}

/** Başlık satırına göre sütun indeksi haritası çıkarır. */
export function headerIndex(header: string[]): Map<string, number> {
  const m = new Map<string, number>();
  header.forEach((h, i) => m.set(h.trim().toUpperCase(), i));
  return m;
}
