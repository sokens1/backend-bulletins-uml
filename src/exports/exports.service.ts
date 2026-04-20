import { Injectable, NotFoundException } from '@nestjs/common';
import { GradesService } from '../grades/grades.service';
import { PrismaService } from '../prisma/prisma.service';
import { PDFDocument, rgb, StandardFonts } from 'pdf-lib';
import * as ExcelJS from 'exceljs';

@Injectable()
export class ExportsService {
  constructor(
    private gradesService: GradesService,
    private prisma: PrismaService,
  ) {}

  async generateBulletinPdf(studentId: string, semesterId: string): Promise<Buffer> {
    const report = await this.gradesService.calculateStudentReport(studentId, semesterId);
    const semester = await this.prisma.semester.findUnique({ where: { id: semesterId } });
    
    const pdfDoc = await PDFDocument.create();
    const page = pdfDoc.addPage([600, 800]);
    const { width, height } = page.getSize();
    
    const fontNormal = await pdfDoc.embedFont(StandardFonts.Helvetica);
    const fontBold = await pdfDoc.embedFont(StandardFonts.HelveticaBold);

    // Header
    page.drawText('INPTIC - GABON', { x: 50, y: height - 50, size: 20, font: fontBold });
    page.drawText('BULLETIN DE NOTES', { x: width / 2 - 70, y: height - 100, size: 18, font: fontBold });
    page.drawText(`Année académique: ${semester?.year || 'N/A'}`, { x: 50, y: height - 130, size: 12, font: fontNormal });
    page.drawText(`Semestre: ${semester?.name || 'N/A'}`, { x: width - 150, y: height - 130, size: 12, font: fontNormal });

    // Student Info
    page.drawText(`Étudiant: ${report.student}`, { x: 50, y: height - 170, size: 14, font: fontBold });
    page.drawText(`Pénalité Absence: ${report.penalty} pts (${report.absences}h)`, { x: width - 250, y: height - 170, size: 10, font: fontNormal });

    // Table Header
    let currentY = height - 210;
    page.drawRectangle({ x: 45, y: currentY - 5, width: width - 90, height: 20, color: rgb(0.9, 0.9, 0.9) });
    page.drawText('Matière', { x: 50, y: currentY, size: 10, font: fontBold });
    page.drawText('Note CC', { x: 250, y: currentY, size: 10, font: fontBold });
    page.drawText('Note Exam', { x: 320, y: currentY, size: 10, font: fontBold });
    page.drawText('Moyenne', { x: 400, y: currentY, size: 10, font: fontBold });
    page.drawText('Crédits', { x: 480, y: currentY, size: 10, font: fontBold });
    page.drawText('Status', { x: 540, y: currentY, size: 10, font: fontBold });

    // Table Content
    for (const ue of report.report) {
      currentY -= 25;
      page.drawText(`${ue.ue}`, { x: 50, y: currentY, size: 10, font: fontBold, color: rgb(0.1, 0.2, 0.5) });
      
      for (const subj of ue.subjects) {
        currentY -= 20;
        page.drawText(subj.subject.substring(0, 30), { x: 60, y: currentY, size: 9, font: fontNormal });
        page.drawText(subj.grade?.ccGrade?.toString() || '-', { x: 250, y: currentY, size: 9, font: fontNormal });
        page.drawText((subj.grade?.rattrapageGrade ?? subj.grade?.examGrade ?? '-').toString(), { x: 320, y: currentY, size: 9, font: fontNormal });
        page.drawText(subj.average.toString(), { x: 400, y: currentY, size: 9, font: fontBold });
        page.drawText(ue.credits.toString(), { x: 480, y: currentY, size: 9, font: fontNormal });
        page.drawText(ue.status, { x: 540, y: currentY, size: 8, font: fontNormal });
      }
    }

    // Footer
    currentY -= 40;
    page.drawRectangle({ x: 350, y: currentY - 30, width: 200, height: 60, color: rgb(0.95, 0.95, 0.95) });
    page.drawText(`MOYENNE SEMESTRIELLE: ${report.semesterAverage}`, { x: 360, y: currentY, size: 12, font: fontBold });
    page.drawText(`DÉCISION: ${report.status}`, { x: 360, y: currentY - 20, size: 12, font: fontBold, color: report.status === 'ADMITTED' ? rgb(0, 0.5, 0) : rgb(0.8, 0, 0) });

    const pdfBytes = await pdfDoc.save();
    return Buffer.from(pdfBytes);
  }

  async importGradesFromExcel(buffer: Buffer, semesterId: string) {
    const workbook = new ExcelJS.Workbook();
    await workbook.xlsx.load(buffer as any);
    const worksheet = workbook.getWorksheet(1);
    
    if (!worksheet) throw new NotFoundException('Worksheet not found');

    const results: { studentId: string; subjectId: string; ccGrade: number; examGrade: number }[] = [];
    worksheet.eachRow((row, rowNumber) => {
      if (rowNumber === 1) return; // Skip header

      const studentId = row.getCell(1).value as string;
      const subjectId = row.getCell(2).value as string;
      const ccGrade = row.getCell(3).value as number;
      const examGrade = row.getCell(4).value as number;

      results.push({ studentId, subjectId, ccGrade, examGrade });
    });

    for (const res of results) {
      await this.prisma.grade.upsert({
        where: {
          studentId_subjectId: { studentId: res.studentId, subjectId: res.subjectId }
        },
        update: { ccGrade: res.ccGrade, examGrade: res.examGrade },
        create: { studentId: res.studentId, subjectId: res.subjectId, ccGrade: res.ccGrade, examGrade: res.examGrade }
      });
    }

    return { imported: results.length };
  }
}
