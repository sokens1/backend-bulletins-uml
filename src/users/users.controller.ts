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

  @Delete('student/:id')
  @Roles(Role.ADMIN)
  @ApiOperation({ summary: 'Delete a student and their user account' })
  deleteStudent(@Param('id') id: string) {
    return this.usersService.deleteStudent(id);
  }

  @Get('staff')
  @Roles(Role.ADMIN)
  @ApiOperation({ summary: 'List all staff users (Admin, Secretary, Teacher)' })
  findAllStaff() {
    return this.usersService.findAllStaff();
  }

  @Post('teacher')
  @Roles(Role.ADMIN)
  @ApiOperation({ summary: 'Create a new teacher account' })
  createTeacher(@Body() data: any) {
    return this.usersService.createTeacher(data);
  }

  @Post('secretary')
  @Roles(Role.ADMIN)
  @ApiOperation({ summary: 'Create a new secretary account' })
  createSecretary(@Body() data: any) {
    return this.usersService.createSecretary(data);
  }

  @Patch('staff/:id')
  @Roles(Role.ADMIN)
  @ApiOperation({ summary: 'Update a staff member' })
  updateStaff(@Param('id') id: string, @Body() data: any) {
    return this.usersService.updateStaff(id, data);
  }

  @Delete('staff/:id')
  @Roles(Role.ADMIN)
  @ApiOperation({ summary: 'Delete a staff member' })
  deleteStaff(@Param('id') id: string) {
    return this.usersService.deleteStaff(id);
  }
}
