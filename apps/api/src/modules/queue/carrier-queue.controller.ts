import { Body, Controller, Delete, Get, HttpCode, Param, Patch, Post, Put, Query } from '@nestjs/common';
import {
  bulkCloseWindowSchema,
  bulkGroupCreateSchema,
  bulkGroupMembersSchema,
  bulkGroupReorderSchema,
  bulkGroupUpdateSchema,
  bulkHaltSchema,
  bulkSettingsSchema,
  bulkStartHeadSchema,
  carrierDecisionSchema,
  manualPermitSchema,
  type BulkGroupCreateInput,
  type BulkGroupMembersInput,
  type BulkGroupReorderInput,
  type BulkGroupUpdateInput,
  type BulkSettingsInput,
  type BulkStartHeadInput,
  type CancelRequestStatus,
  type CarrierBulkGroupDto,
  type CarrierBulkLiveDto,
  type CarrierBulkSettingsDto,
  type CarrierCancelRequestDto,
  type CarrierDecisionInput,
} from '@cb/shared';
import { CurrentUser, Roles, type AuthUser } from '../../common/auth/auth.decorators';
import { DomainError } from '../../common/errors/domain-error';
import { ZodPipe } from '../../common/validation/zod';
import { CarrierBulkService } from './carrier-bulk.service';
import { CarrierCancelService, type ManualPermitInput } from './carrier-cancel.service';

function cancelStatus(v: unknown): CancelRequestStatus | undefined {
  if (v === undefined || v === '') return undefined;
  if (v === 'PENDING' || v === 'APPROVED' || v === 'REJECTED') return v;
  throw new DomainError('VALIDATION_FAILED', { issues: [{ path: 'status', message: 'PENDING|APPROVED|REJECTED' }] });
}

/** Carrier queue endpoints: groups, bulk rotation controls, cancel requests, manual permits. */
@Roles('CARRIER_OPERATOR')
@Controller('carrier')
export class CarrierQueueController {
  constructor(
    private readonly bulk: CarrierBulkService,
    private readonly cancel: CarrierCancelService,
  ) {}

  // ───────── groups ─────────
  @Get('groups')
  groups(@CurrentUser() user: AuthUser): Promise<CarrierBulkGroupDto[]> {
    return this.bulk.groups(user);
  }

  @Post('groups')
  createGroup(
    @CurrentUser() user: AuthUser,
    @Body(new ZodPipe(bulkGroupCreateSchema)) body: BulkGroupCreateInput,
  ): Promise<CarrierBulkGroupDto> {
    return this.bulk.createGroup(user, body);
  }

  @Patch('groups/reorder')
  reorder(@CurrentUser() user: AuthUser, @Body(new ZodPipe(bulkGroupReorderSchema)) body: BulkGroupReorderInput): Promise<CarrierBulkGroupDto[]> {
    return this.bulk.reorderGroups(user, body);
  }

  @Patch('groups/:id')
  updateGroup(
    @CurrentUser() user: AuthUser,
    @Param('id') id: string,
    @Body(new ZodPipe(bulkGroupUpdateSchema)) body: BulkGroupUpdateInput,
  ): Promise<CarrierBulkGroupDto> {
    return this.bulk.updateGroup(user, id, body);
  }

  @Delete('groups/:id')
  deleteGroup(@CurrentUser() user: AuthUser, @Param('id') id: string): Promise<{ id: string }> {
    return this.bulk.deleteGroup(user, id);
  }

  @Put('groups/:id/members')
  setMembers(
    @CurrentUser() user: AuthUser,
    @Param('id') id: string,
    @Body(new ZodPipe(bulkGroupMembersSchema)) body: BulkGroupMembersInput,
  ): Promise<CarrierBulkGroupDto> {
    return this.bulk.setMembers(user, id, body);
  }

  // ───────── bulk rotation ─────────
  @Get('bulk/settings')
  settings(@CurrentUser() user: AuthUser): Promise<CarrierBulkSettingsDto> {
    return this.bulk.settings(user);
  }

  @Put('bulk/settings')
  updateSettings(
    @CurrentUser() user: AuthUser,
    @Body(new ZodPipe(bulkSettingsSchema)) body: BulkSettingsInput,
  ): Promise<CarrierBulkSettingsDto> {
    return this.bulk.updateSettings(user, body);
  }

  @Post('bulk/start-head')
  @HttpCode(200)
  startHead(
    @CurrentUser() user: AuthUser,
    @Body(new ZodPipe(bulkStartHeadSchema)) body: BulkStartHeadInput,
  ): Promise<CarrierBulkSettingsDto> {
    return this.bulk.startHead(user, body);
  }

  @Get('bulk/live')
  live(@CurrentUser() user: AuthUser): Promise<CarrierBulkLiveDto> {
    return this.bulk.live(user);
  }

  @Post('bulk/halt')
  @HttpCode(200)
  halt(@CurrentUser() user: AuthUser, @Body(new ZodPipe(bulkHaltSchema)) body: { reason: string }): Promise<CarrierBulkLiveDto> {
    return this.bulk.halt(user, body.reason);
  }

  @Post('bulk/windows/:id/close')
  @HttpCode(200)
  closeWindow(
    @CurrentUser() user: AuthUser,
    @Param('id') id: string,
    @Body(new ZodPipe(bulkCloseWindowSchema)) body: { reason: string },
  ): Promise<CarrierBulkLiveDto> {
    return this.bulk.closeWindow(user, id, body.reason);
  }

  // ───────── cancel requests ─────────
  @Get('cancel-requests')
  cancelRequests(@CurrentUser() user: AuthUser, @Query('status') status?: string): Promise<CarrierCancelRequestDto[]> {
    return this.cancel.list(user, cancelStatus(status));
  }

  @Post('cancel-requests/:id/approve')
  @HttpCode(200)
  approve(
    @CurrentUser() user: AuthUser,
    @Param('id') id: string,
    @Body(new ZodPipe(carrierDecisionSchema)) body: CarrierDecisionInput,
  ): Promise<CarrierCancelRequestDto> {
    return this.cancel.approve(user, id, body);
  }

  @Post('cancel-requests/:id/reject')
  @HttpCode(200)
  reject(
    @CurrentUser() user: AuthUser,
    @Param('id') id: string,
    @Body(new ZodPipe(carrierDecisionSchema)) body: CarrierDecisionInput,
  ): Promise<CarrierCancelRequestDto> {
    return this.cancel.reject(user, id, body);
  }

  // ───────── manual permit ─────────
  @Post('permits/manual')
  @HttpCode(200)
  manualPermit(
    @CurrentUser() user: AuthUser,
    @Body(new ZodPipe(manualPermitSchema)) body: ManualPermitInput,
  ): Promise<{ id: string; permitNo: number }> {
    return this.cancel.manualPermit(user, body);
  }
}
