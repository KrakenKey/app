import {
  Controller,
  // Get,
  // Post,
  Body,
  // Patch,
  // Param,
  // Delete,
} from '@nestjs/common';
import { ApiExcludeController } from '@nestjs/swagger';
import { CertsService } from './certs.service';
// import { CreateCertDto } from './dto/create-cert.dto';
// import { UpdateCertDto } from './dto/update-cert.dto';

@Controller('certs')
@ApiExcludeController()
export class CertsController {
  constructor(private readonly certsService: CertsService) {}

  // @Post()
  // create(@Body() createCertDto: CreateCertDto) {
  //   return this.certsService.create(createCertDto);
  // }

  // @Get()
  // findAll() {
  //   return this.certsService.findAll();
  // }

  // @Get(':id')
  // findOne(@Param('id') id: string) {
  //   return this.certsService.findOne(+id);
  // }

  // @Patch(':id')
  // update(@Param('id') id: string, @Body() updateCertDto: UpdateCertDto) {
  //   return this.certsService.update(+id, updateCertDto);
  // }

  // @Delete(':id')
  // remove(@Param('id') id: string) {
  //   return this.certsService.remove(+id);
  // }
}
