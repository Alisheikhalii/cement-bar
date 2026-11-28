import { Body, Controller, Get, HttpCode, Param, Post, Query, Res } from '@nestjs/common';
import type { Response } from 'express';
import { PERMIT_COLUMNS, PERMIT_VIEWS, permitActionSchema, permitReturnSchema, type PermitView } from '@cb/shared';
import { CurrentUser, Roles, type AuthUser } from '../../common/auth/auth.decorators';
import { DomainError } from '../../common/errors/domain-error';
import { parseListQuery } from '../../common/list/list-query';
import { respondList } from '../../common/list/list-response';
import { parseWith } from '../../common/validation/zod';
import { isPermitAction } from './permit-state';
import { CarrierPermitsService, type PermitActionResult } from './permits.service';

export function parseView(raw: unknown): PermitView | undefined {
  if (raw === undefined || raw === '') return undefined;
  if (typeof raw !== 'string' || !(PERMIT_VIEWS as readonly string[]).includes(raw)) {
    throw new DomainError('VALIDATION_FAILED', { issues: [{ path: 'view', message: 'active|archived' }] });
  }
  return raw as PermitView;
}

/** /carrier/permits (US-B9): list + operational actions. Manual permit (POST /manual) is not in P2. */
@Roles('CARRIER_OPERATOR')
@Controller('carrier/permits')
export class CarrierPermitsController {
  constructor(private readonly permits: CarrierPermitsService) {}

  /** `?view=active|archived` (source spec §4.6). */
  @Get()
  async list(@CurrentUser() user: AuthUser, @Query() query: Record<string, unknown>, @Res({ passthrough: true }) res: Response) {
    const parsed = parseListQuery(query, PERMIT_COLUMNS, { allowParams: ['view'] });
    const { rows, total } = await this.permits.list(user, parsed, parseView(query.view));
    return respondList(res, parsed, PERMIT_COLUMNS, rows, total, 'permits');
  }

  /** POST /carrier/permits/:id/{arrive|load|exit|no-show|return} */
  @Post(':id/:action')
  @HttpCode(200)
  act(@CurrentUser() user: AuthUser, @Param('id') id: string, @Param('action') action: string, @Body() body: unknown): Promise<PermitActionResult> {
    if (!isPermitAction(action)) throw new DomainError('NOT_FOUND');
    if (action === 'return') {
      const { reason } = parseWith(permitReturnSchema, body ?? {});
      return this.permits.act(user, id, action, reason);
    }
    const { note } = parseWith(permitActionSchema, body ?? {});
    return this.permits.act(user, id, action, note);
  }
}
