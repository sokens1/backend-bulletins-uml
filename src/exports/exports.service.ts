import { Injectable, NotFoundException } from '@nestjs/common';
import { GradesService } from '../grades/grades.service';
import { DatabaseService } from '../database/database.service';
import { UsersService } from '../users/users.service';
import { PDFDocument, rgb, StandardFonts, PDFFont, PDFPage } from 'pdf-lib';
import * as ExcelJS from 'exceljs';
import * as fs from 'fs';
import * as path from 'path';

@Injectable()
export class ExportsService {
  constructor(
    private gradesService: GradesService,
    private prisma: DatabaseService,
    private usersService: UsersService,
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
        page.drawText(subj.average.toString(), { x: cols.studentNote + 15, y: currentY - 12, size: 9, font: fontBold });
        
        const subjStat = globalStats.subjectStats.find(s => s.subjectName === subj.subject);
        page.drawText(subjStat?.average.toString() || '-', { x: cols.classAvg + 15, y: currentY - 12, size: 8, font: fontNormal });
        
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
      page.drawText(ue.average.toString(), { x: cols.studentNote + 15, y: currentY - 13, size: 9, font: fontBold, color: rgb(0, 0, 0.4) });
      
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
    page.drawText(report.semesterAverage.toString(), { x: width - 85, y: currentY - 17, size: 11, font: fontBold });

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
