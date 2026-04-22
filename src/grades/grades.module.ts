import { Module } from '@nestjs/common';
import { GradesService } from './grades.service';
import { GradesController } from './grades.controller';
import { AttendanceController } from './attendance.controller';
import { SettingsModule } from '../settings/settings.module';

@Module({
  imports: [SettingsModule],
  providers: [GradesService],
  controllers: [GradesController, AttendanceController],
  exports: [GradesService],
})
export class GradesModule {}
