import { Controller, Get } from '@nestjs/common';
import { Public } from '../common/decorators';
import { AppError } from '../common/errors';
import { DatabaseService } from '../database/database.service';

@Controller()
export class HealthController {
  constructor(private readonly db: DatabaseService) {}

  /**
   * EP-20: `200 { "status": "ok" }`. The probe also touches the database so a
   * backend that lost its datastore is not reported as healthy; the failure is
   * rendered through the standard error envelope (RF-16).
   */
  @Public()
  @Get('health')
  async health(): Promise<{ status: string }> {
    try {
      await this.db.query('SELECT 1');
    } catch {
      throw new AppError('internal_error', 'Database unavailable', 503);
    }
    return { status: 'ok' };
  }
}
