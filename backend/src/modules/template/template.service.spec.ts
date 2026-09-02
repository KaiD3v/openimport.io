import { ConflictException, NotFoundException } from '@nestjs/common';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { TemplateFieldType } from './template-field-type.js';
import { TemplateRepository } from './template.repository.js';
import { TemplateService } from './template.service.js';

const organizationId = '11111111-1111-1111-1111-111111111111';
const otherOrganizationId = '22222222-2222-2222-2222-222222222222';

const createDto = {
  name: 'products',
  fields: [
    {
      key: 'sku',
      label: 'SKU',
      type: TemplateFieldType.String,
      required: true,
    },
    {
      key: 'priceInCents',
      label: 'Preço',
      type: TemplateFieldType.Currency,
      required: true,
    },
  ],
};

const persisted = {
  id: 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',
  organizationId,
  name: 'products',
  createdAt: new Date('2026-09-02T12:00:00.000Z'),
  updatedAt: new Date('2026-09-02T12:00:00.000Z'),
  fields: [
    {
      id: 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb',
      templateId: 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',
      key: 'sku',
      label: 'SKU',
      type: TemplateFieldType.String,
      required: true,
      position: 0,
    },
    {
      id: 'cccccccc-cccc-cccc-cccc-cccccccccccc',
      templateId: 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',
      key: 'priceInCents',
      label: 'Preço',
      type: TemplateFieldType.Currency,
      required: true,
      position: 1,
    },
  ],
};

describe('TemplateService', () => {
  let service: TemplateService;
  let repository: {
    create: ReturnType<typeof vi.fn>;
    findByIdForOrganization: ReturnType<typeof vi.fn>;
  };

  beforeEach(() => {
    repository = {
      create: vi.fn(),
      findByIdForOrganization: vi.fn(),
    };
    service = new TemplateService(
      repository as unknown as TemplateRepository,
    );
  });

  it('creates a template scoped to the authenticated organization and assigns field positions', async () => {
    repository.create.mockResolvedValue(persisted);

    const result = await service.create(organizationId, createDto);

    expect(repository.create).toHaveBeenCalledWith(organizationId, {
      name: 'products',
      fields: [
        {
          key: 'sku',
          label: 'SKU',
          type: TemplateFieldType.String,
          required: true,
          position: 0,
        },
        {
          key: 'priceInCents',
          label: 'Preço',
          type: TemplateFieldType.Currency,
          required: true,
          position: 1,
        },
      ],
    });
    expect(result).toEqual({
      id: persisted.id,
      name: 'products',
      fields: [
        {
          key: 'sku',
          label: 'SKU',
          type: 'string',
          required: true,
          position: 0,
        },
        {
          key: 'priceInCents',
          label: 'Preço',
          type: 'currency',
          required: true,
          position: 1,
        },
      ],
      createdAt: '2026-09-02T12:00:00.000Z',
      updatedAt: '2026-09-02T12:00:00.000Z',
    });
    expect(result).not.toHaveProperty('organizationId');
  });

  it('converts a unique name violation into a conflict', async () => {
    repository.create.mockRejectedValue({
      code: 'P2002',
      meta: { target: ['organization_id', 'name'] },
    });

    await expect(service.create(organizationId, createDto)).rejects.toBeInstanceOf(
      ConflictException,
    );
  });

  it('queries by template id and organization id together', async () => {
    repository.findByIdForOrganization.mockResolvedValue(persisted);

    const result = await service.findById(organizationId, persisted.id);

    expect(repository.findByIdForOrganization).toHaveBeenCalledWith(
      organizationId,
      persisted.id,
    );
    expect(result.id).toBe(persisted.id);
  });

  it('does not look up a template by id alone when scoping by organization', async () => {
    repository.findByIdForOrganization.mockResolvedValue(null);

    await expect(
      service.findById(otherOrganizationId, persisted.id),
    ).rejects.toBeInstanceOf(NotFoundException);

    expect(repository.findByIdForOrganization).toHaveBeenCalledWith(
      otherOrganizationId,
      persisted.id,
    );
    expect(repository.findByIdForOrganization).not.toHaveBeenCalledWith(
      persisted.id,
    );
  });
});
