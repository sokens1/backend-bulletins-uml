import { Module } from '@nestjs/common';
import { AppController } from './app.controller';
import { AppService } from './app.service';
import { PrismaModule } from './prisma/prisma.module';
import { AuthModule } from './auth/auth.module';
import { AcademicModule } from './academic/academic.module';

@Module({
  imports: [PrismaModule, AuthModule, AcademicModule],
  controllers: [AppController],
  providers: [AppService],
})
export class AppModule {}
