import { Controller, Get, Post, Patch, Delete, Body, Param, UseGuards, Request } from '@nestjs/common';
import { UsersService } from './users.service';
import { ApiTags, ApiOperation, ApiBearerAuth } from '@nestjs/swagger';
import { JwtAuthGuard } from '../auth/guard/jwt-auth.guard';
import { RolesGuard } from '../auth/guard/roles.guard';
import { Roles } from '../auth/decorator/roles.decorator';
import { Role } from '@prisma/client';

@ApiTags('users')
@ApiBearerAuth()
@Controller('users')
@UseGuards(JwtAuthGuard, RolesGuard)
export class UsersController {
  constructor(private readonly usersService: UsersService) {}

  @Get('profile')
  @ApiOperation({ summary: 'Get current user profile' })
  getProfile(@Request() req) {
    return this.usersService.getProfile(req.user.id);
  }

  @Get('students')
  @Roles(Role.ADMIN, Role.SECRETARY, Role.TEACHER)
  @ApiOperation({ summary: 'List all students (Admin, Secretary, Teacher only)' })
  findAllStudents() {
    return this.usersService.findAllStudents();
  }

  @Get('teachers')
  @Roles(Role.ADMIN, Role.SECRETARY)
  @ApiOperation({ summary: 'List all teachers (Admin, Secretary only)' })
  findAllTeachers() {
    return this.usersService.findAllTeachers();
  }

  @Post('students')
  @Roles(Role.ADMIN, Role.SECRETARY)
  @ApiOperation({ summary: 'Create a new student' })
  createStudent(@Body() data: any) {
    return this.usersService.createStudent(data);
  }

  @Patch('students/:id')
  @Roles(Role.ADMIN, Role.SECRETARY)
  @ApiOperation({ summary: 'Update student information' })
  updateStudent(@Param('id') id: string, @Body() data: any) {
    return this.usersService.updateStudent(id, data);
  }

  @Delete('students/:id')
  @Roles(Role.ADMIN)
  @ApiOperation({ summary: 'Delete a student (Admin only)' })
  deleteStudent(@Param('id') id: string) {
    return this.usersService.deleteStudent(id);
  }
}
