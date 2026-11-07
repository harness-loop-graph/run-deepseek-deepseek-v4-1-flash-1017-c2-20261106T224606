import { Body, Controller, Get, Param, Patch, Post, Put, Query } from '@nestjs/common';
import { z } from 'zod';
import { AdminService } from './admin.service';
import { AvailabilityService } from '../availability/availability.service';
import { AccessService } from '../common/access.service';
import { AuditService } from '../audit/audit.service';
import { CurrentUser } from '../common/current-user.decorator';
import type { AuthContext } from '../common/auth-context';
import { Roles } from '../common/decorators';
import { notFound } from '../common/errors';
import { emptyQuerySchema } from '../common/schemas';
import {
  dateOnlySchema,
  emailSchema,
  idSchema,
  isoDateTimeSchema,
  parseWithSchema,
  roleSchema,
} from '../common/validation';

const pageQuerySchema = z
  .object({
    page: z.coerce.number().int().min(1).max(10_000).optional(),
    pageSize: z.coerce.number().int().min(1).max(100).optional(),
  })
  .strict();

const idParamSchema = z.object({ id: idSchema }).strict();

const createUserSchema = z
  .object({
    email: emailSchema,
    roles: z.array(roleSchema).min(1).max(4),
  })
  .strict();

const updateRolesSchema = z
  .object({ roles: z.array(roleSchema).min(1).max(4) })
  .strict();

const availabilitySlotSchema = z
  .object({ start: isoDateTimeSchema, end: isoDateTimeSchema })
  .strict();

const replaceAvailabilitySchema = z
  .object({ slots: z.array(availabilitySlotSchema).max(500) })
  .strict();

const auditQuerySchema = z
  .object({
    actor: z.string().min(1).max(255).optional(),
    action: z.string().min(1).max(120).optional(),
    from: dateOnlySchema.optional(),
    to: dateOnlySchema.optional(),
    page: z.coerce.number().int().min(1).max(10_000).optional(),
    pageSize: z.coerce.number().int().min(1).max(100).optional(),
  })
  .strict();

@Controller('admin')
@Roles('admin')
export class AdminController {
  constructor(
    private readonly admin: AdminService,
    private readonly availability: AvailabilityService,
    private readonly access: AccessService,
    private readonly audit: AuditService,
  ) {}

  @Get('users')
  async listUsers(@Query() query: Record<string, unknown>): Promise<unknown> {
    const data = parseWithSchema(pageQuerySchema, query);
    return this.admin.listUsers(data.page ?? 1, data.pageSize ?? 20);
  }

  @Post('users')
  async createUser(
    @Body() body: Record<string, unknown>,
    @Query() query: Record<string, unknown>,
    @CurrentUser() user: AuthContext,
  ): Promise<unknown> {
    parseWithSchema(emptyQuerySchema, query);
    const data = parseWithSchema(createUserSchema, body);
    return this.admin.createUser(user.userId, data.email, data.roles);
  }

  @Patch('users/:id/roles')
  async updateRoles(
    @Param() params: Record<string, string>,
    @Body() body: Record<string, unknown>,
    @Query() query: Record<string, unknown>,
    @CurrentUser() user: AuthContext,
  ): Promise<unknown> {
    parseWithSchema(emptyQuerySchema, query);
    const { id } = parseWithSchema(idParamSchema, params);
    const data = parseWithSchema(updateRolesSchema, body);
    return this.admin.updateRoles(user.userId, id, data.roles);
  }

  @Get('professionals')
  async listProfessionals(@Query() query: Record<string, unknown>): Promise<unknown> {
    parseWithSchema(emptyQuerySchema, query);
    return this.access.listProfessionals();
  }

  @Get('professionals/:id/availability')
  async getAvailability(
    @Param() params: Record<string, string>,
    @Query() query: Record<string, unknown>,
  ): Promise<unknown> {
    parseWithSchema(emptyQuerySchema, query);
    const { id } = parseWithSchema(idParamSchema, params);
    const exists = await this.access.professionalExists(id);
    if (!exists) {
      throw notFound('Professional not found');
    }
    return this.availability.listAvailability(id);
  }

  @Put('professionals/:id/availability')
  async replaceAvailability(
    @Param() params: Record<string, string>,
    @Body() body: Record<string, unknown>,
    @Query() query: Record<string, unknown>,
    @CurrentUser() user: AuthContext,
  ): Promise<unknown> {
    parseWithSchema(emptyQuerySchema, query);
    const { id } = parseWithSchema(idParamSchema, params);
    const data = parseWithSchema(replaceAvailabilitySchema, body);
    const exists = await this.access.professionalExists(id);
    if (!exists) {
      throw notFound('Professional not found');
    }
    const slots = await this.availability.replaceAvailability(id, data.slots);
    await this.audit.record({
      actorId: user.userId,
      action: 'availability_replaced',
      resourceType: 'disponibilidad',
      resourceId: id,
      detail: { slots: slots.length },
    });
    return { professionalId: id, slots };
  }

  @Get('audit')
  async listAudit(@Query() query: Record<string, unknown>): Promise<unknown> {
    const data = parseWithSchema(auditQuerySchema, query);
    return this.audit.list({
      actor: data.actor,
      action: data.action,
      from: data.from,
      to: data.to,
      page: data.page ?? 1,
      pageSize: data.pageSize ?? 20,
    });
  }
}
