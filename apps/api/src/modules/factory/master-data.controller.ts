import { Body, Controller, Get, Param, Patch, Post } from '@nestjs/common';
import { destinationSchema, loaderTypeSchema, packagingTypeSchema, productSchema } from '@cb/shared';
import { CurrentUser, Roles, type AuthUser } from '../../common/auth/auth.decorators';
import { ZodPipe } from '../../common/validation/zod';
import { parsePatch, UuidPipe } from './factory.util';
import {
  MasterDataService,
  type DestinationInput,
  type LoaderTypeInput,
  type PackagingTypeInput,
  type ProductInput,
} from './master-data.service';

const destinationPatch = destinationSchema.partial();
const loaderTypePatch = loaderTypeSchema.partial();
const packagingTypePatch = packagingTypeSchema.partial();
const productPatch = productSchema.partial();

/** /factory/{destinations,loader-types,packaging-types,products}: list, create, PATCH (incl. activate/deactivate). */
@Roles('FACTORY_OPERATOR')
@Controller('factory')
export class MasterDataController {
  constructor(private readonly master: MasterDataService) {}

  @Get('destinations')
  destinations(@CurrentUser() user: AuthUser) {
    return this.master.listDestinations(user);
  }

  @Post('destinations')
  createDestination(@CurrentUser() user: AuthUser, @Body(new ZodPipe(destinationSchema)) body: DestinationInput) {
    return this.master.createDestination(user, body);
  }

  @Patch('destinations/:id')
  updateDestination(@CurrentUser() user: AuthUser, @Param('id', UuidPipe) id: string, @Body() body: unknown) {
    return this.master.updateDestination(user, id, parsePatch(destinationPatch, body));
  }

  @Get('loader-types')
  loaderTypes(@CurrentUser() user: AuthUser) {
    return this.master.listLoaderTypes(user);
  }

  @Post('loader-types')
  createLoaderType(@CurrentUser() user: AuthUser, @Body(new ZodPipe(loaderTypeSchema)) body: LoaderTypeInput) {
    return this.master.createLoaderType(user, body);
  }

  @Patch('loader-types/:id')
  updateLoaderType(@CurrentUser() user: AuthUser, @Param('id', UuidPipe) id: string, @Body() body: unknown) {
    return this.master.updateLoaderType(user, id, parsePatch(loaderTypePatch, body));
  }

  @Get('packaging-types')
  packagingTypes(@CurrentUser() user: AuthUser) {
    return this.master.listPackagingTypes(user);
  }

  @Post('packaging-types')
  createPackagingType(@CurrentUser() user: AuthUser, @Body(new ZodPipe(packagingTypeSchema)) body: PackagingTypeInput) {
    return this.master.createPackagingType(user, body);
  }

  @Patch('packaging-types/:id')
  updatePackagingType(@CurrentUser() user: AuthUser, @Param('id', UuidPipe) id: string, @Body() body: unknown) {
    return this.master.updatePackagingType(user, id, parsePatch(packagingTypePatch, body));
  }

  @Get('products')
  products(@CurrentUser() user: AuthUser) {
    return this.master.listProducts(user);
  }

  @Post('products')
  createProduct(@CurrentUser() user: AuthUser, @Body(new ZodPipe(productSchema)) body: ProductInput) {
    return this.master.createProduct(user, body);
  }

  @Patch('products/:id')
  updateProduct(@CurrentUser() user: AuthUser, @Param('id', UuidPipe) id: string, @Body() body: unknown) {
    return this.master.updateProduct(user, id, parsePatch(productPatch, body));
  }
}
