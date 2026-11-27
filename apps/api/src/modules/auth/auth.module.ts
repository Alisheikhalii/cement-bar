import { Module } from '@nestjs/common';
import { AuthController } from './auth.controller';
import { AuthGuard } from './auth.guard';
import { AuthService } from './auth.service';
import { PasswordService } from './password.service';
import { RegisterDriverService } from './register-driver.service';
import { SessionService } from './session.service';
import { TokenService } from './token.service';
import { UserLookupService } from './user-lookup.service';

@Module({
  controllers: [AuthController],
  providers: [
    AuthService,
    AuthGuard,
    PasswordService,
    RegisterDriverService,
    SessionService,
    TokenService,
    UserLookupService,
  ],
  exports: [AuthGuard, PasswordService, SessionService, TokenService],
})
export class AuthModule {}
