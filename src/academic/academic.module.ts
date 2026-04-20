import { Module } from '@nestjs/common';
import { AcademicService } from './academic.service';
import { AcademicController } from './academic.controller';

@Module({
  providers: [AcademicService],
  controllers: [AcademicController]
})
export class AcademicModule {}
