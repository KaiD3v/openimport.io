import { Readable, Transform } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { parse } from 'csv-parse';
import {
  CsvParseError,
  type CsvParseHandlers,
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

/**
 * Ceiling for {@link RecordBoundaryTransform}'s temporary raw-byte buffer.
 *
 * This is deliberately separate from {@link recordSizeLimit}: that function
 * bounds csv-parse's own `max_record_size`, which counts *interpreted*
 * (already-unescaped) field bytes. RecordBoundaryTransform instead buffers
 * the *raw* CSV representation, before csv-parse has had a chance to collapse
 * `""` escapes back into a single quote. A field entirely made of quote
 * characters doubles in size on the wire (`x` content bytes -> `2x` raw
 * bytes) and is wrapped in one more pair of quotes, so the raw ceiling must
 * scale accordingly. Sizing this too tight makes acceptance depend on where
 * the stream happens to be chunked instead of on the CSV's actual validity.
 */
function rawRecordBufferLimit(limits: CsvParseLimits): number {
  const maxRawFieldBytes = limits.maxFieldBytes * 2 + 2; // doubled quotes + wrapping pair
  const delimiterBytes = Math.max(limits.maxColumns - 1, 0);
  const terminatorBytes = 2; // CRLF
  return maxRawFieldBytes * limits.maxColumns + delimiterBytes + terminatorBytes;
}

function abortStream(stream: Readable | undefined): void {
  if (!stream || stream.destroyed) {
    return;
  }
  try {
    stream.destroy();
  } catch {
    // Destroy must stay idempotent even if a source throws.
  }
}

function isIgnorableCancelError(error: unknown): boolean {
  if (!error || typeof error !== 'object') {
    return false;
  }
  const code =
    'code' in error && typeof (error as { code: unknown }).code === 'string'
      ? (error as { code: string }).code
      : undefined;
  if (code === 'ERR_STREAM_PREMATURE_CLOSE' || code === 'ABORT_ERR') {
    return true;
  }
  return error instanceof Error && /premature close/i.test(error.message);
}

function flattenErrors(error: unknown): unknown[] {
  if (error instanceof AggregateError) {
    return [error, ...error.errors.flatMap((item) => flattenErrors(item))];
  }
  if (
    typeof error === 'object' &&
    error !== null &&
    'errors' in error &&
    Array.isArray((error as { errors: unknown }).errors)
  ) {
    return [
      error,
      ...(error as { errors: unknown[] }).errors.flatMap((item) =>
        flattenErrors(item),
      ),
    ];
  }
  if (error instanceof Error && error.cause !== undefined) {
    return [error, ...flattenErrors(error.cause)];
  }
  return [error];
}

function primaryParseFailure(error: unknown): unknown {
  const collected = flattenErrors(error);
  const csv = collected.find((item) => item instanceof CsvParseError);
  if (csv) {
    return csv;
  }
  const primary = collected.find(
    (item) =>
      item instanceof Error &&
      !(item instanceof AggregateError) &&
      !isIgnorableCancelError(item),
  );
  return primary ?? error;
}

/**
 * Quote-aware record coalescer placed before csv-parse.
 *
 * Holds an unquoted trailing CR until the next byte is known so CRLF split
 * across chunks stays one terminator. After each complete record, appends LF
 * pads so csv-parse can emit without waiting for source EOF / trim look-ahead
 * (needMoreDataSize includes multi-byte UTF-8 trim chars, typically 3 bytes).
 * The pad never reaches hashing (hasher sits upstream of parse).
 *
 * Incremental by construction: every new chunk is scanned exactly once, and
 * bytes already classified are never revisited. Only a single-byte boundary
 * decision can be deferred across a chunk boundary -- a trailing CR waiting
 * to see whether the next byte is LF, or a trailing quote (while inside a
 * quoted field) waiting to see whether the next byte is another quote (an
 * escaped `""`) or something else (the closing quote). Bytes accepted into
 * the current record are kept as slices in `segments` and concatenated only
 * once, at emission time, so total copying stays linear in record size
 * regardless of how many chunks it arrived in.
 */
const RECORD_EMIT_LOOKAHEAD_PAD = Buffer.alloc(4, 0x0a);

type PendingBoundary = 'none' | 'cr' | 'quote';

class RecordBoundaryTransform extends Transform {
  private segments: Buffer[] = [];
  private segmentsSize = 0;
  private quoting = false;
  private pendingBoundary: PendingBoundary = 'none';
  private readonly maxRawRecordBytes: number;

  constructor(maxRawRecordBytes: number) {
    super();
    this.maxRawRecordBytes = maxRawRecordBytes;
  }

  override _transform(
    chunk: Buffer,
    _encoding: BufferEncoding,
    callback: (error?: Error | null) => void,
  ): void {
    try {
      this.consume(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
      callback();
    } catch (error) {
      callback(error instanceof Error ? error : new Error(String(error)));
    }
  }

  override _flush(callback: (error?: Error | null) => void): void {
    try {
      if (this.segmentsSize > 0) {
        this.push(Buffer.concat(this.segments, this.segmentsSize));
        this.resetPending();
      }
      callback();
    } catch (error) {
      callback(error instanceof Error ? error : new Error(String(error)));
    }
  }

  private resetPending(): void {
    this.segments = [];
    this.segmentsSize = 0;
  }

  /** Accepts a slice of already-classified bytes into the pending record. */
  private append(part: Buffer): void {
    if (part.length === 0) {
      return;
    }
    this.segments.push(part);
    this.segmentsSize += part.length;
    if (this.segmentsSize > this.maxRawRecordBytes) {
      throw new CsvParseError('CSV record exceeds the maximum record size.');
    }
  }

  /** Appends an optional final slice (e.g. the terminator) and emits. */
  private emitCompleteRecord(finalPart?: Buffer): void {
    if (finalPart && finalPart.length > 0) {
      this.segments.push(finalPart);
      this.segmentsSize += finalPart.length;
    }
    const record = Buffer.concat(this.segments, this.segmentsSize);
    this.resetPending();
    this.push(Buffer.concat([record, RECORD_EMIT_LOOKAHEAD_PAD]));
  }

  private consume(chunk: Buffer): void {
    let index = 0;

    if (this.pendingBoundary === 'quote') {
      this.pendingBoundary = 'none';
      if (chunk.length > 0 && chunk[0] === 0x22) {
        // The withheld quote plus this one form an escaped `""`; both are
        // already counted (the first via the prior call's append/hold).
        this.append(chunk.subarray(0, 1));
        index = 1;
      } else {
        // The withheld quote was the real closer; re-evaluate this byte
        // below with quoting now false.
        this.quoting = false;
      }
    } else if (this.pendingBoundary === 'cr') {
      this.pendingBoundary = 'none';
      if (chunk.length > 0 && chunk[0] === 0x0a) {
        this.emitCompleteRecord(chunk.subarray(0, 1));
        index = 1;
      } else {
        // The withheld CR was already a complete terminator by itself.
        this.emitCompleteRecord();
      }
    }

    let start = index;
    while (index < chunk.length) {
      const byte = chunk[index]!;

      if (byte === 0x22) {
        if (this.quoting) {
          if (index + 1 < chunk.length) {
            if (chunk[index + 1] === 0x22) {
              index += 2;
              continue;
            }
            this.quoting = false;
            index += 1;
            continue;
          }
          this.append(chunk.subarray(start, index + 1));
          this.pendingBoundary = 'quote';
          return;
        }
        this.quoting = true;
        index += 1;
        continue;
      }

      if (!this.quoting && byte === 0x0d) {
        if (index + 1 < chunk.length) {
          if (chunk[index + 1] === 0x0a) {
            this.append(chunk.subarray(start, index));
            this.emitCompleteRecord(chunk.subarray(index, index + 2));
            start = index + 2;
            index += 2;
            continue;
          }
          this.append(chunk.subarray(start, index + 1));
          this.emitCompleteRecord();
          start = index + 1;
          index += 1;
          continue;
        }
        this.append(chunk.subarray(start, index + 1));
        this.pendingBoundary = 'cr';
        return;
      }

      if (!this.quoting && byte === 0x0a) {
        this.append(chunk.subarray(start, index));
        this.emitCompleteRecord(chunk.subarray(index, index + 1));
        start = index + 1;
        index += 1;
        continue;
      }

      index += 1;
    }

    if (start < chunk.length) {
      this.append(chunk.subarray(start));
    }
  }
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
    [Symbol.asyncIterator]: () => {
      let pending = first && first.length > 0 ? first : undefined;
      return {
        async next() {
          if (pending) {
            const value = pending;
            pending = undefined;
            return { done: false as const, value };
          }
          return iterator.next();
        },
        async return() {
          abortStream(input);
          return { done: true as const, value: undefined };
        },
        async throw(error: unknown) {
          abortStream(input);
          throw error;
        },
      };
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
  handlers: CsvParseHandlers = {},
): Promise<CsvParseResult> {
  let headerText: string;
  let prefix: Buffer;
  let rest: AsyncIterable<Buffer>;
  let encoding: 'utf-8';
  try {
    ({ headerText, prefix, rest, encoding } = await splitHeader(input));
  } catch (error) {
    abortStream(input);
    throw error;
  }
  if (headerText.trim().length === 0) {
    abortStream(input);
    throw new CsvParseError('CSV header is empty.');
  }

  let delimiter: ',' | ';';
  try {
    delimiter = detectDelimiter(headerText);
  } catch (error) {
    abortStream(input);
    throw error;
  }
  const parser = parse({
    bom: false,
    columns: false,
    delimiter,
    record_delimiter: ['\n', '\r\n', '\r'],
    relax_column_count: false,
    skip_empty_lines: true,
    trim: false,
    relax_quotes: false,
    max_record_size: recordSizeLimit(limits),
  });
  const inspection = new InspectionTransform();
  const boundaries = new RecordBoundaryTransform(rawRecordBufferLimit(limits));
  const abortUpstream = (): void => {
    abortStream(input);
  };
  parser.once('error', abortUpstream);
  inspection.once('error', abortUpstream);
  boundaries.once('error', abortUpstream);

  let columns: string[] | undefined;
  let dataRowCount = 0;

  const feed = Readable.from(
    (async function* () {
      try {
        yield prefix;
        for await (const chunk of rest) {
          yield Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
        }
      } catch (error) {
        abortUpstream();
        throw error;
      }
    })(),
  );
  feed.once('error', abortUpstream);

  try {
    await pipeline(
      feed,
      inspection,
      boundaries,
      parser,
      async function consume(source) {
        try {
          for await (const record of source) {
            const row = record as string[];
            if (!columns) {
              columns = row;
              validateHeader(columns, limits);
              await handlers.onHeader?.(columns);
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
            await handlers.onRecord?.(row, dataRowCount);
          }
        } catch (error) {
          abortUpstream();
          throw error;
        }
      },
    );
  } catch (error) {
    abortUpstream();
    const primary = primaryParseFailure(error);
    if (primary instanceof CsvParseError) {
      throw primary;
    }
    const message = primary instanceof Error ? primary.message : '';
    if (message.includes('Max record size')) {
      throw new CsvParseError('CSV record exceeds the maximum record size.');
    }
    const libraryCode =
      typeof primary === 'object' &&
      primary !== null &&
      'code' in primary &&
      typeof (primary as { code: unknown }).code === 'string'
        ? (primary as { code: string }).code
        : undefined;
    if (
      libraryCode === 'CSV_RECORD_INCONSISTENT_COLUMNS' ||
      libraryCode === 'CSV_RECORD_INCONSISTENT_FIELDS_LENGTH' ||
      message.includes('Invalid Record Length')
    ) {
      throw new CsvParseError(
        'CSV row has an inconsistent number of columns.',
      );
    }
    if (
      primary instanceof Error &&
      (primary.name === 'CsvError' ||
        libraryCode?.startsWith('CSV_') ||
        message.includes('Invalid Opening Quote') ||
        message.includes('Invalid Closing Quote') ||
        message.includes('Quote Not Closed'))
    ) {
      throw new CsvParseError('CSV is malformed.');
    }
    throw primary;
  }

  if (!columns) {
    abortStream(input);
    throw new CsvParseError('CSV header is empty.');
  }
  if (dataRowCount === 0) {
    abortStream(input);
    throw new CsvParseError('CSV must contain at least one data row.');
  }

  return {
    columns,
    dataRowCount,
    delimiter,
    encoding,
  };
}
