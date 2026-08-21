import { Injectable, NotFoundException, ConflictException } from '@nestjs/common';
import { DatabaseService } from '../database/database.service';
import {
  CreateSemesterDto,
  CreateUEDto,
  CreateSubjectDto,
  CreateClassDto,
  CreateAcademicYearDto,
  UpdateSemesterDto,
} from './dto/academic.dto';

@Injectable()
export class AcademicService {
  constructor(private prisma: DatabaseService) {}

  // Classes
  async getClasses() {
    return this.prisma.class.findMany({ orderBy: { name: 'asc' } });
  }

  async createClass(dto: CreateClassDto) {
    const existing = await this.prisma.class.findUnique({ where: { name: dto.name } });
    if (existing) throw new ConflictException('Cette classe existe déjà');
    return this.prisma.class.create({ data: dto });
  }

  async deleteClass(id: string) {
    const cls = await this.prisma.class.findUnique({ where: { id } });
    if (!cls) throw new NotFoundException('Class not found');
    return this.prisma.class.delete({ where: { id } });
  }

  // Academic Years
  async getYears() {
    return this.prisma.academicYear.findMany({ orderBy: { label: 'desc' } });
  }

  async createYear(dto: CreateAcademicYearDto) {
    const existing = await this.prisma.academicYear.findUnique({ where: { label: dto.label } });
    if (existing) throw new ConflictException('Cette année existe déjà');
    return this.prisma.academicYear.create({ data: dto });
  }

  async deleteYear(id: string) {
    const year = await this.prisma.academicYear.findUnique({ where: { id } });
    if (!year) throw new NotFoundException('Academic year not found');
    return this.prisma.academicYear.delete({ where: { id } });
  }

  async setActiveYear(id: string) {
    const year = await this.prisma.academicYear.findUnique({ where: { id } });
    if (!year) throw new NotFoundException('Academic year not found');

    return this.prisma.$transaction(async (tx) => {
      await tx.academicYear.updateMany({ data: { isActive: false }, where: { isActive: true } });
      return tx.academicYear.update({ where: { id }, data: { isActive: true } });
    });
  }

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

  async updateSemester(id: string, dto: UpdateSemesterDto) {
    const semester = await this.prisma.semester.findUnique({ where: { id } });
    if (!semester) throw new NotFoundException('Semester not found');
    return this.prisma.semester.update({ where: { id }, data: dto });
  }

  async deleteSemester(id: string) {
    const semester = await this.prisma.semester.findUnique({
      where: { id },
      include: { ues: true },
    });
    if (!semester) throw new NotFoundException('Semester not found');
    if (semester.ues.length > 0) {
      throw new ConflictException(
        'Impossible de supprimer un semestre qui contient encore des UE. Supprimez-les UE au préalable.',
      );
    }
    return this.prisma.semester.delete({ where: { id } });
  }

  async toggleSemesterLock(id: string) {
    const semester = await this.prisma.semester.findUnique({ where: { id } });
    if (!semester) throw new NotFoundException('Semester not found');
    return this.prisma.semester.update({
      where: { id },
      data: { isLocked: !semester.isLocked },
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

  // Neither Grade->Subject, Attendance->Subject nor Subject->UE cascade at the database
  // level (no onDelete: Cascade in schema.prisma) — a naive delete on a UE or Subject that
  // still has any of those attached would just throw a foreign-key constraint error. Both
  // deletes are genuinely destructive/hard-to-reverse actions an admin does deliberately
  // (the frontend's confirm() already says "et toutes ses matières" for a UE), so this
  // explicitly deletes the dependent rows first, all in one transaction so a failure partway
  // through leaves nothing half-deleted.
  async deleteUE(id: string) {
    const ue = await this.prisma.uE.findUnique({ where: { id }, include: { subjects: true } });
    if (!ue) throw new NotFoundException('UE not found');

    const subjectIds = ue.subjects.map((s) => s.id);
    await this.prisma.$transaction([
      this.prisma.grade.deleteMany({ where: { subjectId: { in: subjectIds } } }),
      this.prisma.attendance.deleteMany({ where: { subjectId: { in: subjectIds } } }),
      this.prisma.subject.deleteMany({ where: { ueId: id } }),
      this.prisma.uE.delete({ where: { id } }),
    ]);
    return { deleted: true, subjectsDeleted: subjectIds.length };
  }

  async updateSubject(id: string, dto: any) {
    const subj = await this.prisma.subject.findUnique({ where: { id } });
    if (!subj) throw new NotFoundException('Subject not found');
    return this.prisma.subject.update({ where: { id }, data: dto });
  }

  async deleteSubject(id: string) {
    const subj = await this.prisma.subject.findUnique({ where: { id } });
    if (!subj) throw new NotFoundException('Subject not found');

    await this.prisma.$transaction([
      this.prisma.grade.deleteMany({ where: { subjectId: id } }),
      this.prisma.attendance.deleteMany({ where: { subjectId: id } }),
      this.prisma.subject.delete({ where: { id } }),
    ]);
    return { deleted: true };
  }
}
