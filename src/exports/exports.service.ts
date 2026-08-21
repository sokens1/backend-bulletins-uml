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
    return this.renderBulletinPdf(report as any, globalStats, semester);
  }

  // Pure rendering — takes already-computed report/stats so bulk exports can compute
  // them once for the whole promotion instead of once per student (see generateAllBulletinsZip).
  private async renderBulletinPdf(report: any, globalStats: any, semester: { name: string; year: string } | null): Promise<Buffer> {
    const pdfDoc = await PDFDocument.create();
    const PAGE_SIZE: [number, number] = [595.28, 841.89]; // A4
    const TOP_MARGIN = 30;
    const BOTTOM_MARGIN = 30;
    // Row height (and its dependent font sizes) shrink dynamically so a semester with many
    // UEs/subjects still fits on a single page like the reference bulletins, instead of
    // always spilling onto a 2nd page once a class has more than ~20 table rows.
    const totalTableRows = (report.report as any[]).reduce((sum, ue) => sum + 2 + ue.subjects.length, 0);
    const HEADER_RESERVE = 234; // institution header → student box, down to the table header — constant regardless of report content
    // Avg box → rank/mention → validation table → stats → decision → signature → disclaimer.
    // Reused below in the post-loop ensureSpace() call so the two stay consistent by construction.
    const FOOTER_RESERVE = 260;
    // Extra slack on top of the two reserves above: the row budget is intentionally
    // computed a bit conservatively (rather than an exact-fit calculation) so small
    // rounding differences never tip a bulletin onto an unnecessary 2nd page.
    const SAFETY_MARGIN = 30;
    const availableForTable = (PAGE_SIZE[1] - TOP_MARGIN - BOTTOM_MARGIN) - HEADER_RESERVE - FOOTER_RESERVE - SAFETY_MARGIN;
    const ROW_H = Math.max(7, Math.min(13, totalTableRows > 0 ? availableForTable / totalTableRows : 13));
    const rowFontNormal = Math.max(5, Math.min(7, Math.round(ROW_H * 0.5)));
    const rowFontBold = Math.max(6, Math.min(8, Math.round(ROW_H * 0.57)));
    const rowTextOffset = ROW_H * 0.71;
    let page = pdfDoc.addPage(PAGE_SIZE);
    let { width, height } = page.getSize();

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

    // Shrinks `size` down to `minSize` until `text` fits within `maxWidth`, so long
    // class/subject names never overflow their box (previously ran off the page edge).
    const fitFontSize = (font: PDFFont, text: string, maxWidth: number, size: number, minSize = 6): number => {
      while (size > minSize && font.widthOfTextAtSize(text, size) > maxWidth) {
        size -= 0.5;
      }
      return size;
    };

    const cols = { matiere: 35, credits: 280, coeff: 325, absences: 370, studentNote: 425, classAvg: 505 };

    const drawTableHeader = (y: number) => {
      page.drawRectangle({ x: 30, y: y - 16, width: width - 60, height: 16, color: rgb(0.95, 0.95, 1), borderColor: rgb(0,0,0), borderWidth: 1 });
      page.drawText('Matière', { x: cols.matiere, y: y - 11, size: 8, font: fontBold });
      page.drawText('Crédits', { x: cols.credits, y: y - 11, size: 7, font: fontBold });
      page.drawText('Coefficients', { x: cols.coeff, y: y - 11, size: 6, font: fontBold });
      page.drawText('Hrs Abs.', { x: cols.absences, y: y - 11, size: 7, font: fontBold });
      page.drawText("Notes de l'étudiant", { x: cols.studentNote - 5, y: y - 11, size: 7, font: fontBold, color: rgb(0, 0, 0.4) });
      page.drawText('Moy. classe', { x: cols.classAvg, y: y - 11, size: 7, font: fontBold });
      [cols.credits - 5, cols.coeff - 5, cols.absences - 5, cols.studentNote - 10, cols.classAvg - 5].forEach(x => {
        page.drawLine({ start: { x, y }, end: { x, y: y - 16 }, thickness: 1 });
      });
    };

    // Ensures `required` points of vertical space remain before the bottom margin;
    // otherwise starts a fresh page (and optionally redraws the table header for continuity).
    const ensureSpace = (required: number, opts?: { redrawTableHeader?: boolean; continuationLabel?: string }) => {
      if (currentY - required < BOTTOM_MARGIN) {
        page = pdfDoc.addPage(PAGE_SIZE);
        ({ width, height } = page.getSize());
        currentY = height - TOP_MARGIN;
        if (opts?.continuationLabel) {
          page.drawText(opts.continuationLabel, { x: 30, y: currentY, size: 9, font: fontItalic, color: rgb(0.4, 0.4, 0.4) });
          currentY -= 18;
        }
        if (opts?.redrawTableHeader) {
          drawTableHeader(currentY);
          currentY -= 16;
        }
      }
    };

    // 1. Institution Title and Logo (Centered)
    let currentY = height - TOP_MARGIN;
    const instTitle1 = 'INSTITUT NATIONAL DE LA POSTE, DES TECHNOLOGIES';
    const instTitle2 = "DE L'INFORMATION ET DE LA COMMUNICATION";

    page.drawText(instTitle1, { x: width / 2 - fontBold.widthOfTextAtSize(instTitle1, 8) / 2, y: currentY, size: 8, font: fontBold });
    currentY -= 10;
    page.drawText(instTitle2, { x: width / 2 - fontBold.widthOfTextAtSize(instTitle2, 8) / 2, y: currentY, size: 8, font: fontBold });

    if (logoImage) {
      page.drawImage(logoImage, { x: width / 2 - 28, y: currentY - 6 - 32, width: 56, height: 32 });
    }

    currentY -= 46;
    const dirTitle = 'DIRECTION DES ETUDES ET DE LA PEDAGOGIE';
    page.drawText(dirTitle, { x: width / 2 - fontBold.widthOfTextAtSize(dirTitle, 8) / 2, y: currentY, size: 8, font: fontBold });

    // 2. Header Right (Republic - Gabonaise)
    const rightHeaderX = width - 150;
    const republicY = height - TOP_MARGIN;
    page.drawText('RÉPUBLIQUE GABONAISE', { x: rightHeaderX, y: republicY, size: 9, font: fontBold });
    page.drawText('- - - - - - - - - - -', { x: rightHeaderX + 15, y: republicY - 5, size: 8, font: fontNormal });
    page.drawText('Union - Travail - Justice', { x: rightHeaderX + 10, y: republicY - 15, size: 8, font: fontNormal });
    page.drawText('- - - - - - - - - - -', { x: rightHeaderX + 15, y: republicY - 20, size: 8, font: fontNormal });

    // 3. Class Banner Box (Crucial) — font size shrinks to fit long class names instead of overflowing the box
    currentY -= 32;
    const classBoxHeight = 26;
    const classBoxMaxWidth = width - 60 - 20;
    const classText = `Classe : ${report.student!.class || 'Licence Professionnelle'}`.toUpperCase();
    const classFontSize = fitFontSize(fontBold, classText, classBoxMaxWidth, 11, 6);
    page.drawRectangle({ x: 30, y: currentY - classBoxHeight, width: width - 60, height: classBoxHeight, borderColor: rgb(0, 0, 0.4), borderWidth: 1.5 });
    page.drawText(classText, { x: width / 2 - fontBold.widthOfTextAtSize(classText, classFontSize) / 2, y: currentY - classBoxHeight / 2 - classFontSize / 2 + 1, size: classFontSize, font: fontBold, color: rgb(0, 0, 0.4) });

    // 4. Title
    currentY -= 42;
    const title = `Bulletin de notes du Semestre ${semester?.name.replace('S', '') || ''}`;
    const titleWidth = fontBold.widthOfTextAtSize(title, 16);
    page.drawText(title, { x: width / 2 - titleWidth / 2, y: currentY, size: 16, font: fontBold, color: rgb(0, 0, 0.5) });
    currentY -= 13;
    const yearText = `Année universitaire : ${semester?.year || ''}`;
    const yearWidth = fontNormal.widthOfTextAtSize(yearText, 12);
    page.drawText(yearText, { x: width / 2 - yearWidth / 2, y: currentY, size: 12, font: fontItalic });

    // 4. Student Box (Double bordered)
    currentY -= 30;
    const boxY = currentY;
    page.drawRectangle({ x: 40, y: boxY - 32, width: width - 80, height: 36, borderColor: rgb(0, 0, 0), borderWidth: 1 });
    page.drawLine({ start: { x: 40, y: boxY - 14 }, end: { x: width - 40, y: boxY - 14 }, thickness: 1 });
    page.drawLine({ start: { x: 250, y: boxY + 4 }, end: { x: 250, y: boxY - 32 }, thickness: 1 });

    page.drawText('Nom(s) et Prénom(s)', { x: 45, y: boxY - 9, size: 10, font: fontNormal });
    page.drawText(`${report.student!.firstName} ${report.student!.lastName}`.toUpperCase(), { x: 255, y: boxY - 9, size: 11, font: fontBold });
    page.drawText('Date et lieu de naissance', { x: 45, y: boxY - 27, size: 10, font: fontNormal });
    const birthInfo = `Né[e] le ${report.student!.birthDate ? new Date(report.student!.birthDate).toLocaleDateString() : ''} à ${report.student!.birthPlace || ''}`;
    page.drawText(birthInfo, { x: 255, y: boxY - 27, size: 10, font: fontBold });

    // 5. Main Grades Table
    currentY -= 45;
    drawTableHeader(currentY);
    currentY -= 16;

    const continuationLabel = `Bulletin de notes du Semestre ${semester?.name?.replace('S', '') || ''} (suite) — ${report.student!.firstName} ${report.student!.lastName}`;

    for (const ue of report.report) {
      // UE Header row (UE5-1 style)
      ensureSpace(ROW_H, { redrawTableHeader: true, continuationLabel });
      page.drawRectangle({ x: 30, y: currentY - ROW_H, width: width - 60, height: ROW_H, color: rgb(0.97, 0.97, 0.97), borderColor: rgb(0,0,0), borderWidth: 0.5 });
      page.drawText(`UE${semester?.name.substring(1) || '0'}-${report.report.indexOf(ue) + 1} : ${ue.ueName}`, { x: 35, y: currentY - rowTextOffset, size: rowFontBold, font: fontBold, color: rgb(0, 0, 0.4) });

      currentY -= ROW_H;

      for (const subj of ue.subjects) {
        ensureSpace(ROW_H, { redrawTableHeader: true, continuationLabel });
        page.drawRectangle({ x: 30, y: currentY - ROW_H, width: width - 60, height: ROW_H, borderColor: rgb(0,0,0), borderWidth: 0.5 });
        page.drawText(subj.subject.substring(0, 48), { x: 35, y: currentY - rowTextOffset, size: rowFontNormal, font: fontNormal });
        page.drawText(subj.credits?.toString() || '-', { x: cols.credits + 10, y: currentY - rowTextOffset, size: rowFontNormal, font: fontNormal });
        page.drawText(Number(subj.coefficient ?? 1).toFixed(2).replace('.', ','), { x: cols.coeff + 10, y: currentY - rowTextOffset, size: rowFontNormal, font: fontNormal });
        page.drawText(subj.absences > 0 ? subj.absences.toString() : '-', { x: cols.absences + 10, y: currentY - rowTextOffset, size: rowFontNormal, font: fontNormal, color: subj.absences > 0 ? rgb(0.8, 0, 0) : rgb(0,0,0) });
        page.drawText(Number(subj.average ?? 0).toFixed(2).replace('.', ','), { x: cols.studentNote + 15, y: currentY - rowTextOffset, size: rowFontBold, font: fontBold });

        const subjStat = globalStats.subjectStats.find(s => s.subjectName === subj.subject);
        page.drawText(subjStat ? Number(subjStat.average ?? 0).toFixed(2).replace('.', ',') : '-', { x: cols.classAvg + 15, y: currentY - rowTextOffset, size: rowFontNormal, font: fontNormal });

        // Vertical lines for subject row
        [cols.credits - 5, cols.coeff - 5, cols.absences - 5, cols.studentNote - 10, cols.classAvg - 5].forEach(x => {
          page.drawLine({ start: { x, y: currentY }, end: { x, y: currentY - ROW_H }, thickness: 0.5 });
        });
        currentY -= ROW_H;
      }

      // UE Footer
      ensureSpace(ROW_H, { redrawTableHeader: true, continuationLabel });
      page.drawRectangle({ x: 30, y: currentY - ROW_H, width: width - 60, height: ROW_H, color: rgb(0.98, 0.98, 0.98), borderColor: rgb(0,0,0), borderWidth: 0.5 });
      page.drawText(`Moyenne UE${semester?.name.substring(1) || '0'}-${report.report.indexOf(ue) + 1}`, { x: 130, y: currentY - rowTextOffset, size: rowFontBold, font: fontBold, color: rgb(0, 0, 0.4) });
      page.drawText(ue.creditsExpected.toString(), { x: cols.credits + 10, y: currentY - rowTextOffset, size: rowFontNormal, font: fontBold });

      const totalUEAbsences = ue.subjects.reduce((sum, s) => sum + (s.absences || 0), 0);
      page.drawText(totalUEAbsences > 0 ? totalUEAbsences.toString() : '-', { x: cols.absences + 10, y: currentY - rowTextOffset, size: rowFontNormal, font: fontBold, color: totalUEAbsences > 0 ? rgb(0.8, 0, 0) : rgb(0,0,0) });

      page.drawText(Number(ue.average ?? 0).toFixed(2).replace('.', ','), { x: cols.studentNote + 15, y: currentY - rowTextOffset, size: rowFontBold, font: fontBold, color: rgb(0, 0, 0.4) });

      // Vertical lines for footer row
      [cols.credits - 5, cols.coeff - 5, cols.absences - 5, cols.studentNote - 10, cols.classAvg - 5].forEach(x => {
        page.drawLine({ start: { x, y: currentY }, end: { x, y: currentY - ROW_H }, thickness: 0.5 });
      });
      currentY -= ROW_H;
    }

    // 6. Summary / footer block (avg → rank/mention → validation → stats → decision →
    // signature → disclaimer). Anchored towards the bottom margin instead of drawn right
    // after the table, so a short subject list doesn't leave the page looking top-heavy
    // with a big empty gap above an undersized footer — it never overlaps the table though.
    ensureSpace(FOOTER_RESERVE);
    currentY = Math.min(currentY, BOTTOM_MARGIN + FOOTER_RESERVE);

    currentY -= 14;
    const avgBoxWidth = 210;
    page.drawRectangle({ x: width - 30 - avgBoxWidth, y: currentY - 22, width: avgBoxWidth, height: 22, borderColor: rgb(0,0,0), borderWidth: 1.5 });
    page.drawRectangle({ x: width - 95, y: currentY - 22, width: 65, height: 22, color: rgb(1, 0.9, 0.5) }); // Yellow
    page.drawLine({ start: { x: width - 95, y: currentY }, end: { x: width - 95, y: currentY - 22 }, thickness: 1 });

    page.drawText(`Moyenne au Semestre ${semester?.name.substring(1) || ''}`, { x: width - 30 - avgBoxWidth + 8, y: currentY - 15, size: 9, font: fontBold, color: rgb(0, 0, 0.4) });
    page.drawText(Number(report.semesterAverage ?? 0).toFixed(2).replace('.', ','), { x: width - 75, y: currentY - 15, size: 10, font: fontBold });

    // 7. Rank & Mention Grid
    currentY -= 26;
    const rankText = report.rank === 1 ? '1er' : `${report.rank}ème`;
    page.drawRectangle({ x: 160, y: currentY - 24, width: 280, height: 24, borderColor: rgb(0,0,0), borderWidth: 1 });
    page.drawLine({ start: { x: 300, y: currentY }, end: { x: 300, y: currentY - 24 }, thickness: 1 });
    page.drawText("Rang de l'étudiant au Semestre", { x: 165, y: currentY - 11, size: 8, font: fontNormal });
    page.drawText(`${rankText} / ${report.totalStudents}`, { x: 165, y: currentY - 21, size: 9, font: fontBold });
    page.drawText('Mention', { x: 305, y: currentY - 11, size: 8, font: fontNormal });

    // Mirrors calculateAnnualReport's mention scale (grades.service.ts) — an average below
    // 10 gets no mention at all, it previously defaulted to "Passable" even for a failing grade.
    let mention = 'Non attribuée';
    if (report.semesterAverage >= 16) mention = 'Très Bien';
    else if (report.semesterAverage >= 14) mention = 'Bien';
    else if (report.semesterAverage >= 12) mention = 'Assez Bien';
    else if (report.semesterAverage >= 10) mention = 'Passable';
    page.drawText(mention, { x: 305, y: currentY - 21, size: 9, font: fontBold });

    // 8. Validation Credits Table (Multi-column)
    currentY -= 34;
    const validationTitle = `Etat de la Validation des Crédits au Semestre ${semester?.name.substring(1) || ''}`;
    page.drawText(validationTitle, { x: width / 2 - fontBold.widthOfTextAtSize(validationTitle, 8) / 2, y: currentY, size: 8, font: fontBold });
    currentY -= 11;

    const numUEs = report.report.length;
    const numColumns = numUEs + 1; // UEs + 1 for the total
    const valColWidth = (width - 60) / numColumns;
    const ueLabelSize = numUEs > 3 ? 6 : 7;
    const valTableHeight = 34;

    page.drawRectangle({ x: 30, y: currentY - valTableHeight, width: width - 60, height: valTableHeight, borderColor: rgb(0,0,0), borderWidth: 1 });
    for (let i = 1; i < numColumns; i++) {
      page.drawLine({ start: { x: 30 + valColWidth * i, y: currentY }, end: { x: 30 + valColWidth * i, y: currentY - valTableHeight }, thickness: 1 });
    }

    // Fill headers logic for UEs
    report.report.forEach((ue, idx) => {
      const startX = 30 + (valColWidth * idx);
      page.drawText(`UE${semester?.name.substring(1) || '0'}-${idx + 1}`, { x: startX + 5, y: currentY - 10, size: ueLabelSize, font: fontBold });
      page.drawText(`${ue.creditsWon} Crédits / ${ue.creditsExpected}`, { x: startX + 5, y: currentY - 20, size: ueLabelSize, font: fontNormal });
      page.drawText(ue.status, { x: startX + 5, y: currentY - 30, size: ueLabelSize - 1, font: fontItalic });
    });

    const totalColumnX = 30 + valColWidth * numUEs;
    page.drawText(`Crédits Acquis au Semestre ${semester?.name.substring(1) || ''}`, { x: totalColumnX + 5, y: currentY - 10, size: 7, font: fontBold });
    page.drawText(`${report.totalCreditsWon} Crédits / ${report.totalCreditsExpected}`, { x: totalColumnX + 5, y: currentY - 20, size: 7, font: fontNormal });
    page.drawText(report.creditValidationStatus, { x: totalColumnX + 5, y: currentY - 30, size: ueLabelSize - 1, font: fontItalic, color: report.semesterAverage >= 10 ? rgb(0, 0.4, 0) : rgb(0.7, 0, 0) });

    // 8bis. Statistiques de la Promotion (moyenne classe, min, max, écart-type)
    currentY -= 40;
    const statsText = `Statistiques promotion — Moyenne classe : ${Number(globalStats.classAverage ?? 0).toFixed(2).replace('.', ',')}   |   Min : ${Number(globalStats.min ?? 0).toFixed(2).replace('.', ',')}   |   Max : ${Number(globalStats.max ?? 0).toFixed(2).replace('.', ',')}   |   Écart-type : ${Number(globalStats.stdDev ?? 0).toFixed(2).replace('.', ',')}`;
    page.drawText(statsText, { x: width / 2 - fontItalic.widthOfTextAtSize(statsText, 7) / 2, y: currentY, size: 7, font: fontItalic, color: rgb(0.3, 0.3, 0.3) });

    // 9. Décision du Jury
    currentY -= 20;
    const juryDecisionText = report.status.replace(/^Semestre/, `Semestre ${semester?.name.substring(1) || ''}`);
    page.drawText(`Décision du Jury :    ${juryDecisionText}`, { x: 60, y: currentY, size: 9, font: fontBold, color: rgb(0, 0, 0.4) });
    page.drawLine({ start: { x: 155, y: currentY - 2 }, end: { x: 535, y: currentY - 2 }, thickness: 0.5, color: rgb(0, 0, 0.4) });

    // 10. Signature block: date/place, director title + name, and a reserved blank space
    // for the actual handwritten/scanned signature (previously missing entirely).
    currentY -= 24;
    page.drawText(`Fait à Libreville, le ${new Date().toLocaleDateString('fr-FR')}`, { x: width / 2 - 48, y: currentY, size: 9, font: fontBold });
    currentY -= 16;
    page.drawText('LE DIRECTEUR DES ETUDES ET DE LA PEDAGOGIE', { x: width / 2 - 108, y: currentY, size: 10, font: fontBold, color: rgb(0, 0, 0.4) });
    currentY -= 18;
    page.drawText('Davy Edgard MOUSSAVOU', { x: width / 2 - 68, y: currentY, size: 10, font: fontBold, color: rgb(0, 0, 0.6) });

    currentY -= 32; // blank space reserved for the signature itself
    page.drawLine({ start: { x: width / 2 - 60, y: currentY }, end: { x: width / 2 + 60, y: currentY }, thickness: 0.5, color: rgb(0.6, 0.6, 0.6) });
    page.drawText('Signature', { x: width / 2 - fontItalic.widthOfTextAtSize('Signature', 7) / 2, y: currentY - 9, size: 7, font: fontItalic, color: rgb(0.5, 0.5, 0.5) });

    const disclaimer = "Il ne sera délivré qu'un seul et unique exemplaire de bulletins de notes. L'étudiant est donc prié d'en faire plusieurs copies légalisées.";
    const disclaimerY = BOTTOM_MARGIN;
    page.drawText(disclaimer, { x: width / 2 - fontItalic.widthOfTextAtSize(disclaimer, 7) / 2, y: disclaimerY, size: 7, font: fontItalic, color: rgb(0.4, 0.4, 0.4) });

    const pdfBytes = await pdfDoc.save();
    return Buffer.from(pdfBytes);
  }

  async generateAnnualBulletinPdf(studentId: string, year: string): Promise<Buffer> {
    const annualReport = await this.gradesService.calculateAnnualReport(studentId, year);
    const globalStats = await this.gradesService.getAnnualPromotionStats(year);
    const semesters = await this.prisma.semester.findMany({
      where: { year },
      orderBy: { name: 'asc' },
    });
    return this.renderAnnualBulletinPdf(annualReport as any, globalStats, year, semesters);
  }

  // Pure rendering — see renderBulletinPdf for why this is split out.
  private async renderAnnualBulletinPdf(
    annualReport: any,
    globalStats: any,
    year: string,
    semesters: { id: string; name: string }[],
  ): Promise<Buffer> {
    const semesterNameById = new Map(semesters.map((s) => [s.id, s.name]));

    const pdfDoc = await PDFDocument.create();
    const PAGE_SIZE: [number, number] = [595.28, 841.89];
    const TOP_MARGIN = 40;
    const BOTTOM_MARGIN = 50;
    let page = pdfDoc.addPage(PAGE_SIZE);
    let { width, height } = page.getSize();

    const fontNormal = await pdfDoc.embedFont(StandardFonts.Helvetica);
    const fontBold = await pdfDoc.embedFont(StandardFonts.HelveticaBold);
    const fontItalic = await pdfDoc.embedFont(StandardFonts.HelveticaOblique);

    let logoImage;
    try {
      const logoPath = path.join(process.cwd(), 'src/assets/logo-inptic.png');
      const logoBuffer = fs.readFileSync(logoPath);
      logoImage = await pdfDoc.embedPng(logoBuffer);
    } catch (e) {}

    const tableLeft = 40;
    const tableWidth = width - 80;
    const cols = {
      ueStart: 40,
      sessionStart: 350,
      avgStart: 455,
      tableEnd: 555.28,
    };
    const drawColumnLines = (topY: number, rowHeight: number) => {
      const bottomY = topY - rowHeight;
      [cols.sessionStart, cols.avgStart].forEach((x) => {
        page.drawLine({ start: { x, y: topY }, end: { x, y: bottomY }, color: rgb(0, 0, 0), thickness: 0.5 });
      });
    };
    const drawAnnualTableHeader = (y: number) => {
      page.drawRectangle({ x: tableLeft, y: y - 20, width: tableWidth, height: 20, color: rgb(0.9, 0.95, 1), borderColor: rgb(0,0,0), borderWidth: 1 });
      drawColumnLines(y, 20);
      page.drawText('Unité d\'Enseignement', { x: 45, y: y - 13, size: 9, font: fontBold });
      page.drawText('Session', { x: cols.sessionStart + 10, y: y - 13, size: 8, font: fontBold });
      page.drawText('Moyenne', { x: cols.avgStart + 10, y: y - 13, size: 8, font: fontBold });
    };

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
    drawAnnualTableHeader(currentY);
    currentY -= 20;

    const s5Report = annualReport.semesterReports.find(
      (r) => semesterNameById.get(r.semesterId) === 'S5',
    );
    const s6Report = annualReport.semesterReports.find(
      (r) => semesterNameById.get(r.semesterId) === 'S6',
    );

    const continuationLabel = `Bulletin de notes Annuel ${year} (suite) — ${annualReport.student.firstName} ${annualReport.student.lastName}`;
    const ensureSpace = (required: number, opts?: { redrawTableHeader?: boolean }) => {
      if (currentY - required < BOTTOM_MARGIN) {
        page = pdfDoc.addPage(PAGE_SIZE);
        ({ width, height } = page.getSize());
        currentY = height - TOP_MARGIN;
        page.drawText(continuationLabel, { x: 30, y: currentY, size: 9, font: fontItalic, color: rgb(0.4, 0.4, 0.4) });
        currentY -= 22;
        if (opts?.redrawTableHeader) {
          drawAnnualTableHeader(currentY);
          currentY -= 20;
        }
      }
    };

    if (s5Report) {
      for (const ue of s5Report.report) {
        // Each UE can draw up to 4 rows (UE header, S5, S6, Annual) — keep them together.
        ensureSpace(15 * 4, { redrawTableHeader: true });
        page.drawRectangle({ x: tableLeft, y: currentY - 15, width: tableWidth, height: 15, color: rgb(0.95, 0.95, 0.95), borderColor: rgb(0,0,0), borderWidth: 0.5 });
        drawColumnLines(currentY, 15);
        page.drawText(`${ue.ueCode || 'UE'}: ${ue.ueName}`, { x: 45, y: currentY - 11, size: 8, font: fontBold, color: rgb(0, 0, 0.4) });
        currentY -= 15;

        // Row for S5
        page.drawRectangle({ x: tableLeft, y: currentY - 15, width: tableWidth, height: 15, borderColor: rgb(0,0,0), borderWidth: 0.5 });
        drawColumnLines(currentY, 15);
        page.drawText('S5', { x: cols.sessionStart + 10, y: currentY - 11, size: 8, font: fontNormal });
        page.drawText(Number(ue.average ?? 0).toFixed(2), { x: cols.avgStart + 10, y: currentY - 11, size: 8, font: fontBold });
        currentY -= 15;

        // Find same UE in S6 by UE code first, then UE name
        const ueS6 = s6Report?.report.find(
          (u) => (u.ueCode && ue.ueCode ? u.ueCode === ue.ueCode : u.ueName === ue.ueName),
        );
        if (ueS6) {
          page.drawRectangle({ x: tableLeft, y: currentY - 15, width: tableWidth, height: 15, borderColor: rgb(0,0,0), borderWidth: 0.5 });
          drawColumnLines(currentY, 15);
          page.drawText('S6', { x: cols.sessionStart + 10, y: currentY - 11, size: 8, font: fontNormal });
          page.drawText(Number(ueS6.average ?? 0).toFixed(2), { x: cols.avgStart + 10, y: currentY - 11, size: 8, font: fontBold });
          currentY -= 15;

          // Annual Row for this UE
          page.drawRectangle({ x: tableLeft, y: currentY - 15, width: tableWidth, height: 15, color: rgb(1, 1, 0.9), borderColor: rgb(0,0,0), borderWidth: 0.5 });
          drawColumnLines(currentY, 15);
          page.drawText('Annuel', { x: cols.sessionStart + 10, y: currentY - 11, size: 8, font: fontBold });
          const annualUEAvg = ((ue.average + ueS6.average) / 2).toFixed(2);
          page.drawText(annualUEAvg, { x: cols.avgStart + 10, y: currentY - 11, size: 8, font: fontBold });
          currentY -= 15;
        }
      }
    }

    // Final Annual Result — keep this whole block together on one page.
    ensureSpace(160);
    currentY -= 30;
    page.drawRectangle({ x: tableLeft, y: currentY - 40, width: tableWidth, height: 40, borderColor: rgb(0,0,0), borderWidth: 2 });
    page.drawLine({
      start: { x: cols.avgStart, y: currentY },
      end: { x: cols.avgStart, y: currentY - 40 },
      color: rgb(0, 0, 0),
      thickness: 1,
    });
    page.drawText('Moyenne de l\'étudiant', { x: 60, y: currentY - 25, size: 11, font: fontBold });
    page.drawText(Number(annualReport.annualAverage ?? 0).toFixed(2), { x: cols.avgStart + 20, y: currentY - 25, size: 14, font: fontBold, color: rgb(0, 0, 0.8) });

    page.drawText(`DÉCISION : ${annualReport.status.toUpperCase()}`, { x: 60, y: currentY - 60, size: 11, font: fontBold });
    page.drawText(`MENTION : ${annualReport.mention.toUpperCase()}`, { x: 300, y: currentY - 60, size: 11, font: fontBold });
    page.drawText(`JURY : ${annualReport.juryDecision.toUpperCase()}`, { x: 60, y: currentY - 78, size: 10, font: fontBold, color: rgb(0, 0, 0.4) });

    // Statistiques de la promotion (moyenne classe, min, max, écart-type)
    currentY -= 105;
    const statsText = `Statistiques promotion — Moyenne classe : ${Number(globalStats.classAverage ?? 0).toFixed(2)}   |   Min : ${Number(globalStats.min ?? 0).toFixed(2)}   |   Max : ${Number(globalStats.max ?? 0).toFixed(2)}   |   Écart-type : ${Number(globalStats.stdDev ?? 0).toFixed(2)}`;
    page.drawText(statsText, { x: width / 2 - fontItalic.widthOfTextAtSize(statsText, 8) / 2, y: currentY, size: 8, font: fontItalic, color: rgb(0.3, 0.3, 0.3) });

    const pdfBytes = await pdfDoc.save();
    return Buffer.from(pdfBytes);
  }

  private htmlDocument(title: string, body: string): string {
    return `<!DOCTYPE html>
<html lang="fr">
<head>
<meta charset="UTF-8" />
<title>${title}</title>
<style>
  @media print { body { margin: 0; } .no-print { display: none; } }
  body { font-family: Arial, Helvetica, sans-serif; color: #1a1a2e; max-width: 800px; margin: 20px auto; padding: 0 20px; }
  h1 { text-align: center; color: #000066; font-size: 20px; margin-bottom: 4px; }
  .subtitle { text-align: center; color: #444; font-style: italic; margin-bottom: 20px; }
  .header { text-align: center; font-weight: bold; font-size: 12px; line-height: 1.4; margin-bottom: 10px; }
  .student-box { border: 1px solid #000; padding: 10px 14px; margin-bottom: 20px; display: flex; justify-content: space-between; flex-wrap: wrap; gap: 8px; }
  table { width: 100%; border-collapse: collapse; margin-bottom: 16px; }
  th, td { border: 1px solid #333; padding: 6px 8px; font-size: 13px; text-align: left; }
  th { background: #eef0fa; }
  .ue-row td { background: #f7f7f7; font-weight: bold; color: #000066; }
  .ue-footer td { background: #fbfbfb; font-weight: bold; }
  .avg-box { background: #ffe680; border: 1.5px solid #000; padding: 10px 16px; display: inline-block; font-weight: bold; margin-bottom: 20px; }
  .stats { text-align: center; font-style: italic; color: #444; font-size: 13px; margin: 16px 0; }
  .decision { font-weight: bold; color: #000066; margin: 10px 0; }
  .footer { text-align: center; margin-top: 30px; font-size: 12px; }
  .disclaimer { text-align: center; font-size: 11px; font-style: italic; color: #555; margin-top: 30px; }
  .toolbar { text-align: right; margin-bottom: 10px; }
  .toolbar button { padding: 6px 14px; cursor: pointer; }
</style>
</head>
<body>
<div class="toolbar no-print"><button onclick="window.print()">🖨️ Imprimer / Exporter en PDF</button></div>
${body}
</body>
</html>`;
  }

  async generateBulletinHtml(studentId: string, semesterId: string): Promise<string> {
    const report = await this.gradesService.calculateStudentReport(studentId, semesterId);
    if (!report || !report.student) {
      throw new NotFoundException('Données de l\'étudiant introuvables pour ce bulletin.');
    }
    const globalStats = await this.gradesService.getPromotionStats(semesterId);
    const semester = await this.prisma.semester.findUnique({ where: { id: semesterId } });

    // Mirrors calculateAnnualReport's mention scale (grades.service.ts) — an average below
    // 10 gets no mention at all, it previously defaulted to "Passable" even for a failing grade.
    let mention = 'Non attribuée';
    if (report.semesterAverage >= 16) mention = 'Très Bien';
    else if (report.semesterAverage >= 14) mention = 'Bien';
    else if (report.semesterAverage >= 12) mention = 'Assez Bien';
    else if (report.semesterAverage >= 10) mention = 'Passable';

    const ueRows = report.report.map((ue, idx) => {
      const subjectRows = ue.subjects.map((subj: any) => `
        <tr>
          <td>${subj.subject}</td>
          <td>${subj.credits ?? '-'}</td>
          <td>${Number(subj.coefficient ?? 1).toFixed(2)}</td>
          <td>${subj.absences > 0 ? subj.absences : '-'}</td>
          <td><strong>${Number(subj.average ?? 0).toFixed(2)}</strong></td>
        </tr>`).join('');
      return `
        <tr class="ue-row"><td colspan="5">UE${semester?.name?.substring(1) || '0'}-${idx + 1} : ${ue.ueName}</td></tr>
        ${subjectRows}
        <tr class="ue-footer">
          <td>Moyenne UE</td>
          <td>${ue.creditsExpected}</td>
          <td></td>
          <td></td>
          <td>${Number(ue.average ?? 0).toFixed(2)} — ${ue.status}</td>
        </tr>`;
    }).join('');

    const body = `
      <div class="header">
        INSTITUT NATIONAL DE LA POSTE, DES TECHNOLOGIES DE L'INFORMATION ET DE LA COMMUNICATION<br/>
        DIRECTION DES ETUDES ET DE LA PEDAGOGIE
      </div>
      <h1>Bulletin de notes du Semestre ${semester?.name?.replace('S', '') || ''}</h1>
      <div class="subtitle">Année universitaire : ${semester?.year || ''}</div>
      <div class="student-box">
        <div><strong>Nom(s) et Prénom(s) :</strong> ${report.student.firstName} ${report.student.lastName}</div>
        <div><strong>Classe :</strong> ${report.student.class || 'Licence Professionnelle'}</div>
      </div>
      <table>
        <thead>
          <tr><th>Matière</th><th>Crédits</th><th>Coefficient</th><th>Hrs Abs.</th><th>Note</th></tr>
        </thead>
        <tbody>${ueRows}</tbody>
      </table>
      <div class="avg-box">Moyenne au Semestre ${semester?.name?.substring(1) || ''} : ${Number(report.semesterAverage ?? 0).toFixed(2)}/20</div>
      <p>Rang de l'étudiant au semestre : <strong>${report.rank}${report.rank === 1 ? 'er' : 'ème'} / ${report.totalStudents}</strong> — Mention : <strong>${mention}</strong></p>
      <p>Crédits acquis au semestre : <strong>${report.totalCreditsWon} / ${report.totalCreditsExpected}</strong> — <strong>${report.creditValidationStatus}</strong></p>
      <div class="stats">Statistiques promotion — Moyenne classe : ${Number(globalStats.classAverage ?? 0).toFixed(2)} | Min : ${Number(globalStats.min ?? 0).toFixed(2)} | Max : ${Number(globalStats.max ?? 0).toFixed(2)} | Écart-type : ${Number(globalStats.stdDev ?? 0).toFixed(2)}</div>
      <div class="decision">Décision du Jury : ${report.status.replace(/^Semestre/, `Semestre ${semester?.name?.substring(1) || ''}`)}</div>
      <div class="footer">
        Fait à Libreville, le ${new Date().toLocaleDateString('fr-FR')}<br/>
        LE DIRECTEUR DES ETUDES ET DE LA PEDAGOGIE<br/>
        <strong>Davy Edgard MOUSSAVOU</strong>
      </div>
      <div class="disclaimer">Il ne sera délivré qu'un seul et unique exemplaire de bulletins de notes. L'étudiant est donc prié d'en faire plusieurs copies légalisées.</div>
    `;

    return this.htmlDocument(`Bulletin ${semester?.name || ''} - ${report.student.firstName} ${report.student.lastName}`, body);
  }

  async generateAnnualBulletinHtml(studentId: string, year: string): Promise<string> {
    const annualReport = await this.gradesService.calculateAnnualReport(studentId, year);
    const globalStats = await this.gradesService.getAnnualPromotionStats(year);
    const semesters = await this.prisma.semester.findMany({ where: { year }, orderBy: { name: 'asc' } });
    const semesterNameById = new Map(semesters.map((s) => [s.id, s.name]));

    const s5Report = annualReport.semesterReports.find((r: any) => semesterNameById.get(r.semesterId) === 'S5');
    const s6Report = annualReport.semesterReports.find((r: any) => semesterNameById.get(r.semesterId) === 'S6');

    const ueRows = (s5Report?.report || []).map((ue: any) => {
      const ueS6 = s6Report?.report.find((u: any) => (u.ueCode && ue.ueCode ? u.ueCode === ue.ueCode : u.ueName === ue.ueName));
      const annualUEAvg = ueS6 ? ((ue.average + ueS6.average) / 2).toFixed(2) : '-';
      return `
        <tr><td>${ue.ueCode || 'UE'} : ${ue.ueName}</td><td>S5</td><td>${Number(ue.average ?? 0).toFixed(2)}</td></tr>
        ${ueS6 ? `<tr><td></td><td>S6</td><td>${Number(ueS6.average ?? 0).toFixed(2)}</td></tr>
        <tr class="ue-footer"><td></td><td>Annuel</td><td>${annualUEAvg}</td></tr>` : ''}
      `;
    }).join('');

    const body = `
      <div class="header">RÉPUBLIQUE GABONAISE — INSTITUT NATIONAL DE LA POSTE, DES TIC</div>
      <h1>Bulletin de notes Annuel</h1>
      <div class="subtitle">Année universitaire : ${year}</div>
      <div class="student-box">
        <div><strong>Nom et Prénom :</strong> ${annualReport.student.firstName} ${annualReport.student.lastName}</div>
        <div><strong>Lieu de naissance :</strong> ${annualReport.student.birthPlace || 'N/A'}</div>
      </div>
      <table>
        <thead><tr><th>Unité d'Enseignement</th><th>Session</th><th>Moyenne</th></tr></thead>
        <tbody>${ueRows}</tbody>
      </table>
      <div class="avg-box">Moyenne de l'étudiant : ${Number(annualReport.annualAverage ?? 0).toFixed(2)}/20</div>
      <div class="decision">DÉCISION : ${annualReport.status.toUpperCase()}</div>
      <div class="decision">MENTION : ${annualReport.mention.toUpperCase()}</div>
      <div class="decision">JURY : ${annualReport.juryDecision.toUpperCase()}</div>
      <div class="stats">Statistiques promotion — Moyenne classe : ${Number(globalStats.classAverage ?? 0).toFixed(2)} | Min : ${Number(globalStats.min ?? 0).toFixed(2)} | Max : ${Number(globalStats.max ?? 0).toFixed(2)} | Écart-type : ${Number(globalStats.stdDev ?? 0).toFixed(2)}</div>
    `;

    return this.htmlDocument(`Bulletin Annuel ${year} - ${annualReport.student.firstName} ${annualReport.student.lastName}`, body);
  }

  async generatePromotionXlsx(semesterId: string): Promise<Buffer> {
    const semester = await this.prisma.semester.findUnique({
      where: { id: semesterId },
      include: {
        ues: {
          include: {
            subjects: {
              orderBy: { name: 'asc' },
            },
          },
          orderBy: { name: 'asc' },
        },
      },
    });

    if (!semester) throw new NotFoundException('Semestre introuvable');

    const students = await this.prisma.student.findMany({
      orderBy: { lastName: 'asc' },
    });

    const { reportsByStudentId } = await this.gradesService.computeSemesterReports(semesterId);
    const reports = students.map((s) => reportsByStudentId.get(s.id)).filter((r): r is NonNullable<typeof r> => !!r);

    const workbook = new ExcelJS.Workbook();
    const worksheet = workbook.addWorksheet(`Promotion - ${semester.name}`);

    // Build columns
    const columns: any[] = [
      { header: 'MATRICULE', key: 'studentId', width: 20 },
      { header: 'NOM', key: 'lastName', width: 25 },
      { header: 'PRÉNOM', key: 'firstName', width: 25 },
      { header: 'CLASSE', key: 'class', width: 15 },
    ];

    // Add UE and Subject columns
    semester.ues.forEach((ue) => {
      columns.push({ header: `UE: ${ue.code || ue.name} (MOY)`, key: `ue_${ue.id}_avg`, width: 15 });
      ue.subjects.forEach((subj) => {
        columns.push({ header: `${subj.name} (CC)`, key: `subj_${subj.id}_cc`, width: 12 });
        columns.push({ header: `${subj.name} (EXAM)`, key: `subj_${subj.id}_exam`, width: 12 });
        columns.push({ header: `${subj.name} (MOY)`, key: `subj_${subj.id}_moy`, width: 12 });
        columns.push({ header: `${subj.name} (ABS)`, key: `subj_${subj.id}_abs`, width: 10 });
      });
    });

    columns.push(
      { header: 'MOYENNE SEMESTRE', key: 'semesterAvg', width: 20 },
      { header: 'RANG', key: 'rank', width: 10 },
      { header: 'CRÉDITS ACQUIS', key: 'credits', width: 15 },
      { header: 'DÉCISION', key: 'status', width: 20 }
    );

    worksheet.columns = columns;

    // Add rows
    reports.forEach((report) => {
      const rowData: any = {
        studentId: report.student?.studentId || '',
        lastName: report.student?.lastName || '',
        firstName: report.student?.firstName || '',
        class: report.student?.class || '',
        semesterAvg: report.semesterAverage?.toFixed(2) || '0.00',
        rank: report.rank || '',
        credits: report.totalCreditsWon || 0,
        status: report.status || '',
      };

      report.report.forEach((ueReport: any) => {
        // Find corresponding UE in semester object to get ID
        const ue = semester.ues.find(u => u.name === ueReport.ueName || u.code === ueReport.ueCode);
        if (ue) {
          rowData[`ue_${ue.id}_avg`] = ueReport.average?.toFixed(2) || '0.00';
          
          ueReport.subjects.forEach((subjReport: any) => {
            const subj = ue.subjects.find(s => s.name === subjReport.subject);
            if (subj) {
              rowData[`subj_${subj.id}_cc`] = subjReport.grade?.ccGrade ?? '';
              rowData[`subj_${subj.id}_exam`] = subjReport.grade?.examGrade ?? '';
              rowData[`subj_${subj.id}_moy`] = subjReport.average?.toFixed(2) || '0.00';
              rowData[`subj_${subj.id}_abs`] = subjReport.absences || 0;
            }
          });
        }
      });

      worksheet.addRow(rowData);
    });

    // Styling
    worksheet.getRow(1).font = { bold: true };
    worksheet.getRow(1).fill = {
      type: 'pattern',
      pattern: 'solid',
      fgColor: { argb: 'FFE0E0E0' }
    };
    
    // Add borders to all cells
    worksheet.eachRow((row) => {
      row.eachCell((cell) => {
        cell.border = {
          top: { style: 'thin' },
          left: { style: 'thin' },
          bottom: { style: 'thin' },
          right: { style: 'thin' }
        };
      });
    });

    const buffer = await workbook.xlsx.writeBuffer();
    return Buffer.from(buffer);
  }
  async generateAnnualPromotionXlsx(year: string): Promise<Buffer> {
    const semesters = await this.prisma.semester.findMany({
      where: { year },
      orderBy: { name: 'asc' },
    });

    const students = await this.prisma.student.findMany({
      orderBy: { lastName: 'asc' },
    });

    const reports = await Promise.all(
      students.map((s) => this.gradesService.calculateAnnualReport(s.id, year))
    );

    const sortedAverages = [...reports.map(r => r.annualAverage)].sort((a, b) => b - a);

    const workbook = new ExcelJS.Workbook();
    const worksheet = workbook.addWorksheet(`Promotion Annuelle - ${year}`);

    // Build columns
    const columns: any[] = [
      { header: 'MATRICULE', key: 'studentId', width: 20 },
      { header: 'NOM', key: 'lastName', width: 25 },
      { header: 'PRÉNOM', key: 'firstName', width: 25 },
      { header: 'CLASSE', key: 'class', width: 15 },
    ];

    semesters.forEach((sem) => {
      columns.push({ header: `MOYENNE ${sem.name}`, key: `sem_${sem.id}_avg`, width: 15 });
    });

    columns.push(
      { header: 'MOYENNE ANNUELLE', key: 'annualAvg', width: 20 },
      { header: 'RANG', key: 'rank', width: 10 },
      { header: 'CRÉDITS ACQUIS', key: 'credits', width: 15 },
      { header: 'DÉCISION', key: 'status', width: 20 },
      { header: 'MENTION', key: 'mention', width: 15 }
    );

    worksheet.columns = columns;

    reports.forEach((report) => {
      const rank = sortedAverages.indexOf(report.annualAverage) + 1;
      const rowData: any = {
        studentId: report.student?.studentId || '',
        lastName: report.student?.lastName || '',
        firstName: report.student?.firstName || '',
        class: report.student?.class || '',
        annualAvg: report.annualAverage?.toFixed(2) || '0.00',
        rank: rank,
        credits: report.totalCreditsWon || 0,
        status: report.status || '',
        mention: report.mention || '',
      };

      report.semesterReports.forEach((semReport) => {
        rowData[`sem_${semReport.semesterId}_avg`] = semReport.semesterAverage?.toFixed(2) || '0.00';
      });

      worksheet.addRow(rowData);
    });

    worksheet.getRow(1).font = { bold: true };
    worksheet.getRow(1).fill = {
      type: 'pattern',
      pattern: 'solid',
      fgColor: { argb: 'FFE0E0E0' }
    };

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

  // Computes the shared per-promotion data (every student's report + class stats) ONCE,
  // then renders each bulletin from that in-memory data — instead of each bulletin
  // re-querying and re-ranking the whole class from scratch (was O(n²) DB work, the
  // reason bulk downloads used to time out for anything but a handful of students).
  private async renderAllBulletinsForSemester(semesterId: string): Promise<{ student: { lastName: string; firstName: string; studentId: string; id: string }; pdf: Buffer }[]> {
    const semesterData = await this.gradesService.computeSemesterReports(semesterId);
    const globalStats = await this.gradesService.getPromotionStats(semesterId, semesterData);
    const semester = await this.prisma.semester.findUnique({ where: { id: semesterId } });

    const results: { student: { lastName: string; firstName: string; studentId: string; id: string }; pdf: Buffer }[] = [];
    for (const student of semesterData.students) {
      const report = semesterData.reportsByStudentId.get(student.id);
      if (!report) continue;
      try {
        const pdf = await this.renderBulletinPdf(report as any, globalStats, semester);
        results.push({ student, pdf });
      } catch {
        // ignore rendering failures for individual students (e.g. incomplete data)
      }
    }
    return results;
  }

  private async renderAllAnnualBulletinsForYear(year: string): Promise<{ student: { lastName: string; firstName: string; studentId: string; id: string }; pdf: Buffer }[]> {
    const students = await this.prisma.student.findMany({ orderBy: [{ lastName: 'asc' }] });
    const globalStats = await this.gradesService.getAnnualPromotionStats(year);
    const semesters = await this.prisma.semester.findMany({ where: { year }, orderBy: { name: 'asc' } });

    const results: { student: { lastName: string; firstName: string; studentId: string; id: string }; pdf: Buffer }[] = [];
    for (const student of students) {
      try {
        const annualReport = await this.gradesService.calculateAnnualReport(student.id, year);
        const pdf = await this.renderAnnualBulletinPdf(annualReport as any, globalStats, year, semesters);
        results.push({ student, pdf });
      } catch {
        // ignore missing data or errors for individual students
      }
    }
    return results;
  }

  private zipPdfs(entries: { student: { lastName: string; firstName: string; studentId: string; id: string }; pdf: Buffer }[], nameFor: (student: { lastName: string; firstName: string; studentId: string; id: string }) => string): Promise<Buffer> {
    return new Promise<Buffer>((resolve, reject) => {
      const archive = archiver('zip', { zlib: { level: 9 } });
      const chunks: Buffer[] = [];

      archive.on('data', (d) => chunks.push(Buffer.from(d)));
      archive.on('warning', (err) => {
        if ((err as any).code === 'ENOENT') return;
        reject(err);
      });
      archive.on('error', (err) => reject(err));
      archive.on('end', () => resolve(Buffer.concat(chunks)));

      for (const { student, pdf } of entries) {
        archive.append(pdf, { name: nameFor(student) });
      }

      archive.finalize();
    });
  }

  private safeStudentName(s: { lastName: string; firstName: string; studentId: string; id: string }): string {
    return `${(s.lastName || '').toUpperCase()}_${(s.firstName || '').toUpperCase()}_${s.studentId || s.id}`.replace(/[^a-zA-Z0-9_]+/g, '_');
  }

  async generateAllBulletinsZip(semesterId: string): Promise<Buffer> {
    const semester = await this.prisma.semester.findUnique({ where: { id: semesterId } });
    const entries = await this.renderAllBulletinsForSemester(semesterId);
    return this.zipPdfs(entries, (s) => `bulletin_${semester?.name || 'SEM'}_${this.safeStudentName(s)}.pdf`);
  }

  async generateAllAnnualBulletinsZip(year: string): Promise<Buffer> {
    const entries = await this.renderAllAnnualBulletinsForYear(year);
    return this.zipPdfs(entries, (s) => `bulletin_ANNUEL_${year}_${this.safeStudentName(s)}.pdf`);
  }

  private async mergePdfBuffers(buffers: Buffer[]): Promise<Buffer> {
    const mergedDoc = await PDFDocument.create();
    for (const buf of buffers) {
      const src = await PDFDocument.load(buf);
      const pages = await mergedDoc.copyPages(src, src.getPageIndices());
      pages.forEach((p) => mergedDoc.addPage(p));
    }
    const bytes = await mergedDoc.save();
    return Buffer.from(bytes);
  }

  async generateAllBulletinsSinglePdf(semesterId: string): Promise<Buffer> {
    const entries = await this.renderAllBulletinsForSemester(semesterId);
    return this.mergePdfBuffers(entries.map((e) => e.pdf));
  }

  async generateAllAnnualBulletinsSinglePdf(year: string): Promise<Buffer> {
    const entries = await this.renderAllAnnualBulletinsForYear(year);
    return this.mergePdfBuffers(entries.map((e) => e.pdf));
  }

  // Trims, collapses internal whitespace and lower-cases so "Anglais  technique " and
  // "anglais technique" match — Excel copy/paste routinely introduces stray spacing/case.
  private normalizeText(s: string): string {
    return s.trim().replace(/\s+/g, ' ').toLowerCase();
  }

  // Accepts either "14.5" or the French "14,5" and validates the 0-20 range required by
  // the grading rules. Returns an error string instead of silently dropping bad input.
  private parseGradeCell(raw: string, label: string): { value?: number; error?: string } {
    const trimmed = raw.trim();
    if (trimmed === '') return {};
    const value = Number(trimmed.replace(',', '.'));
    if (!Number.isFinite(value)) return { error: `${label} invalide ("${raw}")` };
    if (value < 0 || value > 20) return { error: `${label} hors barème 0-20 ("${raw}")` };
    return { value };
  }

  async importGradesFromExcel(buffer: Buffer, semesterId: string, userId: string) {
    const workbook = new ExcelJS.Workbook();
    await workbook.xlsx.load(buffer as any);

    if (workbook.worksheets.length === 0) throw new NotFoundException('Worksheet not found');

    // Loaded once up front (instead of per-row queries) so matching is both faster and
    // resilient to whitespace/case differences between the Excel file and the database.
    const students = await this.prisma.student.findMany();
    const studentById = new Map(students.map((s) => [s.id, s]));
    const studentByMatricule = new Map(students.map((s) => [this.normalizeText(s.studentId), s]));

    const subjects = await this.prisma.subject.findMany({ where: { ue: { semesterId } } });
    const subjectById = new Map(subjects.map((s) => [s.id, s]));
    const subjectByName = new Map(subjects.map((s) => [this.normalizeText(s.name), s]));

    let count = 0;
    let skipped = 0;
    const errors: string[] = [];
    let anyReleveSheetFound = false;
    const R = ExportsService.RELEVE;

    // Each sheet is one subject's "relevé de notes" (see buildReleveSheet) — the subject
    // is read from the fixed "Matière :" cell rather than the sheet tab (which is
    // sanitized/truncated for Excel and isn't reliable for matching).
    for (const worksheet of workbook.worksheets) {
      const subjectRef = worksheet.getCell(R.MATIERE_ROW, R.MATIERE_COL).toString().trim();
      const headerLabel = worksheet.getCell(R.HEADER_ROW, R.COL_MATRICULE).toString().trim();
      if (!subjectRef || !headerLabel.toLowerCase().startsWith('matricule')) continue; // not a relevé sheet
      anyReleveSheetFound = true;

      const subject = subjectById.get(subjectRef) ?? subjectByName.get(this.normalizeText(subjectRef));
      if (!subject) {
        skipped++;
        errors.push(`${worksheet.name}: matière introuvable pour ce semestre ("${subjectRef}")`);
        continue;
      }

      for (let i = R.HEADER_ROW + 1; i <= worksheet.rowCount; i++) {
        const row = worksheet.getRow(i);
        const studentRef = row.getCell(R.COL_MATRICULE).toString().trim();
        if (!studentRef) break; // end of the student list for this sheet

        const student = studentById.get(studentRef) ?? studentByMatricule.get(this.normalizeText(studentRef));
        if (!student) {
          skipped++;
          errors.push(`${worksheet.name} - Ligne ${i}: étudiant introuvable ("${studentRef}")`);
          continue;
        }

        const cc = this.parseGradeCell(row.getCell(R.COL_CC).toString().trim(), 'Note CC');
        const exam = this.parseGradeCell(row.getCell(R.COL_EXAM).toString().trim(), 'Note Examen');
        const rattr = this.parseGradeCell(row.getCell(R.COL_RATTR).toString().trim(), 'Note Rattrapage');
        const rowErrors = [cc.error, exam.error, rattr.error].filter(Boolean);
        if (rowErrors.length > 0) {
          skipped++;
          errors.push(`${worksheet.name} - Ligne ${i} (${student.studentId}): ${rowErrors.join(', ')}`);
          continue;
        }
        if (cc.value === undefined && exam.value === undefined && rattr.value === undefined) {
          continue; // left blank for this student — not an error
        }

        try {
          await this.gradesService.enterGrade({
              studentId: student.id,
              subjectId: subject.id,
              ccGrade: cc.value,
              examGrade: exam.value,
              rattrapageGrade: rattr.value,
          }, userId);
          count++;
        } catch (e) {
          skipped++;
          errors.push(`${worksheet.name} - Ligne ${i} (${student.studentId}): ${e instanceof Error ? e.message : 'erreur inconnue'}`);
        }
      }
    }

    if (!anyReleveSheetFound) {
      throw new NotFoundException(
        'Aucun onglet "relevé de notes" reconnu dans ce fichier. ' +
        "Utilisez le canevas généré par l'application (bouton \"Canevas notes\").",
      );
    }

    return { imported: count, skipped, errors };
  }

  private styleTemplateHeaderRow(worksheet: ExcelJS.Worksheet) {
    worksheet.getRow(1).font = { bold: true };
    worksheet.getRow(1).fill = {
      type: 'pattern',
      pattern: 'solid',
      fgColor: { argb: 'FFE0E0E0' },
    };
  }

  async generateTemplate(type: 'STUDENTS' | 'GRADES', semesterId?: string): Promise<Buffer> {
    const workbook = new ExcelJS.Workbook();

    if (type === 'STUDENTS') {
      const worksheet = workbook.addWorksheet('Etudiants');
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
      this.styleTemplateHeaderRow(worksheet);
    } else {
      // One "RELEVÉ DE NOTES" sheet per subject — mirrors the school's own historical
      // gradebook (ASUR 2014-2015.xls: one signed relevé per subject, with the institution
      // header, Classe/Année/Matière/Coefficient/Semestre/Enseignant block, a N°/Élèves/
      // CC/Examen/Moyenne table, and signature lines) instead of a generic spreadsheet.
      const subjects = semesterId
        ? await this.prisma.subject.findMany({
            where: { ue: { semesterId } },
            include: { ue: true, teacher: true },
            orderBy: [{ ue: { name: 'asc' } }, { name: 'asc' }],
          })
        : [];
      const students = semesterId
        ? await this.prisma.student.findMany({ orderBy: [{ lastName: 'asc' }, { firstName: 'asc' }] })
        : [];
      const semester = semesterId ? await this.prisma.semester.findUnique({ where: { id: semesterId } }) : null;

      if (semesterId && subjects.length === 0) {
        const worksheet = workbook.addWorksheet('Relevé');
        worksheet.addRow(['Aucune matière enregistrée pour ce semestre — créez-les dans Gestion académique avant d\'importer des notes.']);
      } else {
        const effectiveSubjects = subjects.length > 0
          ? subjects
          : [{ id: 'sample', name: 'Anglais technique', coefficient: 1, ccWeight: 0.4, examWeight: 0.6, teacher: null } as any];
        const effectiveStudents = students.length > 0
          ? students
          : [{ studentId: 'INPTIC-2024-001', lastName: 'DUPONT', firstName: 'Jean' } as any];

        const usedSheetNames = new Set<string>();
        for (const subject of effectiveSubjects) {
          this.buildReleveSheet(workbook, {
            subjectName: subject.name,
            coefficient: subject.coefficient,
            ccWeight: subject.ccWeight ?? 0.4,
            examWeight: subject.examWeight ?? 0.6,
            teacherName: subject.teacher ? `${subject.teacher.firstName} ${subject.teacher.lastName}` : undefined,
            className: students[0]?.class,
            year: semester?.year,
            semesterName: semester?.name,
            students: effectiveStudents,
          }, usedSheetNames);
        }
      }
    }

    const buffer = await workbook.xlsx.writeBuffer();
    return Buffer.from(buffer);
  }

  // Row/column layout the "relevé de notes" sheets below use — importGradesFromExcel reads
  // these exact positions back, since this service both generates and parses the file.
  private static readonly RELEVE = {
    MATIERE_ROW: 7, MATIERE_COL: 2,
    HEADER_ROW: 11,
    COL_NUM: 1, COL_MATRICULE: 2, COL_ELEVE: 3, COL_CC: 4, COL_EXAM: 5, COL_RATTR: 6, COL_MOY: 7,
  } as const;

  private buildReleveSheet(
    workbook: ExcelJS.Workbook,
    data: {
      subjectName: string;
      coefficient: number;
      ccWeight: number;
      examWeight: number;
      teacherName?: string;
      className?: string;
      year?: string;
      semesterName?: string;
      students: { studentId: string; lastName: string; firstName: string }[];
    },
    usedSheetNames: Set<string>,
  ) {
    const R = ExportsService.RELEVE;
    const sheetName = this.uniqueSheetName(data.subjectName, usedSheetNames);
    const ws = workbook.addWorksheet(sheetName);
    ws.columns = [
      { width: 6 }, { width: 18 }, { width: 34 }, { width: 14 }, { width: 14 }, { width: 14 }, { width: 12 },
    ];

    const centerBold = (cell: ExcelJS.Cell, size = 9) => { cell.font = { bold: true, size }; cell.alignment = { horizontal: 'center' }; };

    ws.mergeCells(1, 1, 1, 7);
    centerBold(ws.getCell(1, 1), 9);
    ws.getCell(1, 1).value = 'INSTITUT NATIONAL DE LA POSTE, DES TECHNOLOGIES DE L\'INFORMATION ET DE LA COMMUNICATION';
    ws.mergeCells(2, 1, 2, 7);
    centerBold(ws.getCell(2, 1), 9);
    ws.getCell(2, 1).value = 'DIRECTION DES ETUDES ET DE LA PEDAGOGIE';

    ws.mergeCells(4, 1, 4, 7);
    const title = ws.getCell(4, 1);
    title.value = 'RELEVE DE NOTES';
    title.font = { bold: true, size: 13 };
    title.alignment = { horizontal: 'center' };

    ws.getCell(6, 1).value = 'Classe :';
    ws.getCell(6, 2).value = data.className || '';
    ws.getCell(6, 5).value = 'Année :';
    ws.getCell(6, 6).value = data.year || '';

    ws.getCell(R.MATIERE_ROW, 1).value = 'Matière :';
    ws.getCell(R.MATIERE_ROW, R.MATIERE_COL).value = data.subjectName;
    ws.getCell(R.MATIERE_ROW, R.MATIERE_COL).font = { bold: true };

    ws.getCell(8, 1).value = 'Coefficient :';
    ws.getCell(8, 2).value = data.coefficient;
    ws.getCell(8, 5).value = 'Semestre :';
    ws.getCell(8, 6).value = data.semesterName || '';

    ws.getCell(9, 1).value = 'Enseignant :';
    ws.getCell(9, 2).value = data.teacherName || '.....................................';

    const headerRow = ws.getRow(R.HEADER_ROW);
    headerRow.values = [
      'N°', 'Matricule', 'Élèves',
      `Contrôle Continu ${Math.round(data.ccWeight * 100)}%`,
      `Examen Final ${Math.round(data.examWeight * 100)}%`,
      'Rattrapage',
      'Moyenne',
    ];
    headerRow.font = { bold: true };
    headerRow.alignment = { horizontal: 'center', wrapText: true };
    headerRow.eachCell((cell) => {
      cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFE0E0E0' } };
      cell.border = { top: { style: 'thin' }, bottom: { style: 'thin' }, left: { style: 'thin' }, right: { style: 'thin' } };
    });

    let r = R.HEADER_ROW + 1;
    data.students.forEach((student, idx) => {
      const row = ws.getRow(r);
      row.getCell(R.COL_NUM).value = idx + 1;
      row.getCell(R.COL_MATRICULE).value = student.studentId;
      row.getCell(R.COL_ELEVE).value = `${student.lastName} ${student.firstName}`;
      // Moyenne is a live preview only (CC×weight + Examen×weight, replaced by Rattrapage
      // when filled) — the app recomputes the authoritative average itself on import.
      const ccRef = `D${r}`, examRef = `E${r}`, rattrRef = `F${r}`;
      row.getCell(R.COL_MOY).value = {
        formula: `IF(${rattrRef}<>"",${rattrRef},IF(AND(${ccRef}<>"",${examRef}<>""),${ccRef}*${data.ccWeight}+${examRef}*${data.examWeight},IF(${ccRef}<>"",${ccRef},IF(${examRef}<>"",${examRef},""))))`,
      };
      r += 1;
    });
    const lastDataRow = r - 1;

    r += 1;
    ws.getCell(r, 1).value = 'Moyenne de la classe :';
    ws.getCell(r, 1).font = { italic: true };
    if (lastDataRow >= R.HEADER_ROW + 1) {
      ws.getCell(r, R.COL_MOY).value = { formula: `IFERROR(AVERAGE(G${R.HEADER_ROW + 1}:G${lastDataRow}),"")` };
    }

    r += 2;
    ws.getCell(r, 1).value = 'Date : .....................';
    r += 2;
    ws.getCell(r, 1).value = "Signature de l'Enseignant";
    ws.getCell(r, 5).value = 'Visa Responsable Pédagogique';
    ws.getCell(r, 1).font = { italic: true, size: 8 };
    ws.getCell(r, 5).font = { italic: true, size: 8 };

    ws.getCell(R.MATIERE_ROW, 1).note =
      'Cette cellule identifie la matière pour l\'import — ne la modifiez pas. ' +
      'Seules les colonnes Contrôle Continu, Examen Final et Rattrapage sont à remplir ; ' +
      'la Moyenne est calculée automatiquement à titre indicatif.';
    ws.views = [{ state: 'frozen', ySplit: R.HEADER_ROW }];
  }

  private uniqueSheetName(subjectName: string, used: Set<string>): string {
    // Excel sheet names: max 31 chars, and : \ / ? * [ ] are forbidden.
    let base = subjectName.replace(/[:\\/?*[\]]/g, ' ').trim().slice(0, 31) || 'Matière';
    let name = base;
    let i = 2;
    while (used.has(name)) {
      const suffix = ` (${i})`;
      name = base.slice(0, 31 - suffix.length) + suffix;
      i += 1;
    }
    used.add(name);
    return name;
  }

  // Real data export (as opposed to generateTemplate, which is always a blank canvas) —
  // used by the Classes module's "Exporter" button to download a class roster.
  async generateStudentsXlsx(className?: string): Promise<Buffer> {
    const students = await this.prisma.student.findMany({
      where: className ? { class: className } : undefined,
      include: { user: { select: { email: true } } },
      orderBy: [{ lastName: 'asc' }, { firstName: 'asc' }],
    });

    const workbook = new ExcelJS.Workbook();
    const worksheet = workbook.addWorksheet(className || 'Etudiants');
    worksheet.columns = [
      { header: 'MATRICULE', key: 'studentId', width: 20 },
      { header: 'NOM', key: 'lastName', width: 22 },
      { header: 'PRÉNOM', key: 'firstName', width: 22 },
      { header: 'EMAIL', key: 'email', width: 32 },
      { header: 'CLASSE', key: 'class', width: 15 },
      { header: 'DATE_NAISSANCE', key: 'birthDate', width: 18 },
      { header: 'LIEU_NAISSANCE', key: 'birthPlace', width: 20 },
      { header: 'TYPE_BAC', key: 'bacType', width: 12 },
      { header: 'ÉTABLISSEMENT_ORIGINE', key: 'provenance', width: 30 },
    ];

    for (const s of students) {
      worksheet.addRow({
        studentId: s.studentId,
        lastName: s.lastName,
        firstName: s.firstName,
        email: s.user?.email ?? '',
        class: s.class,
        birthDate: s.birthDate ? new Date(s.birthDate).toISOString().slice(0, 10) : '',
        birthPlace: s.birthPlace ?? '',
        bacType: s.bacType ?? '',
        provenance: s.provenance ?? '',
      });
    }

    this.styleTemplateHeaderRow(worksheet);
    const buffer = await workbook.xlsx.writeBuffer();
    return Buffer.from(buffer);
  }

  async importStudentsFromExcel(buffer: Buffer, defaultClass?: string) {
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
        // Importing from a specific class's page (defaultClass set) lets the CLASSE column
        // be left blank — every row then falls into that class instead of the generic default.
        const className = row.getCell(5).toString().trim() || defaultClass || '';
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
