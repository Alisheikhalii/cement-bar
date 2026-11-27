import 'reflect-metadata';
import { Logger as NestLogger } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { Logger } from 'nestjs-pino';
import { AppModule } from './app.module';
import { loadConfig, loadDotEnv } from './config/app-config';
import { configureApp } from './configure-app';

async function startWorker(): Promise<void> {
  // Placeholder (WORKER=1): BullMQ processors (window ticks, allocation, hall-day lifecycle) land in later phases.
  const ctx = await NestFactory.createApplicationContext(AppModule, { bufferLogs: true });
  ctx.useLogger(ctx.get(Logger));
  ctx.enableShutdownHooks();
  new NestLogger('Worker').log('worker started (no job processors registered yet)');
}

async function startApi(port: number): Promise<void> {
  const app = await NestFactory.create<NestExpressApplication>(AppModule, { bodyParser: false, bufferLogs: true });
  app.useLogger(app.get(Logger));
  configureApp(app);
  await app.listen(port);
  new NestLogger('Bootstrap').log(`API listening on :${port}`);
}

async function bootstrap(): Promise<void> {
  loadDotEnv();
  const config = loadConfig();
  if (config.worker) await startWorker();
  else await startApi(config.port);
}

bootstrap().catch((err: unknown) => {
  console.error('Fatal bootstrap error', err instanceof Error ? err.message : err);
  process.exit(1);
});
