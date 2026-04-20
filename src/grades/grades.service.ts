import { Injectable, NotFoundException } from '@nestjs/common';
import { DatabaseService } from '../database/database.service';
import { EnterGradeDto, EnterAttendanceDto } from './dto/grades.dto';

@Injectable()
export class GradesService {
  constructor(private prisma: DatabaseService) {}

  async enterGrade(dto: EnterGradeDto) {
    const student = await this.prisma.student.findUnique({ where: { id: dto.studentId } });
    if (!student) throw new NotFoundException('Student not found');

    const subject = await this.prisma.subject.findUnique({ where: { id: dto.subjectId } });
    if (!subject) throw new NotFoundException('Subject not found');

    return this.prisma.grade.upsert({
      where: {
        studentId_subjectId: {
          studentId: dto.studentId,
          subjectId: dto.subjectId,
        },
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
  }

  async enterAttendance(dto: EnterAttendanceDto) {
    return this.prisma.attendance.create({
      data: dto,
    });
  }

  async calculateStudentReport(studentId: string, semesterId: string) {
    const student = await this.prisma.student.findUnique({
      where: { id: studentId },
      include: { attendances: true },
    });
    if (!student) throw new NotFoundException('Student not found');

    const ues = await this.prisma.uE.findMany({
      where: { semesterId },
      include: {
        subjects: {
          include: {
            grades: { where: { studentId } },
          },
        },
      },
    });

    const totalAbsenceHours = student.attendances.reduce((acc, curr) => acc + curr.hoursAbsent, 0);
    const penalty = totalAbsenceHours * 0.01;

    let totalSemesterPoints = 0;
    let totalSemesterCredits = 0;

    const ueReports = ues.map((ue) => {
      let totalUEPoints = 0;
      let totalUECoeff = 0;

      const subjectReports = ue.subjects.map((subject) => {
        const grade = subject.grades[0];
        if (!grade) return { subject: subject.name, average: 0, status: 'NOT_GRADED' };

        // Calculation: (CC*0.4) + (Max(Exam, Rattrapage)*0.6)
        const examValue = grade.rattrapageGrade ?? grade.examGrade ?? 0;
        const rawAverage = (grade.ccGrade ?? 0) * 0.4 + examValue * 0.6;
        const average = Math.max(0, rawAverage - penalty);

        totalUEPoints += average * subject.coefficient;
        totalUECoeff += subject.coefficient;

        return {
          subject: subject.name,
          average: parseFloat(average.toFixed(2)),
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

    // Apply Compensation Logic
    const finalReport = ueReports.map((ue) => ({
      ...ue,
      status: ue.average >= 10 || semesterAverage >= 10 ? 'VALIDATED' : 'NOT_VALIDATED',
    }));

    return {
      student: `${student.firstName} ${student.lastName}`,
      semesterAverage: parseFloat(semesterAverage.toFixed(2)),
      penalty: parseFloat(penalty.toFixed(2)),
      absences: totalAbsenceHours,
      report: finalReport,
      status: semesterAverage >= 10 ? 'ADMITTED' : 'FAILED',
    };
  }
}
