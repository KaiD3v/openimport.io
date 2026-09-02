export const TemplateFieldType = {
  String: 'string',
  Integer: 'integer',
  Currency: 'currency',
} as const;

export type TemplateFieldType =
  (typeof TemplateFieldType)[keyof typeof TemplateFieldType];
