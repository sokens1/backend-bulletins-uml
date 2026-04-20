import { Module } from '@nestjs/common';
import { ExportsService } from './exports.service';
import { ExportsController } from './exports.controller';
import { GradesModule } from '../grades/grades.module';
import { PrismaModule } from '../prisma/prisma.module';

@Module({
  imports: [GradesModule, PrismaModule],
  providers: [ExportsService],
  controllers: [ExportsController],
})
export class ExportsModule {}
