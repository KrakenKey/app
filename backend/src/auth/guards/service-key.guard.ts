import { Injectable } from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';

@Injectable()
export class ServiceKeyGuard extends AuthGuard('service-key') {}
