import 'reflect-metadata';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { Test } from '@nestjs/testing';
import { AppModule } from '../../src/app.module';
import { ClockService, FakeClock } from '../../src/common/clock/clock.service';
import { FieldCrypto } from '../../src/common/crypto/field-crypto';
import { PrismaService } from '../../src/common/prisma/prisma.service';
import { RedisService } from '../../src/common/redis/redis.service';
import { configureApp } from '../../src/configure-app';

export interface TestApp {
  app: NestExpressApplication;
  clock: FakeClock;
  prisma: PrismaService;
  redis: RedisService;
  crypto: FieldCrypto;
  close: () => Promise<void>;
}

export async function createTestApp(): Promise<TestApp> {
  // FakeClock starts at real "now" so Redis TTLs and DB timestamps stay coherent.
  const clock = new FakeClock(new Date());
  const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
    .overrideProvider(ClockService)
    .useValue(clock)
    .compile();
  const app = moduleRef.createNestApplication<NestExpressApplication>({ bodyParser: false, logger: false });
  configureApp(app);
  await app.init();
  return {
    app,
    clock,
    prisma: app.get(PrismaService),
    redis: app.get(RedisService),
    crypto: app.get(FieldCrypto),
    close: () => app.close(),
  };
}

let ipCounter = 0;
/** Unique fake client IP per call so per-IP rate limits never collide between tests. */
export function freshIp(): string {
  ipCounter += 1;
  const r = Math.floor(Math.random() * 200) + 1;
  return `10.${r}.${Math.floor(ipCounter / 250) % 250}.${(ipCounter % 250) + 1}`;
}
