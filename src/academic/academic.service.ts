import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { CreateSemesterDto, CreateUEDto, CreateSubjectDto } from './dto/academic.dto';

@Injectable()
export class AcademicService {
  constructor(private prisma: PrismaService) {}

  // Semesters
  async createSemester(dto: CreateSemesterDto) {
    return this.prisma.semester.create({
      data: dto,
    });
  }

  async getAllSemesters() {
    return this.prisma.semester.findMany({
      include: {
        ues: {
          include: {
            subjects: true,
          },
        },
      },
    });
  }

  // UEs
  async createUE(dto: CreateUEDto) {
    const semester = await this.prisma.semester.findUnique({
      where: { id: dto.semesterId },
    });
    if (!semester) throw new NotFoundException('Semester not found');

    return this.prisma.uE.create({
      data: dto,
    });
  }

  // Subjects
  async createSubject(dto: CreateSubjectDto) {
    const ue = await this.prisma.uE.findUnique({
      where: { id: dto.ueId },
    });
    if (!ue) throw new NotFoundException('UE not found');

    return this.prisma.subject.create({
      data: dto,
    });
  }

  async getStructure() {
    return this.prisma.semester.findMany({
      include: {
        ues: {
          include: {
            subjects: {
              include: {
                teacher: true,
              },
            },
          },
        },
      },
    });
  }
}
