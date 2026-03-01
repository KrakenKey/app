import { PartialType } from '@nestjs/swagger';
import { CreateCertDto } from './create-cert.dto';

export class UpdateCertDto extends PartialType(CreateCertDto) {}
