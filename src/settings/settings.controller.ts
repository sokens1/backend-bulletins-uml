import { Body, Controller, Get, Patch, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { Role } from '@prisma/client';
import { Roles } from '../auth/decorator/roles.decorator';
import { JwtAuthGuard } from '../auth/guard/jwt-auth.guard';
import { RolesGuard } from '../auth/guard/roles.guard';
import { SettingsService } from './settings.service';

type UpdateAcademicRulesDto = {
  absencePenaltyPerHour?: number;
  soutenanceUeCode?: string;
  enableSoutenanceRetake?: boolean;
};

@ApiTags('settings')
@ApiBearerAuth()
@Controller('settings')
@UseGuards(JwtAuthGuard, RolesGuard)
export class SettingsController {
  constructor(private readonly settingsService: SettingsService) {}

  @Get('academic-rules')
  @Roles(Role.ADMIN)
  @ApiOperation({ summary: 'Get academic rules settings' })
  getAcademicRules() {
    return this.settingsService.getAcademicRulesSettings();
  }

  @Patch('academic-rules')
  @Roles(Role.ADMIN)
  @ApiOperation({ summary: 'Update academic rules settings' })
  updateAcademicRules(@Body() dto: UpdateAcademicRulesDto) {
    return this.settingsService.updateAcademicRulesSettings(dto);
  }
}
