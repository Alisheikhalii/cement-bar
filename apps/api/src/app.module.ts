import { Module } from '@nestjs/common';
import { APP_FILTER, APP_GUARD } from '@nestjs/core';
import { ThrottlerGuard } from '@nestjs/throttler';
import { LoggerModule } from 'nestjs-pino';
import { loadConfig } from './config/app-config';
import { CsrfGuard } from './common/auth/csrf.guard';
import { RolesGuard } from './common/auth/roles.guard';
import { CommonModule } from './common/common.module';
import { AllExceptionsFilter } from './common/errors/all-exceptions.filter';
import { loggerParams } from './common/logging/logger.config';
import { AnnouncementsModule } from './modules/announcements/announcements.module';
import { AuditModule } from './modules/audit/audit.service';
import { AuthGuard } from './modules/auth/auth.guard';
import { AuthModule } from './modules/auth/auth.module';
import { CarrierModule } from './modules/carrier/carrier.module';
import { DriverModule } from './modules/driver/driver.module';
import { FactoryModule } from './modules/factory/factory.module';
import { OpsModule } from './modules/ops/ops.module';
import { PingModule } from './modules/ping/ping.module';
import { PublicModule } from './modules/public/public.module';
import { QueueModule } from './modules/queue/queue.module';
import { RealtimeModule } from './modules/realtime/realtime.module';
import { RateLimitModule } from './modules/throttle/rate-limit.module';
import { UserRateLimitGuard } from './modules/throttle/user-rate-limit.guard';
import { ReportsModule } from './modules/reports/reports.module';

@Module({
  imports: [
    LoggerModule.forRootAsync({
      useFactory: () => {
        const c = loadConfig();
        return loggerParams(c.logLevel, c.nodeEnv === 'development');
      },
    }),
    CommonModule,
    AuditModule,
    RateLimitModule,
    AuthModule,
    PublicModule,
    OpsModule,
    PingModule,
    // Phase 2 vertical slices
    FactoryModule,
    AnnouncementsModule,
    CarrierModule,
    ReportsModule,
    DriverModule,
    // Phase 3 queue engine + realtime
    RealtimeModule,
    QueueModule,
  ],
  providers: [
    { provide: APP_FILTER, useClass: AllExceptionsFilter },
    // Order matters: IP rate limit → authentication → per-driver rate limit → CSRF → roles.
    { provide: APP_GUARD, useClass: ThrottlerGuard },
    { provide: APP_GUARD, useClass: AuthGuard },
    { provide: APP_GUARD, useClass: UserRateLimitGuard },
    { provide: APP_GUARD, useClass: CsrfGuard },
    { provide: APP_GUARD, useClass: RolesGuard },
  ],
})
export class AppModule {}
