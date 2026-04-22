import { Controller, Get, Post, Param, Query, Res, UseInterceptors, UploadedFile, UseGuards, Request } from '@nestjs/common';
import { ExportsService } from './exports.service';
import type { Response } from 'express';
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
    const buffer: Buffer = await this.exportsService.generateBulletinPdf(studentId, semesterId);
    
    res.set({
      'Content-Type': 'application/pdf',
      'Content-Disposition': `attachment; filename=bulletin_${studentId}.pdf`,
      'Content-Length': buffer.length,
    });

    res.end(buffer);
  }

  @Get('bulletin-annual/:studentId')
  @ApiOperation({ summary: 'Download student annual bulletin in PDF format' })
  async downloadAnnualBulletin(
    @Param('studentId') studentId: string,
    @Query('year') year: string,
    @Res() res: Response,
  ) {
    const buffer: Buffer = await this.exportsService.generateAnnualBulletinPdf(studentId, year);
    
    res.set({
      'Content-Type': 'application/pdf',
      'Content-Disposition': `attachment; filename=bulletin_annuel_${studentId}.pdf`,
      'Content-Length': buffer.length,
    });

    res.end(buffer);
  }

  @Get('promotion')
  @Roles(Role.ADMIN, Role.SECRETARY)
  @ApiOperation({ summary: 'Download promotion export in XLSX' })
  async downloadPromotionXlsx(
    @Query('semesterId') semesterId: string,
    @Res() res: Response,
  ) {
    const buffer = await this.exportsService.generatePromotionXlsx(semesterId);
    res.set({
      'Content-Type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      'Content-Disposition': `attachment; filename=promotion_${semesterId}.xlsx`,
      'Content-Length': buffer.length,
    });
    res.end(buffer);
  }

  @Get('grades')
  @Roles(Role.ADMIN, Role.SECRETARY, Role.TEACHER)
  @ApiOperation({ summary: 'Download grades export in XLSX (semester)' })
  async downloadGradesXlsx(
    @Query('semesterId') semesterId: string,
    @Res() res: Response,
  ) {
    const buffer = await this.exportsService.generateGradesXlsx(semesterId);
    res.set({
      'Content-Type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      'Content-Disposition': `attachment; filename=notes_${semesterId}.xlsx`,
      'Content-Length': buffer.length,
    });
    res.end(buffer);
  }

  @Get('bulletins-zip')
  @Roles(Role.ADMIN, Role.SECRETARY)
  @ApiOperation({ summary: 'Download all bulletins of a semester as ZIP' })
  async downloadAllBulletinsZip(
    @Query('semesterId') semesterId: string,
    @Res() res: Response,
  ) {
    const buffer = await this.exportsService.generateAllBulletinsZip(semesterId);
    res.set({
      'Content-Type': 'application/zip',
      'Content-Disposition': `attachment; filename=bulletins_${semesterId}.zip`,
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
    @Request() req,
  ) {
    return this.exportsService.importGradesFromExcel(file.buffer, semesterId, req.user.id);
  }

  @Get('template/:type')
  @ApiOperation({ summary: 'Download an adaptive Excel template for Students or Grades' })
  async getTemplate(
    @Param('type') type: 'STUDENTS' | 'GRADES',
    @Res() res: Response,
  ) {
    const buffer = await this.exportsService.generateTemplate(type);
    
    res.set({
      'Content-Type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      'Content-Disposition': `attachment; filename=template_${type.toLowerCase()}.xlsx`,
      'Content-Length': buffer.length,
    });

    res.end(buffer);
  }

  @Post('import-students')
  @Roles(Role.ADMIN, Role.SECRETARY)
  @UseInterceptors(FileInterceptor('file'))
  @ApiConsumes('multipart/form-data')
  @ApiOperation({ summary: 'Batch import students from an Excel file (Admin, Secretary only)' })
  @ApiBody({
    schema: {
      type: 'object',
      properties: {
        file: { type: 'string', format: 'binary' },
      },
    },
  })
  async importStudents(@UploadedFile() file: Express.Multer.File) {
    return this.exportsService.importStudentsFromExcel(file.buffer);
  }
}
