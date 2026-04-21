import { Controller, Get, Post, Patch, Body, Param, UseGuards, Request } from '@nestjs/common';
import { GradesService } from './grades.service';
import { EnterAttendanceDto } from './dto/grades.dto';
import { ApiTags, ApiOperation, ApiBearerAuth } from '@nestjs/swagger';
import { JwtAuthGuard } from '../auth/guard/jwt-auth.guard';
import { RolesGuard } from '../auth/guard/roles.guard';
import { Roles } from '../auth/decorator/roles.decorator';
import { Role } from '@prisma/client';

@ApiTags('attendance')
@ApiBearerAuth()
@Controller('attendance')
@UseGuards(JwtAuthGuard, RolesGuard)
export class AttendanceController {
  constructor(private readonly gradesService: GradesService) {}

  @Get()
  @Roles(Role.ADMIN, Role.SECRETARY)
  @ApiOperation({ summary: 'List all student attendances (Admin, Secretary only)' })
  findAll() {
    return this.gradesService.findAllAttendances();
  }

  @Post()
  @Roles(Role.ADMIN, Role.SECRETARY)
  @ApiOperation({ summary: 'Create a new attendance record' })
  create(@Body() dto: EnterAttendanceDto, @Request() req) {
    return this.gradesService.enterAttendance(dto, req.user.id);
  }

  @Patch(':id')
  @Roles(Role.ADMIN, Role.SECRETARY)
  @ApiOperation({ summary: 'Update an attendance record' })
  update(@Param('id') id: string, @Body() dto: EnterAttendanceDto, @Request() req) {
    return this.gradesService.updateAttendance(id, dto, req.user.id);
  }
}
