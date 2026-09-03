export type MappingPair = {
  columnPosition: number;
  fieldKey: string;
};

export type TemplateFieldForMapping = {
  key: string;
  required: boolean;
  position: number;
};

export type ColumnForMapping = {
  position: number;
};

export type MappingView = {
  mappings: MappingPair[];
  isComplete: boolean;
  missingRequiredFields: string[];
};

export class MappingValidationError extends Error {
  readonly code = 'IMPORT.MAPPING_INVALID';

  constructor(message: string) {
    super(message);
    this.name = 'MappingValidationError';
  }
}

function sortByTemplateFieldOrder(
  mappings: MappingPair[],
  fieldsByKey: Map<string, TemplateFieldForMapping>,
): MappingPair[] {
  return [...mappings].sort((left, right) => {
    const leftPosition = fieldsByKey.get(left.fieldKey)?.position ?? 0;
    const rightPosition = fieldsByKey.get(right.fieldKey)?.position ?? 0;
    if (leftPosition !== rightPosition) {
      return leftPosition - rightPosition;
    }
    return left.columnPosition - right.columnPosition;
  });
}

export function canonicalizeMapping(
  mappings: MappingPair[],
  templateFields: TemplateFieldForMapping[],
  columns: ColumnForMapping[],
): MappingView {
  const fieldsByKey = new Map(
    templateFields.map((field) => [field.key, field]),
  );
  const columnPositions = new Set(columns.map((column) => column.position));
  const seenColumns = new Set<number>();
  const seenFields = new Set<string>();

  for (const mapping of mappings) {
    if (!Number.isInteger(mapping.columnPosition) || mapping.columnPosition < 0) {
      throw new MappingValidationError(
        'columnPosition must be a non-negative integer.',
      );
    }
    if (!columnPositions.has(mapping.columnPosition)) {
      throw new MappingValidationError(
        `Column position ${mapping.columnPosition} does not exist on this import session.`,
      );
    }
    if (!fieldsByKey.has(mapping.fieldKey)) {
      throw new MappingValidationError(
        `Field key "${mapping.fieldKey}" is not part of this session template.`,
      );
    }
    if (seenColumns.has(mapping.columnPosition)) {
      throw new MappingValidationError(
        `Column position ${mapping.columnPosition} is mapped more than once.`,
      );
    }
    if (seenFields.has(mapping.fieldKey)) {
      throw new MappingValidationError(
        `Field key "${mapping.fieldKey}" is mapped more than once.`,
      );
    }
    seenColumns.add(mapping.columnPosition);
    seenFields.add(mapping.fieldKey);
  }

  const orderedMappings = sortByTemplateFieldOrder(mappings, fieldsByKey);
  const missingRequiredFields = templateFields
    .filter((field) => field.required && !seenFields.has(field.key))
    .sort((left, right) => left.position - right.position)
    .map((field) => field.key);

  return {
    mappings: orderedMappings,
    isComplete:
      orderedMappings.length > 0 && missingRequiredFields.length === 0,
    missingRequiredFields,
  };
}

export function parseStoredMapping(value: unknown): MappingPair[] {
  if (!Array.isArray(value)) {
    return [];
  }

  const pairs: MappingPair[] = [];
  for (const item of value) {
    if (
      typeof item !== 'object' ||
      item === null ||
      typeof (item as { columnPosition?: unknown }).columnPosition !==
        'number' ||
      typeof (item as { fieldKey?: unknown }).fieldKey !== 'string'
    ) {
      continue;
    }
    pairs.push({
      columnPosition: (item as MappingPair).columnPosition,
      fieldKey: (item as MappingPair).fieldKey,
    });
  }
  return pairs;
}

export function areMappingsSemanticallyEqual(
  left: MappingPair[],
  right: MappingPair[],
): boolean {
  if (left.length !== right.length) {
    return false;
  }

  const normalize = (pairs: MappingPair[]) =>
    [...pairs]
      .map((pair) => `${pair.fieldKey}:${pair.columnPosition}`)
      .sort((a, b) => a.localeCompare(b));

  const leftKeys = normalize(left);
  const rightKeys = normalize(right);
  return leftKeys.every((key, index) => key === rightKeys[index]);
}

export function buildMappingView(
  storedMappings: MappingPair[],
  templateFields: TemplateFieldForMapping[],
  columns: ColumnForMapping[],
): MappingView {
  return canonicalizeMapping(storedMappings, templateFields, columns);
}
