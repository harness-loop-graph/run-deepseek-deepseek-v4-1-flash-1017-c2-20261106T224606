import { Module } from '@nestjs/common';
import { APP_FILTER, APP_GUARD } from '@nestjs/core';
import { AppConfigModule } from './config/app-config.module';
import { DatabaseModule } from './database/database.module';
import { AuditModule } from './audit/audit.module';
import { CommonModule } from './common/common.module';
import { AuthModule } from './auth/auth.module';
import { AvailabilityModule } from './availability/availability.module';
import { AppointmentsModule } from './appointments/appointments.module';
import { EncountersModule } from './encounters/encounters.module';
import { AttachmentsModule } from './attachments/attachments.module';
import { AdminModule } from './admin/admin.module';
import { HealthModule } from './health/health.module';
import { AuthGuard } from './common/auth.guard';
import { AllExceptionsFilter } from './common/all-exceptions.filter';

@Module({
  imports: [
    AppConfigModule,
    DatabaseModule,
    AuditModule,
    CommonModule,
    AuthModule,
    AvailabilityModule,
    AppointmentsModule,
    EncountersModule,
    AttachmentsModule,
    AdminModule,
    HealthModule,
  ],
  providers: [
    { provide: APP_GUARD, useClass: AuthGuard },
    { provide: APP_FILTER, useClass: AllExceptionsFilter },
  ],
})
export class AppModule {}
