import { Injectable } from '@nestjs/common';

@Injectable()
export class AppService {
  getInfo(): { status: string; version: string } {
    return {
      status: 'ok',
      version: process.env.KK_API_VERSION || 'unknown',
    };
  }
}
