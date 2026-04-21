import { Controller, Post, Get, Patch, Delete, Body, Param, UseGuards } from '@nestjs/common';
import { AcademicService } from './academic.service';
import { CreateSemesterDto, CreateUEDto, CreateSubjectDto } from './dto/academic.dto';
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

  @Post('semester')
  @Roles(Role.ADMIN)
  @ApiOperation({ summary: 'Create a new semester (Admin only)' })
  createSemester(@Body() dto: CreateSemesterDto) {
    return this.academicService.createSemester(dto);
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
