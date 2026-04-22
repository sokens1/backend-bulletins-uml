import { Injectable, NotFoundException, ConflictException } from '@nestjs/common';
import { DatabaseService } from '../database/database.service';
import * as bcrypt from 'bcrypt';

@Injectable()
export class UsersService {
  constructor(private prisma: DatabaseService) {}

  async getProfile(userId: string) {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: {
        id: true,
        email: true,
        role: true,
        student: true,
        teacher: true,
      },
    });
    if (!user) throw new NotFoundException('User not found');
    return user;
  }

  async findAllStudents() {
    return this.prisma.student.findMany({
      include: {
        user: {
          select: { email: true, createdAt: true },
        },
      },
    });
  }


  async findAllTeachers() {
    return this.prisma.teacher.findMany({
      include: {
        user: {
          select: { email: true, createdAt: true },
        },
      },
    });
  }

  async findAllStaff() {
    return this.prisma.user.findMany({
      where: {
        role: { in: ['ADMIN', 'SECRETARY', 'TEACHER'] },
      },
      select: {
        id: true,
        email: true,
        role: true,
        createdAt: true,
        teacher: true,
      },
      orderBy: { createdAt: 'desc' },
    });
  }

  async createTeacher(data: any) {
    const existingUser = await this.prisma.user.findUnique({ where: { email: data.email } });
    if (existingUser) throw new ConflictException('User with this email already exists');

    const hashedPassword = await bcrypt.hash(data.password || 'Inptic2024!', 10);

    return this.prisma.user.create({
      data: {
        email: data.email,
        password: hashedPassword,
        role: 'TEACHER',
        teacher: {
          create: {
            firstName: data.firstName,
            lastName: data.lastName,
          },
        },
      },
      include: { teacher: true },
    });
  }

  async createSecretary(data: any) {
    const existingUser = await this.prisma.user.findUnique({ where: { email: data.email } });
    if (existingUser) throw new ConflictException('User with this email already exists');

    const hashedPassword = await bcrypt.hash(data.password || 'Inptic2024!', 10);

    return this.prisma.user.create({
      data: {
        email: data.email,
        password: hashedPassword,
        role: 'SECRETARY',
      },
    });
  }

  async updateStaff(id: string, data: any) {
    const user = await this.prisma.user.findUnique({ where: { id }, include: { teacher: true } });
    if (!user) throw new NotFoundException('User not found');

    const updateData: any = { role: data.role };
    if (data.email) updateData.email = data.email;

    if (user.role === 'TEACHER' && data.firstName && data.lastName) {
      await this.prisma.teacher.update({
        where: { userId: id },
        data: { firstName: data.firstName, lastName: data.lastName },
      });
    }

    return this.prisma.user.update({
      where: { id },
      data: updateData,
    });
  }

  async deleteStaff(id: string) {
    const user = await this.prisma.user.findUnique({ where: { id } });
    if (!user) throw new NotFoundException('User not found');

    if (user.role === 'ADMIN') {
      throw new ConflictException('Suppression d\'un administrateur non autorisée');
    }

    return this.prisma.user.delete({ where: { id } });
  }

  async createStudent(data: any) {
    const existingUser = await this.prisma.user.findUnique({ where: { email: data.email } });
    if (existingUser) throw new ConflictException('User with this email already exists');

    const hashedPassword = await bcrypt.hash(data.password || 'Inptic2024!', 10);

    return this.prisma.user.create({
      data: {
        email: data.email,
        password: hashedPassword,
        role: 'STUDENT',
        student: {
          create: {
            studentId: data.studentId, // Matricule
            firstName: data.firstName,
            lastName: data.lastName,
            class: data.class || 'Licence Professionnelle',
            birthDate: data.birthDate ? new Date(data.birthDate) : null,
            birthPlace: data.birthPlace,
            bacType: data.bacType,
            provenance: data.provenance,
          },
        },
      },
      include: { student: true },
    });
  }

  async updateStudent(id: string, data: any) {
    const student = await this.prisma.student.findUnique({ where: { id } });
    if (!student) throw new NotFoundException('Student not found');

    return this.prisma.student.update({
      where: { id },
      data: {
        firstName: data.firstName,
        lastName: data.lastName,
        class: data.class,
        birthDate: data.birthDate ? new Date(data.birthDate) : undefined,
        birthPlace: data.birthPlace,
        bacType: data.bacType,
        provenance: data.provenance,
      },
    });
  }

  async updateProfile(userId: string, data: any) {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      include: { student: true, teacher: true },
    });
    if (!user) throw new NotFoundException('User not found');

    if (data.email && data.email !== user.email) {
      const existing = await this.prisma.user.findUnique({ where: { email: data.email } });
      if (existing && existing.id !== userId) {
        throw new ConflictException('User with this email already exists');
      }
      await this.prisma.user.update({ where: { id: userId }, data: { email: data.email } });
    }

    if (user.role === 'STUDENT' && user.student) {
      await this.prisma.student.update({
        where: { userId },
        data: {
          firstName: data.firstName ?? undefined,
          lastName: data.lastName ?? undefined,
          class: data.class ?? undefined,
          birthDate: data.birthDate ? new Date(data.birthDate) : undefined,
          birthPlace: data.birthPlace ?? undefined,
          bacType: data.bacType ?? undefined,
          provenance: data.provenance ?? undefined,
        },
      });
    }

    if (user.role === 'TEACHER' && user.teacher) {
      await this.prisma.teacher.update({
        where: { userId },
        data: {
          firstName: data.firstName ?? undefined,
          lastName: data.lastName ?? undefined,
        },
      });
    }

    return this.getProfile(userId);
  }

  async deleteStudent(id: string) {
    const student = await this.prisma.student.findUnique({ where: { id } });
    if (!student) throw new NotFoundException('Student not found');

    // Delete user (cascade will handle student if configured, but we do it manually to be safe or use prisma cascade)
    return this.prisma.user.delete({ where: { id: student.userId } });
  }
}
