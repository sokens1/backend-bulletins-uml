import { Injectable, NotFoundException } from '@nestjs/common';
import { DatabaseService } from '../database/database.service';
import { CreateSemesterDto, CreateUEDto, CreateSubjectDto } from './dto/academic.dto';

@Injectable()
export class AcademicService {
  constructor(private prisma: DatabaseService) {}

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
      orderBy: { name: 'asc' },
    });
  }

  async updateUE(id: string, dto: any) {
    const ue = await this.prisma.uE.findUnique({ where: { id } });
    if (!ue) throw new NotFoundException('UE not found');
    return this.prisma.uE.update({ where: { id }, data: dto });
  }

  async deleteUE(id: string) {
    const ue = await this.prisma.uE.findUnique({ where: { id } });
    if (!ue) throw new NotFoundException('UE not found');
    return this.prisma.uE.delete({ where: { id } });
  }

  async updateSubject(id: string, dto: any) {
    const subj = await this.prisma.subject.findUnique({ where: { id } });
    if (!subj) throw new NotFoundException('Subject not found');
    return this.prisma.subject.update({ where: { id }, data: dto });
  }

  async deleteSubject(id: string) {
    const subj = await this.prisma.subject.findUnique({ where: { id } });
    if (!subj) throw new NotFoundException('Subject not found');
    return this.prisma.subject.delete({ where: { id } });
  }
}
