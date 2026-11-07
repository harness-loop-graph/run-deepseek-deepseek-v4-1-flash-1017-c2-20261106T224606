import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Param,
  Post,
  Query,
} from '@nestjs/common';
import { AppointmentsService } from './appointments.service';
import { AccessService } from '../common/access.service';
import { CurrentUser } from '../common/current-user.decorator';
import type { AuthContext } from '../common/auth-context';
import { Roles } from '../common/decorators';
import { forbidden, notFound, rateLimited, unauthorized, validationError } from '../common/errors';
import { parseWithSchema } from '../common/validation';
import {
  agendaQuerySchema,
  bookingBodySchema,
  emptyQuerySchema,
  idParamSchema,
} from '../common/schemas';
import { RateLimitService } from '../common/rate-limit.service';
import { AuditService } from '../audit/audit.service';
import {
  canCancelAppointment,
  canReadAgenda,
  canReadAppointment,
  hasRole,
} from '../common/policies';
import { APP_CONFIG, AppConfig } from '../config/config';
import { Inject } from '@nestjs/common';

const BOOKING_RATE_WINDOW_MS = 60_000;

/** Normalises an ISO-8601 slot start; anything else is a validation error. */
function isoOrDate(value: string): string {
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) {
    throw validationError('slotStart must be an ISO-8601 timestamp');
  }
  return parsed.toISOString();
}

function isoDate(date: Date): string {
  return date.toISOString().slice(0, 10);
}

function defaultAgendaRange(): { from: string; to: string } {
  const from = new Date();
  const to = new Date(from.getTime() + 7 * 24 * 60 * 60 * 1000);
  return { from: isoDate(from), to: isoDate(to) };
}

@Controller()
export class AppointmentsController {
  constructor(
    @Inject(APP_CONFIG) private readonly config: AppConfig,
    private readonly appointments: AppointmentsService,
    private readonly access: AccessService,
    private readonly rateLimiter: RateLimitService,
    private readonly audit: AuditService,
  ) {}

  private async patientId(user: AuthContext): Promise<number> {
    const patientId = await this.access.patientIdForUser(user.userId);
    if (patientId === null) {
      throw forbidden('Only patients have their own appointment list');
    }
    return patientId;
  }

  @Get('me/appointments')
  @Roles('patient')
  async myAppointments(
    @Query() query: Record<string, unknown>,
    @CurrentUser() user: AuthContext,
  ): Promise<unknown> {
    parseWithSchema(emptyQuerySchema, query);
    const patientId = await this.patientId(user);
    return this.appointments.listForPatient(patientId);
  }

  @Post('appointments')
  @Roles('patient')
  async book(
    @Body() body: Record<string, unknown>,
    @CurrentUser() user: AuthContext,
  ): Promise<unknown> {
    const data = parseWithSchema(bookingBodySchema, body);
    const patientId = await this.patientId(user);
    const retryAfter = this.rateLimiter.consume(
      `booking:${user.userId}`,
      this.config.bookingRateLimit,
      BOOKING_RATE_WINDOW_MS,
    );
    if (retryAfter !== null) {
      throw rateLimited(retryAfter);
    }
    const slotStart = isoOrDate(data.slotStart);
    return this.appointments.book(user.userId, patientId, data.professionalId, slotStart);
  }

  @Delete('appointments/:id')
  @HttpCode(204)
  @Roles('patient')
  async cancel(
    @Param() params: Record<string, string>,
    @Query() query: Record<string, unknown>,
    @CurrentUser() user: AuthContext,
  ): Promise<void> {
    parseWithSchema(emptyQuerySchema, query);
    const { id } = parseWithSchema(idParamSchema, params);
    const appointment = await this.appointments.findById(id);
    if (appointment === null) {
      throw notFound('Appointment not found');
    }
    const actor = {
      userId: user.userId,
      roles: user.roles,
      patientId: await this.access.patientIdForUser(user.userId),
      professionalId: null,
    };
    if (!canCancelAppointment(actor, appointment)) {
      throw forbidden('You can only cancel your own appointments');
    }
    await this.appointments.cancel(user.userId, id);
  }

  @Get('appointments/:id')
  @Roles('patient', 'professional', 'staff')
  async detail(
    @Param() params: Record<string, string>,
    @Query() query: Record<string, unknown>,
    @CurrentUser() user: AuthContext,
  ): Promise<unknown> {
    parseWithSchema(emptyQuerySchema, query);
    const { id } = parseWithSchema(idParamSchema, params);
    const appointment = await this.appointments.findById(id);
    if (appointment === null) {
      throw notFound('Appointment not found');
    }
    const actor = {
      userId: user.userId,
      roles: user.roles,
      patientId: await this.access.patientIdForUser(user.userId),
      professionalId: await this.access.professionalIdForUser(user.userId),
    };
    if (!canReadAppointment(actor, appointment)) {
      throw forbidden('You are not allowed to read this appointment');
    }
    await this.audit.record({
      actorId: user.userId,
      action: 'appointment_read',
      resourceType: 'cita',
      resourceId: id,
    });
    return appointment;
  }

  @Get('agenda')
  @Roles('professional', 'staff')
  async agenda(
    @Query() query: Record<string, unknown>,
    @CurrentUser() user: AuthContext,
  ): Promise<unknown> {
    const defaults = defaultAgendaRange();
    // Validate the whole query string first so undeclared parameters are
    // rejected (RF-12); the defaults only fill absent fields.
    const data = parseWithSchema(agendaQuerySchema, query);
    const from = data.from ?? defaults.from;
    const to = data.to ?? defaults.to;
    if (new Date(`${to}T00:00:00.000Z`).getTime() < new Date(`${from}T00:00:00.000Z`).getTime()) {
      throw validationError('to must be on or after from');
    }
    const actor = {
      userId: user.userId,
      roles: user.roles,
      patientId: null,
      professionalId: await this.access.professionalIdForUser(user.userId),
    };
    if (!canReadAgenda(actor)) {
      throw unauthorized();
    }
    if (hasRole(actor, 'professional') && actor.professionalId !== null) {
      return this.appointments.listAgenda(actor.professionalId, from, to);
    }
    if (hasRole(actor, 'staff')) {
      return this.appointments.listAgendaForStaff(from, to);
    }
    throw forbidden('No agenda available for this account');
  }
}
