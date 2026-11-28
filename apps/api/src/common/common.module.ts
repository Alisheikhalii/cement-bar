import { Global, Module } from '@nestjs/common';
import { APP_CONFIG, loadConfig, type AppConfig } from '../config/app-config';
import { ClockService } from './clock/clock.service';
import { FieldCrypto } from './crypto/field-crypto';
import { PrismaService } from './prisma/prisma.service';
import { QuotaService } from './quota/quota.service';
import { RedisService } from './redis/redis.service';

@Global()
@Module({
  providers: [
    { provide: APP_CONFIG, useFactory: (): AppConfig => loadConfig() },
    ClockService,
    PrismaService,
    RedisService,
    QuotaService,
    {
      provide: FieldCrypto,
      inject: [APP_CONFIG],
      useFactory: (c: AppConfig): FieldCrypto => new FieldCrypto(c.fieldEncryptionKey, c.fieldHashKey),
    },
  ],
  exports: [APP_CONFIG, ClockService, PrismaService, RedisService, FieldCrypto, QuotaService],
})
export class CommonModule {}
