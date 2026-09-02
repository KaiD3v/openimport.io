import { TemplateFieldType } from './template-field-type.js';

export type TemplateFieldRecord = {
  key: string;
  label: string;
  type: TemplateFieldType;
  required: boolean;
  position: number;
};

export type ImportTemplateRecord = {
  id: string;
  organizationId: string;
  name: string;
  createdAt: Date;
  updatedAt: Date;
  fields: TemplateFieldRecord[];
};

export type CreateTemplateData = {
  name: string;
  fields: Array<{
    key: string;
    label: string;
    type: TemplateFieldType;
    required: boolean;
    position: number;
  }>;
};
