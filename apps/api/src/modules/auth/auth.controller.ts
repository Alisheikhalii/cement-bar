import { Body, Controller, Get, HttpCode, Inject, Post, Req, Res } from '@nestjs/common';
import type { Request, Response } from 'express';
import {
  changePasswordSchema,
  loginSchema,
  registerDriverSchema,
  type LoginInput,
  type MeResponse,
  type RegisterDriverInput,
} from '@cb/shared';
import type { z } from 'zod';
import { APP_CONFIG, type AppConfig } from '../../config/app-config';
import {
  CurrentUser,
  Public,
  RateLimitBucket,
  SkipCsrf,
  type AuthUser,
} from '../../common/auth/auth.decorators';
import { ZodPipe } from '../../common/validation/zod';
import { clearAuthCookies, cookieNames, readCookie, setAuthCookies } from './auth.cookies';
import { AuthService } from './auth.service';
import { RegisterDriverService } from './register-driver.service';

type ChangePasswordInput = z.infer<typeof changePasswordSchema>;

@Controller('auth')
export class AuthController {
  constructor(
    private readonly auth: AuthService,
    private readonly registration: RegisterDriverService,
    @Inject(APP_CONFIG) private readonly config: AppConfig,
  ) {}

  @Public()
  @SkipCsrf()
  @RateLimitBucket('login')
  @Post('login')
  @HttpCode(200)
  async login(
    @Body(new ZodPipe(loginSchema)) body: LoginInput,
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ): Promise<MeResponse> {
    const result = await this.auth.login(body, req.ip);
    setAuthCookies(res, this.config, result.tokens);
    return result.me;
  }

  @Public()
  @SkipCsrf()
  @Post('refresh')
  @HttpCode(204)
  async refresh(@Req() req: Request, @Res({ passthrough: true }) res: Response): Promise<void> {
    const token = readCookie(req, cookieNames(this.config).refresh);
    try {
      const tokens = await this.auth.refresh(token, req.ip);
      setAuthCookies(res, this.config, tokens);
    } catch (e) {
      clearAuthCookies(res, this.config);
      throw e;
    }
  }

  /** Public so an expired access token can still log out; CSRF token is still required. */
  @Public()
  @Post('logout')
  @HttpCode(204)
  async logout(@Req() req: Request, @Res({ passthrough: true }) res: Response): Promise<void> {
    const names = cookieNames(this.config);
    await this.auth.logout(readCookie(req, names.access), readCookie(req, names.refresh));
    clearAuthCookies(res, this.config);
  }

  @Get('me')
  me(@CurrentUser() user: AuthUser): Promise<MeResponse> {
    return this.auth.me(user);
  }

  @Post('change-password')
  @HttpCode(204)
  async changePassword(
    @CurrentUser() user: AuthUser,
    @Body(new ZodPipe(changePasswordSchema)) body: ChangePasswordInput,
  ): Promise<void> {
    await this.auth.changePassword(user, body.currentPassword, body.newPassword);
  }

  @Public()
  @SkipCsrf()
  @RateLimitBucket('register')
  @Post('register-driver')
  @HttpCode(201)
  register(
    @Body(new ZodPipe(registerDriverSchema)) body: RegisterDriverInput,
  ): Promise<{ id: string; status: 'PENDING' }> {
    return this.registration.register(body);
  }
}
