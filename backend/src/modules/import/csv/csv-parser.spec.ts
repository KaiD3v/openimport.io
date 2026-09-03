import { Readable } from 'node:stream';
import { describe, expect, it } from 'vitest';
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
});
