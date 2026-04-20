import { Module } from '@nestjs/common';
import { ApplicationController } from './application.controller';
import { ApplicationService } from './application.service';
import { DatabaseModule } from './database/database.module';
import { AuthModule } from './auth/auth.module';
import { AcademicModule } from './academic/academic.module';
import { GradesModule } from './grades/grades.module';
import { UsersModule } from './users/users.module';
import { ExportsModule } from './exports/exports.module';

@Module({
  imports: [DatabaseModule, AuthModule, AcademicModule, GradesModule, UsersModule, ExportsModule],
  controllers: [ApplicationController],
  providers: [ApplicationService],
})
export class ApplicationModule {}
