import { Injectable } from '@nestjs/common';
import { DatabaseService } from '../database/database.service';

type AcademicRulesSettings = {
  absencePenaltyPerHour: number;
  soutenanceUeCode: string;
  enableSoutenanceRetake: boolean;
};

@Injectable()
export class SettingsService {
  constructor(private prisma: DatabaseService) {}

  private readonly defaults: AcademicRulesSettings = {
    absencePenaltyPerHour: Number(process.env.ABSENCE_PENALTY_PER_HOUR ?? 0.01),
    soutenanceUeCode: process.env.SOUTENANCE_UE_CODE ?? 'UE6-2',
    enableSoutenanceRetake: (process.env.ENABLE_SOUTENANCE_RETAKE ?? 'true') === 'true',
  };

  private async ensureTable() {
    await this.prisma.$executeRawUnsafe(`
      CREATE TABLE IF NOT EXISTS app_settings (
        key TEXT PRIMARY KEY,
        value TEXT NOT NULL,
        updated_at TIMESTAMP DEFAULT NOW()
      )
    `);
  }

  private async setValue(key: string, value: string) {
    await this.prisma.$executeRawUnsafe(
      `
      INSERT INTO app_settings (key, value, updated_at)
      VALUES ($1, $2, NOW())
      ON CONFLICT (key)
      DO UPDATE SET value = EXCLUDED.value, updated_at = NOW()
      `,
      key,
      value,
    );
  }

  private async getValues(keys: string[]) {
    const rows = await this.prisma.$queryRawUnsafe<Array<{ key: string; value: string }>>(
      `SELECT key, value FROM app_settings WHERE key = ANY($1::text[])`,
      keys,
    );
    return rows.reduce<Record<string, string>>((acc, row) => {
      acc[row.key] = row.value;
      return acc;
    }, {});
  }

  async getAcademicRulesSettings(): Promise<AcademicRulesSettings> {
    await this.ensureTable();
    const values = await this.getValues([
      'absencePenaltyPerHour',
      'soutenanceUeCode',
      'enableSoutenanceRetake',
    ]);

    const parsedPenalty = Number(values.absencePenaltyPerHour);

    return {
      absencePenaltyPerHour:
        Number.isFinite(parsedPenalty) && parsedPenalty >= 0
          ? parsedPenalty
          : this.defaults.absencePenaltyPerHour,
      soutenanceUeCode: values.soutenanceUeCode || this.defaults.soutenanceUeCode,
      enableSoutenanceRetake:
        values.enableSoutenanceRetake !== undefined
          ? values.enableSoutenanceRetake === 'true'
          : this.defaults.enableSoutenanceRetake,
    };
  }

  async updateAcademicRulesSettings(payload: Partial<AcademicRulesSettings>) {
    await this.ensureTable();

    if (payload.absencePenaltyPerHour !== undefined) {
      await this.setValue('absencePenaltyPerHour', String(payload.absencePenaltyPerHour));
    }
    if (payload.soutenanceUeCode !== undefined) {
      await this.setValue('soutenanceUeCode', payload.soutenanceUeCode);
    }
    if (payload.enableSoutenanceRetake !== undefined) {
      await this.setValue('enableSoutenanceRetake', String(payload.enableSoutenanceRetake));
    }

    return this.getAcademicRulesSettings();
  }
}
