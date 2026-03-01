import {
  Injectable,
  OnModuleInit,
  InternalServerErrorException,
} from '@nestjs/common';
import { PassportStrategy } from '@nestjs/passport';
import { Strategy } from 'passport-custom'; // We use a custom wrapper for more control
import * as oidc from 'openid-client';
import { ConfigService } from '@nestjs/config';
import { URL } from 'url';

@Injectable()
export class AuthentikStrategy
  extends PassportStrategy(Strategy, 'authentik')
  implements OnModuleInit
{
  private client: any;

  constructor(private configService: ConfigService) {
    super();
  }

  async onModuleInit() {
    try {
      // 1. Discover the Authentik configuration
      const issuerUrl = this.configService.get(
        'KK_AUTHENTIK_ISSUER_URL',
      ) as string;
      const config = await oidc.discovery(
        new URL(issuerUrl),
        this.configService.get('KK_AUTHENTIK_CLIENT_ID') as string,
        this.configService.get('KK_AUTHENTIK_CLIENT_SECRET') as string,
      );

      this.client = config;
      console.log('✅ Authentik Strategy Initialized');
    } catch (error) {
      console.error('❌ Failed to discover Authentik:', error);
      throw new InternalServerErrorException('IdP Discovery failed');
    }
  }

  // The 'validate' method is what Passport calls after the handshake
  // validate(req: any) {
  // This is where you exchange the code for user details
  // For a SaaS, you'll want to return the user profile here
  // Passport attaches this return value to req.user
  // return {
  //   userId: 'extracted-from-token',
  //   email: 'extracted-from-token',
  // };
  // }
  validate() {
    return null; // This strategy is only for the handshake, actual user info is in the proxy strategy
  }
}
