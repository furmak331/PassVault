export class CsvError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'CsvError';
  }
}

/**
 * Parse CSV as written by browsers and password managers (RFC 4180): quoted
 * fields, doubled quotes inside them, line breaks inside quoted fields, CRLF or
 * LF line endings, and an optional UTF-8 byte order mark. Blank lines are
 * dropped.
 */
export function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = '';
  let quoted = false;
  let fieldStarted = false;
  const endField = () => {
    row.push(field);
    field = '';
    fieldStarted = false;
  };
  const endRow = () => {
    endField();
    if (!(row.length === 1 && row[0] === '')) rows.push(row);
    row = [];
  };

  for (let i = text.charCodeAt(0) === 0xfeff ? 1 : 0; i < text.length; i++) {
    const c = text[i];
    if (quoted) {
      if (c === '"') {
        if (text[i + 1] === '"') {
          field += '"';
          i++;
        } else {
          quoted = false;
        }
      } else {
        field += c;
      }
    } else if (c === '"' && !fieldStarted) {
      quoted = true;
      fieldStarted = true;
    } else if (c === ',') {
      endField();
    } else if (c === '\n' || c === '\r') {
      if (c === '\r' && text[i + 1] === '\n') i++;
      endRow();
    } else {
      field += c;
      fieldStarted = true;
    }
  }
  if (quoted) throw new CsvError('The file ends inside a quoted field, so it may be cut off.');
  if (fieldStarted || row.length > 0) endRow();
  return rows;
}
