import { Injectable, NotFoundException } from '@nestjs/common';
import { GradesService } from '../grades/grades.service';
import { DatabaseService } from '../database/database.service';
import { UsersService } from '../users/users.service';
import { PDFDocument, rgb, StandardFonts, PDFFont, PDFPage } from 'pdf-lib';
import * as ExcelJS from 'exceljs';
import * as fs from 'fs';
import * as path from 'path';
import archiver from 'archiver';

@Injectable()
export class ExportsService {
  constructor(
    private gradesService: GradesService,
    private prisma: DatabaseService,
    private usersService: UsersService,
  ) {}

  async generateBulletinPdf(studentId: string, semesterId: string): Promise<Buffer> {
    const report = await this.gradesService.calculateStudentReport(studentId, semesterId);
    if (!report || !report.student) {
      throw new NotFoundException('Données de l\'étudiant introuvables pour ce bulletin.');
    }
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

    // 1. Institution Title and Logo (Centered)
    let currentY = height - 40;
    const instTitle1 = 'INSTITUT NATIONAL DE LA POSTE, DES TECHNOLOGIES';
    const instTitle2 = "DE L'INFORMATION ET DE LA COMMUNICATION";
    
    page.drawText(instTitle1, { x: width / 2 - fontBold.widthOfTextAtSize(instTitle1, 8) / 2, y: currentY, size: 8, font: fontBold });
    currentY -= 10;
    page.drawText(instTitle2, { x: width / 2 - fontBold.widthOfTextAtSize(instTitle2, 8) / 2, y: currentY, size: 8, font: fontBold });
    
    if (logoImage) {
      page.drawImage(logoImage, { x: width / 2 - 35, y: currentY - 50, width: 70, height: 45 });
    }
    
    currentY -= 60;
    const dirTitle = 'DIRECTION DES ETUDES ET DE LA PEDAGOGIE';
    page.drawText(dirTitle, { x: width / 2 - fontBold.widthOfTextAtSize(dirTitle, 8) / 2, y: currentY, size: 8, font: fontBold });

    // 2. Header Right (Republic - Gabonaise)
    const rightHeaderX = width - 150;
    const republicY = height - 40;
    page.drawText('RÉPUBLIQUE GABONAISE', { x: rightHeaderX, y: republicY, size: 9, font: fontBold });
    page.drawText('- - - - - - - - - - -', { x: rightHeaderX + 15, y: republicY - 5, size: 8, font: fontNormal });
    page.drawText('Union - Travail - Justice', { x: rightHeaderX + 10, y: republicY - 15, size: 8, font: fontNormal });
    page.drawText('- - - - - - - - - - -', { x: rightHeaderX + 15, y: republicY - 20, size: 8, font: fontNormal });

    // 3. Class Banner Box (Crucial)
    currentY -= 45;
    const classBoxHeight = 35;
    const classText = `Classe : ${report.student!.class || 'Licence Professionnelle'}`;
    page.drawRectangle({ x: 30, y: currentY - classBoxHeight, width: width - 60, height: classBoxHeight, borderColor: rgb(0, 0, 0.4), borderWidth: 1.5 });
    page.drawText(classText.toUpperCase(), { x: width / 2 - fontBold.widthOfTextAtSize(classText.toUpperCase(), 11) / 2, y: currentY - 22, size: 11, font: fontBold, color: rgb(0, 0, 0.4) });

    // 4. Title
    currentY -= 65;
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
    page.drawText(`${report.student!.firstName} ${report.student!.lastName}`.toUpperCase(), { x: 255, y: boxY - 10, size: 11, font: fontBold });
    page.drawText('Date et lieu de naissance', { x: 45, y: boxY - 33, size: 10, font: fontNormal });
    const birthInfo = `Né[e] le ${report.student!.birthDate ? new Date(report.student!.birthDate).toLocaleDateString() : ''} à ${report.student!.birthPlace || ''}`;
    page.drawText(birthInfo, { x: 255, y: boxY - 33, size: 10, font: fontBold });

    // 5. Main Grades Table
    currentY -= 70;
    const tableHeaderY = currentY;
    page.drawRectangle({ x: 30, y: tableHeaderY - 20, width: width - 60, height: 20, color: rgb(0.95, 0.95, 1), borderColor: rgb(0,0,0), borderWidth: 1 });
    
    const cols = { matiere: 35, credits: 310, coeff: 365, studentNote: 425, classAvg: 505 };
    page.drawText('Matière', { x: cols.matiere, y: tableHeaderY - 13, size: 9, font: fontBold });
    page.drawText('Crédits', { x: cols.credits, y: tableHeaderY - 13, size: 8, font: fontBold });
    page.drawText('Coefficients', { x: cols.coeff, y: tableHeaderY - 13, size: 7, font: fontBold });
    page.drawText("Notes de l'étudiant", { x: cols.studentNote - 5, y: tableHeaderY - 13, size: 8, font: fontBold, color: rgb(0, 0, 0.4) });
    page.drawText('Moy. classe', { x: cols.classAvg, y: tableHeaderY - 13, size: 8, font: fontBold });

    // Vertical lines for header
    [cols.credits - 5, cols.coeff - 5, cols.studentNote - 10, cols.classAvg - 5].forEach(x => {
      page.drawLine({ start: { x, y: tableHeaderY }, end: { x, y: tableHeaderY - 20 }, thickness: 1 });
    });

    currentY = tableHeaderY - 20;
    const tableStartY = currentY;

    for (const ue of report.report) {
      // UE Header row (UE 5-1 style)
      page.drawRectangle({ x: 30, y: currentY - 18, width: width - 60, height: 18, color: rgb(0.97, 0.97, 0.97), borderColor: rgb(0,0,0), borderWidth: 0.5 });
      page.drawText(`UE ${semester?.name.substring(1) || '0'}-${report.report.indexOf(ue) + 1} : ${ue.ueName}`, { x: 35, y: currentY - 13, size: 9, font: fontBold, color: rgb(0, 0, 0.4) });
      
      // Vertical lines for UE row
      [cols.credits - 5, cols.coeff - 5, cols.studentNote - 10, cols.classAvg - 5].forEach(x => {
        page.drawLine({ start: { x, y: currentY }, end: { x, y: currentY - 18 }, thickness: 0.5 });
      });
      currentY -= 18;

      for (const subj of ue.subjects) {
        page.drawRectangle({ x: 30, y: currentY - 18, width: width - 60, height: 18, borderColor: rgb(0,0,0), borderWidth: 0.5 });
        page.drawText(subj.subject.substring(0, 52), { x: 45, y: currentY - 12, size: 8, font: fontNormal });
        page.drawText(subj.credits?.toString() || '-', { x: cols.credits + 10, y: currentY - 12, size: 8, font: fontNormal });
        page.drawText('3,00', { x: cols.coeff + 10, y: currentY - 12, size: 8, font: fontNormal }); 
        page.drawText(Number(subj.average ?? 0).toFixed(2), { x: cols.studentNote + 15, y: currentY - 12, size: 9, font: fontBold });
        
        const subjStat = globalStats.subjectStats.find(s => s.subjectName === subj.subject);
        page.drawText(subjStat ? Number(subjStat.average ?? 0).toFixed(2) : '-', { x: cols.classAvg + 15, y: currentY - 12, size: 8, font: fontNormal });
        
        // Vertical lines for subject row
        [cols.credits - 5, cols.coeff - 5, cols.studentNote - 10, cols.classAvg - 5].forEach(x => {
          page.drawLine({ start: { x, y: currentY }, end: { x, y: currentY - 18 }, thickness: 0.5 });
        });
        currentY -= 18;
      }

      // UE Footer
      page.drawRectangle({ x: 30, y: currentY - 18, width: width - 60, height: 18, color: rgb(0.98, 0.98, 0.98), borderColor: rgb(0,0,0), borderWidth: 0.5 });
      page.drawText(`Moyenne UE ${semester?.name.substring(1) || '0'}-${report.report.indexOf(ue) + 1}`, { x: 130, y: currentY - 13, size: 9, font: fontBold, color: rgb(0, 0, 0.4) });
      page.drawText(ue.creditsExpected.toString(), { x: cols.credits + 10, y: currentY - 13, size: 8, font: fontBold });
      page.drawText(Number(ue.average ?? 0).toFixed(2), { x: cols.studentNote + 15, y: currentY - 13, size: 9, font: fontBold, color: rgb(0, 0, 0.4) });
      
      // Vertical lines for footer row
      [cols.credits - 5, cols.coeff - 5, cols.studentNote - 10, cols.classAvg - 5].forEach(x => {
        page.drawLine({ start: { x, y: currentY }, end: { x, y: currentY - 18 }, thickness: 0.5 });
      });
      currentY -= 18;
    }

    // 6. Annual / Semester Average (Yellow Highlight)
    currentY -= 20;
    const avgBoxWidth = 250;
    page.drawRectangle({ x: width - 30 - avgBoxWidth, y: currentY - 25, width: avgBoxWidth, height: 25, borderColor: rgb(0,0,0), borderWidth: 1.5 });
    page.drawRectangle({ x: width - 110, y: currentY - 25, width: 80, height: 25, color: rgb(1, 0.9, 0.5) }); // Yellow
    page.drawLine({ start: { x: width - 110, y: currentY }, end: { x: width - 110, y: currentY - 25 }, thickness: 1 });
    
    page.drawText(`Moyenne au Semestre ${semester?.name.substring(1) || ''}`, { x: width - 30 - avgBoxWidth + 10, y: currentY - 17, size: 10, font: fontBold, color: rgb(0, 0, 0.4) });
    page.drawText(Number(report.semesterAverage ?? 0).toFixed(2), { x: width - 85, y: currentY - 17, size: 11, font: fontBold });

    // 7. Rank & Mention Grid
    currentY -= 40;
    const rankText = report.rank === 1 ? '1er' : `${report.rank}ème`;
    page.drawRectangle({ x: 150, y: currentY - 35, width: 300, height: 35, borderColor: rgb(0,0,0), borderWidth: 1 });
    page.drawLine({ start: { x: 300, y: currentY }, end: { x: 300, y: currentY - 35 }, thickness: 1 });
    page.drawText("Rang de l'étudiant au Semestre", { x: 155, y: currentY - 15, size: 9, font: fontNormal });
    page.drawText(`${rankText} / ${report.totalStudents}`, { x: 155, y: currentY - 28, size: 10, font: fontBold });
    page.drawText('Mention', { x: 305, y: currentY - 15, size: 9, font: fontNormal });
    
    let mention = 'Passable';
    if (report.semesterAverage >= 16) mention = 'Très Bien';
    else if (report.semesterAverage >= 14) mention = 'Bien';
    else if (report.semesterAverage >= 12) mention = 'Assez Bien';
    page.drawText(mention, { x: 305, y: currentY - 28, size: 10, font: fontBold });

    // 8. Validation Credits Table (Multi-column)
    currentY -= 60;
    const validationTitle = `Etat de la Validation des Crédits au Semestre ${semester?.name.substring(1) || ''}`;
    page.drawText(validationTitle, { x: width / 2 - fontBold.widthOfTextAtSize(validationTitle, 9) / 2, y: currentY, size: 9, font: fontBold });
    currentY -= 15;
    
    const valColWidth = (width - 60) / 3;
    page.drawRectangle({ x: 30, y: currentY - 45, width: width - 60, height: 45, borderColor: rgb(0,0,0), borderWidth: 1 });
    page.drawLine({ start: { x: 30 + valColWidth, y: currentY }, end: { x: 30 + valColWidth, y: currentY - 45 }, thickness: 1 });
    page.drawLine({ start: { x: 30 + valColWidth * 2, y: currentY }, end: { x: 30 + valColWidth * 2, y: currentY - 45 }, thickness: 1 });

    // Fill headers logic for UEs
    report.report.slice(0, 2).forEach((ue, idx) => {
      const startX = 30 + (valColWidth * idx);
      page.drawText(`UE ${semester?.name.substring(1) || '0'}-${idx + 1}`, { x: startX + 5, y: currentY - 12, size: 8, font: fontBold });
      page.drawText(`${ue.creditsWon} Crédits / ${ue.creditsExpected}`, { x: startX + 5, y: currentY - 25, size: 8, font: fontNormal });
      page.drawText(ue.status, { x: startX + 5, y: currentY - 38, size: 8, font: fontItalic });
    });

    const totalColumnX = 30 + valColWidth * 2;
    page.drawText('Crédits Acquis au Semestre', { x: totalColumnX + 5, y: currentY - 12, size: 8, font: fontBold });
    page.drawText(`${report.totalCreditsWon} Crédits / 30`, { x: totalColumnX + 5, y: currentY - 25, size: 8, font: fontNormal });
    page.drawText(report.status.toUpperCase(), { x: totalColumnX + 5, y: currentY - 38, size: 8, font: fontBold, color: report.semesterAverage >= 10 ? rgb(0, 0.4, 0) : rgb(0.7, 0, 0) });

    // 9. Final Footer Blocks
    currentY -= 80;
    page.drawText(`Décision du Jury :    ${report.semesterAverage.toFixed(2)}`, { x: 60, y: currentY, size: 10, font: fontBold, color: rgb(0, 0, 0.4) });
    page.drawLine({ start: { x: 160, y: currentY - 2 }, end: { x: 535, y: currentY - 2 }, thickness: 0.5, color: rgb(0, 0, 0.4) });

    currentY -= 40;
    page.drawText(`Fait à Libreville, le ${new Date().toLocaleDateString('fr-FR')}`, { x: width / 2 - 50, y: currentY, size: 10, font: fontBold });
    currentY -= 20;
    page.drawText('LE DIRECTEUR DES ETUDES ET DE LA PEDAGOGIE', { x: width / 2 - 120, y: currentY, size: 11, font: fontBold, color: rgb(0, 0, 0.4) });

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
         page.drawText(Number(ue.average ?? 0).toFixed(2), { x: cols.notes + 10, y: currentY - 11, size: 8, font: fontBold });
         currentY -= 15;

         // Find same UE in S2
         const ueS2 = s2Report?.report.find(u => u.ueName === ue.ueName);
         if (ueS2) {
            page.drawRectangle({ x: 40, y: currentY - 15, width: width - 80, height: 15, borderColor: rgb(0,0,0), borderWidth: 0.5 });
            page.drawText('Semestre 2', { x: 70, y: currentY - 11, size: 8, font: fontNormal });
           page.drawText(Number(ueS2.average ?? 0).toFixed(2), { x: cols.notes + 10, y: currentY - 11, size: 8, font: fontBold });
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
    page.drawText(Number(annualReport.annualAverage ?? 0).toFixed(2), { x: cols.notes, y: currentY - 25, size: 14, font: fontBold, color: rgb(0, 0, 0.8) });
    
    page.drawText(`DÉCISION : ${annualReport.status.toUpperCase()}`, { x: 60, y: currentY - 60, size: 11, font: fontBold });
    page.drawText(`MENTION : ${annualReport.mention.toUpperCase()}`, { x: 300, y: currentY - 60, size: 11, font: fontBold });

    const pdfBytes = await pdfDoc.save();
    return Buffer.from(pdfBytes);
  }

  async generatePromotionXlsx(semesterId: string): Promise<Buffer> {
    const stats = await this.gradesService.getPromotionStats(semesterId);
    const workbook = new ExcelJS.Workbook();
    const worksheet = workbook.addWorksheet('Promotion');

    worksheet.columns = [
      { header: 'NOM', key: 'lastName', width: 22 },
      { header: 'PRÉNOM', key: 'firstName', width: 22 },
      { header: 'RANG', key: 'rank', width: 10 },
      { header: 'CRÉDITS_ACQUIS', key: 'credits', width: 15 },
      { header: 'MOYENNE_SEMESTRE', key: 'avg', width: 18 },
      { header: 'DÉCISION', key: 'status', width: 18 },
    ];

    (stats.studentResults || []).forEach((r: any) => {
      worksheet.addRow({
        lastName: r.student?.lastName || '',
        firstName: r.student?.firstName || '',
        rank: r.rank ?? '',
        credits: r.totalCreditsWon ?? '',
        avg: r.semesterAverage ?? '',
        status: r.status ?? '',
      });
    });

    worksheet.getRow(1).font = { bold: true };
    const buffer = await workbook.xlsx.writeBuffer();
    return Buffer.from(buffer);
  }

  async generateGradesXlsx(semesterId: string): Promise<Buffer> {
    const workbook = new ExcelJS.Workbook();
    const worksheet = workbook.addWorksheet('Notes');

    worksheet.columns = [
      { header: 'STUDENT_ID (Matricule)', key: 'studentId', width: 22 },
      { header: 'NOM', key: 'lastName', width: 20 },
      { header: 'PRÉNOM', key: 'firstName', width: 20 },
      { header: 'MATIÈRE', key: 'subject', width: 30 },
      { header: 'NOTE_CC', key: 'cc', width: 12 },
      { header: 'NOTE_EXAMEN', key: 'exam', width: 14 },
      { header: 'NOTE_RATTRAPAGE', key: 'rattr', width: 16 },
    ];

    const grades = await this.prisma.grade.findMany({
      where: { subject: { ue: { semesterId } } },
      include: { student: true, subject: true },
      orderBy: [{ student: { lastName: 'asc' } }],
    });

    grades.forEach((g) => {
      worksheet.addRow({
        studentId: g.student.studentId,
        lastName: g.student.lastName,
        firstName: g.student.firstName,
        subject: g.subject.name,
        cc: g.ccGrade ?? '',
        exam: g.examGrade ?? '',
        rattr: g.rattrapageGrade ?? '',
      });
    });

    worksheet.getRow(1).font = { bold: true };
    const buffer = await workbook.xlsx.writeBuffer();
    return Buffer.from(buffer);
  }

  async generateAllBulletinsZip(semesterId: string): Promise<Buffer> {
    const semester = await this.prisma.semester.findUnique({ where: { id: semesterId } });
    const students = await this.prisma.student.findMany({ orderBy: [{ lastName: 'asc' }] });

    return new Promise<Buffer>(async (resolve, reject) => {
      const archive = archiver('zip', { zlib: { level: 9 } });
      const chunks: Buffer[] = [];

      archive.on('data', (d) => chunks.push(Buffer.from(d)));
      archive.on('warning', (err) => {
        if ((err as any).code === 'ENOENT') return;
        reject(err);
      });
      archive.on('error', (err) => reject(err));
      archive.on('end', () => resolve(Buffer.concat(chunks)));

      for (const s of students) {
        try {
          const pdf = await this.generateBulletinPdf(s.id, semesterId);
          const safeName = `${(s.lastName || '').toUpperCase()}_${(s.firstName || '').toUpperCase()}_${s.studentId || s.id}`.replace(/[^a-zA-Z0-9_]+/g, '_');
          archive.append(pdf, { name: `bulletin_${semester?.name || 'SEM'}_${safeName}.pdf` });
        } catch {
          // ignore missing data
        }
      }

      archive.finalize();
    });
  }

  async generateAllAnnualBulletinsZip(year: string): Promise<Buffer> {
    const students = await this.prisma.student.findMany({ orderBy: [{ lastName: 'asc' }] });

    return new Promise<Buffer>(async (resolve, reject) => {
      const archive = archiver('zip', { zlib: { level: 9 } });
      const chunks: Buffer[] = [];

      archive.on('data', (d) => chunks.push(Buffer.from(d)));
      archive.on('warning', (err) => {
        if ((err as any).code === 'ENOENT') return;
        reject(err);
      });
      archive.on('error', (err) => reject(err));
      archive.on('end', () => resolve(Buffer.concat(chunks)));

      for (const s of students) {
        try {
          const pdf = await this.generateAnnualBulletinPdf(s.id, year);
          const safeName = `${(s.lastName || '').toUpperCase()}_${(s.firstName || '').toUpperCase()}_${s.studentId || s.id}`.replace(/[^a-zA-Z0-9_]+/g, '_');
          archive.append(pdf, { name: `bulletin_ANNUEL_${year}_${safeName}.pdf` });
        } catch {
          // ignore missing data or errors for individual students
        }
      }

      archive.finalize();
    });
  }

  async importGradesFromExcel(buffer: Buffer, semesterId: string, userId: string) {
    const workbook = new ExcelJS.Workbook();
    await workbook.xlsx.load(buffer as any);
    const worksheet = workbook.getWorksheet(1);
    
    if (!worksheet) throw new NotFoundException('Worksheet not found');

    let count = 0;
    let skipped = 0;
    const errors: string[] = [];
    for (let i = 2; i <= worksheet.rowCount; i++) {
        const row = worksheet.getRow(i);
        const studentRef = row.getCell(1).toString().trim();
        const subjectRef = row.getCell(2).toString().trim();
        const ccRaw = row.getCell(3).toString().trim();
        const examRaw = row.getCell(4).toString().trim();
        const rattrRaw = row.getCell(5).toString().trim();

        if (!studentRef || !subjectRef) {
          skipped++;
          continue;
        }

        const student = await this.prisma.student.findFirst({
          where: {
            OR: [{ id: studentRef }, { studentId: studentRef }],
          },
        });

        const subject = await this.prisma.subject.findFirst({
          where: {
            ue: { semesterId },
            OR: [{ id: subjectRef }, { name: { equals: subjectRef, mode: 'insensitive' } }],
          },
        });

        if (!student || !subject) {
          skipped++;
          errors.push(`Ligne ${i}: étudiant ou matière introuvable (${studentRef} / ${subjectRef})`);
          continue;
        }

        const ccGrade = ccRaw !== '' ? Number(ccRaw) : undefined;
        const examGrade = examRaw !== '' ? Number(examRaw) : undefined;
        const rattrapageGrade = rattrRaw !== '' ? Number(rattrRaw) : undefined;

        await this.gradesService.enterGrade({
            studentId: student.id,
            subjectId: subject.id,
            ccGrade: Number.isFinite(ccGrade as number) ? ccGrade : undefined,
            examGrade: Number.isFinite(examGrade as number) ? examGrade : undefined,
            rattrapageGrade: Number.isFinite(rattrapageGrade as number) ? rattrapageGrade : undefined,
        }, userId);
        count++;
    }

    return { imported: count, skipped, errors };
  }

  async generateTemplate(type: 'STUDENTS' | 'GRADES'): Promise<Buffer> {
    const workbook = new ExcelJS.Workbook();
    const worksheet = workbook.addWorksheet('Template');

    if (type === 'STUDENTS') {
      worksheet.columns = [
        { header: 'MATRICULE', key: 'studentId', width: 20 },
        { header: 'NOM', key: 'lastName', width: 25 },
        { header: 'PRÉNOM', key: 'firstName', width: 25 },
        { header: 'EMAIL', key: 'email', width: 30 },
        { header: 'CLASSE', key: 'class', width: 15 },
        { header: 'DATE_NAISSANCE (AAAA-MM-JJ)', key: 'birthDate', width: 25 },
        { header: 'LIEU_NAISSANCE', key: 'birthPlace', width: 25 },
        { header: 'TYPE_BAC', key: 'bacType', width: 15 },
        { header: 'ÉTABLISSEMENT_ORIGINE', key: 'provenance', width: 30 },
        { header: 'MOT_DE_PASSE_INITIAL', key: 'password', width: 20 },
      ];
      // Add a sample row
      worksheet.addRow({
          studentId: 'INPTIC-2024-001',
          lastName: 'DUPONT',
          firstName: 'Jean',
          email: 'jean.dupont@inptic.ga',
          class: 'LP ASUR',
          birthDate: '2002-05-15',
          birthPlace: 'Libreville',
          bacType: 'C',
          provenance: 'Lycée Technique',
          password: 'Password123'
      });
    } else {
      worksheet.columns = [
        { header: 'STUDENT_ID (ou Matricule)', key: 'studentId', width: 25 },
        { header: 'SUBJECT_ID (Libellé)', key: 'subjectId', width: 25 },
        { header: 'NOTE_CC (/20)', key: 'ccGrade', width: 15 },
        { header: 'NOTE_EXAMEN (/20)', key: 'examGrade', width: 15 },
        { header: 'NOTE_RATTRAPAGE (/20)', key: 'rattrapageGrade', width: 20 },
      ];
      worksheet.addRow({
          studentId: 'INPTIC-2024-001',
          subjectId: 'Anglais',
          ccGrade: 14.5,
          examGrade: 12,
          rattrapageGrade: ''
      });
    }

    // Styling headers
    worksheet.getRow(1).font = { bold: true };
    worksheet.getRow(1).fill = {
      type: 'pattern',
      pattern: 'solid',
      fgColor: { argb: 'FFE0E0E0' }
    };

    const buffer = await workbook.xlsx.writeBuffer();
    return Buffer.from(buffer);
  }

  async importStudentsFromExcel(buffer: Buffer) {
    const workbook = new ExcelJS.Workbook();
    await workbook.xlsx.load(buffer as any);
    const worksheet = workbook.getWorksheet(1);
    
    if (!worksheet) throw new NotFoundException('Worksheet not found');

    let count = 0;
    for (let i = 2; i <= worksheet.rowCount; i++) {
        const row = worksheet.getRow(i);
        const studentId = row.getCell(1).toString();
        const lastName = row.getCell(2).toString();
        const firstName = row.getCell(3).toString();
        const email = row.getCell(4).toString();
        const className = row.getCell(5).toString();
        const birthDateStr = row.getCell(6).toString();
        const birthPlace = row.getCell(7).toString();
        const bacType = row.getCell(8).toString();
        const provenance = row.getCell(9).toString();
        const password = row.getCell(10).toString() || 'Inptic2024!';

        if (studentId && email) {
            await this.usersService.createStudent({
                studentId,
                lastName,
                firstName,
                email,
                class: className,
                birthDate: birthDateStr,
                birthPlace,
                bacType,
                provenance,
                password,
            });
            count++;
        }
    }

    return { imported: count };
  }
}
