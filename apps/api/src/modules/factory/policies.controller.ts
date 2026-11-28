import { Body, Controller, Get, Post, Query } from '@nestjs/common';
import { policyCreateSchema, zUuid, type PolicyCreateInput } from '@cb/shared';
import { z } from 'zod';
import { CurrentUser, Roles, type AuthUser } from '../../common/auth/auth.decorators';
import { ZodPipe } from '../../common/validation/zod';
import { PoliciesService } from './policies.service';

const listQuery = z.object({ hallId: zUuid.optional() }).strict();

@Roles('FACTORY_OPERATOR')
@Controller('factory/policies')
export class PoliciesController {
  constructor(private readonly policies: PoliciesService) {}

  @Get()
  list(@CurrentUser() user: AuthUser, @Query(new ZodPipe(listQuery)) q: z.infer<typeof listQuery>) {
    return this.policies.list(user, q.hallId);
  }

  /** Creates a NEW version; existing versions are never modified. */
  @Post()
  create(@CurrentUser() user: AuthUser, @Body(new ZodPipe(policyCreateSchema)) body: PolicyCreateInput) {
    return this.policies.create(user, body);
  }
}
