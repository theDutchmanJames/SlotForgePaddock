'use strict';
const MAX_FILE = 16 * 1024 * 1024,
  MAX_ROWS = 5001,
  MAX_COLS = 200,
  MAX_CELLS = 500000;
function csv(text, separator) {
  const rows = [],
    row = [];
  let value = '',
    quoted = false,
    closed = false;
  const cell = () => {
    if (value.length > 20000) throw Error('A cell exceeds 20,000 characters');
    row.push({ text: value });
    value = '';
    closed = false;
    if (row.length > MAX_COLS) throw Error('Use at most 200 columns');
  };
  const line = () => {
    cell();
    rows.push(row.splice(0));
    if (rows.length > MAX_ROWS) throw Error('Use at most 5,000 cars plus a header row');
  };
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (quoted) {
      if (c === '"') {
        if (text[i + 1] === '"') {
          value += '"';
          i++;
        } else {
          quoted = false;
          closed = true;
        }
      } else value += c;
      continue;
    }
    if (c === separator) {
      cell();
      continue;
    }
    if (c === '\r' || c === '\n') {
      if (c === '\r' && text[i + 1] === '\n') i++;
      line();
      continue;
    }
    if (c === '"' && !value && !closed) {
      quoted = true;
      continue;
    }
    if (closed) {
      if (c === ' ' || c === '\t') continue;
      throw Error('Unexpected text after a quoted CSV cell');
    }
    value += c;
  }
  if (quoted) throw Error('An opening CSV quote has no closing quote');
  if (value || row.length || closed) line();
  return rows;
}
function zipBudget(bytes) {
  let end = -1;
  for (let i = bytes.length - 22; i >= Math.max(0, bytes.length - 65557); i--)
    if (bytes.readUInt32LE(i) === 0x06054b50) {
      end = i;
      break;
    }
  if (end < 0) throw Error('Choose a valid .xlsx workbook');
  const count = bytes.readUInt16LE(end + 10);
  let offset = bytes.readUInt32LE(end + 16),
    expanded = 0;
  if (count > 10000) throw Error('Workbook contains too many archive entries');
  for (let i = 0; i < count; i++) {
    if (offset + 46 > bytes.length || bytes.readUInt32LE(offset) !== 0x02014b50)
      throw Error('Invalid workbook archive');
    if (bytes.readUInt16LE(offset + 8) & 1) throw Error('Save an unencrypted .xlsx workbook');
    const size = bytes.readUInt32LE(offset + 24),
      compressed = bytes.readUInt32LE(offset + 20),
      local = bytes.readUInt32LE(offset + 42),
      method = bytes.readUInt16LE(offset + 10);
    expanded += size;
    if (expanded > 64 * 1024 * 1024) throw Error('Workbook expands beyond 64 MiB; export the car sheet as CSV');
    if (local + 30 > bytes.length || bytes.readUInt32LE(local) !== 0x04034b50) throw Error('Invalid workbook entry');
    const begin = local + 30 + bytes.readUInt16LE(local + 26) + bytes.readUInt16LE(local + 28);
    if (begin + compressed > bytes.length) throw Error('Truncated workbook entry');
    // Do not trust ZIP size declarations: bound actual inflation before SheetJS.
    const packed = bytes.subarray(begin, begin + compressed),
      actual =
        method === 0
          ? packed
          : method === 8
            ? require('node:zlib').inflateRawSync(packed, { maxOutputLength: Math.max(1, size) })
            : null;
    if (!actual || actual.length !== size) throw Error('Invalid workbook entry size or compression');
    offset += 46 + bytes.readUInt16LE(offset + 28) + bytes.readUInt16LE(offset + 30) + bytes.readUInt16LE(offset + 32);
  }
}
function parse(bytes, extension, options = {}) {
  bytes = Buffer.from(bytes);
  if (bytes.length > MAX_FILE) throw Error('Choose a file of at most 16 MiB');
  if (extension === '.csv') {
    let text;
    try {
      const encoding =
        bytes[0] === 0xff && bytes[1] === 0xfe
          ? 'utf-16le'
          : bytes[0] === 0xfe && bytes[1] === 0xff
            ? 'utf-16be'
            : 'utf-8';
      text = new TextDecoder(encoding, { fatal: true }).decode(bytes);
    } catch {
      throw Error('Save the CSV as UTF-8 and try again');
    }
    let delimiter = options.delimiter;
    if (delimiter && ![';', ',', '\t'].includes(delimiter)) throw Error('Invalid CSV separator');
    if (!delimiter) {
      let best = -1;
      for (const candidate of [',', ';', '\t']) {
        try {
          const sample = csv(text, candidate).slice(0, 20),
            widths = sample.map(r => r.length),
            width = Math.max(...widths, 0),
            score = width > 1 ? widths.filter(w => w === width).length * 100 + width : 0;
          if (score > best) {
            best = score;
            delimiter = candidate;
          }
        } catch {}
      }
      if (!delimiter) throw Error('Could not read the CSV; check quoting and separators');
    }
    const rows = csv(text, delimiter);
    if (rows.reduce((n, r) => n + r.length, 0) > MAX_CELLS) throw Error('The file has too many cells');
    return { delimiter, sheets: [{ name: 'CSV', rows }] };
  }
  if (extension !== '.xlsx') throw Error('Choose a .csv or .xlsx file');
  zipBudget(bytes);
  const X = require('xlsx'),
    book = X.read(bytes, {
      type: 'buffer',
      cellNF: true,
      cellText: true,
      cellDates: false,
      cellFormula: true,
      cellHTML: false,
      bookVBA: false,
      sheetRows: MAX_ROWS + 1
    }),
    sheets = [];
  let cells = 0;
  if (book.SheetNames.length > 50) throw Error('Use a workbook with at most 50 sheets');
  for (const name of book.SheetNames) {
    const sheet = book.Sheets[name],
      range = sheet['!ref'] ? X.utils.decode_range(sheet['!fullref'] || sheet['!ref']) : null,
      rows = [];
    if (range && (range.e.r >= MAX_ROWS || range.e.c >= MAX_COLS))
      throw Error('Sheet ' + name + ' exceeds 5,000 cars plus a header or 200 columns; export only the car table');
    if (range)
      for (let r = 0; r <= range.e.r; r++) {
        const row = [];
        for (let c = 0; c <= range.e.c; c++) {
          if (++cells > MAX_CELLS) throw Error('Workbook contains more than 500,000 cells');
          const cell = sheet[X.utils.encode_cell({ r, c })];
          let result = { text: '' };
          if (cell) {
            result = { text: String(cell.w ?? cell.v ?? '') };
            if (cell.t === 'e') result.issue = 'Excel error: ' + result.text;
            else if (cell.f && cell.v === undefined)
              result.issue = 'Formula has no saved result; recalculate and save in Excel first';
            else if (cell.t === 'n') {
              if (X.SSF.is_date(cell.z || '')) {
                const d = X.SSF.parse_date_code(cell.v, { date1904: !!book.Workbook?.WBProps?.date1904 });
                if (d)
                  result.date =
                    String(d.y).padStart(4, '0') +
                    '-' +
                    String(d.m).padStart(2, '0') +
                    '-' +
                    String(d.d).padStart(2, '0');
              } else result.number = cell.v;
            }
            if (result.text.length > 20000) result.issue = 'Cell exceeds 20,000 characters';
          }
          row.push(result);
        }
        rows.push(row);
      }
    sheets.push({ name, rows });
  }
  return { sheets };
}
module.exports = { parse, MAX_FILE };
