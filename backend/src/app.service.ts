import { Injectable } from '@nestjs/common';

@Injectable()
export class AppService {
  getInfo(): { status: string; version: string; commit: string } {
    return {
      status: 'ok',
      version: process.env.KK_API_VERSION || 'unknown',
      // Baked into the image at build time (KK_GIT_SHA build arg), so it
      // says which commit is running whatever the deploy tags or pins.
      commit: process.env.KK_GIT_SHA || 'unknown',
    };
  }
}
