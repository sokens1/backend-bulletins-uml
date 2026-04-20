import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../database/prisma.service';

@Injectable()
export class UsersService {
  constructor(private prisma: PrismaService) {}

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
          select: { email: true },
        },
      },
    });
  }
}
