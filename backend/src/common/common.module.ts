import { Global, Module } from '@nestjs/common';
import { AccessService } from './access.service';
import { RateLimitService } from './rate-limit.service';
import { TokenService } from './token.service';

/**
 * Cross-cutting providers shared by every feature module: token lookup,
 * resource ownership checks and rate limiting buckets.
 */
@Global()
@Module({
  providers: [AccessService, TokenService, RateLimitService],
  exports: [AccessService, TokenService, RateLimitService],
})
export class CommonModule {}
