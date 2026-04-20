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
          credits: subject.credits,
          absences,
          penalty: parseFloat(penalty.toFixed(2)),
          grade,
        };
      });

      const ueAverage = totalUECoeff > 0 ? totalUEPoints / totalUECoeff : 0;
      totalSemesterPoints += ueAverage * ue.credits;
      totalSemesterCredits += ue.credits;

      return {
        ueName: ue.name,
        ueCode: ue.code,
        average: parseFloat(ueAverage.toFixed(2)),
        creditsExpected: ue.credits,
        subjects: subjectReports,
      };
    });

    const semesterAverage = totalSemesterCredits > 0 ? totalSemesterPoints / totalSemesterCredits : 0;
    
    // Detailed acquisition status
    const finalReport = ueReports.map((ue) => {
      let status = 'UE non Acquise';
      let creditsWon = 0;

      if (ue.average >= 10) {
        status = 'UE Acquise';
        creditsWon = ue.creditsExpected;
      } else if (semesterAverage >= 10) {
        status = 'UE Acquise par Compensation';
        creditsWon = ue.creditsExpected;
      }

      return { ...ue, status, creditsWon };
    });

    const totalCreditsWon = finalReport.reduce((acc, curr) => acc + curr.creditsWon, 0);

    // Rank calculation
    const rankData = await this.getStudentRank(studentId, semesterId, parseFloat(semesterAverage.toFixed(2)));

    return {
      student,
      semesterAverage: parseFloat(semesterAverage.toFixed(2)),
      absences: totalAbsences,
      penalty: parseFloat(totalPenalty.toFixed(2)),
      report: finalReport,
      totalCreditsWon,
      rank: rankData.rank,
      totalStudents: rankData.total,
      status: semesterAverage >= 10 ? 'Semestre validé' : 'Semestre non validé',
    };
  }

  private async getStudentRank(studentId: string, semesterId: string, currentAvg: number) {
    const students = await this.prisma.student.findMany();
    const averages = await Promise.all(
      students.map(async (s) => {
        const report = await this.calculateStudentReportRaw(s.id, semesterId);
        return { id: s.id, avg: report };
      }),
    );

    const sorted = averages.sort((a, b) => b.avg - a.avg);
    const rank = sorted.findIndex((s) => s.id === studentId) + 1;
    
    return { rank, total: students.length };
  }

  // Raw calculation to avoid recursion
  private async calculateStudentReportRaw(studentId: string, semesterId: string) {
    const ues = await this.prisma.uE.findMany({
      where: { semesterId },
      include: { subjects: { include: { grades: { where: { studentId } } } } },
    });

    let totalSemesterPoints = 0;
    let totalSemesterCredits = 0;

    for (const ue of ues) {
      let totalUEPoints = 0;
      let totalUECoeff = 0;

      for (const subj of ue.subjects) {
        const grade = subj.grades[0];
        if (!grade) continue;

        let avg = 0;
        if (grade.rattrapageGrade !== null) avg = grade.rattrapageGrade;
        else avg = (grade.ccGrade ?? 0) * 0.4 + (grade.examGrade ?? 0) * 0.6;
        
        totalUEPoints += avg * subj.coefficient;
        totalUECoeff += subj.coefficient;
      }

      const ueAvg = totalUECoeff > 0 ? totalUEPoints / totalUECoeff : 0;
      totalSemesterPoints += ueAvg * ue.credits;
      totalSemesterCredits += ue.credits;
    }

    return totalSemesterCredits > 0 ? totalSemesterPoints / totalSemesterCredits : 0;
  }

  async getPromotionStats(semesterId: string) {
    const students = await this.prisma.student.findMany();
    const allReports = await Promise.all(
      students.map((s) => this.calculateStudentReport(s.id, semesterId)),
    );

    const averages = allReports.map((r) => r.semesterAverage);
    
    // Calculate per-subject averages
    const subjects = await this.prisma.subject.findMany({
      where: { ue: { semesterId } },
    });

    const subjectStats = subjects.map((subj) => {
      const subjectGrades = allReports
        .flatMap((r) => r.report.flatMap((ue) => ue.subjects))
        .filter((s) => s.subject === subj.name);
      
      const avg = subjectGrades.length > 0 
        ? subjectGrades.reduce((acc, curr) => acc + curr.average, 0) / subjectGrades.length 
        : 0;

      return {
        subjectName: subj.name,
        average: parseFloat(avg.toFixed(2)),
      };
    });

    return {
      classAverage: parseFloat((averages.reduce((a, b) => a + b, 0) / averages.length || 0).toFixed(2)),
      min: averages.length > 0 ? Math.min(...averages) : 0,
      max: averages.length > 0 ? Math.max(...averages) : 0,
      count: students.length,
      subjectStats,
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

    let mention = 'Passable';
    if (annualAverage >= 16) mention = 'Très Bien';
    else if (annualAverage >= 14) mention = 'Bien';
    else if (annualAverage >= 12) mention = 'Assez Bien';

    return {
      student,
      year,
      annualAverage: parseFloat(annualAverage.toFixed(2)),
      semesterReports: validReports,
      status: annualAverage >= 10 ? 'Admis(e)' : 'Ajourné(e)',
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
