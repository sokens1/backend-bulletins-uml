import { Module } from '@nestjs/common';
import { AppController } from './app.controller';
import { AppService } from './app.service';
import { PrismaModule } from './database/prisma.module';
import { AuthModule } from './auth/auth.module';
import { AcademicModule } from './academic/academic.module';
import { GradesModule } from './grades/grades.module';
import { UsersModule } from './users/users.module';
import { ExportsModule } from './exports/exports.module';

@Module({
  imports: [PrismaModule, AuthModule, AcademicModule, GradesModule, UsersModule, ExportsModule],
  controllers: [AppController],
  providers: [AppService],
})
export class AppModule {}
