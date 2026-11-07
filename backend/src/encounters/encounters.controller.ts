import { Body, Controller, Get, Param, Post, Query } from '@nestjs/common';
import { z } from 'zod';
import { EncountersService } from './encounters.service';
import { AccessService } from '../common/access.service';
import { CurrentUser } from '../common/current-user.decorator';
import type { AuthContext } from '../common/auth-context';
import { Roles } from '../common/decorators';
import { forbidden, notFound } from '../common/errors';
import { parseWithSchema } from '../common/validation';
import { emptyQuerySchema } from '../common/schemas';
import { canReadClinicalHistory, canRecordEncounter } from '../common/policies';
import { AuditService } from '../audit/audit.service';

const idParamSchema = z.object({ id: z.coerce.number().int().positive() }).strict();

const encounterBodySchema = z
  .object({
    notes: z.string().min(1, 'notes is required').max(20_000),
    diagnosis: z.string().min(1, 'diagnosis is required').max(5_000),
  })
  .strict();

@Controller()
export class EncountersController {
  constructor(
    private readonly encounters: EncountersService,
    private readonly access: AccessService,
    private readonly audit: AuditService,
  ) {}

  @Post('appointments/:id/encounter')
  @Roles('professional')
  async record(
    @Param() params: Record<string, string>,
    @Query() query: Record<string, unknown>,
    @Body() body: Record<string, unknown>,
    @CurrentUser() user: AuthContext,
  ): Promise<unknown> {
    parseWithSchema(emptyQuerySchema, query);
    const { id } = parseWithSchema(idParamSchema, params);
    const data = parseWithSchema(encounterBodySchema, body);
    const appointment = await this.access.findAppointment(id);
    if (appointment === null) {
      throw notFound('Appointment not found');
    }
    const actor = {
      userId: user.userId,
      roles: user.roles,
      patientId: null,
      professionalId: await this.access.professionalIdForUser(user.userId),
    };
    if (
      !canRecordEncounter(actor, {
        patientId: appointment.paciente_id,
        professionalId: appointment.profesional_id,
      })
    ) {
      throw forbidden('Only the assigned professional can record this encounter');
    }
    return this.encounters.record(
      user.userId,
      {
        id: appointment.id,
        patientId: appointment.paciente_id,
        professionalId: appointment.profesional_id,
      },
      data.notes,
      data.diagnosis,
    );
  }

  @Get('appointments/:id/encounters')
  @Roles('patient', 'professional')
  async listForAppointment(
    @Param() params: Record<string, string>,
    @Query() query: Record<string, unknown>,
    @CurrentUser() user: AuthContext,
  ): Promise<unknown> {
    parseWithSchema(emptyQuerySchema, query);
    const { id } = parseWithSchema(idParamSchema, params);
    const appointment = await this.access.findAppointment(id);
    if (appointment === null) {
      throw notFound('Appointment not found');
    }
    const actor = {
      userId: user.userId,
      roles: user.roles,
      patientId: await this.access.patientIdForUser(user.userId),
      professionalId: await this.access.professionalIdForUser(user.userId),
    };
    const isOwnPatient = actor.patientId !== null && actor.patientId === appointment.paciente_id;
    const isAssigned =
      actor.professionalId !== null && actor.professionalId === appointment.profesional_id;
    if (!isOwnPatient && !isAssigned) {
      throw forbidden('You are not allowed to read this clinical content');
    }
    await this.audit.record({
      actorId: user.userId,
      action: 'encounter_read',
      resourceType: 'cita',
      resourceId: id,
    });
    return this.encounters.forAppointment(id);
  }

  @Get('patients/:id/clinical-history')
  @Roles('patient', 'professional')
  async clinicalHistory(
    @Param() params: Record<string, string>,
    @Query() query: Record<string, unknown>,
    @CurrentUser() user: AuthContext,
  ): Promise<unknown> {
    parseWithSchema(emptyQuerySchema, query);
    const { id } = parseWithSchema(idParamSchema, params);
    const exists = await this.access.patientExists(id);
    if (!exists) {
      throw notFound('Patient not found');
    }
    const professionalId = await this.access.professionalIdForUser(user.userId);
    const actor = {
      userId: user.userId,
      roles: user.roles,
      patientId: await this.access.patientIdForUser(user.userId),
      professionalId,
    };
    const assigned =
      professionalId !== null ? await this.access.hasAssignedAppointment(professionalId, id) : false;
    if (!canReadClinicalHistory(actor, id, assigned)) {
      throw forbidden('You are not allowed to read this clinical history');
    }
    return this.encounters.clinicalHistory(id, user.userId);
  }

  @Get('professional/patients')
  @Roles('professional')
  async patients(@CurrentUser() user: AuthContext): Promise<unknown> {
    const professionalId = await this.access.professionalIdForUser(user.userId);
    if (professionalId === null) {
      throw forbidden('No professional profile for this account');
    }
    return this.encounters.listPatientsForProfessional(professionalId);
  }
}
