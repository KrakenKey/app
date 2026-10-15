import { IsNotEmpty, IsString, Matches, MaxLength } from 'class-validator';

export class AwsMarketplaceRegistrationDto {
  /**
   * The `registration` query parameter the fulfillment URL redirected to
   * (43 base64url characters).
   */
  @IsString()
  @IsNotEmpty()
  @MaxLength(128)
  @Matches(/^[A-Za-z0-9_-]+$/)
  registration: string;
}
