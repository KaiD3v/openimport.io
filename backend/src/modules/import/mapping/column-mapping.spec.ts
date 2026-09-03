import { describe, expect, it } from 'vitest';
import {
  MappingValidationError,
  areMappingsSemanticallyEqual,
  canonicalizeMapping,
  type MappingPair,
  type TemplateFieldForMapping,
} from './column-mapping.js';

const fields: TemplateFieldForMapping[] = [
  { key: 'sku', required: true, position: 0 },
  { key: 'model', required: true, position: 1 },
  { key: 'size', required: true, position: 2 },
  { key: 'priceInCents', required: true, position: 3 },
  { key: 'stock', required: true, position: 4 },
  { key: 'notes', required: false, position: 5 },
];

const columns = [
  { position: 0 },
  { position: 1 },
  { position: 2 },
  { position: 3 },
  { position: 4 },
  { position: 5 },
];

describe('canonicalizeMapping', () => {
  it('accepts a complete mapping and reports isComplete true', () => {
    const mappings: MappingPair[] = [
      { columnPosition: 4, fieldKey: 'stock' },
      { columnPosition: 0, fieldKey: 'sku' },
      { columnPosition: 3, fieldKey: 'priceInCents' },
      { columnPosition: 1, fieldKey: 'model' },
      { columnPosition: 2, fieldKey: 'size' },
    ];

    const view = canonicalizeMapping(mappings, fields, columns);

    expect(view.isComplete).toBe(true);
    expect(view.missingRequiredFields).toEqual([]);
    expect(view.mappings.map((item) => item.fieldKey)).toEqual([
      'sku',
      'model',
      'size',
      'priceInCents',
      'stock',
    ]);
  });

  it('accepts a partial draft and lists missing required fields in template order', () => {
    const view = canonicalizeMapping(
      [
        { columnPosition: 3, fieldKey: 'priceInCents' },
        { columnPosition: 0, fieldKey: 'sku' },
      ],
      fields,
      columns,
    );

    expect(view.isComplete).toBe(false);
    expect(view.missingRequiredFields).toEqual(['model', 'size', 'stock']);
    expect(view.mappings).toEqual([
      { columnPosition: 0, fieldKey: 'sku' },
      { columnPosition: 3, fieldKey: 'priceInCents' },
    ]);
  });

  it('treats an empty mapping as incomplete with all required fields missing', () => {
    const view = canonicalizeMapping([], fields, columns);

    expect(view).toEqual({
      mappings: [],
      isComplete: false,
      missingRequiredFields: ['sku', 'model', 'size', 'priceInCents', 'stock'],
    });
  });

  it('is incomplete when only optional fields are mapped', () => {
    const view = canonicalizeMapping(
      [{ columnPosition: 5, fieldKey: 'notes' }],
      fields,
      columns,
    );

    expect(view.isComplete).toBe(false);
    expect(view.missingRequiredFields).toEqual([
      'sku',
      'model',
      'size',
      'priceInCents',
      'stock',
    ]);
  });

  it('is complete for templates with only optional fields when at least one mapping exists', () => {
    const optionalOnly: TemplateFieldForMapping[] = [
      { key: 'notes', required: false, position: 0 },
      { key: 'tag', required: false, position: 1 },
    ];

    const view = canonicalizeMapping(
      [{ columnPosition: 0, fieldKey: 'notes' }],
      optionalOnly,
      [{ position: 0 }, { position: 1 }],
    );

    expect(view.isComplete).toBe(true);
    expect(view.missingRequiredFields).toEqual([]);
  });

  it('is incomplete for optional-only templates with an empty mapping', () => {
    const optionalOnly: TemplateFieldForMapping[] = [
      { key: 'notes', required: false, position: 0 },
    ];

    const view = canonicalizeMapping([], optionalOnly, [{ position: 0 }]);

    expect(view.isComplete).toBe(false);
    expect(view.missingRequiredFields).toEqual([]);
  });

  it('rejects unknown column positions', () => {
    expect(() =>
      canonicalizeMapping(
        [{ columnPosition: 9, fieldKey: 'sku' }],
        fields,
        columns,
      ),
    ).toThrow(MappingValidationError);
  });

  it('rejects field keys outside the template', () => {
    try {
      canonicalizeMapping(
        [{ columnPosition: 0, fieldKey: 'unknown' }],
        fields,
        columns,
      );
      throw new Error('expected mapping validation error');
    } catch (error) {
      expect(error).toBeInstanceOf(MappingValidationError);
      expect((error as MappingValidationError).code).toBe(
        'IMPORT.MAPPING_INVALID',
      );
    }
  });

  it('rejects duplicate column positions', () => {
    expect(() =>
      canonicalizeMapping(
        [
          { columnPosition: 0, fieldKey: 'sku' },
          { columnPosition: 0, fieldKey: 'model' },
        ],
        fields,
        columns,
      ),
    ).toThrow(/mapped more than once/);
  });

  it('rejects duplicate field keys', () => {
    expect(() =>
      canonicalizeMapping(
        [
          { columnPosition: 0, fieldKey: 'sku' },
          { columnPosition: 1, fieldKey: 'sku' },
        ],
        fields,
        columns,
      ),
    ).toThrow(/mapped more than once/);
  });
});

describe('areMappingsSemanticallyEqual', () => {
  it('treats different order as equal', () => {
    expect(
      areMappingsSemanticallyEqual(
        [
          { columnPosition: 0, fieldKey: 'sku' },
          { columnPosition: 3, fieldKey: 'priceInCents' },
        ],
        [
          { columnPosition: 3, fieldKey: 'priceInCents' },
          { columnPosition: 0, fieldKey: 'sku' },
        ],
      ),
    ).toBe(true);
  });

  it('detects different associations', () => {
    expect(
      areMappingsSemanticallyEqual(
        [{ columnPosition: 0, fieldKey: 'sku' }],
        [{ columnPosition: 1, fieldKey: 'sku' }],
      ),
    ).toBe(false);
  });
});
