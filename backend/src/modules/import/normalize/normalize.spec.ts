import { describe, expect, it } from 'vitest';
import {
  normalizeInteger,
  normalizeCurrencyPtBrV1,
  normalizeRecord,
  type TemplateFieldForNormalize,
} from './normalize.js';

const sku: TemplateFieldForNormalize = {
  key: 'sku',
  type: 'string',
  required: true,
};
const size: TemplateFieldForNormalize = {
  key: 'size',
  type: 'integer',
  required: true,
};
const stock: TemplateFieldForNormalize = {
  key: 'stock',
  type: 'integer',
  required: false,
};
const price: TemplateFieldForNormalize = {
  key: 'priceInCents',
  type: 'currency',
  required: true,
};
const note: TemplateFieldForNormalize = {
  key: 'note',
  type: 'string',
  required: false,
};

describe('normalizeInteger', () => {
  it('accepts digits with optional sign, including zero and negatives', () => {
    expect(normalizeInteger('0')).toEqual({ ok: true, value: 0 });
    expect(normalizeInteger('+42')).toEqual({ ok: true, value: 42 });
    expect(normalizeInteger('-7')).toEqual({ ok: true, value: -7 });
    expect(normalizeInteger('9007199254740991')).toEqual({
      ok: true,
      value: Number.MAX_SAFE_INTEGER,
    });
    expect(normalizeInteger('-9007199254740991')).toEqual({
      ok: true,
      value: Number.MIN_SAFE_INTEGER,
    });
  });

  it('rejects separators, decimals, exponents, hex, and residue', () => {
    for (const invalid of [
      '1_000',
      '1.000',
      '1,000',
      '1.5',
      '1e3',
      '0x10',
      '10x',
      '++1',
      '1 ',
      '',
    ]) {
      const result = normalizeInteger(invalid);
      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.code).toBe('FIELD.INVALID_INTEGER');
      }
    }
  });

  it('rejects values outside the safe integer range', () => {
    expect(normalizeInteger('9007199254740992')).toEqual({
      ok: false,
      code: 'FIELD.NUMBER_OUT_OF_RANGE',
    });
    expect(normalizeInteger('-9007199254740992')).toEqual({
      ok: false,
      code: 'FIELD.NUMBER_OUT_OF_RANGE',
    });
  });
});

describe('normalizeCurrencyPtBrV1', () => {
  it('converts the required pt-BR examples to cents', () => {
    expect(normalizeCurrencyPtBrV1('299')).toEqual({ ok: true, value: 29900 });
    expect(normalizeCurrencyPtBrV1('299,9')).toEqual({ ok: true, value: 29990 });
    expect(normalizeCurrencyPtBrV1('299,90')).toEqual({
      ok: true,
      value: 29990,
    });
    expect(normalizeCurrencyPtBrV1('R$ 299,90')).toEqual({
      ok: true,
      value: 29990,
    });
    expect(normalizeCurrencyPtBrV1('1.234,56')).toEqual({
      ok: true,
      value: 123456,
    });
    expect(normalizeCurrencyPtBrV1('1.234')).toEqual({
      ok: true,
      value: 123400,
    });
    expect(normalizeCurrencyPtBrV1('-10,50')).toEqual({
      ok: true,
      value: -1050,
    });
    expect(normalizeCurrencyPtBrV1('R$ -10,50')).toEqual({
      ok: true,
      value: -1050,
    });
  });

  it('accepts NBSP after the R$ prefix', () => {
    expect(normalizeCurrencyPtBrV1('R$\u00A0299,90')).toEqual({
      ok: true,
      value: 29990,
    });
  });

  it('rejects US-style, mixed, exponent, and over-precise amounts', () => {
    for (const invalid of [
      '299.90',
      '1,234.56',
      '12.34,56',
      '10,999',
      '1e3',
      'NaN',
      'Infinity',
      '1 234,56',
      'r$ 10',
    ]) {
      const result = normalizeCurrencyPtBrV1(invalid);
      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.code).toBe('FIELD.INVALID_CURRENCY');
      }
    }
  });

  it('rejects currency amounts outside the safe integer range', () => {
    const result = normalizeCurrencyPtBrV1('90071992547410');
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.code).toBe('FIELD.NUMBER_OUT_OF_RANGE');
    }
  });
});

describe('normalizeRecord', () => {
  it('maps by column position and emits template keys, preserving SKU zeros', () => {
    const result = normalizeRecord(
      ['000123', '42', 'R$ 299,90'],
      [
        { columnPosition: 0, fieldKey: 'sku' },
        { columnPosition: 1, fieldKey: 'size' },
        { columnPosition: 2, fieldKey: 'priceInCents' },
      ],
      [sku, size, price],
    );

    expect(result.valid).toBe(true);
    expect(result.data).toEqual({
      sku: '000123',
      size: 42,
      priceInCents: 29990,
    });
    expect(result.errors).toEqual([]);
  });

  it('trims edges but preserves internal string content', () => {
    const result = normalizeRecord(
      ['  TEN-001  ', ' 8 '],
      [
        { columnPosition: 0, fieldKey: 'sku' },
        { columnPosition: 1, fieldKey: 'priceInCents' },
      ],
      [sku, price],
    );

    expect(result.valid).toBe(true);
    expect(result.data).toEqual({ sku: 'TEN-001', priceInCents: 800 });
  });

  it('treats empty required fields as FIELD.REQUIRED and omits empty optionals', () => {
    const result = normalizeRecord(
      ['', '10', '   '],
      [
        { columnPosition: 0, fieldKey: 'sku' },
        { columnPosition: 1, fieldKey: 'priceInCents' },
        { columnPosition: 2, fieldKey: 'note' },
      ],
      [sku, price, note],
    );

    expect(result.valid).toBe(false);
    expect(result.data).toBeNull();
    expect(result.errors).toEqual([
      {
        fieldKey: 'sku',
        code: 'FIELD.REQUIRED',
        message: 'This field is required.',
      },
    ]);
  });

  it('omits unmapped optional fields and still errors on invalid optional values', () => {
    const omitted = normalizeRecord(
      ['A1', '10'],
      [
        { columnPosition: 0, fieldKey: 'sku' },
        { columnPosition: 1, fieldKey: 'priceInCents' },
      ],
      [sku, price, stock],
    );
    expect(omitted.valid).toBe(true);
    expect(omitted.data).toEqual({ sku: 'A1', priceInCents: 1000 });
    expect(omitted.data).not.toHaveProperty('stock');

    const invalidOptional = normalizeRecord(
      ['A1', '10', '1.5'],
      [
        { columnPosition: 0, fieldKey: 'sku' },
        { columnPosition: 1, fieldKey: 'priceInCents' },
        { columnPosition: 2, fieldKey: 'stock' },
      ],
      [sku, price, stock],
    );
    expect(invalidOptional.valid).toBe(false);
    expect(invalidOptional.data).toBeNull();
    expect(invalidOptional.errors).toEqual([
      {
        fieldKey: 'stock',
        code: 'FIELD.INVALID_INTEGER',
        message: 'Value must be an integer.',
      },
    ]);
  });

  it('collects every field error on the same row without interpolating values', () => {
    const result = normalizeRecord(
      ['', 'x', '299.90'],
      [
        { columnPosition: 0, fieldKey: 'sku' },
        { columnPosition: 1, fieldKey: 'size' },
        { columnPosition: 2, fieldKey: 'priceInCents' },
      ],
      [sku, size, price],
    );

    expect(result.valid).toBe(false);
    expect(result.data).toBeNull();
    expect(result.errors).toEqual([
      {
        fieldKey: 'sku',
        code: 'FIELD.REQUIRED',
        message: 'This field is required.',
      },
      {
        fieldKey: 'size',
        code: 'FIELD.INVALID_INTEGER',
        message: 'Value must be an integer.',
      },
      {
        fieldKey: 'priceInCents',
        code: 'FIELD.INVALID_CURRENCY',
        message: 'Value must be a currency amount in pt-BR format.',
      },
    ]);
    expect(JSON.stringify(result.errors)).not.toContain('299.90');
  });

  it('assigns inherited property names as own keys on a null-prototype object', () => {
    const ctorField: TemplateFieldForNormalize = {
      key: 'constructor',
      type: 'string',
      required: true,
    };
    const result = normalizeRecord(
      ['own-value', '10'],
      [
        { columnPosition: 0, fieldKey: 'constructor' },
        { columnPosition: 1, fieldKey: 'priceInCents' },
      ],
      [ctorField, price],
    );

    expect(result.valid).toBe(true);
    expect(Object.getPrototypeOf(result.data)).toBeNull();
    expect(Object.prototype.hasOwnProperty.call(result.data, 'constructor')).toBe(
      true,
    );
    expect((result.data as Record<string, unknown>).constructor).toBe(
      'own-value',
    );
  });
});
