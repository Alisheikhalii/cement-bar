import { Injectable } from '@nestjs/common';

/** Single source of "now" for business logic. Never call Date.now() in domain code. */
@Injectable()
export class ClockService {
  now(): Date {
    return new Date();
  }
}

/** Deterministic clock for tests. */
export class FakeClock extends ClockService {
  private current: Date;

  constructor(start: Date = new Date('2026-01-01T00:00:00.000Z')) {
    super();
    this.current = new Date(start.getTime());
  }

  override now(): Date {
    return new Date(this.current.getTime());
  }

  set(at: Date): void {
    this.current = new Date(at.getTime());
  }

  advance(ms: number): void {
    this.current = new Date(this.current.getTime() + ms);
  }
}
