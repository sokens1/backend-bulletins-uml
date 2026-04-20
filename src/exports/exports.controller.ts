import { Controller, Get, Post, Param, Query, Res, UseInterceptors, UploadedFile, UseGuards } from '@nestjs/common';
import { ExportsService } from './exports.service';
import { Response } from 'express';
import { FileInterceptor } from '@nestjs/platform-express';
import { ApiTags, ApiOperation, ApiBearerAuth, ApiConsumes, ApiBody } from '@nestjs/swagger';
import { JwtAuthGuard } from '../auth/guard/jwt-auth.guard';
import { RolesGuard } from '../auth/guard/roles.guard';
import { Roles } from '../auth/decorator/roles.decorator';
import { Role } from '@prisma/client';

@ApiTags('exports')
@ApiBearerAuth()
@Controller('exports')
@UseGuards(JwtAuthGuard, RolesGuard)
export class ExportsController {
  constructor(private readonly exportsService: ExportsService) {}

  @Get('bulletin/:studentId')
  @ApiOperation({ summary: 'Download student bulletin in PDF format' })
  async downloadBulletin(
    @Param('studentId') studentId: string,
    @Query('semesterId') semesterId: string,
    @Res() res: Response,
  ) {
    const buffer = await this.exportsService.generateBulletinPdf(studentId, semesterId);
    
    res.set({
      'Content-Type': 'application/pdf',
      'Content-Disposition': `attachment; filename=bulletin_${studentId}.pdf`,
      'Content-Length': buffer.length,
    });

    res.end(buffer);
  }

  @Post('import-grades')
  @Roles(Role.ADMIN, Role.SECRETARY)
  @UseInterceptors(FileInterceptor('file'))
  @ApiConsumes('multipart/form-data')
  @ApiOperation({ summary: 'Import grades from an Excel file (Admin, Secretary only)' })
  @ApiBody({
    schema: {
      type: 'object',
      properties: {
        file: { type: 'string', format: 'binary' },
        semesterId: { type: 'string' },
      },
    },
  })
  async importGrades(
    @UploadedFile() file: Express.Multer.File,
    @Query('semesterId') semesterId: string,
  ) {
    return this.exportsService.importGradesFromExcel(file.buffer, semesterId);
  }
}
