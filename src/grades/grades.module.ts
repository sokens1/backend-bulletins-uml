import { Module } from '@nestjs/common';
import { GradesService } from './grades.service';
import { GradesController } from './grades.controller';

@Module({
  providers: [GradesService],
  controllers: [GradesController]
})
export class GradesModule {}
