import { Controller, Get, Module, Req, Res } from '@nestjs/common';
import { SkipThrottle } from '@nestjs/throttler';
import type { Request, Response } from 'express';
import { Public } from '../../common/auth/auth.decorators';
import { DomainError } from '../../common/errors/domain-error';
import { PrismaService } from '../../common/prisma/prisma.service';
import { RedisService } from '../../common/redis/redis.service';
import { MetricsService } from './metrics.service';
import { isPrivateIp } from './private-ip';

@Public()
@SkipThrottle({ global: true })
@Controller()
export class OpsController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly redis: RedisService,
    private readonly metrics: MetricsService,
  ) {}

  @Get('healthz')
  healthz(): { status: 'ok' } {
    return { status: 'ok' };
  }

  @Get('readyz')
  async readyz(@Res({ passthrough: true }) res: Response): Promise<{ status: string; db: boolean; redis: boolean }> {
    const [db, redis] = await Promise.all([
      this.prisma.$queryRaw`SELECT 1`.then(
        () => true,
        () => false,
      ),
      this.redis.ping(),
    ]);
    const ok = db && redis;
    res.status(ok ? 200 : 503);
    return { status: ok ? 'ok' : 'fail', db, redis };
  }

  /** Internal network only: both the socket peer and the resolved client IP must be private. */
  @Get('metrics')
  async metricsEndpoint(@Req() req: Request, @Res() res: Response): Promise<void> {
    if (!isPrivateIp(req.socket.remoteAddress) || !isPrivateIp(req.ip)) throw new DomainError('FORBIDDEN');
    res.setHeader('Content-Type', this.metrics.registry.contentType);
    res.send(await this.metrics.registry.metrics());
  }
}

@Module({ controllers: [OpsController], providers: [MetricsService], exports: [MetricsService] })
export class OpsModule {}
