import { IsNotEmpty, IsString, MaxLength } from 'class-validator';

export class MarketplaceTokenDto {
  /** The `token` query parameter Microsoft adds to the landing page URL, decoded. */
  @IsString()
  @IsNotEmpty()
  @MaxLength(8192)
  token: string;
}
