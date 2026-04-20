import { Injectable, NotFoundException } from '@nestjs/common';
import { DatabaseService } from '../database/database.service';
import { EnterGradeDto, EnterAttendanceDto } from './dto/grades.dto';

@Injectable()
export class GradesService {
  constructor(private prisma: DatabaseService) {}

  async enterGrade(dto: EnterGradeDto, userId: string) {
    const student = await this.prisma.student.findUnique({ where: { id: dto.studentId } });
    if (!student) throw new NotFoundException('Student not found');

    const subject = await this.prisma.subject.findUnique({ where: { id: dto.subjectId } });
    if (!subject) throw new NotFoundException('Subject not found');

    const oldGrade = await this.prisma.grade.findUnique({
      where: {
        studentId_subjectId: { studentId: dto.studentId, subjectId: dto.subjectId },
      },
    });

    const grade = await this.prisma.grade.upsert({
      where: {
        studentId_subjectId: { studentId: dto.studentId, subjectId: dto.subjectId },
      },
      update: {
        ccGrade: dto.ccGrade,
        examGrade: dto.examGrade,
        rattrapageGrade: dto.rattrapageGrade,
      },
      create: {
        studentId: dto.studentId,
        subjectId: dto.subjectId,
        ccGrade: dto.ccGrade,
        examGrade: dto.examGrade,
        rattrapageGrade: dto.rattrapageGrade,
      },
    });

    await this.prisma.auditLog.create({
      data: {
        userId,
        action: oldGrade ? 'UPDATE_GRADE' : 'CREATE_GRADE',
        entity: 'Grade',
        entityId: grade.id,
        oldData: oldGrade as any,
        newData: grade as any,
      },
    });

    return grade;
  }

  async enterAttendance(dto: EnterAttendanceDto, userId: string) {
    const attendance = await this.prisma.attendance.create({
      data: dto,
    });

    await this.prisma.auditLog.create({
      data: {
        userId,
        action: 'ENTER_ATTENDANCE',
        entity: 'Attendance',
        entityId: attendance.id,
        newData: attendance as any,
      },
    });

    return attendance;
  }

  async calculateStudentReport(studentId: string, semesterId: string) {
    const student = await this.prisma.student.findUnique({
      where: { id: studentId },
    });
    if (!student) throw new NotFoundException('Student not found');

    const ues = await this.prisma.uE.findMany({
      where: { semesterId },
      include: {
        subjects: {
          include: {
            grades: { where: { studentId } },
            attendances: { where: { studentId } },
          },
        },
      },
    });

    let totalSemesterPoints = 0;
    let totalSemesterCredits = 0;
    let totalAbsences = 0;
    let totalPenalty = 0;

    const ueReports = ues.map((ue) => {
      let totalUEPoints = 0;
      let totalUECoeff = 0;

      const subjectReports = ue.subjects.map((subject) => {
        const grade = subject.grades[0];
        const absences = subject.attendances.reduce((acc, curr) => acc + curr.hoursAbsent, 0);
        const penalty = absences * 0.01;
        totalAbsences += absences;
        totalPenalty += penalty;

        if (!grade) {
          return { subject: subject.name, average: 0, status: 'NOT_GRADED', absences, penalty };
        }

        let average = 0;
        if (grade.rattrapageGrade !== null && grade.rattrapageGrade !== undefined) {
          average = grade.rattrapageGrade;
        } else {
          if (grade.ccGrade !== null && (grade.examGrade === null || grade.examGrade === undefined)) {
            average = grade.ccGrade;
          } else if (grade.examGrade !== null && (grade.ccGrade === null || grade.ccGrade === undefined)) {
            average = grade.examGrade;
          } else {
            average = (grade.ccGrade ?? 0) * 0.4 + (grade.examGrade ?? 0) * 0.6;
          }
        }

        average = Math.max(0, average - penalty);
        totalUEPoints += average * subject.coefficient;
        totalUECoeff += subject.coefficient;

        return {
          subject: subject.name,
          average: parseFloat(average.toFixed(2)),
          absences,
          penalty: parseFloat(penalty.toFixed(2)),
          grade,
        };
      });

      const ueAverage = totalUECoeff > 0 ? totalUEPoints / totalUECoeff : 0;
      totalSemesterPoints += ueAverage * ue.credits;
      totalSemesterCredits += ue.credits;

      return {
        ue: ue.name,
        average: parseFloat(ueAverage.toFixed(2)),
        credits: ue.credits,
        subjects: subjectReports,
      };
    });

    const semesterAverage = totalSemesterCredits > 0 ? totalSemesterPoints / totalSemesterCredits : 0;
    const finalReport = ueReports.map((ue) => ({
      ...ue,
      status: ue.average >= 10 || semesterAverage >= 10 ? 'VALIDATED' : 'NOT_VALIDATED',
    }));

    return {
      studentId,
      studentName: `${student.firstName} ${student.lastName}`,
      semesterAverage: parseFloat(semesterAverage.toFixed(2)),
      absences: totalAbsences,
      penalty: parseFloat(totalPenalty.toFixed(2)),
      report: finalReport,
      status: semesterAverage >= 10 ? 'ADMITTED' : 'FAILED',
    };
  }

  async getPromotionStats(semesterId: string) {
    const students = await this.prisma.student.findMany();
    const allReports = await Promise.all(
      students.map((s) => this.calculateStudentReport(s.id, semesterId)),
    );

    const semesterAverages = allReports.map((r) => r.semesterAverage);
    
    return {
      classAverage: parseFloat((semesterAverages.reduce((a, b) => a + b, 0) / semesterAverages.length || 0).toFixed(2)),
      min: semesterAverages.length > 0 ? Math.min(...semesterAverages) : 0,
      max: semesterAverages.length > 0 ? Math.max(...semesterAverages) : 0,
      count: students.length,
    };
  }

  async calculateAnnualReport(studentId: string, year: string) {
    const semesters = await this.prisma.semester.findMany({ where: { year } });
    const student = await this.prisma.student.findUnique({ where: { id: studentId } });
    if (!student) throw new NotFoundException('Student not found');

    const reports = await Promise.all(
      semesters.map((s) => this.calculateStudentReport(studentId, s.id)),
    );

    const validReports = reports.filter((r) => r.semesterAverage > 0);
    const annualAverage = validReports.length > 0 
      ? validReports.reduce((acc, curr) => acc + curr.semesterAverage, 0) / validReports.length 
      : 0;

    let mention = 'Sans mention';
    if (annualAverage >= 16) mention = 'Très Bien';
    else if (annualAverage >= 14) mention = 'Bien';
    else if (annualAverage >= 12) mention = 'Assez Bien';
    else if (annualAverage >= 10) mention = 'Passable';

    return {
      studentName: `${student.firstName} ${student.lastName}`,
      year,
      annualAverage: parseFloat(annualAverage.toFixed(2)),
      semesterReports: validReports,
      status: annualAverage >= 10 ? 'ADMITTED' : 'FAILED',
      mention,
    };
  }

  async getAuditLogs() {
    return this.prisma.auditLog.findMany({
      include: { user: { select: { email: true, role: true } } },
      orderBy: { timestamp: 'desc' },
      take: 100,
    });
  }
}
