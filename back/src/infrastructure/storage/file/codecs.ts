/**
 * File formats for the file-backed store: how one collection becomes text
 * and back. Decoding must return exactly what was encoded.
 */
import type { Row } from '../../../application/ports/storage';
import { columnType, columnsOf, type CollectionName, type ColumnType } from '../schema';

export type FileFormat = 'json' | 'csv';

export interface Codec {
  readonly extension: string;
  encode(collection: CollectionName, rows: Row[]): string;
  decode(collection: CollectionName, text: string): Row[];
}

// ── JSON ────────────────────────────────────────────

const jsonCodec: Codec = {
  extension: 'json',
  encode: (_collection, rows) => `${JSON.stringify(rows, null, 2)}\n`,
  decode: (_collection, text) => JSON.parse(text) as Row[],
};

// ── CSV (RFC 4180) ──────────────────────────────────
//
// One header row with the collection's columns, then one row per record.
//   - empty cell            -> null        (an empty string is written as "")
//   - int / bool            -> 42, true
//   - timestamp / date      -> ISO text
//   - json (lists, objects) -> JSON text in a quoted cell
// Text starting with = + - @ or ' gets a leading apostrophe so spreadsheet
// apps do not run it as a formula; the apostrophe is removed when reading.

const NEEDS_QUOTES = /[",\r\n]|^\s|\s$/;
const FORMULA_START = /^[=+\-@'\t\r]/;

function quote(text: string): string {
  return `"${text.replace(/"/g, '""')}"`;
}

function encodeCell(value: unknown, type: ColumnType): string {
  if (value === null || value === undefined) return '';
  if (type === 'json') return quote(JSON.stringify(value));
  if (type === 'int' || type === 'bool') return String(value);
  let text = String(value);
  if (type === 'text' && FORMULA_START.test(text)) text = `'${text}`;
  return text === '' || NEEDS_QUOTES.test(text) ? quote(text) : text;
}

function decodeCell(cell: Cell, type: ColumnType): unknown {
  if (cell.text === '' && !cell.quoted) return null;
  switch (type) {
    case 'int': return Number(cell.text);
    case 'bool': return cell.text === 'true';
    case 'json': return JSON.parse(cell.text);
    case 'text': return cell.text.startsWith("'") ? cell.text.slice(1) : cell.text;
    default: return cell.text;
  }
}

interface Cell {
  text: string;
  /** Distinguishes "" (empty string) from an empty cell (null). */
  quoted: boolean;
}

/** Splits CSV text into rows of cells, honouring quotes, escaped quotes and embedded newlines. */
export function parseCsv(text: string): Cell[][] {
  const rows: Cell[][] = [];
  let row: Cell[] = [];
  let cell: Cell = { text: '', quoted: false };
  let inQuotes = false;

  const endCell = () => { row.push(cell); cell = { text: '', quoted: false }; };
  const endRow = () => { endCell(); rows.push(row); row = []; };

  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (inQuotes) {
      if (ch !== '"') cell.text += ch;
      else if (text[i + 1] === '"') { cell.text += '"'; i++; }
      else inQuotes = false;
    } else if (ch === '"') {
      inQuotes = true;
      cell.quoted = true;
    } else if (ch === ',') {
      endCell();
    } else if (ch === '\n') {
      endRow();
    } else if (ch !== '\r') {
      cell.text += ch;
    }
  }
  if (cell.text !== '' || cell.quoted || row.length > 0) endRow();
  return rows;
}

const csvCodec: Codec = {
  extension: 'csv',

  encode(collection, rows) {
    const columns = columnsOf(collection);
    const types = columns.map((column) => columnType(collection, column));
    const lines = [columns.join(',')];
    for (const row of rows) {
      lines.push(columns.map((column, i) => encodeCell(row[column], types[i])).join(','));
    }
    return `${lines.join('\n')}\n`;
  },

  decode(collection, text) {
    const [header, ...lines] = parseCsv(text);
    if (!header) return [];
    const known = new Set(columnsOf(collection));
    const columns = header.map((cell) => cell.text);
    const unknown = columns.filter((column) => !known.has(column));
    if (unknown.length > 0) {
      throw new Error(`${collection}.csv has unknown columns: ${unknown.join(', ')}`);
    }

    return lines.map((cells, index) => {
      if (cells.length !== columns.length) {
        throw new Error(`${collection}.csv row ${index + 2}: expected ${columns.length} cells, found ${cells.length}`);
      }
      const row: Row = {};
      columns.forEach((column, i) => {
        row[column] = decodeCell(cells[i], columnType(collection, column));
      });
      return row;
    });
  },
};

export const CODECS: Record<FileFormat, Codec> = { json: jsonCodec, csv: csvCodec };
