import { Readable } from 'node:stream';
import { describe, expect, it, vi } from 'vitest';
import {
  CsvParseError,
  parseCsvStream,
  type CsvParseLimits,
} from './csv-parser.js';

const limits: CsvParseLimits = {
  maxDataRows: 100,
  maxColumns: 20,
  maxFieldBytes: 1024,
};

function streamOf(chunks: Array<string | Buffer>): Readable {
  return Readable.from(chunks);
}

describe('parseCsvStream', () => {
  it('parses a comma-delimited UTF-8 CSV', async () => {
    const result = await parseCsvStream(
      streamOf(['sku,name,price\n', 'A1,Widget,10\n']),
      limits,
    );

    expect(result.delimiter).toBe(',');
    expect(result.encoding).toBe('utf-8');
    expect(result.columns).toEqual(['sku', 'name', 'price']);
    expect(result.dataRowCount).toBe(1);
  });

  it('parses a semicolon-delimited CSV', async () => {
    const result = await parseCsvStream(
      streamOf(['sku;name;price\n', 'A1;Widget;10\n']),
      limits,
    );

    expect(result.delimiter).toBe(';');
    expect(result.columns).toEqual(['sku', 'name', 'price']);
  });

  it('accepts UTF-8 with BOM', async () => {
    const bom = Buffer.from([0xef, 0xbb, 0xbf]);
    const result = await parseCsvStream(
      streamOf([bom, Buffer.from('sku,name\nA1,Widget\n', 'utf8')]),
      limits,
    );

    expect(result.encoding).toBe('utf-8');
    expect(result.columns).toEqual(['sku', 'name']);
    expect(result.columns[0]).toBe('sku');
  });

  it('strips a fragmented UTF-8 BOM the same way as a whole BOM for plain and quoted headers', async () => {
    const bodies = [
      Buffer.from('sku,name\nA1,Widget\n', 'utf8'),
      Buffer.from('"sku",name\nA1,Widget\n', 'utf8'),
      Buffer.from('sku;name\nA1;Widget\n', 'utf8'),
      Buffer.from('"sku";"name"\nA1;Widget\n', 'utf8'),
    ];
    const bomPartitions = [
      [Buffer.from([0xef, 0xbb, 0xbf])],
      [Buffer.from([0xef]), Buffer.from([0xbb, 0xbf])],
      [Buffer.from([0xef, 0xbb]), Buffer.from([0xbf])],
      [Buffer.from([0xef]), Buffer.from([0xbb]), Buffer.from([0xbf])],
      [
        Buffer.alloc(0),
        Buffer.from([0xef]),
        Buffer.alloc(0),
        Buffer.from([0xbb]),
        Buffer.alloc(0),
        Buffer.from([0xbf]),
      ],
    ];

    for (const body of bodies) {
      const expected = await parseCsvStream(
        Readable.from([Buffer.concat([Buffer.from([0xef, 0xbb, 0xbf]), body])]),
        limits,
      );

      for (const bomChunks of bomPartitions) {
        const result = await parseCsvStream(
          Readable.from([...bomChunks, body]),
          limits,
        );
        expect(result.columns).toEqual(expected.columns);
        expect(result.columns[0]?.startsWith('\uFEFF')).toBe(false);
        expect(result.delimiter).toBe(expected.delimiter);
        expect(result.dataRowCount).toBe(expected.dataRowCount);
      }
    }
  });

  it('preserves CSV without a BOM when it starts with a multibyte character', async () => {
    const result = await parseCsvStream(
      streamOf([
        Buffer.from([0xc3, 0xa9]),
        Buffer.from('sku,name\n1,2\n', 'utf8'),
      ]),
      limits,
    );
    expect(result.columns).toEqual(['ésku', 'name']);
  });

  it('accepts a fragmented BOM before a multiline quoted header', async () => {
    const result = await parseCsvStream(
      Readable.from([
        Buffer.from([0xef]),
        Buffer.from([0xbb, 0xbf]),
        Buffer.from('"part-one\n', 'utf8'),
        Buffer.from('part-two",sku\n', 'utf8'),
        Buffer.from('1,2\n', 'utf8'),
      ]),
      limits,
    );
    expect(result.columns).toEqual(['part-one\npart-two', 'sku']);
  });

  it('preserves U+FEFF inside a field while still stripping a leading BOM', async () => {
    const bom = Buffer.from([0xef, 0xbb, 0xbf]);
    const body = Buffer.from('"sku","na\uFEFFme"\nA1,Widget\n', 'utf8');
    const whole = await parseCsvStream(Readable.from([Buffer.concat([bom, body])]), limits);
    const fragmented = await parseCsvStream(
      Readable.from([Buffer.from([0xef]), Buffer.from([0xbb]), Buffer.from([0xbf]), body]),
      limits,
    );

    expect(whole.columns).toEqual(['sku', 'na\uFEFFme']);
    expect(fragmented.columns).toEqual(['sku', 'na\uFEFFme']);
    expect(fragmented.columns[0]).toBe('sku');
  });

  it('excludes a fragmented BOM from the header scan limit', async () => {
    const limit = 64 * 1024;
    const header = Buffer.concat([Buffer.alloc(limit - 1, 0x61), Buffer.from('\n1\n', 'utf8')]);
    const result = await parseCsvStream(
      Readable.from([
        Buffer.from([0xef]),
        Buffer.from([0xbb]),
        Buffer.from([0xbf]),
        header,
      ]),
      {
        maxDataRows: 1,
        maxColumns: 1,
        maxFieldBytes: limit,
      },
    );
    expect(result.dataRowCount).toBe(1);
  });

  it('accepts CRLF line endings', async () => {
    const result = await parseCsvStream(
      streamOf(['sku,name\r\n', 'A1,Widget\r\n']),
      limits,
    );

    expect(result.dataRowCount).toBe(1);
    expect(result.columns).toEqual(['sku', 'name']);
  });

  it('preserves quoted fields and delimiters inside quotes', async () => {
    const result = await parseCsvStream(
      streamOf(['sku,name\n', '"A,1","Widget; Deluxe"\n']),
      limits,
    );

    expect(result.columns).toEqual(['sku', 'name']);
    expect(result.dataRowCount).toBe(1);
  });

  it('rejects an empty column name', async () => {
    await expect(
      parseCsvStream(streamOf(['sku,,price\n', '1,2,3\n']), limits),
    ).rejects.toBeInstanceOf(CsvParseError);
  });

  it('rejects duplicate column names', async () => {
    await expect(
      parseCsvStream(streamOf(['sku,sku\n', '1,2\n']), limits),
    ).rejects.toMatchObject({ code: 'IMPORT.INVALID_CSV' });
  });

  it('rejects an empty file', async () => {
    await expect(parseCsvStream(streamOf([]), limits)).rejects.toMatchObject({
      code: 'IMPORT.INVALID_CSV',
    });
  });

  it('rejects a header-only file with no data rows', async () => {
    await expect(
      parseCsvStream(streamOf(['sku,name\n']), limits),
    ).rejects.toMatchObject({ code: 'IMPORT.INVALID_CSV' });
  });

  it('rejects inconsistent column counts', async () => {
    await expect(
      parseCsvStream(streamOf(['sku,name\n', 'A1\n']), limits),
    ).rejects.toMatchObject({ code: 'IMPORT.INVALID_CSV' });
  });

  it('rejects malformed quoted CSV', async () => {
    await expect(
      parseCsvStream(streamOf(['sku,name\n', '"unclosed\n']), limits),
    ).rejects.toMatchObject({ code: 'IMPORT.INVALID_CSV' });
  });

  it('rejects null bytes', async () => {
    await expect(
      parseCsvStream(
        streamOf([Buffer.from('sku,name\nA1\0,Widget\n', 'utf8')]),
        limits,
      ),
    ).rejects.toMatchObject({ code: 'IMPORT.INVALID_CSV' });
  });

  it('rejects clearly binary content', async () => {
    const binary = Buffer.from([0x00, 0x01, 0x02, 0xff, 0xfe, 0x00, 0x10]);
    await expect(
      parseCsvStream(streamOf([binary]), limits),
    ).rejects.toMatchObject({ code: 'IMPORT.INVALID_CSV' });
  });

  it('rejects unsupported encodings such as UTF-16 LE BOM', async () => {
    const utf16 = Buffer.from([
      0xff, 0xfe, 0x73, 0x00, 0x6b, 0x00, 0x75, 0x00,
    ]);
    await expect(
      parseCsvStream(streamOf([utf16]), limits),
    ).rejects.toMatchObject({ code: 'IMPORT.INVALID_CSV' });
  });

  it('rejects when the row limit is exceeded', async () => {
    const rows = Array.from({ length: 3 }, (_, i) => `v${i}\n`).join('');
    await expect(
      parseCsvStream(streamOf([`sku\n${rows}`]), {
        ...limits,
        maxDataRows: 2,
      }),
    ).rejects.toMatchObject({ code: 'IMPORT.INVALID_CSV' });
  });

  it('rejects when the column limit is exceeded', async () => {
    await expect(
      parseCsvStream(streamOf(['a,b,c\n1,2,3\n']), {
        ...limits,
        maxColumns: 2,
      }),
    ).rejects.toMatchObject({ code: 'IMPORT.INVALID_CSV' });
  });

  it('rejects when a field exceeds the max field size', async () => {
    const huge = 'x'.repeat(20);
    await expect(
      parseCsvStream(streamOf([`sku\n${huge}\n`]), {
        ...limits,
        maxFieldBytes: 10,
      }),
    ).rejects.toMatchObject({ code: 'IMPORT.INVALID_CSV' });
  });

  it('rejects ambiguous delimiter detection', async () => {
    await expect(
      parseCsvStream(streamOf(['a,b;c\n1,2;3\n']), limits),
    ).rejects.toMatchObject({ code: 'IMPORT.INVALID_CSV' });
  });

  it('rejects invalid UTF-8 in the header', async () => {
    await expect(
      parseCsvStream(
        streamOf([Buffer.from([0x73, 0x6b, 0x75, 0xff, 0x0a, 0x31, 0x0a])]),
        limits,
      ),
    ).rejects.toMatchObject({ code: 'IMPORT.INVALID_CSV' });
  });

  it('rejects invalid UTF-8 in the body after a valid header', async () => {
    const header = Buffer.from('sku,name\n', 'utf8');
    const body = Buffer.from([0x41, 0x31, 0x2c, 0xff, 0x0a]);
    await expect(
      parseCsvStream(streamOf([header, body]), limits),
    ).rejects.toMatchObject({ code: 'IMPORT.INVALID_CSV' });
  });

  it('accepts a valid multibyte sequence split across chunks', async () => {
    const result = await parseCsvStream(
      streamOf([
        Buffer.from('sku,name\nA1,Jos', 'utf8'),
        Buffer.from([0xc3]),
        Buffer.from([0xa9, 0x0a]),
      ]),
      limits,
    );

    expect(result.dataRowCount).toBe(1);
    expect(result.columns).toEqual(['sku', 'name']);
  });

  it('rejects an invalid UTF-8 sequence split across chunks', async () => {
    await expect(
      parseCsvStream(
        streamOf([
          Buffer.from('sku,name\nA1,', 'utf8'),
          Buffer.from([0xc3]),
          Buffer.from([0xff, 0x0a]),
        ]),
        limits,
      ),
    ).rejects.toMatchObject({ code: 'IMPORT.INVALID_CSV' });
  });

  it('rejects an incomplete multibyte sequence at EOF', async () => {
    await expect(
      parseCsvStream(
        streamOf([
          Buffer.from('sku,name\nA1,', 'utf8'),
          Buffer.from([0xc3]),
        ]),
        limits,
      ),
    ).rejects.toMatchObject({ code: 'IMPORT.INVALID_CSV' });
  });

  it('accepts accents and other valid Unicode', async () => {
    const result = await parseCsvStream(
      streamOf(['sku,nome\n', 'A1,José\n']),
      limits,
    );

    expect(result.columns).toEqual(['sku', 'nome']);
    expect(result.dataRowCount).toBe(1);
  });

  it('accepts a row whose total size exceeds maxFieldBytes when every field is within the limit', async () => {
    const fieldA = 'a'.repeat(20);
    const fieldB = 'b'.repeat(20);
    const result = await parseCsvStream(
      streamOf([`sku,name\n${fieldA},${fieldB}\n`]),
      { ...limits, maxFieldBytes: 20 },
    );

    expect(result.dataRowCount).toBe(1);
  });

  it('rejects a single field above maxFieldBytes', async () => {
    await expect(
      parseCsvStream(streamOf([`sku\n${'x'.repeat(21)}\n`]), {
        ...limits,
        maxFieldBytes: 20,
      }),
    ).rejects.toMatchObject({ code: 'IMPORT.INVALID_CSV' });
  });

  it('parses a simple comma-delimited header', async () => {
    const result = await parseCsvStream(
      streamOf(['sku,name\n', 'A1,Widget\n']),
      limits,
    );
    expect(result.delimiter).toBe(',');
    expect(result.columns).toEqual(['sku', 'name']);
  });

  it('parses a simple semicolon-delimited header', async () => {
    const result = await parseCsvStream(
      streamOf(['sku;name\n', 'A1;Widget\n']),
      limits,
    );
    expect(result.delimiter).toBe(';');
    expect(result.columns).toEqual(['sku', 'name']);
  });

  it('parses a quoted multiline comma-delimited header', async () => {
    const result = await parseCsvStream(
      streamOf(['"first\nname",sku\n', 'value,A1\n']),
      limits,
    );
    expect(result.delimiter).toBe(',');
    expect(result.columns).toEqual(['first\nname', 'sku']);
  });

  it('parses a quoted multiline semicolon-delimited header', async () => {
    const result = await parseCsvStream(
      streamOf(['"first\nname";sku\n', 'value;A1\n']),
      limits,
    );
    expect(result.delimiter).toBe(';');
    expect(result.columns).toEqual(['first\nname', 'sku']);
  });

  it('preserves CRLF inside a quoted header field', async () => {
    const result = await parseCsvStream(
      streamOf(['"first\r\nname";sku\r\n', 'value;A1\r\n']),
      limits,
    );
    expect(result.delimiter).toBe(';');
    expect(result.columns[0]).toMatch(/first\r?\nname/);
    expect(result.columns[1]).toBe('sku');
  });

  it('finds the first logical record when the terminator and quotes are split across chunks', async () => {
    const result = await parseCsvStream(
      streamOf([
        Buffer.from('"first', 'utf8'),
        Buffer.from('\nname"', 'utf8'),
        Buffer.from(';sku\r', 'utf8'),
        Buffer.from('\nvalue;A1\n', 'utf8'),
      ]),
      limits,
    );
    expect(result.delimiter).toBe(';');
    expect(result.columns).toEqual(['first\nname', 'sku']);
  });

  it('treats escaped quotes as data inside the first record', async () => {
    const result = await parseCsvStream(
      streamOf(['"he said ""hi""";sku\n', 'value;A1\n']),
      limits,
    );
    expect(result.delimiter).toBe(';');
    expect(result.columns).toEqual(['he said "hi"', 'sku']);
  });

  it('rejects an unclosed quoted header', async () => {
    await expect(
      parseCsvStream(streamOf(['"first\nname;sku\nvalue;A1\n']), limits),
    ).rejects.toMatchObject({ code: 'IMPORT.INVALID_CSV' });
  });

  it('rejects a logical header above the scan limit', async () => {
    const hugeQuoted = `"${'x'.repeat(70_000)}\nname";sku\n1;2\n`;
    await expect(
      parseCsvStream(streamOf([hugeQuoted]), limits),
    ).rejects.toMatchObject({
      code: 'IMPORT.INVALID_CSV',
      message: expect.stringMatching(/scan size/i),
    });
  });

  it('accepts a multibyte UTF-8 character in the header split across chunks', async () => {
    const result = await parseCsvStream(
      streamOf([
        Buffer.from('"nom', 'utf8'),
        Buffer.from([0xc3]),
        Buffer.from([0xa9]),
        Buffer.from('";sku\n', 'utf8'),
        Buffer.from('value;A1\n', 'utf8'),
      ]),
      limits,
    );
    expect(result.delimiter).toBe(';');
    expect(result.columns).toEqual(['nomé', 'sku']);
  });

  it('rejects invalid UTF-8 delivered in a delayed chunk after the header', async () => {
    const input = Readable.from(
      (async function* () {
        yield Buffer.from('sku,name\n', 'utf8');
        await new Promise((resolve) => {
          setTimeout(resolve, 30);
        });
        yield Buffer.from([0x41, 0x31, 0x2c, 0xff, 0x0a]);
      })(),
    );

    await expect(parseCsvStream(input, limits)).rejects.toMatchObject({
      code: 'IMPORT.INVALID_CSV',
    });
  });

  it('rejects an incomplete UTF-8 sequence at EOF after delayed chunks', async () => {
    const input = Readable.from(
      (async function* () {
        yield Buffer.from('sku,name\nA1,', 'utf8');
        await new Promise((resolve) => {
          setTimeout(resolve, 10);
        });
        yield Buffer.from([0xc3]);
      })(),
    );

    await expect(parseCsvStream(input, limits)).rejects.toMatchObject({
      code: 'IMPORT.INVALID_CSV',
    });
  });

  it('rejects a null byte delivered after the header', async () => {
    const input = Readable.from(
      (async function* () {
        yield Buffer.from('sku,name\n', 'utf8');
        await new Promise((resolve) => {
          setTimeout(resolve, 10);
        });
        yield Buffer.from('A1\0,Widget\n', 'utf8');
      })(),
    );

    await expect(parseCsvStream(input, limits)).rejects.toMatchObject({
      code: 'IMPORT.INVALID_CSV',
    });
  });

  it('propagates a late source read error after the header without wrapping it as malformed CSV', async () => {
    const input = new Readable({
      read() {
        // pushed below
      },
    });
    queueMicrotask(() => {
      input.push(Buffer.from('sku,name\n', 'utf8'));
      queueMicrotask(() => {
        input.destroy(new Error('storage read failed'));
      });
    });

    await expect(parseCsvStream(input, limits)).rejects.toThrow(
      'storage read failed',
    );
  });

  it('accepts the same large CSV for single, tiny, and irregular chunk partitions', async () => {
    const data = Buffer.from(
      `sku,name\n${(`A1,${'x'.repeat(100)}\n`).repeat(700)}`,
      'utf8',
    );
    expect(data.length).toBe(72_809);
    const largeLimits: CsvParseLimits = {
      maxDataRows: 700,
      maxColumns: 20,
      maxFieldBytes: 100,
    };

    const partitions = [
      [data],
      Array.from(data, (byte) => Buffer.from([byte])),
      [
        data.subarray(0, 3),
        data.subarray(3, 40),
        data.subarray(40, 41),
        data.subarray(41),
      ],
    ];

    for (const chunks of partitions) {
      const result = await parseCsvStream(Readable.from(chunks), largeLimits);
      expect(result.dataRowCount).toBe(700);
      expect(result.columns).toEqual(['sku', 'name']);
    }
  });

  it('accepts a short header when a large body arrives in the same chunk', async () => {
    const body = `A1,${'y'.repeat(50)}\n`.repeat(2_000);
    const combined = Buffer.from(`sku,name\n${body}`, 'utf8');
    expect(combined.length).toBeGreaterThan(64 * 1024);

    const result = await parseCsvStream(Readable.from([combined]), {
      maxDataRows: 2_000,
      maxColumns: 20,
      maxFieldBytes: 64,
    });
    expect(result.dataRowCount).toBe(2_000);
  });

  it('accepts a multiline header split across chunks under the scan limit', async () => {
    const result = await parseCsvStream(
      streamOf([
        Buffer.from('"part-one\n', 'utf8'),
        Buffer.from('part-two";sku\n', 'utf8'),
        Buffer.from('1;2\n', 'utf8'),
      ]),
      limits,
    );
    expect(result.columns).toEqual(['part-one\npart-two', 'sku']);
  });

  it('enforces the header scan limit around the boundary excluding BOM', async () => {
    const limit = 64 * 1024;
    const bom = Buffer.from([0xef, 0xbb, 0xbf]);
    const exactly = Buffer.concat([
      bom,
      Buffer.alloc(limit - 1, 0x61),
      Buffer.from('\n1\n', 'utf8'),
    ]);
    const exactResult = await parseCsvStream(Readable.from([exactly]), {
      maxDataRows: 1,
      maxColumns: 1,
      maxFieldBytes: limit,
    });
    expect(exactResult.dataRowCount).toBe(1);

    const below = Buffer.concat([
      bom,
      Buffer.alloc(limit - 2, 0x61),
      Buffer.from('\n1\n', 'utf8'),
    ]);
    await expect(
      parseCsvStream(Readable.from([below]), {
        maxDataRows: 1,
        maxColumns: 1,
        maxFieldBytes: limit,
      }),
    ).resolves.toMatchObject({ dataRowCount: 1 });

    const above = Buffer.concat([
      bom,
      Buffer.alloc(limit, 0x61),
      Buffer.from('\n1\n', 'utf8'),
    ]);
    await expect(
      parseCsvStream(Readable.from([above]), {
        maxDataRows: 1,
        maxColumns: 1,
        maxFieldBytes: limit + 10,
      }),
    ).rejects.toMatchObject({
      code: 'IMPORT.INVALID_CSV',
      message: expect.stringMatching(/scan size/i),
    });
  });

  it('awaits record callbacks sequentially and does not accumulate every row', async () => {
    const events: string[] = [];
    let maxHeld = 0;
    const held: string[][] = [];

    await parseCsvStream(streamOf(['sku,name\n', 'A1,a\n', 'A2,b\n', 'A3,c\n']), limits, {
      onHeader: async (columns) => {
        events.push(`header:${columns.join('|')}`);
      },
      onRecord: async (row, recordNumber) => {
        events.push(`start:${recordNumber}`);
        held.push(row);
        maxHeld = Math.max(maxHeld, held.length);
        await new Promise((resolve) => {
          setTimeout(resolve, 15);
        });
        events.push(`end:${recordNumber}`);
        held.pop();
      },
    });

    expect(events).toEqual([
      'header:sku|name',
      'start:1',
      'end:1',
      'start:2',
      'end:2',
      'start:3',
      'end:3',
    ]);
    expect(maxHeld).toBe(1);
  });

  it('propagates a consumer failure from onRecord', async () => {
    await expect(
      parseCsvStream(streamOf(['sku,name\n', 'A1,a\n', 'A2,b\n']), limits, {
        onRecord: async () => {
          throw new Error('consumer failed');
        },
      }),
    ).rejects.toThrow('consumer failed');
  });

  function openEndedStream(payload: string | Buffer): Readable {
    let pushed = false;
    const data = Buffer.isBuffer(payload)
      ? payload
      : Buffer.from(payload, 'utf8');
    return new Readable({
      read() {
        if (pushed) {
          return;
        }
        pushed = true;
        this.push(data);
      },
    });
  }

  function rejectIfHung<T>(promise: Promise<T>, label: string): Promise<T> {
    return Promise.race([
      promise,
      new Promise<never>((_, reject) => {
        setTimeout(
          () => reject(new Error(`${label} hung waiting for EOF`)),
          1000,
        );
      }),
    ]);
  }

  it('rejects an oversized field without waiting for source EOF', async () => {
    const source = openEndedStream('sku\nABCDEFGHIJK\n');
    await expect(
      rejectIfHung(
        parseCsvStream(source, { ...limits, maxFieldBytes: 8 }),
        'oversized field',
      ),
    ).rejects.toMatchObject({
      code: 'IMPORT.INVALID_CSV',
      message: expect.stringMatching(/field size/i),
    });
    expect(source.destroyed).toBe(true);
  });

  it('rejects a row-limit overflow without waiting for source EOF', async () => {
    const source = openEndedStream('sku\nA\nB\n');
    await expect(
      rejectIfHung(
        parseCsvStream(source, { ...limits, maxDataRows: 1 }),
        'row limit',
      ),
    ).rejects.toMatchObject({
      code: 'IMPORT.INVALID_CSV',
      message: expect.stringMatching(/data rows/i),
    });
    expect(source.destroyed).toBe(true);
  });

  it('rejects an inconsistent row without waiting for source EOF', async () => {
    const source = openEndedStream('sku\nA,B\n');
    await expect(
      rejectIfHung(parseCsvStream(source, limits), 'inconsistent columns'),
    ).rejects.toMatchObject({
      code: 'IMPORT.INVALID_CSV',
      message: expect.stringMatching(/inconsistent/i),
    });
    expect(source.destroyed).toBe(true);
  });

  it('rejects a duplicate header without waiting for source EOF', async () => {
    const source = openEndedStream('sku,sku\nA,B\n');
    await expect(
      rejectIfHung(parseCsvStream(source, limits), 'duplicate header'),
    ).rejects.toMatchObject({
      code: 'IMPORT.INVALID_CSV',
      message: expect.stringMatching(/duplicate/i),
    });
    expect(source.destroyed).toBe(true);
  });

  it('propagates a synchronous onHeader failure without waiting for source EOF', async () => {
    const source = openEndedStream('sku,name\nA1,a\n');
    let called = false;
    await expect(
      rejectIfHung(
        parseCsvStream(source, limits, {
          onHeader: () => {
            called = true;
            throw new Error('header callback failed');
          },
        }),
        'sync onHeader',
      ),
    ).rejects.toThrow('header callback failed');
    expect(called).toBe(true);
    expect(source.destroyed).toBe(true);
  });

  it('propagates an async onHeader failure without waiting for source EOF', async () => {
    const source = openEndedStream('sku,name\nA1,a\n');
    await expect(
      rejectIfHung(
        parseCsvStream(source, limits, {
          onHeader: async () => {
            await Promise.resolve();
            throw new Error('async header callback failed');
          },
        }),
        'async onHeader',
      ),
    ).rejects.toThrow('async header callback failed');
    expect(source.destroyed).toBe(true);
  });

  it('propagates a synchronous onRecord failure without waiting for source EOF', async () => {
    const source = openEndedStream('sku,name\nA1,a\nA2,b\n');
    await expect(
      rejectIfHung(
        parseCsvStream(source, limits, {
          onRecord: () => {
            throw new Error('record callback failed');
          },
        }),
        'sync onRecord',
      ),
    ).rejects.toThrow('record callback failed');
    expect(source.destroyed).toBe(true);
  });

  it('propagates an async onRecord failure without waiting for source EOF', async () => {
    const source = openEndedStream('sku,name\nA1,a\nA2,b\n');
    await expect(
      rejectIfHung(
        parseCsvStream(source, limits, {
          onRecord: async () => {
            await Promise.resolve();
            throw new Error('async record callback failed');
          },
        }),
        'async onRecord',
      ),
    ).rejects.toThrow('async record callback failed');
    expect(source.destroyed).toBe(true);
  });

  it('propagates a late stream error while a record callback is in flight', async () => {
    const input = Readable.from(
      (async function* () {
        yield Buffer.from('sku,name\nA1,a\n', 'utf8');
        await new Promise((resolve) => {
          setTimeout(resolve, 40);
        });
        yield Buffer.from([0xff]);
      })(),
    );

    await expect(
      parseCsvStream(input, limits, {
        onRecord: async () => {
          await new Promise((resolve) => {
            setTimeout(resolve, 20);
          });
        },
      }),
    ).rejects.toMatchObject({ code: 'IMPORT.INVALID_CSV' });
  });

  async function collectRecords(
    chunks: Array<string | Buffer>,
    parseLimits: CsvParseLimits = limits,
  ): Promise<{ columns: string[]; rows: string[][]; dataRowCount: number }> {
    const rows: string[][] = [];
    let columns: string[] = [];
    const result = await parseCsvStream(
      Readable.from(
        chunks.map((chunk) =>
          Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk, 'utf8'),
        ),
      ),
      parseLimits,
      {
        onHeader: (header) => {
          columns = [...header];
        },
        onRecord: (row) => {
          rows.push([...row]);
        },
      },
    );
    return { columns, rows, dataRowCount: result.dataRowCount };
  }

  function everyTwoChunkSplits(bytes: Buffer): Buffer[][] {
    const splits: Buffer[][] = [];
    for (let index = 1; index < bytes.length; index += 1) {
      splits.push([bytes.subarray(0, index), bytes.subarray(index)]);
    }
    return splits;
  }

  it('keeps CRLF split across chunks as one terminator', async () => {
    const parsed = await collectRecords([
      Buffer.from('sku\r\nA\r', 'utf8'),
      Buffer.from('\nB\r\n', 'utf8'),
    ]);
    expect(parsed.columns).toEqual(['sku']);
    expect(parsed.rows).toEqual([['A'], ['B']]);
    expect(parsed.dataRowCount).toBe(2);
  });

  it('does not reject a valid CRLF CSV when the split lands between CR and LF', async () => {
    const parsed = await collectRecords([
      Buffer.from('sku,name\r\nA,B\r', 'utf8'),
      Buffer.from('\nC,D\r\n', 'utf8'),
    ]);
    expect(parsed.columns).toEqual(['sku', 'name']);
    expect(parsed.rows).toEqual([
      ['A', 'B'],
      ['C', 'D'],
    ]);
    expect(parsed.dataRowCount).toBe(2);
  });

  it('parses CRLF fixtures identically for every two-chunk split', async () => {
    const fixtures: Array<{
      label: string;
      bytes: Buffer;
      columns: string[];
      rows: string[][];
    }> = [
      {
        label: 'single-column CRLF',
        bytes: Buffer.from('sku\r\nA\r\nB\r\n', 'utf8'),
        columns: ['sku'],
        rows: [['A'], ['B']],
      },
      {
        label: 'multi-column CRLF',
        bytes: Buffer.from('sku,name\r\nA,B\r\nC,D\r\n', 'utf8'),
        columns: ['sku', 'name'],
        rows: [
          ['A', 'B'],
          ['C', 'D'],
        ],
      },
      {
        label: 'semicolon CRLF',
        bytes: Buffer.from('sku;name\r\nA;B\r\nC;D\r\n', 'utf8'),
        columns: ['sku', 'name'],
        rows: [
          ['A', 'B'],
          ['C', 'D'],
        ],
      },
      {
        label: 'quoted CRLF content',
        bytes: Buffer.from('sku,note\r\nA,"x\r\ny"\r\nB,z\r\n', 'utf8'),
        columns: ['sku', 'note'],
        rows: [
          ['A', 'x\r\ny'],
          ['B', 'z'],
        ],
      },
      {
        label: 'escaped quotes CRLF',
        bytes: Buffer.from('sku,note\r\nA,"he said ""hi"""\r\nB,z\r\n', 'utf8'),
        columns: ['sku', 'note'],
        rows: [
          ['A', 'he said "hi"'],
          ['B', 'z'],
        ],
      },
      {
        label: 'LF without trailing terminator on last row',
        bytes: Buffer.from('sku\nA\nB', 'utf8'),
        columns: ['sku'],
        rows: [['A'], ['B']],
      },
      {
        label: 'CRLF without trailing terminator on last row',
        bytes: Buffer.from('sku\r\nA\r\nB', 'utf8'),
        columns: ['sku'],
        rows: [['A'], ['B']],
      },
      {
        label: 'BOM + CRLF',
        bytes: Buffer.concat([
          Buffer.from([0xef, 0xbb, 0xbf]),
          Buffer.from('sku\r\nA\r\nB\r\n', 'utf8'),
        ]),
        columns: ['sku'],
        rows: [['A'], ['B']],
      },
      {
        label: 'UTF-8 multibyte field',
        bytes: Buffer.from('sku,name\nA,café\nB,naïve\n', 'utf8'),
        columns: ['sku', 'name'],
        rows: [
          ['A', 'café'],
          ['B', 'naïve'],
        ],
      },
      {
        label: 'LF single column',
        bytes: Buffer.from('sku\nA\nB\n', 'utf8'),
        columns: ['sku'],
        rows: [['A'], ['B']],
      },
    ];

    for (const fixture of fixtures) {
      const expected = await collectRecords([fixture.bytes]);
      expect(expected.columns, fixture.label).toEqual(fixture.columns);
      expect(expected.rows, fixture.label).toEqual(fixture.rows);
      expect(expected.dataRowCount, fixture.label).toBe(fixture.rows.length);

      for (const chunks of everyTwoChunkSplits(fixture.bytes)) {
        const parsed = await collectRecords(chunks);
        expect(parsed.columns, `${fixture.label} split`).toEqual(fixture.columns);
        expect(parsed.rows, `${fixture.label} split`).toEqual(fixture.rows);
        expect(parsed.dataRowCount, `${fixture.label} split`).toBe(
          fixture.rows.length,
        );
      }

      const oneByte = Array.from(fixture.bytes, (byte) => Buffer.from([byte]));
      const parsedOneByte = await collectRecords(oneByte);
      expect(parsedOneByte.rows, `${fixture.label} one-byte`).toEqual(
        fixture.rows,
      );

      const mid = Math.floor(fixture.bytes.length / 2);
      const irregular = [
        fixture.bytes.subarray(0, 1),
        fixture.bytes.subarray(1, mid),
        fixture.bytes.subarray(mid, fixture.bytes.length - 1),
        fixture.bytes.subarray(fixture.bytes.length - 1),
      ].filter((part) => part.length > 0);
      const parsedIrregular = await collectRecords(irregular);
      expect(parsedIrregular.rows, `${fixture.label} irregular`).toEqual(
        fixture.rows,
      );
    }
  });

  it('keeps CRLF integrity through HashAndLimitTransform chunk boundaries', async () => {
    const { HashAndLimitTransform } = await import(
      '../hash-and-limit.transform.js'
    );
    const { pipeline } = await import('node:stream/promises');
    const chunks = [
      Buffer.from('sku\r\nA\r', 'utf8'),
      Buffer.from('\nB\r\n', 'utf8'),
    ];
    const hasher = new HashAndLimitTransform(1_000_000);
    const rows: string[][] = [];
    const parsePromise = parseCsvStream(hasher, limits, {
      onRecord: (row) => {
        rows.push([...row]);
      },
    });
    const feedPromise = pipeline(Readable.from(chunks), hasher);
    void parsePromise.then(
      () => undefined,
      () => undefined,
    );
    void feedPromise.then(
      () => undefined,
      () => undefined,
    );
    const result = await parsePromise;
    await feedPromise;
    expect(result.dataRowCount).toBe(2);
    expect(rows).toEqual([['A'], ['B']]);
  });

  it('accepts a field of exactly maxFieldBytes escaped quotes regardless of fragmentation', async () => {
    const q = String.fromCharCode(34);
    // Decoded field is q.repeat(100): 100 literal quote characters, exactly
    // at maxFieldBytes. On the wire each is doubled ("" -> "), so the raw
    // field representation is 202 bytes (1 wrapping quote + 200 escaped +
    // 1 wrapping quote).
    const csv = Buffer.from(`sku\n${q}${q.repeat(200)}${q}\n`, 'utf8');
    const smallLimits: CsvParseLimits = {
      maxDataRows: 10,
      maxColumns: 1,
      maxFieldBytes: 100,
    };
    const expectedField = q.repeat(100);

    const single = await collectRecords([csv], smallLimits);
    expect(single.rows).toEqual([[expectedField]]);
    expect(single.dataRowCount).toBe(1);

    const cutAt150 = await collectRecords(
      [csv.subarray(0, 150), csv.subarray(150)],
      smallLimits,
    );
    expect(cutAt150.rows).toEqual([[expectedField]]);

    for (const chunks of everyTwoChunkSplits(csv)) {
      const parsed = await collectRecords(chunks, smallLimits);
      expect(parsed.rows).toEqual([[expectedField]]);
    }

    const oneByte = Array.from(csv, (byte) => Buffer.from([byte]));
    expect((await collectRecords(oneByte, smallLimits)).rows).toEqual([
      [expectedField],
    ]);

    const mid = Math.floor(csv.length / 2);
    const irregular = [
      csv.subarray(0, 1),
      csv.subarray(1, mid),
      csv.subarray(mid, csv.length - 1),
      csv.subarray(csv.length - 1),
    ].filter((part) => part.length > 0);
    expect((await collectRecords(irregular, smallLimits)).rows).toEqual([
      [expectedField],
    ]);
  });

  it('rejects a field one byte above maxFieldBytes regardless of fragmentation', async () => {
    const q = String.fromCharCode(34);
    // Decoded field is q.repeat(101): one quote character over the limit.
    const csv = Buffer.from(`sku\n${q}${q.repeat(202)}${q}\n`, 'utf8');
    const smallLimits: CsvParseLimits = {
      maxDataRows: 10,
      maxColumns: 1,
      maxFieldBytes: 100,
    };

    await expect(collectRecords([csv], smallLimits)).rejects.toMatchObject({
      code: 'IMPORT.INVALID_CSV',
    });
    await expect(
      collectRecords([csv.subarray(0, 150), csv.subarray(150)], smallLimits),
    ).rejects.toMatchObject({ code: 'IMPORT.INVALID_CSV' });
    await expect(
      collectRecords(
        Array.from(csv, (byte) => Buffer.from([byte])),
        smallLimits,
      ),
    ).rejects.toMatchObject({ code: 'IMPORT.INVALID_CSV' });
  });

  it('accepts the default-limits worst case CSV whole and split mid-field', async () => {
    // Independent review repro: 50 columns, 65536-byte fields; 32 fields are
    // entirely quote characters at exactly the field-size limit (raw
    // representation doubles via escaping) and 18 are a single character.
    const q = '"';
    const maxFieldBytes = 65_536;
    const bigField = q + q.repeat(maxFieldBytes * 2) + q; // decodes to 65536 quotes
    const smallField = 'v';
    const columnCount = 50;
    const header = Array.from({ length: columnCount }, (_, i) => `c${i}`).join(
      ',',
    );
    const fields = [
      ...Array.from({ length: 32 }, () => bigField),
      ...Array.from({ length: 18 }, () => smallField),
    ];
    expect(fields).toHaveLength(columnCount);
    const csv = Buffer.from(`${header}\n${fields.join(',')}\n`, 'utf8');
    expect(csv.length).toBeGreaterThan(4_000_000);

    const defaultLimits: CsvParseLimits = {
      maxDataRows: 10,
      maxColumns: columnCount,
      maxFieldBytes,
    };

    const whole = await collectRecords([csv], defaultLimits);
    expect(whole.dataRowCount).toBe(1);
    expect(whole.rows[0]).toHaveLength(columnCount);
    expect(whole.rows[0]?.[0]).toBe(q.repeat(maxFieldBytes));
    expect(whole.rows[0]?.[32]).toBe('v');

    // Split at a few representative points inside the escaped-quote run of
    // the first field: just after the opening quote, mid-run, between two
    // bytes of an escaped pair, and just before the closing quote.
    const headerLen = header.length + 1;
    const splitOffsets = [
      headerLen + 2,
      headerLen + 2 + maxFieldBytes,
      headerLen + 2 + maxFieldBytes * 2 - 1,
      headerLen + 1 + bigField.length,
    ];
    for (const offset of splitOffsets) {
      const split = await collectRecords(
        [csv.subarray(0, offset), csv.subarray(offset)],
        defaultLimits,
      );
      expect(split.dataRowCount, `offset ${offset}`).toBe(1);
      expect(split.rows[0]?.[0], `offset ${offset}`).toBe(
        q.repeat(maxFieldBytes),
      );
      expect(split.rows[0]?.[32], `offset ${offset}`).toBe('v');
    }
  });

  it('scans a long escaped-quote field incrementally without quadratic Buffer.concat cost', async () => {
    const sizes = [8 * 1024, 16 * 1024, 32 * 1024];
    const concatBytesBySize: number[] = [];
    const originalConcat = Buffer.concat.bind(Buffer);

    for (const contentBytes of sizes) {
      const rawField = `"${'""'.repeat(contentBytes)}"`;
      const csv = Buffer.from(`sku\n${rawField}\n`, 'utf8');
      const chunks = Array.from(csv, (byte) => Buffer.from([byte]));

      let concatBytes = 0;
      const spy = vi
        .spyOn(Buffer, 'concat')
        .mockImplementation((list: readonly Uint8Array[], totalLength?: number) => {
          concatBytes += list.reduce((sum, part) => sum + part.length, 0);
          return originalConcat(list, totalLength);
        });

      try {
        const result = await parseCsvStream(Readable.from(chunks), {
          maxDataRows: 1,
          maxColumns: 1,
          maxFieldBytes: contentBytes,
        });
        expect(result.dataRowCount).toBe(1);
      } finally {
        spy.mockRestore();
      }

      concatBytesBySize.push(concatBytes);
    }

    // A quadratic scanner re-copies the whole accumulated record on every
    // one-byte chunk, so total Buffer.concat input would grow roughly with
    // the square of the record size (the independent review measured ~537MB
    // of copies for a 32KiB field). An incremental scanner concatenates each
    // record's bytes only once at emission, so total copying stays within a
    // small constant multiple of the record size and grows linearly.
    for (let i = 0; i < sizes.length; i += 1) {
      expect(concatBytesBySize[i], `size ${sizes[i]}`).toBeLessThan(
        sizes[i]! * 10,
      );
    }
    const growthFor4x = concatBytesBySize[2]! / concatBytesBySize[0]!;
    expect(growthFor4x).toBeLessThan(8);
  });
});
