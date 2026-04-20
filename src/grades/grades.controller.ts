import { Controller, Post, Get, Body, Param, UseGuards, Query, Request } from '@nestjs/common';
import { GradesService } from './grades.service';
import { EnterGradeDto, EnterAttendanceDto } from './dto/grades.dto';
import { ApiTags, ApiOperation, ApiBearerAuth } from '@nestjs/swagger';
import { JwtAuthGuard } from '../auth/guard/jwt-auth.guard';
import { RolesGuard } from '../auth/guard/roles.guard';
import { Roles } from '../auth/decorator/roles.decorator';
import { Role } from '@prisma/client';

@ApiTags('grades')
@ApiBearerAuth()
@Controller('grades')
@UseGuards(JwtAuthGuard, RolesGuard)
export class GradesController {
  constructor(private readonly gradesService: GradesService) {}

  @Post('enter')
  @Roles(Role.ADMIN, Role.TEACHER, Role.SECRETARY)
  @ApiOperation({ summary: 'Enter or update a grade (Teacher, Secretary, Admin)' })
  enterGrade(@Body() dto: EnterGradeDto, @Request() req) {
    return this.gradesService.enterGrade(dto, req.user.id);
  }

  @Post('attendance')
  @Roles(Role.ADMIN, Role.SECRETARY)
  @ApiOperation({ summary: 'Register student attendance/absence (Secretary, Admin only)' })
  enterAttendance(@Body() dto: EnterAttendanceDto, @Request() req) {
    return this.gradesService.enterAttendance(dto, req.user.id);
  }

  @Get('report/:studentId')
  @ApiOperation({ summary: 'Generate a student report for a specific semester' })
  getReport(
    @Param('studentId') studentId: string,
    @Query('semesterId') semesterId: string,
  ) {
    return this.gradesService.calculateStudentReport(studentId, semesterId);
  }

  @Get('report-annual/:studentId')
  @ApiOperation({ summary: 'Generate an annual report (S5 + S6)' })
  getAnnualReport(
    @Param('studentId') studentId: string,
    @Query('year') year: string,
  ) {
    return this.gradesService.calculateAnnualReport(studentId, year);
  }

  @Get('audit')
  @Roles(Role.ADMIN)
  @ApiOperation({ summary: 'Consult audit logs (Admin only)' })
  getAuditLogs() {
    return this.gradesService.getAuditLogs();
  }
}
