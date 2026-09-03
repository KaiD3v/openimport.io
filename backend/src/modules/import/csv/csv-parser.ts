export class CsvParseError extends Error {
  readonly code = 'IMPORT.INVALID_CSV';

  constructor(message: string) {
    super(message);
    this.name = 'CsvParseError';
  }
}

export type CsvParseLimits = {
  maxDataRows: number;
  maxColumns: number;
  maxFieldBytes: number;
};

export type CsvParseResult = {
  columns: string[];
  dataRowCount: number;
  delimiter: ',' | ';';
  encoding: 'utf-8';
};

export type CsvParseHandlers = {
  onHeader?: (columns: string[]) => void | Promise<void>;
  onRecord?: (row: string[], recordNumber: number) => void | Promise<void>;
};

export { parseCsvStream } from './parse-csv-stream.js';
export { detectDelimiter } from './detect-delimiter.js';
