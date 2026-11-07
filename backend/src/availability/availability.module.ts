import { Module } from '@nestjs/common';
import { AvailabilityController } from './availability.controller';
import { ProfessionalsController } from './professionals.controller';
import { AvailabilityService } from './availability.service';

@Module({
  controllers: [AvailabilityController, ProfessionalsController],
  providers: [AvailabilityService],
  exports: [AvailabilityService],
})
export class AvailabilityModule {}
