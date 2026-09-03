import { Readable, Transform } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { parse } from 'csv-parse';
import {
  CsvParseError,
  type CsvParseLimits,
  type CsvParseResult,
} from './csv-parser.js';
import { detectDelimiter } from './detect-delimiter.js';

const UTF8_BOM = Buffer.from([0xef, 0xbb, 0xbf]);
const UTF16_LE_BOM = Buffer.from([0xff, 0xfe]);
const UTF16_BE_BOM = Buffer.from([0xfe, 0xff]);
export const HEADER_SCAN_LIMIT = 64 * 1024;

class InspectionTransform extends Transform {
  override _transform(
    chunk: Buffer,
    _encoding: BufferEncoding,
    callback: (error?: Error | null, data?: Buffer) => void,
  ): void {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    if (buffer.includes(0)) {
      callback(new CsvParseError('CSV contains null bytes.'));
      return;
    }
    callback(null, buffer);
  }
}

function isUnsupportedBom(sample: Buffer): boolean {
  return (
    sample.subarray(0, 2).equals(UTF16_LE_BOM) ||
    sample.subarray(0, 2).equals(UTF16_BE_BOM)
  );
}

function isMostlyBinary(sample: Buffer): boolean {
  if (sample.length === 0) {
    return false;
  }
  let suspicious = 0;
  const start = sample.subarray(0, 3).equals(UTF8_BOM) ? 3 : 0;
  for (let i = start; i < sample.length; i += 1) {
    const byte = sample[i]!;
    if (byte === 0) {
      return true;
    }
    if (byte < 0x09 || (byte > 0x0d && byte < 0x20) || byte === 0x7f) {
      suspicious += 1;
    }
  }
  return suspicious / Math.max(sample.length - start, 1) > 0.3;
}

function recordSizeLimit(limits: CsvParseLimits): number {
  return limits.maxFieldBytes * limits.maxColumns + 4 * limits.maxColumns + 16;
}

function decodeHeaderRecord(record: Buffer): string {
  try {
    return new TextDecoder('utf-8', { fatal: true }).decode(record);
  } catch {
    throw new CsvParseError(
      'Unsupported CSV encoding. Only UTF-8 is accepted.',
    );
  }
}

type ScannerFeedResult =
  | { status: 'found'; prefix: Buffer; rest: Buffer }
  | { status: 'need_more' };

/**
 * Incremental first-record scanner. Processes only new bytes; buffers header
 * bytes until the first unquoted LF/CRLF. Body bytes in the same chunk are not
 * counted toward HEADER_SCAN_LIMIT.
 */
class IncrementalFirstRecordScanner {
  private inQuotes = false;
  private carry = Buffer.alloc(0);
  private parts: Buffer[] = [];
  private size = 0;

  feed(chunk: Buffer): ScannerFeedResult {
    const data =
      this.carry.length > 0 ? Buffer.concat([this.carry, chunk]) : chunk;
    this.carry = Buffer.alloc(0);

    let index = 0;
    while (index < data.length) {
      const byte = data[index]!;

      if (byte === 0x22) {
        if (this.inQuotes) {
          if (index + 1 < data.length) {
            if (data[index + 1] === 0x22) {
              index += 2;
              continue;
            }
            this.inQuotes = false;
            index += 1;
            continue;
          }
          this.appendHeader(data.subarray(0, index));
          this.carry = Buffer.from(data.subarray(index));
          return { status: 'need_more' };
        }
        this.inQuotes = true;
        index += 1;
        continue;
      }

      if (!this.inQuotes && byte === 0x0d) {
        if (index + 1 < data.length) {
          if (data[index + 1] === 0x0a) {
            return this.finishRecord(data, index, 2);
          }
          index += 1;
          continue;
        }
        this.appendHeader(data.subarray(0, index));
        this.carry = Buffer.from(data.subarray(index));
        return { status: 'need_more' };
      }

      if (!this.inQuotes && byte === 0x0a) {
        return this.finishRecord(data, index, 1);
      }

      index += 1;
    }

    this.appendHeader(data);
    return { status: 'need_more' };
  }

  finish():
    | { status: 'eof'; prefix: Buffer }
    | { status: 'unclosed' } {
    if (this.carry.length === 1 && this.carry[0] === 0x22 && this.inQuotes) {
      this.appendHeader(this.carry);
      this.carry = Buffer.alloc(0);
      this.inQuotes = false;
    } else if (this.carry.length > 0) {
      this.appendHeader(this.carry);
      this.carry = Buffer.alloc(0);
    }

    if (this.inQuotes) {
      return { status: 'unclosed' };
    }
    if (this.size > HEADER_SCAN_LIMIT) {
      throw new CsvParseError('CSV header exceeds the maximum scan size.');
    }
    return {
      status: 'eof',
      prefix: Buffer.concat(this.parts, this.size),
    };
  }

  private finishRecord(
    data: Buffer,
    recordEnd: number,
    terminatorLength: number,
  ): { status: 'found'; prefix: Buffer; rest: Buffer } {
    const end = recordEnd + terminatorLength;
    this.appendHeader(data.subarray(0, end));
    if (this.size > HEADER_SCAN_LIMIT) {
      throw new CsvParseError('CSV header exceeds the maximum scan size.');
    }
    return {
      status: 'found',
      prefix: Buffer.concat(this.parts, this.size),
      rest: data.subarray(end),
    };
  }

  private appendHeader(part: Buffer): void {
    if (part.length === 0) {
      return;
    }
    if (this.size + part.length > HEADER_SCAN_LIMIT) {
      throw new CsvParseError('CSV header exceeds the maximum scan size.');
    }
    this.parts.push(Buffer.from(part));
    this.size += part.length;
  }
}

async function* validateUtf8Chunks(
  input: Readable,
): AsyncGenerator<Buffer, void, undefined> {
  const decoder = new TextDecoder('utf-8', { fatal: true });
  for await (const chunk of input) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk as string);
    try {
      decoder.decode(buffer, { stream: true });
    } catch {
      throw new CsvParseError('CSV contains invalid UTF-8.');
    }
    if (buffer.includes(0)) {
      throw new CsvParseError('CSV contains null bytes.');
    }
    yield buffer;
  }
  try {
    decoder.decode(new Uint8Array(), { stream: false });
  } catch {
    throw new CsvParseError('CSV contains invalid UTF-8.');
  }
}

function stripTerminator(prefix: Buffer): Buffer {
  if (
    prefix.length >= 2 &&
    prefix[prefix.length - 2] === 0x0d &&
    prefix[prefix.length - 1] === 0x0a
  ) {
    return prefix.subarray(0, prefix.length - 2);
  }
  if (prefix.length >= 1 && prefix[prefix.length - 1] === 0x0a) {
    return prefix.subarray(0, prefix.length - 1);
  }
  return prefix;
}

/**
 * Incremental UTF-8 / UTF-16 preamble gate. Buffers at most 2 pending bytes
 * until a BOM can be confirmed or ruled out. Empty chunks do not settle the
 * decision. Only a leading EF BB BF is stripped, once.
 */
class IncrementalUtf8Preamble {
  private pending = Buffer.alloc(0);
  private settled = false;
  private binaryChecked = false;

  consume(chunk: Buffer): Buffer {
    if (this.settled) {
      this.ensureBinarySample(chunk);
      return chunk;
    }
    if (chunk.length === 0) {
      return Buffer.alloc(0);
    }

    const data =
      this.pending.length > 0
        ? Buffer.concat([this.pending, chunk])
        : chunk;
    this.pending = Buffer.alloc(0);

    if (data[0] === 0xff || data[0] === 0xfe) {
      if (data.length < 2) {
        this.pending = Buffer.from(data);
        return Buffer.alloc(0);
      }
      if (isUnsupportedBom(data)) {
        throw new CsvParseError(
          'Unsupported CSV encoding. Only UTF-8 is accepted.',
        );
      }
      return this.release(data);
    }

    if (data[0] === 0xef) {
      if (data.length < 3) {
        if (data.length >= 2 && data[1] !== 0xbb) {
          return this.release(data);
        }
        this.pending = Buffer.from(data);
        return Buffer.alloc(0);
      }
      if (data.subarray(0, 3).equals(UTF8_BOM)) {
        return this.release(data.subarray(3));
      }
      return this.release(data);
    }

    return this.release(data);
  }

  finish(): Buffer {
    if (this.settled) {
      return Buffer.alloc(0);
    }
    if (this.pending.length === 0) {
      this.settled = true;
      return Buffer.alloc(0);
    }
    const leftover = this.pending;
    this.pending = Buffer.alloc(0);
    return this.release(leftover);
  }

  private release(data: Buffer): Buffer {
    this.settled = true;
    this.ensureBinarySample(data);
    return data;
  }

  private ensureBinarySample(data: Buffer): void {
    if (this.binaryChecked || data.length === 0) {
      return;
    }
    this.binaryChecked = true;
    if (isMostlyBinary(data.subarray(0, Math.min(data.length, 512)))) {
      throw new CsvParseError('CSV content appears to be binary.');
    }
  }
}

async function splitHeader(input: Readable): Promise<{
  headerText: string;
  prefix: Buffer;
  rest: AsyncIterable<Buffer>;
  encoding: 'utf-8';
}> {
  const iterator = validateUtf8Chunks(input)[Symbol.asyncIterator]();
  const scanner = new IncrementalFirstRecordScanner();
  const preamble = new IncrementalUtf8Preamble();

  const restAfter = (first?: Buffer): AsyncIterable<Buffer> => ({
    [Symbol.asyncIterator]: async function* () {
      if (first && first.length > 0) {
        yield first;
      }
      while (true) {
        const more = await iterator.next();
        if (more.done) {
          break;
        }
        yield more.value;
      }
    },
  });

  const feedScanner = (
    chunk: Buffer,
  ):
    | {
        headerText: string;
        prefix: Buffer;
        rest: AsyncIterable<Buffer>;
        encoding: 'utf-8';
      }
    | undefined => {
    if (chunk.length === 0) {
      return undefined;
    }
    const scanned = scanner.feed(chunk);
    if (scanned.status !== 'found') {
      return undefined;
    }
    return {
      headerText: decodeHeaderRecord(stripTerminator(scanned.prefix)),
      prefix: scanned.prefix,
      rest: restAfter(scanned.rest),
      encoding: 'utf-8',
    };
  };

  while (true) {
    const next = await iterator.next();
    if (next.done) {
      break;
    }

    const found = feedScanner(preamble.consume(next.value));
    if (found) {
      return found;
    }
  }

  const foundAfterPreamble = feedScanner(preamble.finish());
  if (foundAfterPreamble) {
    return foundAfterPreamble;
  }

  const finished = scanner.finish();
  if (finished.status === 'unclosed') {
    throw new CsvParseError('CSV header contains an unclosed quoted field.');
  }
  if (finished.prefix.length === 0) {
    throw new CsvParseError('CSV file is empty.');
  }

  return {
    headerText: decodeHeaderRecord(finished.prefix),
    prefix: finished.prefix,
    rest: restAfter(),
    encoding: 'utf-8',
  };
}

function validateHeader(columns: string[], limits: CsvParseLimits): void {
  if (columns.length === 0) {
    throw new CsvParseError('CSV header is empty.');
  }
  if (columns.length > limits.maxColumns) {
    throw new CsvParseError('CSV exceeds the maximum number of columns.');
  }

  const seen = new Set<string>();
  for (const column of columns) {
    if (column.trim().length === 0) {
      throw new CsvParseError('CSV header contains an empty column name.');
    }
    if (Buffer.byteLength(column, 'utf8') > limits.maxFieldBytes) {
      throw new CsvParseError('CSV header field exceeds the maximum field size.');
    }
    if (seen.has(column)) {
      throw new CsvParseError('CSV header contains duplicate column names.');
    }
    seen.add(column);
  }
}

export async function parseCsvStream(
  input: Readable,
  limits: CsvParseLimits,
): Promise<CsvParseResult> {
  const { headerText, prefix, rest, encoding } = await splitHeader(input);
  if (headerText.trim().length === 0) {
    throw new CsvParseError('CSV header is empty.');
  }

  const delimiter = detectDelimiter(headerText);
  const parser = parse({
    bom: false,
    columns: false,
    delimiter,
    relax_column_count: false,
    skip_empty_lines: true,
    trim: false,
    relax_quotes: false,
    max_record_size: recordSizeLimit(limits),
  });

  let columns: string[] | undefined;
  let dataRowCount = 0;

  try {
    await pipeline(
      Readable.from(
        (async function* () {
          yield prefix;
          for await (const chunk of rest) {
            yield Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
          }
        })(),
      ),
      new InspectionTransform(),
      parser,
      async function consume(source: AsyncIterable<unknown>) {
        for await (const record of source) {
          const row = record as string[];
          if (!columns) {
            columns = row;
            validateHeader(columns, limits);
            continue;
          }

          dataRowCount += 1;
          if (dataRowCount > limits.maxDataRows) {
            throw new CsvParseError(
              'CSV exceeds the maximum number of data rows.',
            );
          }
          if (row.length !== columns.length) {
            throw new CsvParseError(
              'CSV row has an inconsistent number of columns.',
            );
          }
          for (const field of row) {
            if (Buffer.byteLength(field, 'utf8') > limits.maxFieldBytes) {
              throw new CsvParseError(
                'CSV field exceeds the maximum field size.',
              );
            }
          }
        }
      },
    );
  } catch (error) {
    if (error instanceof CsvParseError) {
      throw error;
    }
    const message = error instanceof Error ? error.message : '';
    if (message.includes('Max record size')) {
      throw new CsvParseError('CSV record exceeds the maximum record size.');
    }
    const libraryCode =
      typeof error === 'object' &&
      error !== null &&
      'code' in error &&
      typeof (error as { code: unknown }).code === 'string'
        ? (error as { code: string }).code
        : undefined;
    if (
      error instanceof Error &&
      (error.name === 'CsvError' ||
        libraryCode?.startsWith('CSV_') ||
        message.includes('Invalid Opening Quote') ||
        message.includes('Invalid Closing Quote') ||
        message.includes('Quote Not Closed') ||
        message.includes('Invalid Record Length'))
    ) {
      throw new CsvParseError('CSV is malformed.');
    }
    throw error;
  }

  if (!columns) {
    throw new CsvParseError('CSV header is empty.');
  }
  if (dataRowCount === 0) {
    throw new CsvParseError('CSV must contain at least one data row.');
  }

  return {
    columns,
    dataRowCount,
    delimiter,
    encoding,
  };
}
