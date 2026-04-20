import { Injectable, NotFoundException } from '@nestjs/common';
import { GradesService } from '../grades/grades.service';
import { DatabaseService } from '../database/database.service';
import { PDFDocument, rgb, StandardFonts } from 'pdf-lib';
import * as ExcelJS from 'exceljs';

@Injectable()
export class ExportsService {
  constructor(
    private gradesService: GradesService,
    private prisma: DatabaseService,
  ) {}

  async generateBulletinPdf(studentId: string, semesterId: string): Promise<Buffer> {
    const report = await this.gradesService.calculateStudentReport(studentId, semesterId);
    const stats = await this.gradesService.getPromotionStats(semesterId);
    const semester = await this.prisma.semester.findUnique({ where: { id: semesterId } });
    
    const pdfDoc = await PDFDocument.create();
    const page = pdfDoc.addPage([600, 850]);
    const { width, height } = page.getSize();
    
    const fontNormal = await pdfDoc.embedFont(StandardFonts.Helvetica);
    const fontBold = await pdfDoc.embedFont(StandardFonts.HelveticaBold);

    // Header INPTIC
    page.drawText('INSTITUT NATIONAL DE LA POSTE, DES TIC', { x: 50, y: height - 40, size: 12, font: fontBold });
    page.drawText('DIRECTION DES ETUDES - INPTIC GABON', { x: 50, y: height - 55, size: 10, font: fontNormal });
    
    page.drawText('BULLETIN DE NOTES', { x: width / 2 - 70, y: height - 100, size: 18, font: fontBold, color: rgb(0.1, 0.2, 0.4) });
    page.drawText(`Année académique: ${semester?.year || 'N/A'}`, { x: 50, y: height - 130, size: 12, font: fontNormal });
    page.drawText(`Semestre: ${semester?.name || 'N/A'}`, { x: width - 150, y: height - 130, size: 12, font: fontNormal });

    // Student Info
    page.drawText(`Nom & Prénom: ${report.studentName}`, { x: 50, y: height - 170, size: 14, font: fontBold });
    page.drawText(`Absences: ${report.absences}h (Pénalité: -${report.penalty} pts)`, { x: width - 200, y: height - 170, size: 10, font: fontNormal });

    // Table Header
    let currentY = height - 210;
    page.drawRectangle({ x: 45, y: currentY - 5, width: width - 90, height: 25, color: rgb(0.1, 0.2, 0.4) });
    const headerColor = rgb(1, 1, 1);
    page.drawText('Matière', { x: 50, y: currentY, size: 9, font: fontBold, color: headerColor });
    page.drawText('Moy', { x: 250, y: currentY, size: 9, font: fontBold, color: headerColor });
    page.drawText('Coeff', { x: 300, y: currentY, size: 9, font: fontBold, color: headerColor });
    page.drawText('Moy Class', { x: 350, y: currentY, size: 9, font: fontBold, color: headerColor });
    page.drawText('Min/Max', { x: 430, y: currentY, size: 9, font: fontBold, color: headerColor });
    page.drawText('Crédits', { x: 500, y: currentY, size: 9, font: fontBold, color: headerColor });
    page.drawText('Validation', { x: 545, y: currentY, size: 8, font: fontBold, color: headerColor });

    // Table Content
    for (const ue of report.report) {
      currentY -= 30;
      page.drawRectangle({ x: 45, y: currentY - 5, width: width - 90, height: 20, color: rgb(0.9, 0.9, 0.95) });
      page.drawText(`${ue.ue}`, { x: 50, y: currentY, size: 10, font: fontBold, color: rgb(0.1, 0.2, 0.5) });
      page.drawText(`Aver: ${ue.average}`, { x: width - 150, y: currentY, size: 10, font: fontBold });
      
      for (const subj of ue.subjects) {
        currentY -= 20;
        page.drawText(subj.subject.substring(0, 35), { x: 60, y: currentY, size: 9, font: fontNormal });
        page.drawText(subj.average.toString(), { x: 250, y: currentY, size: 9, font: fontBold });
        page.drawText(subj.grade ? '1' : '0', { x: 300, y: currentY, size: 9, font: fontNormal }); // Simplified coeff display
        
        // Placeholder Stats per subject (in a real app, calculate this per subject in getPromotionStats)
        page.drawText(`${stats.classAverage}`, { x: 350, y: currentY, size: 9, font: fontNormal });
        page.drawText(`${stats.min}/${stats.max}`, { x: 430, y: currentY, size: 9, font: fontNormal });
        
        page.drawText(ue.credits.toString(), { x: 510, y: currentY, size: 9, font: fontNormal });
        page.drawText(ue.status === 'VALIDATED' ? 'Acquis' : 'Echec', { x: 545, y: currentY, size: 8, font: fontNormal });
      }
    }

    // Results Box
    currentY -= 60;
    page.drawRectangle({ x: 350, y: currentY - 40, width: 220, height: 80, borderColor: rgb(0.1, 0.2, 0.4), borderWidth: 2 });
    page.drawText(`MOYENNE SEMESTRIELLE: ${report.semesterAverage}`, { x: 360, y: currentY, size: 12, font: fontBold });
    page.drawText(`RÉSULTAT: ${report.status}`, { x: 360, y: currentY - 20, size: 12, font: fontBold, color: report.status === 'ADMITTED' ? rgb(0, 0.5, 0) : rgb(0.8, 0, 0) });
    page.drawText(`Rang: 1 / ${stats.count}`, { x: 360, y: currentY - 35, size: 10, font: fontNormal });

    const pdfBytes = await pdfDoc.save();
    return Buffer.from(pdfBytes);
  }

  async importGradesFromExcel(buffer: Buffer, semesterId: string, userId: string) {
    const workbook = new ExcelJS.Workbook();
    await workbook.xlsx.load(buffer as any);
    const worksheet = workbook.getWorksheet(1);
    
    if (!worksheet) throw new NotFoundException('Worksheet not found');

    let count = 0;
    for (let i = 2; i <= worksheet.rowCount; i++) {
      const row = worksheet.getRow(i);
      const studentId = row.getCell(1).toString();
      const subjectId = row.getCell(2).toString();
      const ccGrade = parseFloat(row.getCell(3).toString());
      const examGrade = parseFloat(row.getCell(4).toString());
      const rattrapageGrade = row.getCell(5).value ? parseFloat(row.getCell(5).toString()) : undefined;

      if (studentId && subjectId) {
        await this.gradesService.enterGrade({
          studentId,
          subjectId,
          ccGrade,
          examGrade,
          rattrapageGrade,
        }, userId);
        count++;
      }
    }

    return { imported: count };
  }
}
