import { Controller, Get, Module } from '@nestjs/common';
import { CurrentUser, Roles, type AuthUser } from '../../common/auth/auth.decorators';
import { ClockService } from '../../common/clock/clock.service';

interface Pong {
  ok: true;
  role: AuthUser['role'];
  at: string;
}

/** Minimal role-gated endpoints used by the role-matrix tests until real panels exist. */
@Roles('FACTORY_OPERATOR')
@Controller('factory')
export class FactoryPingController {
  constructor(private readonly clock: ClockService) {}

  @Get('ping')
  ping(@CurrentUser() user: AuthUser): Pong {
    return { ok: true, role: user.role, at: this.clock.now().toISOString() };
  }
}

@Roles('CARRIER_OPERATOR')
@Controller('carrier')
export class CarrierPingController {
  constructor(private readonly clock: ClockService) {}

  @Get('ping')
  ping(@CurrentUser() user: AuthUser): Pong {
    return { ok: true, role: user.role, at: this.clock.now().toISOString() };
  }
}

@Roles('DRIVER')
@Controller('driver')
export class DriverPingController {
  constructor(private readonly clock: ClockService) {}

  @Get('ping')
  ping(@CurrentUser() user: AuthUser): Pong {
    return { ok: true, role: user.role, at: this.clock.now().toISOString() };
  }
}

@Module({ controllers: [FactoryPingController, CarrierPingController, DriverPingController] })
export class PingModule {}
