import { Module } from '@nestjs/common';
import { ExportsService } from './exports.service';
import { ExportsController } from './exports.controller';
import { GradesModule } from '../grades/grades.module';
import { DatabaseModule } from '../database/database.module';
import { UsersModule } from '../users/users.module';

@Module({
  imports: [GradesModule, DatabaseModule, UsersModule],
  providers: [ExportsService],
  controllers: [ExportsController],
})
export class ExportsModule {}
