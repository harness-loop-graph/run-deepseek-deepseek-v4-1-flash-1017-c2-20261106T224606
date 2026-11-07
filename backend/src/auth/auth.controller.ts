import {
  Body,
  Controller,
  Get,
  HttpCode,
  Inject,
  Post,
  Query,
  Req,
  Res,
} from '@nestjs/common';
import type { Request, Response } from 'express';
import { APP_CONFIG, AppConfig } from '../config/config';
import { AuthService } from './auth.service';
import { Public } from '../common/decorators';
import { AppError, rateLimited, validationError } from '../common/errors';
import { RateLimitService } from '../common/rate-limit.service';
import { parseWithSchema } from '../common/validation';
import {
  authorizeQuerySchema,
  loginBodySchema,
  loginQuerySchema,
  refreshBodySchema,
  revokeBodySchema,
  tokenBodySchema,
} from '../common/schemas';
import { renderLoginPage } from './login-page';

const AUTH_RATE_WINDOW_MS = 60_000;

function clientIp(request: Request): string {
  return request.ip ?? request.socket.remoteAddress ?? 'unknown';
}

/**
 * The authorization login form is submitted by the SPA as JSON (fetch) and by
 * a browser as `application/x-www-form-urlencoded` (EP-01 automation). The
 * JSON variant answers with the issued authorization code so the SPA can run
 * the redirect-back step of the PKCE flow itself (RF-18).
 */
function wantsJson(request: Request): boolean {
  const header = request.headers['content-type'];
  const value = Array.isArray(header) ? header[0] : header;
  return typeof value === 'string' && value.toLowerCase().includes('application/json');
}

@Controller('auth')
export class AuthController {
  constructor(
    @Inject(APP_CONFIG) private readonly config: AppConfig,
    private readonly authService: AuthService,
    private readonly rateLimiter: RateLimitService,
  ) {}

  private rateLimitKey(request: Request): string {
    return `auth:${clientIp(request)}`;
  }

  /**
   * RF-14: five failed authentication attempts per minute and IP. Only
   * failures are counted, so a valid credential is never throttled by an
   * attacker sharing the same address, while guessing is stopped after the
   * fifth failure inside the window.
   */
  private countFailure(request: Request): number | null {
    return this.rateLimiter.consume(
      this.rateLimitKey(request),
      this.config.authRateLimit,
      AUTH_RATE_WINDOW_MS,
    );
  }

  /** Counts a failed attempt and turns an exhausted bucket into a 429. */
  private failOrThrow(request: Request): void {
    const retryAfter = this.countFailure(request);
    if (retryAfter !== null) {
      throw rateLimited(retryAfter);
    }
  }

  private clearFailures(request: Request): void {
    this.rateLimiter.reset(this.rateLimitKey(request));
  }

  @Public()
  @Get('authorize')
  authorize(@Query() query: Record<string, unknown>, @Res() response: Response): void {
    const data = parseWithSchema(authorizeQuerySchema, query);
    this.authService.validateClient(data.client_id, data.redirect_uri);
    const params = new URLSearchParams({
      client_id: data.client_id,
      redirect_uri: data.redirect_uri,
      code_challenge: data.code_challenge,
      state: data.state,
    });
    response.redirect(302, `${this.config.backendPublicUrl}/auth/login?${params.toString()}`);
  }

  @Public()
  @Get('login')
  showLogin(@Query() query: Record<string, unknown>, @Res() response: Response): void {
    const parsed = loginQuerySchema.safeParse(query);
    if (!parsed.success) {
      throw validationError('Invalid authorization request');
    }
    const data = parsed.data;
    this.authService.validateClient(data.client_id, data.redirect_uri);
    response
      .status(200)
      .type('html')
      .setHeader('Cache-Control', 'no-store')
      .setHeader('X-Frame-Options', 'DENY')
      .send(
        renderLoginPage({
          clientId: data.client_id,
          redirectUri: data.redirect_uri,
          codeChallenge: data.code_challenge,
          state: data.state,
        }),
      );
  }

  @Public()
  @Post('login')
  async submitLogin(
    @Body() body: Record<string, unknown>,
    @Req() request: Request,
    @Res() response: Response,
  ): Promise<void> {
    const parsed = loginBodySchema.safeParse(body);
    if (!parsed.success) {
      throw validationError('Invalid login submission');
    }
    const data = parsed.data;
    this.authService.validateClient(data.client_id, data.redirect_uri);

    try {
      const user = await this.authService.authenticate(data.email, data.password);
      const code = await this.authService.createAuthorizationCode(
        user.userId,
        data.client_id,
        data.redirect_uri,
        data.code_challenge,
      );
      this.clearFailures(request);
      if (wantsJson(request)) {
        // SPA variant: the browser keeps the PKCE verifier and performs the
        // redirect-back step itself (RF-18).
        response.status(200).json({ code, state: data.state });
        return;
      }
      const redirect = new URL(data.redirect_uri);
      redirect.searchParams.set('code', code);
      redirect.searchParams.set('state', data.state);
      response.redirect(302, redirect.toString());
    } catch (error) {
      if (error instanceof AppError && error.getStatus() === 401) {
        if (wantsJson(request)) {
          this.failOrThrow(request);
          throw error;
        }
        const retryAfter = this.countFailure(request);
        if (retryAfter !== null) {
          response.setHeader('Retry-After', String(retryAfter));
          response
            .status(429)
            .type('html')
            .setHeader('Cache-Control', 'no-store')
            .send(
              renderLoginPage({
                clientId: data.client_id,
                redirectUri: data.redirect_uri,
                codeChallenge: data.code_challenge,
                state: data.state,
                email: data.email,
                error: 'Too many attempts. Try again in a minute.',
              }),
            );
          return;
        }
        response
          .status(200)
          .type('html')
          .setHeader('Cache-Control', 'no-store')
          .send(
            renderLoginPage({
              clientId: data.client_id,
              redirectUri: data.redirect_uri,
              codeChallenge: data.code_challenge,
              state: data.state,
              email: data.email,
              error: 'Invalid credentials',
            }),
          );
        return;
      }
      throw error;
    }
  }

  @Public()
  @Post('token')
  @HttpCode(200)
  async token(@Body() body: Record<string, unknown>, @Req() request: Request): Promise<unknown> {
    const data = parseWithSchema(tokenBodySchema, body);
    try {
      const tokens = await this.authService.exchangeCode(
        data.code,
        data.code_verifier,
        data.client_id,
        data.redirect_uri,
      );
      this.clearFailures(request);
      return tokens;
    } catch (error) {
      this.failOrThrow(request);
      throw error;
    }
  }

  @Public()
  @Post('token/refresh')
  @HttpCode(200)
  async refresh(@Body() body: Record<string, unknown>, @Req() request: Request): Promise<unknown> {
    const data = parseWithSchema(refreshBodySchema, body);
    try {
      const tokens = await this.authService.refresh(data.refresh_token);
      this.clearFailures(request);
      return tokens;
    } catch (error) {
      this.failOrThrow(request);
      throw error;
    }
  }

  @Public()
  @Post('revoke')
  @HttpCode(204)
  async revoke(@Body() body: Record<string, unknown>, @Req() request: Request): Promise<void> {
    const data = parseWithSchema(revokeBodySchema, body);
    try {
      await this.authService.revoke(data.token);
      this.clearFailures(request);
    } catch (error) {
      this.failOrThrow(request);
      throw error;
    }
  }
}
