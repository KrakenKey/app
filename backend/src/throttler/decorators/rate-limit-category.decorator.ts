import { SetMetadata } from '@nestjs/common';
import { RateLimitCategory } from '../interfaces/rate-limit-category.enum';

export const RATE_LIMIT_CATEGORY_KEY = 'rate-limit-category';

export const RateLimitCategoryDecorator = (category: RateLimitCategory) =>
  SetMetadata(RATE_LIMIT_CATEGORY_KEY, category);
