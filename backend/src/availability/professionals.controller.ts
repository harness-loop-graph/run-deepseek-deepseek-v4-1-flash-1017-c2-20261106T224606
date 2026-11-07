import { Controller, Get, Query } from '@nestjs/common';
import { Roles } from '../common/decorators';
import { AccessService } from '../common/access.service';
import { emptyQuerySchema } from '../common/schemas';
import { parseWithSchema } from '../common/validation';

@Controller('professionals')
export class ProfessionalsController {
  constructor(private readonly access: AccessService) {}

  @Get()
  @Roles('patient', 'professional', 'staff', 'admin')
  async list(
    @Query() query: Record<string, unknown>,
  ): Promise<Array<{ id: number; nombre: string; apellidos: string; especialidad: string }>> {
    parseWithSchema(emptyQuerySchema, query);
    return this.access.listProfessionals();
  }
}
