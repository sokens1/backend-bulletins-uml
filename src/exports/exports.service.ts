import { Injectable, NotFoundException } from '@nestjs/common';
import { GradesService } from '../grades/grades.service';
import { DatabaseService } from '../database/database.service';
import { UsersService } from '../users/users.service';
import { PDFDocument, rgb, StandardFonts, PDFFont, PDFPage } from 'pdf-lib';
import * as ExcelJS from 'exceljs';
import * as XLSX from 'xlsx';
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

  // ExcelJS only reads the modern .xlsx (OOXML) format — a legacy .xls (BIFF/OLE2, pre-2007
  // Excel, like the historical "ASUR 2014-2015.xls" gradebook) fails to load at all. SheetJS
  // (xlsx package) reads both, so any incoming .xls is transparently re-serialized to .xlsx
  // in memory before the rest of the import pipeline (built on ExcelJS) ever sees it.
  private toXlsxBuffer(buffer: Buffer): Buffer {
    const isLegacyXls = buffer.length >= 8 && buffer.readUInt32LE(0) === 0xe011cfd0;
    if (!isLegacyXls) return buffer;
    const wb = XLSX.read(buffer, { type: 'buffer', cellDates: true });
    // Legacy .xls merge ranges occasionally overlap in ways ExcelJS's stricter xlsx parser
    // rejects outright ("Cannot merge already merged cells"). Only cell VALUES matter for
    // import (never merge geometry), so they're dropped rather than round-tripped.
    for (const name of wb.SheetNames) {
      delete (wb.Sheets[name] as any)['!merges'];
    }
    return XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' }) as Buffer;
  }

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

  // ExcelJS's own Cell.toString()/.text just call the raw value's toString(), which for a
  // formula cell yields "[object Object]" instead of its computed number — a real problem
  // for the reference workbook, whose Moyenne (and even some CC/Examen) cells are actual
  // Excel formulas with a cached result. Reads that cached result for formula cells, and
  // falls back to the plain text/number/date for everything else.
  private cellString(cell: ExcelJS.Cell): string {
    const v: any = cell.value;
    if (v == null) return '';
    if (typeof v === 'object') {
      if ('result' in v) {
        const result = v.result;
        return result != null && typeof result !== 'object' ? String(result) : '';
      }
      if ('text' in v) return String(v.text ?? '');
      if (v instanceof Date) return v.toISOString();
      return '';
    }
    return String(v);
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

  // Best-effort split of the relevé's single "Élèves" cell ("NOM(S) Prénom(s)", surnames in
  // caps per the school's own convention) into lastName/firstName for a newly-created student.
  // Never blocks the import — worst case the admin fixes the split in Gestion Étudiants.
  private splitEleveName(raw: string): { lastName: string; firstName: string } {
    const words = raw.trim().split(/\s+/).filter(Boolean);
    if (words.length === 0) return { lastName: '(à compléter)', firstName: '(à compléter)' };
    let i = 0;
    while (i < words.length - 1 && words[i] === words[i].toLocaleUpperCase('fr-FR') && /[A-ZÀ-Ÿ]/.test(words[i])) i++;
    if (i === 0) i = 1;
    return {
      lastName: words.slice(0, i).join(' '),
      firstName: words.slice(i).join(' ') || '(à compléter)',
    };
  }

  private slugifyForEmail(text: string): string {
    return text
      .normalize('NFD').replace(/[̀-ͯ]/g, '')
      .toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '') || 'etudiant';
  }

  // The relevé identifies students by name only (no Matricule column, matching the
  // reference workbook) — a brand-new student still needs a unique studentId to satisfy
  // the schema, so one is generated here. Clearly non-guessable-as-real so nobody mistakes
  // it for an official INPTIC matricule; the admin assigns the real one in Gestion Étudiants.
  private generateAutoMatricule(): string {
    const stamp = Date.now().toString(36).toUpperCase();
    const rand = Math.random().toString(36).slice(2, 6).toUpperCase();
    return `AUTO-${stamp}-${rand}`;
  }

  // Locates a relevé sheet's layout by scanning for its "Matière :" label and its "Élèves"
  // header — rather than assuming fixed row/column numbers. This is what lets the importer
  // accept BOTH our own generated canvas (logo header, Matière at row 7) AND the historical
  // reference workbook's own relevé sheets (plain text header, Matière at row 10) — any
  // relevé built on the same N°/Élèves/CC/Examen/Moyenne row pattern, whatever its header
  // height. Coefficient/Enseignant/Classe sit at fixed offsets from the Matière row in both
  // formats (one row below/above respectively, same column), so they're derived from it too.
  private locateReleveLayout(ws: ExcelJS.Worksheet): {
    matiereRow: number; matiereCol: number; classeRow: number; coeffRow: number; enseignantRow: number;
    headerRow: number; colNum: number; colEleve: number; colCC: number; colExam: number; colMoy: number;
  } | null {
    const MAX_ROWS = 25;
    const MAX_COLS = 12;
    let matiereRow = -1, matiereCol = -1;
    let headerRow = -1, colEleve = -1;
    for (let r = 1; r <= MAX_ROWS; r++) {
      for (let c = 1; c <= MAX_COLS; c++) {
        const text = this.normalizeText(this.cellString(ws.getCell(r, c)));
        if (matiereRow === -1 && text.includes('matière')) {
          matiereRow = r;
          matiereCol = c + 1;
        }
        if (headerRow === -1 && text.startsWith('élève')) {
          headerRow = r;
          colEleve = c;
        }
      }
      if (matiereRow !== -1 && headerRow !== -1) break;
    }
    if (matiereRow === -1 || headerRow === -1) return null;
    return {
      matiereRow, matiereCol,
      classeRow: matiereRow - 1, coeffRow: matiereRow + 1, enseignantRow: matiereRow + 2,
      headerRow,
      colNum: colEleve - 1, colEleve, colCC: colEleve + 1, colExam: colEleve + 2, colMoy: colEleve + 3,
    };
  }

  async importGradesFromExcel(buffer: Buffer, semesterId: string, userId: string) {
    const workbook = new ExcelJS.Workbook();
    await workbook.xlsx.load(this.toXlsxBuffer(buffer) as any);

    if (workbook.worksheets.length === 0) throw new NotFoundException('Worksheet not found');

    // Loaded once up front (instead of per-row queries) so matching is both faster and
    // resilient to whitespace/case differences between the Excel file and the database.
    // The relevé has no Matricule column (the reference workbook never had one either), so
    // students are matched by their full name; ambiguous (duplicate) names are reported as
    // an error rather than guessed at.
    const students = await this.prisma.student.findMany();
    const studentById = new Map(students.map((s) => [s.id, s]));
    const studentByName = new Map<string, typeof students[number] | 'AMBIGUOUS'>();
    for (const s of students) {
      const key = this.normalizeText(`${s.lastName} ${s.firstName}`);
      studentByName.set(key, studentByName.has(key) ? 'AMBIGUOUS' : s);
    }

    const subjects = await this.prisma.subject.findMany({ where: { ue: { semesterId } } });
    const subjectById = new Map(subjects.map((s) => [s.id, s]));
    const subjectByName = new Map(subjects.map((s) => [this.normalizeText(s.name), s]));

    // Snapshot of grades that already existed BEFORE this import pass. Re-importing a
    // relevé after a retake session is how rattrapage gets recorded: if a student already
    // had an exam grade for a subject, the new Examen value in the sheet is treated as the
    // rattrapage (which fully replaces the CC/Examen average — see computeSubjectAverage)
    // instead of overwriting examGrade.
    const existingGrades = await this.prisma.grade.findMany({ where: { subject: { ue: { semesterId } } } });
    const existingGradeKey = (studentId: string, subjectId: string) => `${studentId}::${subjectId}`;
    const existingGradeByKey = new Map(existingGrades.map((g) => [existingGradeKey(g.studentId, g.subjectId), g]));

    let count = 0;
    let skipped = 0;
    const errors: string[] = [];
    const createdSubjects: string[] = [];
    const createdStudents: string[] = [];
    let anyReleveSheetFound = false;

    // Lazily created once per import: a holding UE for subjects that arrive via a relevé but
    // don't exist yet — the relevé has no way to say which UE a subject belongs to, so it
    // lands here (0 credits, doesn't skew any average) until an admin moves it in Gestion
    // Académique.
    let placeholderUE: { id: string } | null = null;
    const getOrCreatePlaceholderUE = async () => {
      if (placeholderUE) return placeholderUE;
      const existing = await this.prisma.uE.findFirst({ where: { semesterId, name: 'À classer' } });
      placeholderUE = existing ?? await this.prisma.uE.create({ data: { name: 'À classer', credits: 0, semesterId } });
      return placeholderUE;
    };

    // Sheets that are never a relevé, whatever their internal layout — our own canvas
    // (FV/TabNote/Bulletin/Absences) and the reference workbook's own recap sheets
    // (TabNotS5/BULLETIN S5/TabNotS6/BULLETIN S6/TabAnnuel/BullAnnuel/empty Feuil2-3).
    const NON_RELEVE_SHEET = /^(fv|absences|tabnote|bulletin|tabnots|tabannuel|bullannuel|feuil)/i;

    // Each sheet is one subject's "relevé de notes" — the subject name is read from its
    // "Matière :" cell (located dynamically, see locateReleveLayout) rather than the sheet
    // tab (sanitized/truncated for Excel, unreliable for matching), which is also what lets
    // this accept the historical reference workbook's own relevé sheets, not just our canvas.
    for (const worksheet of workbook.worksheets) {
      if (worksheet.name === 'Absences') {
        const abs = await this.importAbsencesSheet(worksheet, semesterId, userId, studentByName);
        count += abs.count;
        skipped += abs.skipped;
        errors.push(...abs.errors);
        continue;
      }
      if (NON_RELEVE_SHEET.test(worksheet.name)) continue;

      const layout = this.locateReleveLayout(worksheet);
      if (!layout) continue; // not a relevé sheet
      const subjectRef = this.cellString(worksheet.getCell(layout.matiereRow, layout.matiereCol)).trim();
      if (!subjectRef) continue;
      anyReleveSheetFound = true;

      let subject = subjectById.get(subjectRef) ?? subjectByName.get(this.normalizeText(subjectRef));
      if (!subject) {
        try {
          const ue = await getOrCreatePlaceholderUE();
          const coeffCell = Number(worksheet.getCell(layout.coeffRow, layout.matiereCol).value);
          const teacherName = this.cellString(worksheet.getCell(layout.enseignantRow, layout.matiereCol)).trim();
          let teacher: { id: string } | null = null;
          if (teacherName) {
            const allTeachers = await this.prisma.teacher.findMany();
            teacher = allTeachers.find((t) => this.normalizeText(`${t.firstName} ${t.lastName}`) === this.normalizeText(teacherName)) ?? null;
          }
          subject = await this.prisma.subject.create({
            data: {
              name: subjectRef,
              coefficient: Number.isFinite(coeffCell) && coeffCell > 0 ? coeffCell : 1,
              ueId: ue.id,
              teacherId: teacher?.id,
            },
          });
          subjectById.set(subject.id, subject);
          subjectByName.set(this.normalizeText(subject.name), subject);
          createdSubjects.push(subject.name);
        } catch (e) {
          skipped++;
          errors.push(`${worksheet.name}: échec de création de la matière ("${subjectRef}") — ${e instanceof Error ? e.message : 'erreur inconnue'}`);
          continue;
        }
      }

      const sheetClass = this.cellString(worksheet.getCell(layout.classeRow, layout.matiereCol)).trim();

      for (let i = layout.headerRow + 1; i <= worksheet.rowCount; i++) {
        const row = worksheet.getRow(i);
        const eleveName = this.cellString(row.getCell(layout.colEleve)).trim();
        if (!eleveName) break; // end of the student list for this sheet

        const nameKey = this.normalizeText(eleveName);
        const match = studentByName.get(nameKey);
        if (match === 'AMBIGUOUS') {
          skipped++;
          errors.push(`${worksheet.name} - Ligne ${i}: plusieurs étudiants portent le nom "${eleveName}" — renseignez-le distinctement dans Gestion Étudiants avant import.`);
          continue;
        }

        let student = match;
        if (!student) {
          try {
            const { lastName, firstName } = this.splitEleveName(eleveName);
            const studentId = this.generateAutoMatricule();
            const created = await this.usersService.createStudent({
              studentId,
              lastName,
              firstName,
              email: `${this.slugifyForEmail(studentId)}@a-completer.inptic.ga`,
              class: sheetClass || '(à compléter)',
              password: 'Inptic2024!',
            });
            student = created.student!; // just created together with the user above, always present
            studentById.set(student.id, student);
            studentByName.set(nameKey, student);
            createdStudents.push(`${eleveName} (matricule auto: ${studentId})`);
          } catch (e) {
            skipped++;
            errors.push(`${worksheet.name} - Ligne ${i}: échec de création de l'étudiant ("${eleveName}") — ${e instanceof Error ? e.message : 'erreur inconnue'}`);
            continue;
          }
          if (!student) continue; // unreachable in practice, satisfies control-flow narrowing below
        }

        const cc = this.parseGradeCell(this.cellString(row.getCell(layout.colCC)).trim(), 'Note CC');
        let exam = this.parseGradeCell(this.cellString(row.getCell(layout.colExam)).trim(), 'Note Examen');
        const rowErrors = [cc.error, exam.error].filter(Boolean);
        if (rowErrors.length > 0) {
          skipped++;
          errors.push(`${worksheet.name} - Ligne ${i} (${student.studentId}): ${rowErrors.join(', ')}`);
          continue;
        }
        if (cc.value === undefined && exam.value === undefined) {
          // Some relevés (e.g. Stage, Soutenance in the reference workbook) record a single
          // holistic grade directly in the Moyenne column instead of a CC/Examen split —
          // fall back to reading it as the exam grade so those subjects still import.
          const moyenne = this.parseGradeCell(this.cellString(row.getCell(layout.colMoy)).trim(), 'Moyenne');
          if (moyenne.value === undefined) continue; // genuinely left blank — not an error
          exam = moyenne;
        }

        // A subject already had an exam grade before this import → this Examen value is a
        // rattrapage (retake), not a first-time exam entry. It replaces the average
        // entirely (computeSubjectAverage), so it's routed to rattrapageGrade and the
        // original examGrade is left untouched.
        const existing = existingGradeByKey.get(existingGradeKey(student.id, subject.id));
        const isRetake = existing?.examGrade != null && exam.value !== undefined;

        try {
          await this.gradesService.enterGrade({
              studentId: student.id,
              subjectId: subject.id,
              ccGrade: cc.value,
              examGrade: isRetake ? undefined : exam.value,
              rattrapageGrade: isRetake ? exam.value : undefined,
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

    return {
      imported: count,
      skipped,
      errors,
      created: { subjects: createdSubjects, students: createdStudents },
    };
  }

  // Parses the "Absences" sheet (see buildAbsencesSheet: N°/Matricule/Élèves + one column
  // per subject). Upserts by (studentId, subjectId) — Attendance has no unique constraint,
  // so blindly calling enterAttendance again on a re-import would duplicate the hours
  // instead of correcting them.
  private async importAbsencesSheet(
    worksheet: ExcelJS.Worksheet,
    semesterId: string,
    userId: string,
    studentByName: Map<string, { id: string; studentId: string } | 'AMBIGUOUS'>,
  ) {
    let count = 0;
    let skipped = 0;
    const errors: string[] = [];

    const headerRow = worksheet.getRow(10);
    if (!this.normalizeText(this.cellString(headerRow.getCell(2))).startsWith('élève')) {
      return { count, skipped, errors }; // not a recognized Absences layout
    }

    const subjects = await this.prisma.subject.findMany({ where: { ue: { semesterId } } });
    const subjectByName = new Map(subjects.map((s) => [this.normalizeText(s.name), s]));
    const subjectColumns: { col: number; subjectId: string }[] = [];
    for (let c = 3; c <= worksheet.columnCount; c++) {
      const header = this.cellString(headerRow.getCell(c)).trim();
      if (!header) continue;
      const subject = subjectByName.get(this.normalizeText(header));
      if (subject) subjectColumns.push({ col: c, subjectId: subject.id });
    }

    const existingAttendances = await this.prisma.attendance.findMany({ where: { subject: { ue: { semesterId } } } });
    const attendanceKey = (studentId: string, subjectId: string) => `${studentId}::${subjectId}`;
    const attendanceByKey = new Map(existingAttendances.map((a) => [attendanceKey(a.studentId, a.subjectId), a]));

    for (let i = 11; i <= worksheet.rowCount; i++) {
      const row = worksheet.getRow(i);
      const eleveName = this.cellString(row.getCell(2)).trim();
      if (!eleveName) break;

      const match = studentByName.get(this.normalizeText(eleveName));
      if (match === 'AMBIGUOUS') {
        skipped++;
        errors.push(`Absences - Ligne ${i}: plusieurs étudiants portent le nom "${eleveName}" — impossible de choisir.`);
        continue;
      }
      const student = match;
      if (!student) {
        skipped++;
        errors.push(`Absences - Ligne ${i}: étudiant introuvable ("${eleveName}") — importez-le d'abord via un relevé de notes ou Gestion Étudiants.`);
        continue;
      }

      for (const { col, subjectId } of subjectColumns) {
        const raw = this.cellString(row.getCell(col)).trim();
        if (raw === '') continue;
        const hours = Number(raw.replace(',', '.'));
        if (!Number.isFinite(hours) || hours < 0) {
          skipped++;
          errors.push(`Absences - Ligne ${i} (${student.studentId}): heures invalides ("${raw}")`);
          continue;
        }

        try {
          const existing = attendanceByKey.get(attendanceKey(student.id, subjectId));
          if (existing) {
            await this.gradesService.updateAttendance(existing.id, { studentId: student.id, subjectId, hoursAbsent: hours }, userId);
          } else {
            await this.gradesService.enterAttendance({ studentId: student.id, subjectId, hoursAbsent: hours }, userId);
          }
          count++;
        } catch (e) {
          skipped++;
          errors.push(`Absences - Ligne ${i} (${student.studentId}): ${e instanceof Error ? e.message : 'erreur inconnue'}`);
        }
      }
    }

    return { count, skipped, errors };
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
      // gradebook (ASUR 2014-2015.xls: an "FV" roster sheet first, then one signed relevé
      // per subject — logo, institution header, Classe/Année/Matière/Coefficient/Semestre/
      // Enseignant block, a N°/Élèves/CC/Examen/Moyenne table, signature lines, and each
      // subject's tab colored by its UE) instead of a generic spreadsheet.
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
      const logoImageId = this.loadLogoImage(workbook);

      if (semesterId && subjects.length === 0) {
        const worksheet = workbook.addWorksheet('Relevé');
        worksheet.addRow(['Aucune matière enregistrée pour ce semestre — créez-les dans Gestion académique avant d\'importer des notes.']);
      } else {
        const effectiveSubjects = subjects.length > 0
          ? subjects
          : [{ id: 'sample', name: 'Anglais technique', coefficient: 1, ccWeight: 0.4, examWeight: 0.6, teacher: null, ue: { name: 'UE' } } as any];
        const effectiveStudents = students.length > 0
          ? students
          : [{ studentId: 'INPTIC-2024-001', lastName: 'DUPONT', firstName: 'Jean' } as any];

        this.buildRosterSheet(workbook, {
          className: students[0]?.class,
          year: semester?.year,
          semesterName: semester?.name,
          students: effectiveStudents,
          logoImageId,
        });

        // One tab color per UE (cycling through a fixed palette) so subjects group
        // visually at a glance, the way the reference workbook color-codes its tabs.
        const ueColors = new Map<string, string>();
        const palette = ['FFB4C7E7', 'FFC6E0B4', 'FFFFE699', 'FFF4B183', 'FFD9B3E6', 'FFA9D18E'];
        const usedSheetNames = new Set<string>();
        for (const subject of effectiveSubjects) {
          const ueName: string = subject.ue?.name || 'UE';
          if (!ueColors.has(ueName)) ueColors.set(ueName, palette[ueColors.size % palette.length]);

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
            logoImageId,
            tabColor: ueColors.get(ueName)!,
          }, usedSheetNames);
        }

        this.buildAbsencesSheet(workbook, {
          className: students[0]?.class,
          year: semester?.year,
          semesterName: semester?.name,
          subjects: effectiveSubjects,
          students: effectiveStudents,
          logoImageId,
        });

        // TabNote + Bulletin only make sense against real data, and only once real
        // students/subjects exist (not the single-sample fallback used for a preview
        // template with no semester context).
        if (semesterId && subjects.length > 0 && students.length > 0) {
          const precomputed = await this.gradesService.computeSemesterReports(semesterId);
          const { reportsByStudentId } = precomputed;
          const orderedReports = students
            .map((s) => reportsByStudentId.get(s.id))
            .filter((r): r is NonNullable<typeof r> => !!r);

          // Group subjects by UE (preserving DB order) so TabNote/Bulletin's column layout
          // mirrors the reference workbook's per-UE subject blocks exactly.
          const ueGroups: { ueName: string; ueCode?: string | null; subjects: { name: string; credits: number; coefficient: number }[] }[] = [];
          for (const s of subjects) {
            const ueName = s.ue?.name || 'UE';
            let group = ueGroups.find((g) => g.ueName === ueName);
            if (!group) {
              group = { ueName, ueCode: (s.ue as any)?.code, subjects: [] };
              ueGroups.push(group);
            }
            group.subjects.push({ name: s.name, credits: s.credits, coefficient: s.coefficient });
          }

          const { subjectStats } = await this.gradesService.getPromotionStats(semesterId, precomputed);
          const classAverages = new Map(subjectStats.map((s) => [s.subjectName, s.average]));

          this.buildTabNoteSheet(workbook, {
            className: students[0]?.class,
            year: semester?.year,
            semesterName: semester?.name,
            ueGroups,
            reports: orderedReports as any,
            logoImageId,
          });

          this.buildBulletinSheet(workbook, {
            className: students[0]?.class,
            year: semester?.year,
            semesterName: semester?.name,
            ueGroups,
            classAverages,
            studentCount: orderedReports.length,
            logoImageId,
          });
        }
      }
    }

    const buffer = await workbook.xlsx.writeBuffer();
    return Buffer.from(buffer);
  }

  // Embeds the real INPTIC logo (same asset the PDF bulletin uses) once per workbook;
  // returns null if the asset is missing so callers can fall back to text-only headers.
  private loadLogoImage(workbook: ExcelJS.Workbook): number | null {
    try {
      const logoPath = path.join(process.cwd(), 'src/assets/logo-inptic.png');
      const buffer = fs.readFileSync(logoPath);
      return workbook.addImage({ buffer: buffer as any, extension: 'png' });
    } catch {
      return null;
    }
  }

  // Row/column layout the "relevé de notes" sheets below use — importGradesFromExcel reads
  // these exact positions back, since this service both generates and parses the file.
  // No Matricule column — the reference workbook (ASUR 2014-2015.xls) never had one, it
  // identified students by name only. Matricule stays the authoritative ID in Gestion
  // Étudiants; a new student created from a relevé import gets one auto-generated (see
  // importGradesFromExcel) but it isn't shown here.
  // No Rattrapage column either — the reference workbook doesn't have one, because a
  // rattrapage grade *replaces* the subject average entirely (see computeSubjectAverage).
  // Re-importing the same sheet after a retake session naturally implements that: if a
  // Grade already exists for that (student, subject), the Examen value goes to
  // rattrapageGrade instead of examGrade (see importGradesFromExcel).
  private static readonly RELEVE = {
    MATIERE_ROW: 7, MATIERE_COL: 2,
    HEADER_ROW: 11,
    COL_NUM: 1, COL_ELEVE: 2, COL_CC: 3, COL_EXAM: 4, COL_MOY: 5,
  } as const;

  // TabNote header rows, reproducing the reference workbook's TabNotS5 layout: a 2-row-tall
  // "UEx-y : Nom" banner per UE group, then a "Matières"/"Crédits"/"Coefficients" 3-row
  // sub-header under each subject column. The Bulletin sheet's INDEX() formulas are built
  // against DATA_START, so the two stay in sync by construction.
  private static readonly TABNOTE_UEBANNER_ROW = 8; // merged rows 8-9
  private static readonly TABNOTE_MATIERES_ROW = 10;
  private static readonly TABNOTE_CREDITS_ROW = 11;
  private static readonly TABNOTE_COEF_ROW = 12;
  private static readonly TABNOTE_DATA_START = 13;

  // Mirrors calculateAnnualReport / generateBulletinPdf's mention scale — below 10/20 gets
  // no mention at all rather than defaulting to "Passable".
  private mentionFor(avg: number): string {
    if (avg >= 16) return 'Très Bien';
    if (avg >= 14) return 'Bien';
    if (avg >= 12) return 'Assez Bien';
    if (avg >= 10) return 'Passable';
    return 'Non attribuée';
  }

  private formatBirthInfo(student: { birthDate?: Date | string | null; birthPlace?: string | null }): string {
    if (!student.birthDate) return '';
    const d = new Date(student.birthDate);
    const day = String(d.getUTCDate()).padStart(2, '0');
    const month = String(d.getUTCMonth() + 1).padStart(2, '0');
    const year = d.getUTCFullYear();
    return `Né(e) le ${day}/${month}/${year}${student.birthPlace ? ` à ${student.birthPlace}` : ''}`;
  }

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
      logoImageId?: number | null;
      tabColor?: string;
    },
    usedSheetNames: Set<string>,
  ) {
    const R = ExportsService.RELEVE;
    const sheetName = this.uniqueSheetName(data.subjectName, usedSheetNames);
    const ws = workbook.addWorksheet(sheetName, data.tabColor ? { properties: { tabColor: { argb: data.tabColor } } } : undefined);
    const cols = 5;
    ws.columns = [
      { width: 6 }, { width: 40 }, { width: 16 }, { width: 16 }, { width: 12 },
    ];
    this.drawSheetHeader(ws, cols, 'RELEVE DE NOTES', data.logoImageId);

    ws.getCell(6, 1).value = 'Classe :';
    ws.getCell(6, 2).value = data.className || '';
    ws.getCell(6, 4).value = 'Année :';
    ws.getCell(6, 5).value = data.year || '';

    ws.getCell(R.MATIERE_ROW, 1).value = 'Matière :';
    ws.getCell(R.MATIERE_ROW, R.MATIERE_COL).value = data.subjectName;
    ws.getCell(R.MATIERE_ROW, R.MATIERE_COL).font = { bold: true };

    ws.getCell(8, 1).value = 'Coefficient :';
    ws.getCell(8, 2).value = data.coefficient;
    ws.getCell(8, 4).value = 'Semestre :';
    ws.getCell(8, 5).value = data.semesterName || '';

    ws.getCell(9, 1).value = 'Enseignant :';
    ws.getCell(9, 2).value = data.teacherName || '.....................................';

    const headerRow = ws.getRow(R.HEADER_ROW);
    headerRow.values = [
      'N°', 'Élèves',
      `Contrôle Continu ${Math.round(data.ccWeight * 100)}%`,
      `Examen Final ${Math.round(data.examWeight * 100)}%`,
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
      row.getCell(R.COL_ELEVE).value = `${student.lastName} ${student.firstName}`;
      // Moyenne is a live preview only (CC×weight + Examen×weight) — the app recomputes
      // the authoritative average itself on import, applying the rattrapage-replaces-
      // everything rule when a retake grade has been recorded (see importGradesFromExcel).
      const ccCol = this.columnLetter(R.COL_CC), examCol = this.columnLetter(R.COL_EXAM);
      const ccRef = `${ccCol}${r}`, examRef = `${examCol}${r}`;
      row.getCell(R.COL_MOY).value = {
        formula: `IF(AND(${ccRef}<>"",${examRef}<>""),${ccRef}*${data.ccWeight}+${examRef}*${data.examWeight},IF(${ccRef}<>"",${ccRef},IF(${examRef}<>"",${examRef},"")))`,
      };
      r += 1;
    });
    const lastDataRow = r - 1;

    r += 1;
    ws.getCell(r, 1).value = 'Moyenne de la classe :';
    ws.getCell(r, 1).font = { italic: true };
    if (lastDataRow >= R.HEADER_ROW + 1) {
      const moyCol = this.columnLetter(R.COL_MOY);
      ws.getCell(r, R.COL_MOY).value = { formula: `IFERROR(AVERAGE(${moyCol}${R.HEADER_ROW + 1}:${moyCol}${lastDataRow}),"")` };
    }

    r += 2;
    ws.getCell(r, 1).value = 'Date : .....................';
    r += 2;
    ws.getCell(r, 1).value = "Signature de l'Enseignant";
    ws.getCell(r, 4).value = 'Visa Responsable Pédagogique';
    ws.getCell(r, 1).font = { italic: true, size: 8 };
    ws.getCell(r, 4).font = { italic: true, size: 8 };

    ws.getCell(R.MATIERE_ROW, 1).note =
      'Cette cellule identifie la matière pour l\'import — ne la modifiez pas. ' +
      'Seules les colonnes Contrôle Continu, Examen Final et Rattrapage sont à remplir ; ' +
      'la Moyenne est calculée automatiquement à titre indicatif. Les étudiants sont ' +
      'reconnus par leur nom — le matricule se gère dans Gestion Étudiants.';
    ws.views = [{ state: 'frozen', ySplit: R.HEADER_ROW }];
  }

  // First tab of the workbook: a roster of the whole class (matricule/nom/prénom), matching
  // "FV" in the reference gradebook — a blank master relevé it duplicated per subject. Filled
  // in here as a genuinely useful index/summary page instead of a blank template.
  private buildRosterSheet(
    workbook: ExcelJS.Workbook,
    data: {
      className?: string;
      year?: string;
      semesterName?: string;
      students: { studentId: string; lastName: string; firstName: string }[];
      logoImageId?: number | null;
    },
  ) {
    const ws = workbook.addWorksheet('FV', { properties: { tabColor: { argb: 'FF8497B0' } } });
    ws.columns = [{ width: 6 }, { width: 40 }];
    this.drawSheetHeader(ws, 2, 'RELEVE DE NOTES', data.logoImageId);

    ws.getCell(6, 1).value = 'Classe :';
    ws.getCell(6, 2).value = data.className || '';
    ws.getCell(7, 1).value = 'Année :';
    ws.getCell(7, 2).value = data.year || '';
    ws.getCell(8, 1).value = 'Semestre :';
    ws.getCell(8, 2).value = data.semesterName || '';

    const headerRow = ws.getRow(11);
    headerRow.values = ['N°', 'Élèves'];
    headerRow.font = { bold: true };
    headerRow.alignment = { horizontal: 'center' };
    headerRow.eachCell((cell) => {
      cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFE0E0E0' } };
      cell.border = { top: { style: 'thin' }, bottom: { style: 'thin' }, left: { style: 'thin' }, right: { style: 'thin' } };
    });

    data.students.forEach((student, idx) => {
      const row = ws.getRow(12 + idx);
      row.values = [idx + 1, `${student.lastName} ${student.firstName}`];
    });

    ws.views = [{ state: 'frozen', ySplit: 11 }];
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

  private drawSheetHeader(ws: ExcelJS.Worksheet, cols: number, title: string, logoImageId?: number | null) {
    ws.getRow(1).height = 30;
    ws.getRow(2).height = 26;
    ws.getRow(3).height = 10;
    if (logoImageId != null) {
      ws.addImage(logoImageId, { tl: { col: 0.15, row: 0.05 }, ext: { width: 74, height: 60 } });
    }
    const centerBold = (cell: ExcelJS.Cell, size = 11) => { cell.font = { bold: true, size }; cell.alignment = { horizontal: 'center' }; };
    ws.mergeCells(1, 1, 1, cols);
    centerBold(ws.getCell(1, 1), 12);
    ws.getCell(1, 1).value = 'INSTITUT NATIONAL DE LA POSTE, DES TECHNOLOGIES DE L\'INFORMATION ET DE LA COMMUNICATION';
    ws.mergeCells(2, 1, 2, cols);
    centerBold(ws.getCell(2, 1), 11);
    ws.getCell(2, 1).value = 'DIRECTION DES ETUDES ET DE LA PEDAGOGIE';
    ws.mergeCells(4, 1, 4, cols);
    const titleCell = ws.getCell(4, 1);
    titleCell.value = title;
    titleCell.font = { bold: true, size: 18 };
    titleCell.alignment = { horizontal: 'center' };
    ws.getRow(4).height = 26;
  }

  // Converts a 1-based column index to its Excel letter (1 -> A, 27 -> AA, ...).
  private columnLetter(n: number): string {
    let s = '';
    while (n > 0) {
      const rem = (n - 1) % 26;
      s = String.fromCharCode(65 + rem) + s;
      n = Math.floor((n - 1) / 26);
    }
    return s;
  }

  // Single consolidated "Absences" sheet (one column per subject, pivoted like the grades
  // relevé) — mirrors the reference workbook's Absences tab and is imported back the same
  // way, upserting Attendance rows instead of duplicating them on a re-import.
  private buildAbsencesSheet(
    workbook: ExcelJS.Workbook,
    data: {
      className?: string; year?: string; semesterName?: string;
      subjects: { name: string }[];
      students: { studentId: string; lastName: string; firstName: string }[];
      logoImageId?: number | null;
    },
  ) {
    const cols = 2 + data.subjects.length;
    const ws = workbook.addWorksheet('Absences', { properties: { tabColor: { argb: 'FFED7D31' } } });
    ws.columns = [{ width: 6 }, { width: 40 }, ...data.subjects.map(() => ({ width: 16 }))];
    this.drawSheetHeader(ws, cols, 'SUIVI DES ABSENCES (heures)', data.logoImageId);

    ws.getCell(6, 1).value = 'Classe :';
    ws.getCell(6, 2).value = data.className || '';
    ws.getCell(7, 1).value = 'Année :';
    ws.getCell(7, 2).value = data.year || '';
    ws.getCell(8, 1).value = 'Semestre :';
    ws.getCell(8, 2).value = data.semesterName || '';

    const headerRow = ws.getRow(10);
    headerRow.values = ['N°', 'Élèves', ...data.subjects.map((s) => s.name)];
    headerRow.font = { bold: true };
    headerRow.alignment = { horizontal: 'center', wrapText: true };
    headerRow.eachCell((cell) => {
      cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFE0E0E0' } };
      cell.border = { top: { style: 'thin' }, bottom: { style: 'thin' }, left: { style: 'thin' }, right: { style: 'thin' } };
    });

    data.students.forEach((student, idx) => {
      const row = ws.getRow(11 + idx);
      row.getCell(1).value = idx + 1;
      row.getCell(2).value = `${student.lastName} ${student.firstName}`;
    });

    ws.getCell(10, 2).note =
      'Une colonne par matière : indiquez le nombre d\'heures d\'absence, laissez vide sinon. ' +
      'Ne modifiez pas les en-têtes de colonnes : ils servent à retrouver la matière lors de l\'import. ' +
      'Les étudiants sont reconnus par leur nom.';
    ws.views = [{ state: 'frozen', ySplit: 10 }];
  }

  // Column layout shared by TabNote and Bulletin: N°, Nom(s) et Prénom(s), then per UE —
  // one column per subject, "Moyenne UEx", "Crédits Acquis", "Validation" — then the
  // trailing result columns. Computed once so both sheets stay pixel-for-pixel aligned.
  private buildTabNoteLayout(ueGroups: { ueName: string; ueCode?: string | null; subjects: { name: string; credits: number; coefficient: number }[] }[]) {
    const NUM_COL = 1;
    const NOM_COL = 2;
    let cursor = 3;
    const ues = ueGroups.map((ue) => {
      const subjectCols = ue.subjects.map((s) => ({ ...s, col: cursor++ }));
      const moyenneCol = cursor++;
      const creditsCol = cursor++;
      const validationCol = cursor++;
      return { ...ue, subjectCols, moyenneCol, creditsCol, validationCol, startCol: subjectCols[0]?.col ?? moyenneCol, endCol: validationCol };
    });
    const totalCreditsCol = cursor++;
    const moyenneSemCol = cursor++;
    const rangCol = cursor++;
    const avisCol = cursor++;
    const mentionCol = cursor++;
    const naissanceCol = cursor++;
    const bacCol = cursor++;
    const provenanceCol = cursor++;
    const totalCols = cursor - 1;
    return { NUM_COL, NOM_COL, ues, totalCreditsCol, moyenneSemCol, rangCol, avisCol, mentionCol, naissanceCol, bacCol, provenanceCol, totalCols };
  }

  // Read-only consolidated recap — one row per student, reproducing "TabNotS5" from the
  // reference workbook: a 2-row UE banner spanning each UE's subject columns, a "Matières /
  // Crédits / Coefficients" 3-row sub-header, per-student per-subject grades, per-UE moyenne/
  // crédits acquis/validation, then TOTAL CREDITS, Moyenne Semestre, Rang, Avis du Jury,
  // Mention, and the student's Date/lieu de naissance, Type de Bac, Provenance. Computed live
  // from the database, not read back on import (Bulletin below pulls from it via formulas).
  private buildTabNoteSheet(
    workbook: ExcelJS.Workbook,
    data: {
      className?: string; year?: string; semesterName?: string;
      ueGroups: { ueName: string; ueCode?: string | null; subjects: { name: string; credits: number; coefficient: number }[] }[];
      reports: {
        student: { studentId: string; lastName: string; firstName: string; birthDate?: Date | string | null; birthPlace?: string | null; bacType?: string | null; provenance?: string | null };
        report: { ueName: string; average: number; creditsWon: number; status: string; subjects: { subject: string; average: number }[] }[];
        semesterAverage: number; totalCreditsWon: number; totalCreditsExpected: number; rank: number; status: string;
      }[];
      logoImageId?: number | null;
    },
  ) {
    const L = this.buildTabNoteLayout(data.ueGroups);
    const semNum = (data.semesterName || '').replace(/^S/i, '');
    const ws = workbook.addWorksheet('TabNote', { properties: { tabColor: { argb: 'FF7F7F7F' } } });
    ws.columns = Array.from({ length: L.totalCols }, (_, i) => (i < 2 ? { width: i === 0 ? 6 : 26 } : { width: 13 }));
    this.drawSheetHeader(ws, L.totalCols, `TABLEAU RÉCAPITULATIF DES NOTES — SEMESTRE ${semNum}`, data.logoImageId);

    ws.getCell(6, 1).value = 'Classe :';
    ws.getCell(6, 2).value = data.className || '';
    ws.getCell(6, 4).value = 'Année :';
    ws.getCell(6, 5).value = data.year || '';

    const { UEBANNER_ROW, MATIERES_ROW, CREDITS_ROW, COEF_ROW, DATA_START } = {
      UEBANNER_ROW: ExportsService.TABNOTE_UEBANNER_ROW,
      MATIERES_ROW: ExportsService.TABNOTE_MATIERES_ROW,
      CREDITS_ROW: ExportsService.TABNOTE_CREDITS_ROW,
      COEF_ROW: ExportsService.TABNOTE_COEF_ROW,
      DATA_START: ExportsService.TABNOTE_DATA_START,
    };

    const headerFill = (cell: ExcelJS.Cell) => {
      cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFE0E0E0' } };
      cell.border = { top: { style: 'thin' }, bottom: { style: 'thin' }, left: { style: 'thin' }, right: { style: 'thin' } };
      cell.alignment = { horizontal: 'center', vertical: 'middle', wrapText: true };
      cell.font = { bold: true };
    };
    const mergeVFull = (col: number, value: string) => {
      ws.mergeCells(UEBANNER_ROW, col, COEF_ROW, col);
      const cell = ws.getCell(UEBANNER_ROW, col);
      cell.value = value;
      headerFill(cell);
    };
    const mergeVFromMatieres = (col: number, value: string) => {
      ws.mergeCells(MATIERES_ROW, col, COEF_ROW, col);
      const cell = ws.getCell(MATIERES_ROW, col);
      cell.value = value;
      headerFill(cell);
    };

    // N° / Nom(s) et Prénom(s) — vertical banners spanning the whole header block.
    mergeVFull(L.NUM_COL, 'N°');
    mergeVFull(L.NOM_COL, "Nom(s) et Prénom(s)");

    // Per-UE 2-row banner + subject/crédits/coefficients sub-header + "Validation" column.
    // The banner only spans the subject columns + "Moyenne UEx" (mirrors the reference's
    // G:P block) — "Crédits Acquis" and "Validation" get their own separate vertical merges
    // below, so none of these ranges overlap.
    for (const ue of L.ues) {
      ws.mergeCells(UEBANNER_ROW, ue.startCol, UEBANNER_ROW + 1, ue.moyenneCol);
      const banner = ws.getCell(UEBANNER_ROW, ue.startCol);
      banner.value = ue.ueCode ? `${ue.ueCode} : ${ue.ueName}` : ue.ueName;
      headerFill(banner);

      for (const s of ue.subjectCols) {
        const nameCell = ws.getCell(MATIERES_ROW, s.col);
        nameCell.value = s.name;
        headerFill(nameCell);
        const creditsCell = ws.getCell(CREDITS_ROW, s.col);
        creditsCell.value = s.credits;
        headerFill(creditsCell);
        const coefCell = ws.getCell(COEF_ROW, s.col);
        coefCell.value = s.coefficient;
        headerFill(coefCell);
      }
      const totalCredits = ue.subjects.reduce((sum, s) => sum + s.credits, 0);
      const totalCoef = ue.subjects.reduce((sum, s) => sum + s.coefficient, 0);
      const moyenneHeader = ws.getCell(MATIERES_ROW, ue.moyenneCol);
      moyenneHeader.value = `Moyenne ${ue.ueCode || ue.ueName}`;
      headerFill(moyenneHeader);
      const moyenneCredits = ws.getCell(CREDITS_ROW, ue.moyenneCol);
      moyenneCredits.value = totalCredits;
      headerFill(moyenneCredits);
      const moyenneCoef = ws.getCell(COEF_ROW, ue.moyenneCol);
      moyenneCoef.value = totalCoef;
      headerFill(moyenneCoef);

      mergeVFromMatieres(ue.creditsCol, 'Crédits Acquis');
      mergeVFull(ue.validationCol, 'Validation des crédits');
    }

    mergeVFull(L.totalCreditsCol, 'TOTAL CREDITS');
    mergeVFull(L.moyenneSemCol, `Moyenne Semestre ${semNum}`);
    mergeVFull(L.rangCol, 'Rang');
    mergeVFull(L.avisCol, 'Avis du Jury');
    mergeVFull(L.mentionCol, 'Mention');
    mergeVFull(L.naissanceCol, 'Date et lieu de naissance');
    mergeVFull(L.bacCol, 'Type de Bac');
    mergeVFull(L.provenanceCol, 'Provenance');

    data.reports.forEach((r, idx) => {
      const rowIdx = DATA_START + idx;
      ws.getCell(rowIdx, L.NUM_COL).value = idx + 1;
      ws.getCell(rowIdx, L.NOM_COL).value = `${r.student.lastName} ${r.student.firstName}`;

      const ueByName = new Map(r.report.map((ue) => [ue.ueName, ue]));
      for (const ue of L.ues) {
        const ueReport = ueByName.get(ue.ueName);
        const subjAvgByName = new Map((ueReport?.subjects || []).map((s) => [s.subject, s.average]));
        for (const s of ue.subjectCols) {
          ws.getCell(rowIdx, s.col).value = subjAvgByName.get(s.name) ?? '';
        }
        ws.getCell(rowIdx, ue.moyenneCol).value = ueReport?.average ?? '';
        ws.getCell(rowIdx, ue.creditsCol).value = ueReport?.creditsWon ?? '';
        ws.getCell(rowIdx, ue.validationCol).value = ueReport?.status ?? '';
      }
      ws.getCell(rowIdx, L.totalCreditsCol).value = r.totalCreditsWon;
      ws.getCell(rowIdx, L.moyenneSemCol).value = r.semesterAverage;
      ws.getCell(rowIdx, L.rangCol).value = r.rank;
      ws.getCell(rowIdx, L.avisCol).value = r.status.replace(/^Semestre/, `Semestre ${semNum}`);
      ws.getCell(rowIdx, L.mentionCol).value = this.mentionFor(r.semesterAverage);
      ws.getCell(rowIdx, L.naissanceCol).value = this.formatBirthInfo(r.student);
      ws.getCell(rowIdx, L.bacCol).value = r.student.bacType || '';
      ws.getCell(rowIdx, L.provenanceCol).value = r.student.provenance || '';
    });

    ws.getCell(1, 1).note = 'Lecture seule — générée automatiquement depuis les notes déjà saisies. Non lue à l\'import.';
    ws.views = [{ state: 'frozen', xSplit: 2, ySplit: COEF_ROW }];
  }

  // Complete reproduction of "BULLETIN S5": institution header, title stating the exact
  // semester, student identity/birth info, the full UE-grouped subject table (Crédits /
  // Coefficients / Notes / Moyenne de classe), a "Pénalités d'absences" row, Moyenne
  // Semestre, Rang/Mention, "Etat de la Validation des Crédits" table, Décision du Jury and
  // signature block — one student at a time, selected by N° and pulled live from TabNote via
  // INDEX() formulas so it always matches whatever is currently in the database.
  private buildBulletinSheet(
    workbook: ExcelJS.Workbook,
    data: {
      className?: string; year?: string; semesterName?: string;
      ueGroups: { ueName: string; ueCode?: string | null; subjects: { name: string; credits: number; coefficient: number }[] }[];
      classAverages: Map<string, number>; // subjectName -> moyenne de classe
      studentCount: number; logoImageId?: number | null;
    },
  ) {
    const L = this.buildTabNoteLayout(data.ueGroups);
    const semNum = (data.semesterName || '').replace(/^S/i, '');
    const cols = 8;
    const ws = workbook.addWorksheet('Bulletin', { properties: { tabColor: { argb: 'FFFFD966' } } });
    ws.columns = [{ width: 4 }, { width: 30 }, { width: 10 }, { width: 12 }, { width: 6 }, { width: 6 }, { width: 12 }, { width: 14 }];
    this.drawSheetHeader(ws, cols, `BULLETIN DE NOTES DU SEMESTRE ${semNum}`, data.logoImageId);

    let r = 6;
    ws.mergeCells(r, 1, r, cols); ws.getCell(r, 1).value = `Année universitaire : ${data.year || ''}`; ws.getCell(r, 1).font = { bold: true }; r += 1;
    ws.mergeCells(r, 1, r, cols); ws.getCell(r, 1).value = `Classe : ${data.className || ''}`; ws.getCell(r, 1).font = { bold: true }; r += 2;

    const selectorRow = r;
    ws.getCell(selectorRow, 1).value = `N° de l'étudiant (1 à ${data.studentCount}) :`;
    ws.getCell(selectorRow, 1).font = { bold: true };
    const selectorCell = ws.getCell(selectorRow, 3);
    selectorCell.value = 1;
    selectorCell.font = { bold: true, size: 14 };
    selectorCell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFFFE699' } };
    selectorCell.alignment = { horizontal: 'center' };
    selectorCell.border = { top: { style: 'medium' }, bottom: { style: 'medium' }, left: { style: 'medium' }, right: { style: 'medium' } };
    selectorCell.note = `Changez ce nombre (1 à ${data.studentCount}) pour afficher le bulletin d'un autre étudiant — tout ci-dessous se met à jour automatiquement.`;
    r += 2;

    const T = ExportsService.TABNOTE_DATA_START;
    const rowRef = `${T - 1}+$C$${selectorRow}`;
    const idx = (col: number) => `INDEX(TabNote!${this.columnLetter(col)}:${this.columnLetter(col)},${rowRef})`;

    const field = (label: string, formula: string, bold = false) => {
      ws.mergeCells(r, 1, r, 3); ws.getCell(r, 1).value = label; ws.getCell(r, 1).font = { bold: true };
      ws.mergeCells(r, 4, r, cols);
      const cell = ws.getCell(r, 4);
      cell.value = { formula };
      if (bold) cell.font = { bold: true, size: 12 };
      r += 1;
    };

    field('Nom(s) et Prénom(s)', idx(L.NOM_COL), true);
    field('Date et lieu de naissance', idx(L.naissanceCol));
    r += 1;

    // Main table: UE-grouped subject rows with Crédits / Coefficients / Notes / Moyenne de
    // classe, a "Moyenne UEx" footer row per UE, then Pénalités d'absences + Moyenne Semestre.
    const tableHeaderRow = r;
    ws.mergeCells(r, 1, r, 2); ws.getCell(r, 1).value = 'Matières';
    ws.getCell(r, 3).value = 'Crédits';
    ws.getCell(r, 4).value = 'Coefficients';
    ws.getCell(r, 5).value = "Notes de l'étudiant";
    ws.mergeCells(r, 6, r, cols); ws.getCell(r, 6).value = 'Moyenne de classe';
    ws.getRow(r).eachCell((cell) => {
      cell.font = { bold: true };
      cell.alignment = { horizontal: 'center', wrapText: true };
      cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFE0E0E0' } };
      cell.border = { top: { style: 'thin' }, bottom: { style: 'thin' }, left: { style: 'thin' }, right: { style: 'thin' } };
    });
    r += 1;

    for (const ue of L.ues) {
      ws.mergeCells(r, 1, r, cols);
      const ueRow = ws.getCell(r, 1);
      ueRow.value = ue.ueCode ? `${ue.ueCode} : ${ue.ueName}` : ue.ueName;
      ueRow.font = { bold: true };
      ueRow.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFD9D9D9' } };
      r += 1;

      for (const s of ue.subjectCols) {
        ws.mergeCells(r, 1, r, 2); ws.getCell(r, 1).value = s.name;
        ws.getCell(r, 3).value = s.credits;
        ws.getCell(r, 4).value = s.coefficient;
        ws.getCell(r, 5).value = { formula: idx(s.col) };
        ws.mergeCells(r, 6, r, cols);
        ws.getCell(r, 6).value = data.classAverages.get(s.name) ?? '';
        r += 1;
      }

      const totalCredits = ue.subjects.reduce((sum, s) => sum + s.credits, 0);
      ws.mergeCells(r, 1, r, 2); ws.getCell(r, 1).value = `Moyenne ${ue.ueCode || ue.ueName}`; ws.getCell(r, 1).font = { bold: true };
      ws.getCell(r, 3).value = totalCredits;
      ws.getCell(r, 4).value = totalCredits;
      ws.getCell(r, 5).value = { formula: idx(ue.moyenneCol) };
      ws.getCell(r, 5).font = { bold: true };
      ws.mergeCells(r, 6, r, cols);
      r += 1;
    }

    ws.mergeCells(r, 1, r, 2); ws.getCell(r, 1).value = "Pénalités d'absences";
    ws.mergeCells(r, 5, r, cols); ws.getCell(r, 5).value = 'Voir Absences';
    r += 2;

    ws.mergeCells(r, 1, r, 3); ws.getCell(r, 1).value = `Moyenne Semestre ${semNum}`; ws.getCell(r, 1).font = { bold: true, size: 12 };
    ws.mergeCells(r, 4, r, cols);
    const semAvgCell = ws.getCell(r, 4);
    semAvgCell.value = { formula: idx(L.moyenneSemCol) };
    semAvgCell.font = { bold: true, size: 12 };
    r += 2;

    // Rang / Mention
    ws.getCell(r, 1).value = "Rang de l'étudiant au Semestre"; ws.getCell(r, 1).font = { bold: true };
    ws.mergeCells(r, 3, r, 4);
    ws.getCell(r, 3).value = { formula: `${idx(L.rangCol)}&"/${data.studentCount}"` };
    ws.getCell(r, 6).value = 'Mention'; ws.getCell(r, 6).font = { bold: true };
    ws.mergeCells(r, 7, r, cols);
    ws.getCell(r, 7).value = { formula: idx(L.mentionCol) };
    r += 2;

    // Etat de la Validation des Crédits au Semestre N
    ws.mergeCells(r, 1, r, cols);
    ws.getCell(r, 1).value = `Etat de la Validation des Crédits au Semestre ${semNum}`;
    ws.getCell(r, 1).font = { bold: true };
    ws.getCell(r, 1).alignment = { horizontal: 'center' };
    r += 1;
    const validationHeaderRow = r;
    let vc = 1;
    for (const ue of L.ues) {
      ws.getCell(r, vc).value = ue.ueCode || ue.ueName;
      ws.getCell(r, vc).font = { bold: true };
      vc += 1;
    }
    const totalCreditsHeaderCol = Math.min(vc, cols);
    ws.getCell(r, totalCreditsHeaderCol).value = `Crédits validés au Semestre ${semNum}`;
    ws.getCell(r, totalCreditsHeaderCol).font = { bold: true };
    r += 1;
    vc = 1;
    for (const ue of L.ues) {
      const totalCredits = ue.subjects.reduce((sum, s) => sum + s.credits, 0);
      ws.getCell(r, vc).value = { formula: `${idx(ue.creditsCol)}&"/${totalCredits}"` };
      vc += 1;
    }
    ws.getCell(r, totalCreditsHeaderCol).value = { formula: `${idx(L.totalCreditsCol)}&"/${data.ueGroups.reduce((sum, ue) => sum + ue.subjects.reduce((s2, s) => s2 + s.credits, 0), 0)}"` };
    r += 1;
    vc = 1;
    for (const ue of L.ues) {
      ws.getCell(r, vc).value = { formula: idx(ue.validationCol) };
      vc += 1;
    }
    r += 2;

    ws.getCell(r, 1).value = 'Décision du Jury :'; ws.getCell(r, 1).font = { bold: true };
    ws.mergeCells(r, 3, r, cols);
    const decisionCell = ws.getCell(r, 3);
    decisionCell.value = { formula: idx(L.avisCol) };
    decisionCell.font = { bold: true, size: 12 };
    r += 3;

    ws.mergeCells(r, 1, r, cols);
    ws.getCell(r, 1).value = 'Fait à Libreville, le ...................';
    r += 2;
    ws.mergeCells(r, 1, r, cols);
    ws.getCell(r, 1).value = 'Le Directeur des Etudes et de la Pédagogie';
    ws.getCell(r, 1).alignment = { horizontal: 'center' };
    ws.getCell(r, 1).font = { bold: true };
    r += 3;
    ws.mergeCells(r, 1, r, cols);
    ws.getCell(r, 1).value = 'Davy Edgard MOUSSAVOU';
    ws.getCell(r, 1).alignment = { horizontal: 'center' };
    ws.getCell(r, 1).font = { bold: true };

    ws.views = [{ state: 'frozen', ySplit: tableHeaderRow }];
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
    await workbook.xlsx.load(this.toXlsxBuffer(buffer) as any);
    const worksheet = workbook.getWorksheet(1);

    if (!worksheet) throw new NotFoundException('Worksheet not found');

    // Loaded once up front so re-importing a roster (the same file, or a corrected one)
    // updates the matching student in place instead of failing on "email already exists" —
    // previously a single duplicate aborted the whole import (no try/catch at all).
    const existingStudents = await this.prisma.student.findMany();
    const studentByMatricule = new Map(existingStudents.map((s) => [this.normalizeText(s.studentId), s]));

    let created = 0;
    let updated = 0;
    let skipped = 0;
    const errors: string[] = [];

    for (let i = 2; i <= worksheet.rowCount; i++) {
        const row = worksheet.getRow(i);
        const studentId = row.getCell(1).toString().trim();
        const lastName = row.getCell(2).toString().trim();
        const firstName = row.getCell(3).toString().trim();
        const email = row.getCell(4).toString().trim();
        // Importing from a specific class's page (defaultClass set) lets the CLASSE column
        // be left blank — every row then falls into that class instead of the generic default.
        const className = row.getCell(5).toString().trim() || defaultClass || '';
        const birthDateStr = row.getCell(6).toString().trim();
        const birthPlace = row.getCell(7).toString().trim();
        const bacType = row.getCell(8).toString().trim();
        const provenance = row.getCell(9).toString().trim();
        const password = row.getCell(10).toString().trim() || 'Inptic2024!';

        if (!studentId) continue; // blank row

        const existing = studentByMatricule.get(this.normalizeText(studentId));

        try {
          if (existing) {
            // Only overwrite fields actually provided in this row, so a partially-filled
            // re-import can't blank out data that was already there.
            await this.usersService.updateStudent(existing.id, {
              firstName: firstName || undefined,
              lastName: lastName || undefined,
              class: className || undefined,
              birthDate: birthDateStr || undefined,
              birthPlace: birthPlace || undefined,
              bacType: bacType || undefined,
              provenance: provenance || undefined,
            });
            updated++;
          } else {
            if (!email) {
              skipped++;
              errors.push(`Ligne ${i}: email manquant pour le nouvel étudiant ("${studentId}")`);
              continue;
            }
            const result = await this.usersService.createStudent({
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
            if (result.student) studentByMatricule.set(this.normalizeText(studentId), result.student);
            created++;
          }
        } catch (e) {
          skipped++;
          errors.push(`Ligne ${i} (${studentId}): ${e instanceof Error ? e.message : 'erreur inconnue'}`);
        }
    }

    return { imported: created, updated, skipped, errors };
  }
}
