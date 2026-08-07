import { Injectable, NotFoundException, ForbiddenException } from '@nestjs/common';
import { DatabaseService } from '../database/database.service';
import { EnterGradeDto, EnterAttendanceDto } from './dto/grades.dto';
import { SettingsService } from '../settings/settings.service';

@Injectable()
export class GradesService {
  constructor(
    private prisma: DatabaseService,
    private settingsService: SettingsService,
  ) {}

  private async findStudent(idOrUserId: string) {
    const student = await this.prisma.student.findFirst({
      where: {
        OR: [
          { id: idOrUserId },
          { userId: idOrUserId }
        ]
      }
    });
    if (!student) throw new NotFoundException('Student not found');
    return student;
  }

  async enterGrade(dto: EnterGradeDto, userId: string) {
    const student = await this.findStudent(dto.studentId);
    
    const subject = await this.prisma.subject.findUnique({ 
      where: { id: dto.subjectId },
      include: { ue: { include: { semester: true } } }
    });
    if (!subject) throw new NotFoundException('Subject not found');

    const user = await this.prisma.user.findUnique({ where: { id: userId } });
    if (subject.ue.semester.isLocked && user?.role !== 'ADMIN') {
      throw new ForbiddenException('Ce semestre est verrouillé. Vous ne pouvez plus modifier les notes.');
    }

    // Security Check: 5.7 - Teacher can only enter grades for their own subjects

    if (user?.role === 'TEACHER') {
      const teacher = await this.prisma.teacher.findUnique({ where: { userId } });
      if (!teacher || subject.teacherId !== teacher.id) {
        throw new ForbiddenException('Vous n\'êtes pas autorisé à saisir des notes pour cette matière.');
      }
    }

    const oldGrade = await this.prisma.grade.findUnique({
      where: {
        studentId_subjectId: { studentId: student.id, subjectId: dto.subjectId },
      },
    });

    const grade = await this.prisma.grade.upsert({
      where: {
        studentId_subjectId: { studentId: student.id, subjectId: dto.subjectId },
      },
      update: {
        ccGrade: dto.ccGrade,
        examGrade: dto.examGrade,
        rattrapageGrade: dto.rattrapageGrade,
      },
      create: {
        studentId: student.id,
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

  async getStudentSubjectGrade(studentId: string, subjectId: string, userId: string) {
    const student = await this.findStudent(studentId);
    const subject = await this.prisma.subject.findUnique({ where: { id: subjectId } });
    if (!subject) throw new NotFoundException('Subject not found');

    const user = await this.prisma.user.findUnique({ where: { id: userId } });
    if (user?.role === 'TEACHER') {
      const teacher = await this.prisma.teacher.findUnique({ where: { userId } });
      if (!teacher || subject.teacherId !== teacher.id) {
        throw new ForbiddenException('Vous n\'êtes pas autorisé à consulter les notes de cette matière.');
      }
    }

    return this.prisma.grade.findUnique({
      where: {
        studentId_subjectId: { studentId: student.id, subjectId },
      },
    });
  }

  async getSubjectGrades(subjectId: string, userId: string) {
    const subject = await this.prisma.subject.findUnique({ where: { id: subjectId } });
    if (!subject) throw new NotFoundException('Subject not found');

    const user = await this.prisma.user.findUnique({ where: { id: userId } });
    if (user?.role === 'TEACHER') {
      const teacher = await this.prisma.teacher.findUnique({ where: { userId } });
      if (!teacher || subject.teacherId !== teacher.id) {
        throw new ForbiddenException('Vous n\'êtes pas autorisé à consulter les notes de cette matière.');
      }
    }

    const students = await this.prisma.student.findMany({
      orderBy: { lastName: 'asc' },
    });

    const grades = await this.prisma.grade.findMany({
      where: { subjectId },
    });

    const attendances = await this.prisma.attendance.findMany({
      where: { subjectId },
    });

    const rules = await this.getRulesSettings();

    return students.map(s => {
      const g = grades.find(grade => grade.studentId === s.id);
      const studentAttendances = attendances.filter(a => a.studentId === s.id);
      const totalAbsences = studentAttendances.reduce((acc, curr) => acc + curr.hoursAbsent, 0);
      
      let average = 0;
      if (g) {
        average = this.computeSubjectAverage(
          g,
          subject.ccWeight ?? 0.4,
          subject.examWeight ?? 0.6,
          totalAbsences,
          rules.absencePenaltyPerHour
        );
      }

      return {
        student: s,
        grade: g || null,
        absences: totalAbsences,
        average: parseFloat(average.toFixed(2)),
      };
    });
  }

  async getSemesterGrades(semesterId: string, userId: string) {
    const user = await this.prisma.user.findUnique({ where: { id: userId }, include: { teacher: true } });
    
    const subjects = await this.prisma.subject.findMany({
      where: {
        ue: { semesterId },
        ...(user?.role === 'TEACHER' ? { teacherId: user.teacher?.id } : {}),
      },
      include: { ue: true },
    });

    const grades = await this.prisma.grade.findMany({
      where: {
        subjectId: { in: subjects.map(s => s.id) },
      },
    });

    const attendances = await this.prisma.attendance.findMany({
       where: { subjectId: { in: subjects.map(s => s.id) } }
    });

    const students = await this.prisma.student.findMany({
      orderBy: { lastName: 'asc' },
    });

    const rules = await this.getRulesSettings();

    const results: any[] = [];
    for (const student of students) {
      for (const subject of subjects) {
        const g = grades.find(grade => grade.studentId === student.id && grade.subjectId === subject.id);
        const studentAttendances = attendances.filter(a => a.studentId === student.id && a.subjectId === subject.id);
        const totalAbsences = studentAttendances.reduce((acc, curr) => acc + curr.hoursAbsent, 0);
        
        let average = 0;
        if (g) {
          average = this.computeSubjectAverage(
            g,
            subject.ccWeight ?? 0.4,
            subject.examWeight ?? 0.6,
            totalAbsences,
            rules.absencePenaltyPerHour
          );
        }

        results.push({
          student,
          subject: {
            id: subject.id,
            name: subject.name,
            ueName: subject.ue.name,
          },
          grade: g || null,
          absences: totalAbsences,
          average: parseFloat(average.toFixed(2)),
        });
      }
    }

    return results;
  }

  async enterAttendance(dto: EnterAttendanceDto, userId: string) {
    const student = await this.findStudent(dto.studentId);
    
    const subject = await this.prisma.subject.findUnique({
      where: { id: dto.subjectId },
      include: { ue: { include: { semester: true } } }
    });
    if (!subject) throw new NotFoundException('Subject not found');

    const user = await this.prisma.user.findUnique({ where: { id: userId } });
    if (subject.ue.semester.isLocked && user?.role !== 'ADMIN') {
      throw new ForbiddenException('Ce semestre est verrouillé. Vous ne pouvez plus modifier les absences.');
    }

    const attendance = await this.prisma.attendance.create({
      data: {
        ...dto,
        studentId: student.id
      },
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

  private computeSubjectAverage(
    grade: {
      ccGrade: number | null;
      examGrade: number | null;
      rattrapageGrade: number | null;
    },
    ccWeight: number,
    examWeight: number,
    hoursAbsent: number = 0,
    absencePenaltyPerHour: number = 0
  ) {
    let baseAvg = 0;
    if (grade.rattrapageGrade !== null && grade.rattrapageGrade !== undefined) {
      baseAvg = grade.rattrapageGrade;
    } else if (grade.ccGrade !== null && (grade.examGrade === null || grade.examGrade === undefined)) {
      baseAvg = grade.ccGrade;
    } else if (grade.examGrade !== null && (grade.ccGrade === null || grade.ccGrade === undefined)) {
      baseAvg = grade.examGrade;
    } else {
      baseAvg = (grade.ccGrade ?? 0) * ccWeight + (grade.examGrade ?? 0) * examWeight;
    }

    const penalty = hoursAbsent * absencePenaltyPerHour;
    const finalAvg = Math.max(0, baseAvg - penalty);
    return finalAvg;
  }

  private async getRulesSettings() {
    return this.settingsService.getAcademicRulesSettings();
  }

  private computeStdDev(values: number[]): number {
    if (!values.length) return 0;
    const mean = values.reduce((a, b) => a + b, 0) / values.length;
    const variance = values.reduce((acc, v) => acc + Math.pow(v - mean, 2), 0) / values.length;
    return Math.sqrt(variance);
  }

  async calculateStudentReport(studentId: string, semesterId: string) {
    const student = await this.findStudent(studentId);
    const { reportsByStudentId } = await this.computeSemesterReports(semesterId);
    const report = reportsByStudentId.get(student.id);
    if (!report) throw new NotFoundException('Student profile not found');
    return report;
  }

  // Batch-computes every student's semester report (per-UE averages, credits, status, rank)
  // in a handful of bulk queries instead of one DB round-trip per student. Calling
  // calculateStudentReport in a loop used to be O(n²) (each call re-ranked against every
  // other student from scratch) — that's what made bulk bulletin downloads time out.
  async computeSemesterReports(semesterId: string) {
    const rules = await this.getRulesSettings();
    const students = await this.prisma.student.findMany({ include: { user: true } });
    const ues = await this.prisma.uE.findMany({
      where: { semesterId },
      include: {
        subjects: {
          include: {
            grades: true,
            attendances: true,
          },
        },
      },
    });

    const buildReport = (studentId: string) => {
      let totalSemesterPoints = 0;
      let totalSemesterCredits = 0;

      const ueReports = ues.map((ue) => {
        let totalUEPoints = 0;
        let totalUECoeff = 0;

        const subjectReports = ue.subjects.map((subject) => {
          const grade = subject.grades.find((g) => g.studentId === studentId);
          const totalAbsences = subject.attendances
            .filter((a) => a.studentId === studentId)
            .reduce((acc, curr) => acc + curr.hoursAbsent, 0);

          const average = grade
            ? this.computeSubjectAverage(
                grade,
                subject.ccWeight ?? 0.4,
                subject.examWeight ?? 0.6,
                totalAbsences,
                rules.absencePenaltyPerHour
              )
            : 0;

          // An ungraded subject must still weigh into the UE average as a 0 — previously
          // it was skipped entirely, so a UE with e.g. 2 graded subjects and 3 completely
          // ungraded ones averaged only the 2 graded ones and could wrongly come out "acquise".
          totalUEPoints += average * subject.coefficient;
          totalUECoeff += subject.coefficient;

          return {
            subject: subject.name,
            average: parseFloat(average.toFixed(2)),
            status: grade ? undefined : 'NOT_GRADED',
            credits: subject.credits,
            coefficient: subject.coefficient,
            grade: grade ?? null,
            absences: totalAbsences,
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
      const isSemesterValidated = totalCreditsWon >= totalSemesterCredits;

      const hasCompensatedUE = finalReport.some(ue => ue.average < 10 && ue.creditsWon > 0);
      const semesterStatus = isSemesterValidated
        ? (hasCompensatedUE ? 'Semestre validé par compensation' : 'Semestre validé')
        : 'Semestre non validé';
      // Mirrors the "UE Acquise / UE Acquise par Compensation / UE non Acquise" wording
      // used per-UE, for the "Etat de la Validation des Crédits" summary cell.
      const creditValidationStatus = isSemesterValidated
        ? (hasCompensatedUE ? 'Semestre Acquis par Compensation' : 'Semestre Acquis')
        : 'Semestre non Acquis';

      return {
        semesterAverage: parseFloat(semesterAverage.toFixed(2)),
        report: finalReport,
        totalCreditsWon,
        totalCreditsExpected: totalSemesterCredits,
        status: semesterStatus,
        creditValidationStatus,
      };
    };

    const rawReports = students.map((student) => ({ student, data: buildReport(student.id) }));
    const ranked = [...rawReports].sort((a, b) => b.data.semesterAverage - a.data.semesterAverage);

    const reportsByStudentId = new Map(
      rawReports.map(({ student, data }) => [
        student.id,
        {
          student,
          semesterId,
          ...data,
          rank: ranked.findIndex((r) => r.student.id === student.id) + 1,
          totalStudents: students.length,
        },
      ]),
    );

    return { reportsByStudentId, students, ues };
  }

  async getPromotionStats(
    semesterId: string,
    precomputed?: Awaited<ReturnType<GradesService['computeSemesterReports']>>,
  ) {
    const { reportsByStudentId, students, ues } = precomputed ?? (await this.computeSemesterReports(semesterId));
    const reports = [...reportsByStudentId.values()];
    const averages = reports.map((r) => r.semesterAverage);
    const stdDev = this.computeStdDev(averages);

    const subjectStats = ues.flatMap((ue) => ue.subjects).map((subj) => {
      // Class-wide subject average is intentionally computed without the per-student
      // absence penalty (0, 0) — it reflects raw academic performance across the class.
      const subjAvgs = subj.grades.map((g) =>
        this.computeSubjectAverage(g, subj.ccWeight ?? 0.4, subj.examWeight ?? 0.6, 0, 0),
      );
      const avg = subjAvgs.length > 0 ? subjAvgs.reduce((a, b) => a + b, 0) / subjAvgs.length : 0;

      return {
        subjectName: subj.name,
        average: parseFloat(avg.toFixed(2)),
      };
    });

    return {
      classAverage: parseFloat((averages.reduce((a, b) => a + b, 0) / averages.length || 0).toFixed(2)),
      min: parseFloat((averages.length > 0 ? Math.min(...averages) : 0).toFixed(2)),
      max: parseFloat((averages.length > 0 ? Math.max(...averages) : 0).toFixed(2)),
      stdDev: parseFloat(stdDev.toFixed(2)),
      count: students.length,
      subjectStats,
      studentResults: reports.map((r) => ({
        studentId: r.student.id,
        student: {
          id: r.student.id,
          firstName: r.student.firstName,
          lastName: r.student.lastName,
        },
        semesterAverage: r.semesterAverage,
        rank: r.rank,
        totalCreditsWon: r.totalCreditsWon,
        status: r.status,
      })),
    };
  }

  async getAnnualPromotionStats(year: string) {
    const students = await this.prisma.student.findMany({
      include: { user: true }
    });

    const studentReports = await Promise.all(
      students.map(async (s) => {
        const report = await this.calculateAnnualReport(s.id, year);
        return {
          studentId: s.id,
          student: {
            id: s.id,
            firstName: s.firstName,
            lastName: s.lastName,
          },
          annualAverage: report.annualAverage,
          status: report.status,
          juryDecision: report.juryDecision,
          mention: report.mention,
          totalCreditsWon: report.totalCreditsWon,
        };
      })
    );

    const averages = studentReports.map(r => r.annualAverage);
    const sortedAverages = [...averages].sort((a, b) => b - a);
    const stdDev = this.computeStdDev(averages);

    return {
      classAverage: parseFloat((averages.reduce((a, b) => a + b, 0) / averages.length || 0).toFixed(2)),
      min: parseFloat((averages.length > 0 ? Math.min(...averages) : 0).toFixed(2)),
      max: parseFloat((averages.length > 0 ? Math.max(...averages) : 0).toFixed(2)),
      stdDev: parseFloat(stdDev.toFixed(2)),
      count: students.length,
      studentResults: studentReports.map(r => ({
        ...r,
        rank: sortedAverages.indexOf(r.annualAverage) + 1,
      })),
    };
  }

  async calculateAnnualReport(studentId: string, year: string) {
    const rules = await this.getRulesSettings();
    const semesters = await this.prisma.semester.findMany({ where: { year } });
    const student = await this.findStudent(studentId);
    const actualStudentId = student.id;

    const reports = await Promise.all(
      semesters.map((s) => this.calculateStudentReport(actualStudentId, s.id)),
    );

    const reportBySemesterName = semesters.reduce<Record<string, (typeof reports)[number]>>((acc, semester, index) => {
      acc[semester.name] = reports[index];
      return acc;
    }, {});
    const s5Report = reportBySemesterName['S5'];
    const s6Report = reportBySemesterName['S6'];
    if (!s5Report || !s6Report) {
      throw new NotFoundException('Le calcul annuel requiert les semestres S5 et S6.');
    }
    const annualAverage = (s5Report.semesterAverage + s6Report.semesterAverage) / 2;

    let mention = 'Non attribuée';
    if (annualAverage >= 16) mention = 'Très Bien';
    else if (annualAverage >= 14) mention = 'Bien';
    else if (annualAverage >= 12) mention = 'Assez Bien';
    else if (annualAverage >= 10) mention = 'Passable';

    const totalCreditsWon = reports.reduce((acc, curr) => acc + (curr.totalCreditsWon ?? 0), 0);
    const totalCreditsExpected = reports.reduce((acc, curr) => acc + (curr.totalCreditsExpected ?? 0), 0);
    const semestersValidated = reports.every((r) => (r.totalCreditsWon ?? 0) >= (r.totalCreditsExpected ?? 0));

    const soutenanceUe = reports
      .flatMap((r) => r.report ?? [])
      .find((ue) => ue.ueCode === rules.soutenanceUeCode);
    const soutenanceCredits = soutenanceUe?.creditsExpected ?? 0;
    const soutenanceNotAcquired = soutenanceUe ? soutenanceUe.creditsWon < soutenanceCredits : false;

    const canRetakeSoutenance =
      rules.enableSoutenanceRetake &&
      !!soutenanceUe &&
      soutenanceNotAcquired &&
      totalCreditsWon >= totalCreditsExpected - soutenanceCredits;

    let juryDecision = 'Redouble la Licence 3';
    if (semestersValidated && totalCreditsWon >= 60) {
      juryDecision = 'Diplômé(e)';
    } else if (canRetakeSoutenance) {
      juryDecision = 'Reprise de soutenance';
    }

    const hasCompensatedSemester = reports.some(r => r.semesterAverage < 10);
    const annualStatus = annualAverage >= 10 
      ? (hasCompensatedSemester ? 'Admis(e) par compensation' : 'Admis(e)')
      : 'Ajourné(e)';

    return {
      student,
      year,
      annualAverage: parseFloat(annualAverage.toFixed(2)),
      semesterReports: reports,
      totalCreditsWon,
      totalCreditsExpected,
      status: annualStatus,
      juryDecision,
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

  async findAllAttendances() {
    return this.prisma.attendance.findMany({
      include: {
        student: true,
        subject: {
          include: {
            ue: {
              include: {
                semester: true
              }
            }
          }
        },
      },
      orderBy: { student: { lastName: 'asc' } },
    });
  }

  async updateAttendance(id: string, dto: EnterAttendanceDto, userId: string) {
    const existing = await this.prisma.attendance.findUnique({
      where: { id },
      include: { subject: { include: { ue: { include: { semester: true } } } } }
    });
    if (!existing) throw new NotFoundException('Attendance not found');

    const user = await this.prisma.user.findUnique({ where: { id: userId } });
    if (existing.subject.ue.semester.isLocked && user?.role !== 'ADMIN') {
      throw new ForbiddenException('Ce semestre est verrouillé. Vous ne pouvez plus modifier les absences.');
    }

    const attendance = await this.prisma.attendance.update({
      where: { id },
      data: {
        hoursAbsent: dto.hoursAbsent,
      },
    });

    await this.prisma.auditLog.create({
      data: {
        userId,
        action: 'UPDATE_ATTENDANCE',
        entity: 'Attendance',
        entityId: attendance.id,
        newData: attendance as any,
      },
    });

    return attendance;
  }

  async deleteAttendance(id: string, userId: string) {
    const existing = await this.prisma.attendance.findUnique({
      where: { id },
      include: { subject: { include: { ue: { include: { semester: true } } } } }
    });
    if (!existing) throw new NotFoundException('Attendance not found');

    const user = await this.prisma.user.findUnique({ where: { id: userId } });
    if (existing.subject.ue.semester.isLocked && user?.role !== 'ADMIN') {
      throw new ForbiddenException('Ce semestre est verrouillé. Vous ne pouvez plus supprimer d\'absences.');
    }

    const attendance = await this.prisma.attendance.delete({
      where: { id },
    });

    await this.prisma.auditLog.create({
      data: {
        userId,
        action: 'DELETE_ATTENDANCE',
        entity: 'Attendance',
        entityId: id,
        oldData: attendance as any,
      },
    });

    return attendance;
  }
}
