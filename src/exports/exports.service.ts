import { Injectable, NotFoundException } from '@nestjs/common';
import { GradesService } from '../grades/grades.service';
import { DatabaseService } from '../database/database.service';
import { PDFDocument, rgb, StandardFonts, PDFFont, PDFPage } from 'pdf-lib';
import * as ExcelJS from 'exceljs';
import * as fs from 'fs';
import * as path from 'path';

@Injectable()
export class ExportsService {
  constructor(
    private gradesService: GradesService,
    private prisma: DatabaseService,
  ) {}

  async generateBulletinPdf(studentId: string, semesterId: string): Promise<Buffer> {
    const report = await this.gradesService.calculateStudentReport(studentId, semesterId);
    const globalStats = await this.gradesService.getPromotionStats(semesterId);
    const semester = await this.prisma.semester.findUnique({ where: { id: semesterId } });
    
    const pdfDoc = await PDFDocument.create();
    const page = pdfDoc.addPage([595.28, 841.89]); // A4 Size
    const { width, height } = page.getSize();
    
    const fontNormal = await pdfDoc.embedFont(StandardFonts.Helvetica);
    const fontBold = await pdfDoc.embedFont(StandardFonts.HelveticaBold);
    const fontItalic = await pdfDoc.embedFont(StandardFonts.HelveticaOblique);

    // Load Logo if exists
    let logoImage;
    try {
      const logoPath = path.join(process.cwd(), 'src/assets/logo-inptic.png');
      const logoBuffer = fs.readFileSync(logoPath);
      logoImage = await pdfDoc.embedPng(logoBuffer);
    } catch (e) {
      console.warn('Logo not found at src/assets/logo-inptic.png');
    }

    // 1. Header Left (Institution)
    const leftHeaderX = 40;
    let currentY = height - 40;
    page.drawText('INSTITUT NATIONAL DE LA POSTE, DES TECHNOLOGIES', { x: leftHeaderX, y: currentY, size: 8, font: fontBold });
    currentY -= 10;
    page.drawText("DE L'INFORMATION ET DE LA COMMUNICATION", { x: leftHeaderX, y: currentY, size: 8, font: fontBold });
    
    if (logoImage) {
      page.drawImage(logoImage, { x: leftHeaderX + 40, y: currentY - 45, width: 60, height: 40 });
    }
    
    currentY -= 55;
    page.drawText('DIRECTION DES ETUDES ET DE LA PEDAGOGIE', { x: leftHeaderX, y: currentY, size: 8, font: fontBold });

    // 2. Header Right (Republic)
    const rightHeaderX = width - 150;
    currentY = height - 40;
    page.drawText('RÉPUBLIQUE GABONAISE', { x: rightHeaderX, y: currentY, size: 9, font: fontBold });
    currentY -= 5;
    page.drawText('- - - - - - - - - - -', { x: rightHeaderX + 15, y: currentY, size: 8, font: fontNormal });
    currentY -= 10;
    page.drawText('Union - Travail - Justice', { x: rightHeaderX + 10, y: currentY, size: 8, font: fontNormal });
    currentY -= 5;
    page.drawText('- - - - - - - - - - -', { x: rightHeaderX + 15, y: currentY, size: 8, font: fontNormal });

    // 3. Title
    currentY -= 40;
    const title = `Bulletin de notes du Semestre ${semester?.name.replace('S', '') || ''}`;
    const titleWidth = fontBold.widthOfTextAtSize(title, 16);
    page.drawText(title, { x: width / 2 - titleWidth / 2, y: currentY, size: 16, font: fontBold, color: rgb(0, 0, 0.5) });
    currentY -= 15;
    const yearText = `Année universitaire : ${semester?.year || ''}`;
    const yearWidth = fontNormal.widthOfTextAtSize(yearText, 12);
    page.drawText(yearText, { x: width / 2 - yearWidth / 2, y: currentY, size: 12, font: fontItalic });

    // 4. Student Box (Double bordered)
    currentY -= 40;
    const boxY = currentY;
    page.drawRectangle({ x: 40, y: boxY - 40, width: width - 80, height: 45, borderColor: rgb(0, 0, 0), borderWidth: 1 });
    page.drawLine({ start: { x: 40, y: boxY - 18 }, end: { x: width - 40, y: boxY - 18 }, thickness: 1 });
    page.drawLine({ start: { x: 250, y: boxY + 5 }, end: { x: 250, y: boxY - 40 }, thickness: 1 });

    page.drawText('Nom(s) et Prénom(s)', { x: 45, y: boxY - 10, size: 10, font: fontNormal });
    page.drawText(`${report.student.firstName} ${report.student.lastName}`.toUpperCase(), { x: 255, y: boxY - 10, size: 11, font: fontBold });
    page.drawText('Date et lieu de naissance', { x: 45, y: boxY - 33, size: 10, font: fontNormal });
    const birthInfo = `Né[e] le ${report.student.birthDate ? new Date(report.student.birthDate).toLocaleDateString() : ''} à ${report.student.birthPlace || ''}`;
    page.drawText(birthInfo, { x: 255, y: boxY - 33, size: 10, font: fontBold });

    // 5. Main Table
    currentY -= 70;
    const tableHeaderY = currentY;
    page.drawRectangle({ x: 40, y: tableHeaderY - 20, width: width - 80, height: 20, color: rgb(0.95, 0.95, 1), borderColor: rgb(0,0,0), borderWidth: 1 });
    
    const cols = { matiere: 45, credits: 320, coeff: 380, studentNote: 450, classAvg: 520 };
    page.drawText('Matière', { x: cols.matiere, y: tableHeaderY - 13, size: 9, font: fontBold });
    page.drawText('Crédits', { x: cols.credits, y: tableHeaderY - 13, size: 8, font: fontBold });
    page.drawText('Coefficients', { x: cols.coeff, y: tableHeaderY - 13, size: 8, font: fontBold });
    page.drawText("Note l'étudiant", { x: cols.studentNote, y: tableHeaderY - 13, size: 8, font: fontBold });
    page.drawText('Moyenne classe', { x: cols.classAvg, y: tableHeaderY - 13, size: 8, font: fontBold });

    currentY = tableHeaderY - 20;
    for (const ue of report.report) {
      // UE Header row
      page.drawRectangle({ x: 40, y: currentY - 15, width: width - 80, height: 15, color: rgb(0.9, 0.9, 0.9), borderColor: rgb(0,0,0), borderWidth: 0.5 });
      page.drawText(`${ue.ueCode || ''} : ${ue.ueName}`, { x: 45, y: currentY - 11, size: 8, font: fontBold });
      currentY -= 15;

      for (const subj of ue.subjects) {
        page.drawRectangle({ x: 40, y: currentY - 15, width: width - 80, height: 15, borderColor: rgb(0,0,0), borderWidth: 0.5 });
        page.drawText(subj.subject.substring(0, 50), { x: 50, y: currentY - 11, size: 8, font: fontNormal });
        page.drawText(subj.credits?.toString() || '-', { x: cols.credits + 15, y: currentY - 11, size: 8, font: fontNormal });
        page.drawText('2,00', { x: cols.coeff + 15, y: currentY - 11, size: 8, font: fontNormal }); // Static coeff for now or from DB
        page.drawText(subj.average.toString(), { x: cols.studentNote + 20, y: currentY - 11, size: 8, font: fontBold });
        
        const subjStat = globalStats.subjectStats.find(s => s.subjectName === subj.subject);
        page.drawText(subjStat?.average.toString() || '-', { x: cols.classAvg + 20, y: currentY - 11, size: 8, font: fontNormal });
        currentY -= 15;
      }

      // UE Footer (Moyenne UE)
      page.drawRectangle({ x: 40, y: currentY - 15, width: width - 80, height: 15, borderColor: rgb(0,0,0), borderWidth: 0.5 });
      page.drawText(`Moyenne ${ue.ueCode || 'UE'}`, { x: 180, y: currentY - 11, size: 8, font: fontBold });
      page.drawText(ue.creditsExpected.toString(), { x: cols.credits + 15, y: currentY - 11, size: 8, font: fontBold });
      page.drawText(ue.average.toString(), { x: cols.studentNote + 20, y: currentY - 11, size: 8, font: fontBold });
      currentY -= 15;
    }

    // 6. Penalty Row
    currentY -= 5;
    page.drawRectangle({ x: 40, y: currentY - 15, width: width - 80, height: 15, borderColor: rgb(0,0,0), borderWidth: 0.5 });
    page.drawText("Pénalités d'absences", { x: 80, y: currentY - 11, size: 8, font: fontBold });
    page.drawText('0,01/heure', { x: cols.coeff + 10, y: currentY - 11, size: 8, font: fontBold, color: rgb(0.8, 0.4, 0) });
    page.drawText(`${report.absences} heure(s)`, { x: cols.studentNote + 10, y: currentY - 11, size: 8, font: fontBold, color: rgb(0, 0.2, 0.6) });
    currentY -= 15;

    // 7. Results Summary
    currentY -= 10;
    page.drawRectangle({ x: 280, y: currentY - 20, width: width - 320, height: 20, borderColor: rgb(0,0,0), borderWidth: 2 });
    page.drawText(`Moyenne Semestre ${semester?.name.replace('S', '') || ''}`, { x: 300, y: currentY - 14, size: 10, font: fontBold });
    page.drawText(report.semesterAverage.toString(), { x: cols.studentNote + 15, y: currentY - 14, size: 11, font: fontBold });
    page.drawText(globalStats.classAverage.toString(), { x: cols.classAvg + 15, y: currentY - 14, size: 10, font: fontNormal });

    // 8. Rank & Mention Box
    currentY -= 35;
    const rankText = report.rank === 1 ? '1er' : `${report.rank}ème`;
    page.drawRectangle({ x: 130, y: currentY - 30, width: 330, height: 30, borderColor: rgb(0,0,0), borderWidth: 1 });
    page.drawLine({ start: { x: 300, y: currentY }, end: { x: 300, y: currentY - 30 }, thickness: 1 });
    page.drawText('Rang de l\'étudiant au Semestre', { x: 135, y: currentY - 13, size: 9, font: fontNormal });
    page.drawText(`${rankText} / ${report.totalStudents}`, { x: 135, y: currentY - 25, size: 9, font: fontBold });
    page.drawText('Mention', { x: 305, y: currentY - 13, size: 9, font: fontNormal });
    
    let mention = 'Passable';
    if (report.semesterAverage >= 16) mention = 'Très Bien';
    else if (report.semesterAverage >= 14) mention = 'Bien';
    else if (report.semesterAverage >= 12) mention = 'Assez Bien';
    page.drawText(mention, { x: 305, y: currentY - 25, size: 9, font: fontBold });

    // 9. Validation Grid
    currentY -= 50;
    page.drawText('Etat de la Validation des Crédits au Semestre', { x: width / 2 - 100, y: currentY, size: 9, font: fontBold });
    currentY -= 15;
    const gridWidth = width - 100;
    page.drawRectangle({ x: 50, y: currentY - 30, width: gridWidth, height: 30, borderColor: rgb(0,0,0), borderWidth: 1 });
    page.drawLine({ start: { x: 250, y: currentY }, end: { x: 250, y: currentY - 30 }, thickness: 1 });
    page.drawLine({ start: { x: 390, y: currentY }, end: { x: 390, y: currentY - 30 }, thickness: 1 });
    
    page.drawText('Total Crédits', { x: 60, y: currentY - 12, size: 8, font: fontNormal });
    page.drawText(`${report.totalCreditsWon} / 30`, { x: 130, y: currentY - 12, size: 8, font: fontBold });
    page.drawText('Décision du Jury', { x: 260, y: currentY - 12, size: 8, font: fontNormal });
    page.drawText(report.status.toUpperCase(), { x: 395, y: currentY - 12, size: 9, font: fontBold, color: report.semesterAverage >= 10 ? rgb(0, 0.5, 0) : rgb(0.8, 0, 0) });

    // 10. Footer
    currentY -= 60;
    page.drawText(`Fait à Libreville, le ${new Date().toLocaleDateString('fr-FR')}`, { x: 250, y: currentY, size: 10, font: fontBold });
    currentY -= 20;
    page.drawText('Le Directeur des Etudes et de la Pédagogie', { x: 230, y: currentY, size: 10, font: fontBold });

    const pdfBytes = await pdfDoc.save();
    return Buffer.from(pdfBytes);
  }

  async generateAnnualBulletinPdf(studentId: string, year: string): Promise<Buffer> {
    const annualReport = await this.gradesService.calculateAnnualReport(studentId, year);
    
    const pdfDoc = await PDFDocument.create();
    const page = pdfDoc.addPage([595.28, 841.89]);
    const { width, height } = page.getSize();
    
    const fontNormal = await pdfDoc.embedFont(StandardFonts.Helvetica);
    const fontBold = await pdfDoc.embedFont(StandardFonts.HelveticaBold);
    const fontItalic = await pdfDoc.embedFont(StandardFonts.HelveticaOblique);

    let logoImage;
    try {
      const logoPath = path.join(process.cwd(), 'src/assets/logo-inptic.png');
      const logoBuffer = fs.readFileSync(logoPath);
      logoImage = await pdfDoc.embedPng(logoBuffer);
    } catch (e) {}

    // Header (Generic reuse)
    let currentY = height - 40;
    if (logoImage) page.drawImage(logoImage, { x: 80, y: currentY - 50, width: 60, height: 40 });
    page.drawText('RÉPUBLIQUE GABONAISE', { x: width - 150, y: currentY, size: 9, font: fontBold });
    
    currentY -= 100;
    const title = "Bulletin de notes Annuel";
    page.drawText(title, { x: width / 2 - fontBold.widthOfTextAtSize(title, 16) / 2, y: currentY, size: 16, font: fontBold, color: rgb(0, 0, 0.5) });
    page.drawText(`Année universitaire : ${year}`, { x: width / 2 - 50, y: currentY - 15, size: 10, font: fontItalic });

    // Student Box
    currentY -= 60;
    page.drawRectangle({ x: 40, y: currentY - 30, width: width - 80, height: 35, borderColor: rgb(0,0,0), borderWidth: 1 });
    page.drawText(`Nom et Prénom: ${annualReport.student.firstName} ${annualReport.student.lastName}`, { x: 50, y: currentY - 10, size: 11, font: fontBold });
    page.drawText(`Lieu de naissance: ${annualReport.student.birthPlace || 'N/A'}`, { x: 50, y: currentY - 25, size: 9, font: fontNormal });

    // Annual Table
    currentY -= 60;
    const cols = { label: 45, coeff: 350, notes: 410, rang: 470, avgClass: 520 };
    page.drawRectangle({ x: 40, y: currentY - 20, width: width - 80, height: 20, color: rgb(0.9, 0.95, 1), borderColor: rgb(0,0,0), borderWidth: 1 });
    page.drawText('Unités d\'Enseignement', { x: cols.label, y: currentY - 13, size: 9, font: fontBold });
    page.drawText('Coefficients', { x: cols.coeff, y: currentY - 13, size: 7, font: fontBold });
    page.drawText('Notes', { x: cols.notes, y: currentY - 13, size: 7, font: fontBold });
    page.drawText('Rang', { x: cols.rang, y: currentY - 13, size: 7, font: fontBold });
    page.drawText('Moyenne classe', { x: cols.avgClass, y: currentY - 13, size: 7, font: fontBold });

    currentY -= 20;

    // We assume S1 and S2 are the two semesters in the year
    const s1Report = annualReport.semesterReports[0];
    const s2Report = annualReport.semesterReports[1];

    if (s1Report) {
      for (const ue of s1Report.report) {
         page.drawRectangle({ x: 40, y: currentY - 15, width: width - 80, height: 15, color: rgb(0.95, 0.95, 0.95), borderColor: rgb(0,0,0), borderWidth: 0.5 });
         page.drawText(`${ue.ueCode || 'UE'}: ${ue.ueName}`, { x: 45, y: currentY - 11, size: 8, font: fontBold, color: rgb(0, 0, 0.4) });
         currentY -= 15;

         // Row for S1
         page.drawRectangle({ x: 40, y: currentY - 15, width: width - 80, height: 15, borderColor: rgb(0,0,0), borderWidth: 0.5 });
         page.drawText('Semestre 1', { x: 70, y: currentY - 11, size: 8, font: fontNormal });
         page.drawText(ue.average.toString(), { x: cols.notes + 10, y: currentY - 11, size: 8, font: fontBold });
         currentY -= 15;

         // Find same UE in S2
         const ueS2 = s2Report?.report.find(u => u.ueName === ue.ueName);
         if (ueS2) {
            page.drawRectangle({ x: 40, y: currentY - 15, width: width - 80, height: 15, borderColor: rgb(0,0,0), borderWidth: 0.5 });
            page.drawText('Semestre 2', { x: 70, y: currentY - 11, size: 8, font: fontNormal });
            page.drawText(ueS2.average.toString(), { x: cols.notes + 10, y: currentY - 11, size: 8, font: fontBold });
            currentY -= 15;
            
            // Annual Row for this UE
            page.drawRectangle({ x: 40, y: currentY - 15, width: width - 80, height: 15, color: rgb(1, 1, 0.9), borderColor: rgb(0,0,0), borderWidth: 0.5 });
            page.drawText('Annuel', { x: 70, y: currentY - 11, size: 8, font: fontBold });
            const annualUEAvg = ((ue.average + ueS2.average) / 2).toFixed(2);
            page.drawText(annualUEAvg, { x: cols.notes + 10, y: currentY - 11, size: 8, font: fontBold });
            currentY -= 15;
         }
      }
    }

    // Final Annual Result
    currentY -= 30;
    page.drawRectangle({ x: 40, y: currentY - 40, width: width - 80, height: 40, borderColor: rgb(0,0,0), borderWidth: 2 });
    page.drawText('MOYENNE ANNUELLE GENERALE', { x: 60, y: currentY - 25, size: 12, font: fontBold });
    page.drawText(annualReport.annualAverage.toString(), { x: cols.notes, y: currentY - 25, size: 14, font: fontBold, color: rgb(0, 0, 0.8) });
    
    page.drawText(`DÉCISION : ${annualReport.status.toUpperCase()}`, { x: 60, y: currentY - 60, size: 11, font: fontBold });
    page.drawText(`MENTION : ${annualReport.mention.toUpperCase()}`, { x: 300, y: currentY - 60, size: 11, font: fontBold });

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
