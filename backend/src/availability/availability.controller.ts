import { Controller, Get, Query } from '@nestjs/common';
import { z } from 'zod';
import { AvailabilityService } from './availability.service';
import { AccessService } from '../common/access.service';
import { Roles } from '../common/decorators';
import { notFound } from '../common/errors';
import { dateOnlySchema, parseWithSchema } from '../common/validation';

const availabilityQuerySchema = z
  .object({
    professionalId: z.coerce.number().int().positive(),
    from: dateOnlySchema,
    to: dateOnlySchema,
  })
  .strict();

@Controller('availability')
export class AvailabilityController {
  constructor(
    private readonly availability: AvailabilityService,
    private readonly access: AccessService,
  ) {}

  @Get()
  @Roles('patient', 'staff')
  async list(@Query() query: Record<string, unknown>): Promise<unknown> {
    const data = parseWithSchema(availabilityQuerySchema, query);
    const exists = await this.access.professionalExists(data.professionalId);
    if (!exists) {
      throw notFound('Professional not found');
    }
    return this.availability.freeSlots(data.professionalId, data.from, data.to);
  }
}
