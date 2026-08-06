import { Controller, Post, Get, Patch, Delete, Body, Param, UseGuards } from '@nestjs/common';
import { AcademicService } from './academic.service';
import {
  CreateSemesterDto,
  CreateUEDto,
  CreateSubjectDto,
  CreateClassDto,
  CreateAcademicYearDto,
  UpdateSemesterDto,
} from './dto/academic.dto';
import { ApiTags, ApiOperation, ApiBearerAuth } from '@nestjs/swagger';
import { JwtAuthGuard } from '../auth/guard/jwt-auth.guard';
import { RolesGuard } from '../auth/guard/roles.guard';
import { Roles } from '../auth/decorator/roles.decorator';
import { Role } from '@prisma/client';

@ApiTags('academic')
@ApiBearerAuth()
@Controller('academic')
@UseGuards(JwtAuthGuard, RolesGuard)
export class AcademicController {
  constructor(private readonly academicService: AcademicService) {}

  @Get('classes')
  @ApiOperation({ summary: 'List all classes' })
  getClasses() {
    return this.academicService.getClasses();
  }

  @Post('classes')
  @Roles(Role.ADMIN)
  @ApiOperation({ summary: 'Create a new class (Admin only)' })
  createClass(@Body() dto: CreateClassDto) {
    return this.academicService.createClass(dto);
  }

  @Delete('classes/:id')
  @Roles(Role.ADMIN)
  @ApiOperation({ summary: 'Delete a class (Admin only)' })
  deleteClass(@Param('id') id: string) {
    return this.academicService.deleteClass(id);
  }

  @Get('years')
  @ApiOperation({ summary: 'List all academic years' })
  getYears() {
    return this.academicService.getYears();
  }

  @Post('years')
  @Roles(Role.ADMIN)
  @ApiOperation({ summary: 'Create a new academic year (Admin only)' })
  createYear(@Body() dto: CreateAcademicYearDto) {
    return this.academicService.createYear(dto);
  }

  @Delete('years/:id')
  @Roles(Role.ADMIN)
  @ApiOperation({ summary: 'Delete an academic year (Admin only)' })
  deleteYear(@Param('id') id: string) {
    return this.academicService.deleteYear(id);
  }

  @Patch('years/:id/activate')
  @Roles(Role.ADMIN)
  @ApiOperation({ summary: 'Mark an academic year as the active one (Admin only)' })
  setActiveYear(@Param('id') id: string) {
    return this.academicService.setActiveYear(id);
  }

  @Post('semester')
  @Roles(Role.ADMIN)
  @ApiOperation({ summary: 'Create a new semester (Admin only)' })
  createSemester(@Body() dto: CreateSemesterDto) {
    return this.academicService.createSemester(dto);
  }

  @Patch('semester/:id')
  @Roles(Role.ADMIN)
  @ApiOperation({ summary: 'Update a semester (name, year, active status) (Admin only)' })
  updateSemester(@Param('id') id: string, @Body() dto: UpdateSemesterDto) {
    return this.academicService.updateSemester(id, dto);
  }

  @Delete('semester/:id')
  @Roles(Role.ADMIN)
  @ApiOperation({ summary: 'Delete a semester (only if it has no UEs left) (Admin only)' })
  deleteSemester(@Param('id') id: string) {
    return this.academicService.deleteSemester(id);
  }

  @Patch('semester/:id/lock')
  @Roles(Role.ADMIN)
  @ApiOperation({ summary: 'Toggle lock status for a semester (Admin only)' })
  toggleSemesterLock(@Param('id') id: string) {
    return this.academicService.toggleSemesterLock(id);
  }

  @Post('ue')
  @Roles(Role.ADMIN)
  @ApiOperation({ summary: 'Create a new Teaching Unit (UE) (Admin only)' })
  createUE(@Body() dto: CreateUEDto) {
    return this.academicService.createUE(dto);
  }

  @Post('subject')
  @Roles(Role.ADMIN)
  @ApiOperation({ summary: 'Create a new subject (Matière) (Admin only)' })
  createSubject(@Body() dto: CreateSubjectDto) {
    return this.academicService.createSubject(dto);
  }

  @Get('structure')
  @ApiOperation({ summary: 'Get the full academic structure (Semesters -> UEs -> Subjects)' })
  getStructure() {
    return this.academicService.getStructure();
  }

  @Patch('ue/:id')
  @Roles(Role.ADMIN)
  @ApiOperation({ summary: 'Update a Teaching Unit (UE)' })
  updateUE(@Param('id') id: string, @Body() dto: any) {
    return this.academicService.updateUE(id, dto);
  }

  @Delete('ue/:id')
  @Roles(Role.ADMIN)
  @ApiOperation({ summary: 'Delete a Teaching Unit (UE)' })
  deleteUE(@Param('id') id: string) {
    return this.academicService.deleteUE(id);
  }

  @Patch('subject/:id')
  @Roles(Role.ADMIN)
  @ApiOperation({ summary: 'Update a subject' })
  updateSubject(@Param('id') id: string, @Body() dto: any) {
    return this.academicService.updateSubject(id, dto);
  }

  @Delete('subject/:id')
  @Roles(Role.ADMIN)
  @ApiOperation({ summary: 'Delete a subject' })
  deleteSubject(@Param('id') id: string) {
    return this.academicService.deleteSubject(id);
  }
}
