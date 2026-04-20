import { Controller, Post, Get, Body, Param, UseGuards, Query } from '@nestjs/common';
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
  enterGrade(@Body() dto: EnterGradeDto) {
    return this.gradesService.enterGrade(dto);
  }

  @Post('attendance')
  @Roles(Role.ADMIN, Role.SECRETARY)
  @ApiOperation({ summary: 'Register student attendance/absence (Secretary, Admin only)' })
  enterAttendance(@Body() dto: EnterAttendanceDto) {
    return this.gradesService.enterAttendance(dto);
  }

  @Get('report/:studentId')
  @ApiOperation({ summary: 'Generate a student report for a specific semester' })
  getReport(
    @Param('studentId') studentId: string,
    @Query('semesterId') semesterId: string,
  ) {
    return this.gradesService.calculateStudentReport(studentId, semesterId);
  }
}
