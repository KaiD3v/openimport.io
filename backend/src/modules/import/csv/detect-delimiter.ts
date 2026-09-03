import { CsvParseError } from './csv-parser.js';

function countUnquotedDelimiter(line: string, delimiter: ',' | ';'): number {
  let count = 0;
  let inQuotes = false;

  for (let index = 0; index < line.length; index += 1) {
    const char = line[index];
    if (char === '"') {
      const next = line[index + 1];
      if (inQuotes && next === '"') {
        index += 1;
        continue;
      }
      inQuotes = !inQuotes;
      continue;
    }
    if (!inQuotes && char === delimiter) {
      count += 1;
    }
  }

  return count;
}

export function detectDelimiter(headerLine: string): ',' | ';' {
  const commas = countUnquotedDelimiter(headerLine, ',');
  const semicolons = countUnquotedDelimiter(headerLine, ';');

  if (commas > 0 && semicolons > 0) {
    throw new CsvParseError('CSV delimiter is ambiguous between comma and semicolon.');
  }

  if (commas === 0 && semicolons === 0) {
    return ',';
  }

  return commas > semicolons ? ',' : ';';
}
