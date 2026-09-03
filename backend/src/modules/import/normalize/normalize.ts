import type { MappingPair } from '../mapping/column-mapping.js';
import type { TemplateFieldType } from '../../template/template-field-type.js';

export const NORMALIZATION_PROFILE = 'pt-BR-v1';

export type FieldErrorCode =
  | 'FIELD.REQUIRED'
  | 'FIELD.INVALID_INTEGER'
  | 'FIELD.INVALID_CURRENCY'
  | 'FIELD.NUMBER_OUT_OF_RANGE';

export type FieldError = {
  fieldKey: string;
  code: FieldErrorCode;
  message: string;
};

export type TemplateFieldForNormalize = {
  key: string;
  type: TemplateFieldType;
  required: boolean;
};

export type NormalizedSuccess = {
  valid: true;
  data: Record<string, string | number>;
  errors: [];
};

export type NormalizedFailure = {
  valid: false;
  data: null;
  errors: FieldError[];
};

export type NormalizedRecord = NormalizedSuccess | NormalizedFailure;

export type NumberNormalizeResult =
  | { ok: true; value: number }
  | { ok: false; code: 'FIELD.INVALID_INTEGER' | 'FIELD.INVALID_CURRENCY' | 'FIELD.NUMBER_OUT_OF_RANGE' };

const INTEGER_PATTERN = /^[+-]?\d+$/;
const SAFE_MAX = BigInt(Number.MAX_SAFE_INTEGER);
const SAFE_MIN = BigInt(Number.MIN_SAFE_INTEGER);
const NBSP = '\u00A0';

const MESSAGES: Record<FieldErrorCode, string> = {
  'FIELD.REQUIRED': 'This field is required.',
  'FIELD.INVALID_INTEGER': 'Value must be an integer.',
  'FIELD.INVALID_CURRENCY': 'Value must be a currency amount in pt-BR format.',
  'FIELD.NUMBER_OUT_OF_RANGE': 'Number is outside the safe integer range.',
};

function fieldError(fieldKey: string, code: FieldErrorCode): FieldError {
  return { fieldKey, code, message: MESSAGES[code] };
}

function toSafeNumber(
  cents: bigint,
  invalidCode: 'FIELD.INVALID_INTEGER' | 'FIELD.INVALID_CURRENCY',
): NumberNormalizeResult {
  if (cents > SAFE_MAX || cents < SAFE_MIN) {
    return { ok: false, code: 'FIELD.NUMBER_OUT_OF_RANGE' };
  }
  const asNumber = Number(cents);
  if (!Number.isSafeInteger(asNumber)) {
    return { ok: false, code: invalidCode };
  }
  return { ok: true, value: asNumber };
}

export function normalizeInteger(value: string): NumberNormalizeResult {
  if (!INTEGER_PATTERN.test(value)) {
    return { ok: false, code: 'FIELD.INVALID_INTEGER' };
  }
  try {
    return toSafeNumber(BigInt(value), 'FIELD.INVALID_INTEGER');
  } catch {
    return { ok: false, code: 'FIELD.INVALID_INTEGER' };
  }
}

function isValidThousandGrouped(integerPart: string): boolean {
  return /^\d{1,3}(\.\d{3})+$/.test(integerPart);
}

function isPlainDigits(integerPart: string): boolean {
  return /^\d+$/.test(integerPart);
}

export function normalizeCurrencyPtBrV1(value: string): NumberNormalizeResult {
  let rest = value;
  if (rest.startsWith('R$')) {
    rest = rest.slice(2);
    let index = 0;
    while (index < rest.length && (rest[index] === ' ' || rest[index] === NBSP)) {
      index += 1;
    }
    rest = rest.slice(index);
  }

  let sign = 1n;
  if (rest.startsWith('+') || rest.startsWith('-')) {
    if (rest.startsWith('-')) {
      sign = -1n;
    }
    rest = rest.slice(1);
  }

  if (rest.length === 0 || /[ \u00A0eE]/.test(rest)) {
    return { ok: false, code: 'FIELD.INVALID_CURRENCY' };
  }

  const commaIndex = rest.indexOf(',');
  let integerPart: string;
  let fractionPart: string;
  if (commaIndex === -1) {
    integerPart = rest;
    fractionPart = '';
  } else {
    if (rest.indexOf(',', commaIndex + 1) !== -1) {
      return { ok: false, code: 'FIELD.INVALID_CURRENCY' };
    }
    integerPart = rest.slice(0, commaIndex);
    fractionPart = rest.slice(commaIndex + 1);
    if (fractionPart.length < 1 || fractionPart.length > 2 || !/^\d+$/.test(fractionPart)) {
      return { ok: false, code: 'FIELD.INVALID_CURRENCY' };
    }
  }

  if (integerPart.includes('.')) {
    if (!isValidThousandGrouped(integerPart)) {
      return { ok: false, code: 'FIELD.INVALID_CURRENCY' };
    }
  } else if (!isPlainDigits(integerPart)) {
    return { ok: false, code: 'FIELD.INVALID_CURRENCY' };
  }

  const digits = integerPart.replace(/\./g, '');
  const centsFraction = fractionPart.padEnd(2, '0');
  try {
    const cents = sign * (BigInt(digits) * 100n + BigInt(centsFraction));
    return toSafeNumber(cents, 'FIELD.INVALID_CURRENCY');
  } catch {
    return { ok: false, code: 'FIELD.INVALID_CURRENCY' };
  }
}

export function normalizeRecord(
  cells: string[],
  mappings: MappingPair[],
  fields: TemplateFieldForNormalize[],
): NormalizedRecord {
  const fieldsByKey = new Map(fields.map((field) => [field.key, field]));
  const data = Object.create(null) as Record<string, string | number>;
  const errors: FieldError[] = [];

  const orderedMappings = [...mappings].sort((left, right) => {
    const leftField = fieldsByKey.get(left.fieldKey);
    const rightField = fieldsByKey.get(right.fieldKey);
    const leftIndex = leftField ? fields.indexOf(leftField) : Number.MAX_SAFE_INTEGER;
    const rightIndex = rightField ? fields.indexOf(rightField) : Number.MAX_SAFE_INTEGER;
    return leftIndex - rightIndex;
  });

  for (const mapping of orderedMappings) {
    const field = fieldsByKey.get(mapping.fieldKey);
    if (!field) {
      continue;
    }
    const raw = cells[mapping.columnPosition] ?? '';
    const trimmed = raw.trim();
    if (trimmed.length === 0) {
      if (field.required) {
        errors.push(fieldError(field.key, 'FIELD.REQUIRED'));
      }
      continue;
    }

    if (field.type === 'string') {
      data[field.key] = trimmed;
      continue;
    }

    if (field.type === 'integer') {
      const parsed = normalizeInteger(trimmed);
      if (!parsed.ok) {
        errors.push(fieldError(field.key, parsed.code));
        continue;
      }
      data[field.key] = parsed.value;
      continue;
    }

    const parsed = normalizeCurrencyPtBrV1(trimmed);
    if (!parsed.ok) {
      errors.push(fieldError(field.key, parsed.code));
      continue;
    }
    data[field.key] = parsed.value;
  }

  if (errors.length > 0) {
    return { valid: false, data: null, errors };
  }
  return { valid: true, data, errors: [] };
}
