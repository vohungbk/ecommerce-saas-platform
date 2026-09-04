import { Body, Controller, Get, Post, UseGuards } from '@nestjs/common';
import { ApiHeader, ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger';
import { AdminGuard } from '../auth/admin.guard';
import { AuthGuard } from '../auth/auth.guard';
import { CategoriesService } from './categories.service';
import { CreateCategoryDto } from './dto/create-category.dto';

@ApiTags('categories')
@ApiHeader({
  name: 'x-user-id',
  description:
    'Development-only identity shim: id of an existing User. Not production auth.',
  required: true,
})
@Controller('categories')
export class CategoriesController {
  constructor(private readonly categoriesService: CategoriesService) {}

  @Post()
  @UseGuards(AdminGuard)
  @ApiOperation({
    summary: 'Create a category (admin only)',
    description:
      'Creates a new course category. Requires the caller to be an admin (development-only x-user-id header shim, see AdminGuard).',
  })
  @ApiResponse({ status: 201, description: 'Category created' })
  @ApiResponse({ status: 400, description: 'Validation failed' })
  @ApiResponse({ status: 401, description: 'Missing or unknown x-user-id' })
  @ApiResponse({ status: 403, description: 'Caller is not an admin' })
  @ApiResponse({
    status: 409,
    description: 'A category with this name already exists',
  })
  create(@Body() dto: CreateCategoryDto) {
    return this.categoriesService.create(dto);
  }

  @Get()
  @UseGuards(AuthGuard)
  @ApiOperation({
    summary: 'List all categories',
    description:
      'Returns every category, sorted by name ascending. Requires the caller to be an authenticated user of any role (development-only x-user-id header shim, see AuthGuard).',
  })
  @ApiResponse({
    status: 200,
    description: 'All categories',
    schema: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          id: { type: 'string', format: 'uuid' },
          name: { type: 'string', example: 'Web Development' },
          createdAt: { type: 'string', format: 'date-time' },
          updatedAt: { type: 'string', format: 'date-time' },
        },
      },
    },
  })
  @ApiResponse({ status: 401, description: 'Missing or unknown x-user-id' })
  findAll() {
    return this.categoriesService.findAll();
  }
}
