import { ApiProperty } from '@nestjs/swagger';
import { IsNotEmpty, IsString, IsBoolean, IsOptional, IsInt, IsNumber, Min, Max } from 'class-validator';

export class CreateSemesterDto {
  @ApiProperty({ example: 'S5' })
  @IsString()
  @IsNotEmpty()
  name: string;

  @ApiProperty({ example: '2024-2025' })
  @IsString()
  @IsNotEmpty()
  year: string;

  @ApiProperty({ example: true, default: false })
  @IsBoolean()
  @IsOptional()
  isActive?: boolean;
}

export class CreateUEDto {
  @ApiProperty({ example: 'UE5-1 Outils de base' })
  @IsString()
  @IsNotEmpty()
  name: string;

  @ApiProperty({ example: 9 })
  @IsInt()
  @IsNotEmpty()
  credits: number;

  @ApiProperty({ description: 'ID of the semester' })
  @IsString()
  @IsNotEmpty()
  semesterId: string;
}

export class CreateClassDto {
  @ApiProperty({ example: 'LP ASUR' })
  @IsString()
  @IsNotEmpty()
  name: string;
}

export class CreateAcademicYearDto {
  @ApiProperty({ example: '2025-2026' })
  @IsString()
  @IsNotEmpty()
  label: string;
}

export class UpdateSemesterDto {
  @ApiProperty({ example: 'S5', required: false })
  @IsString()
  @IsOptional()
  name?: string;

  @ApiProperty({ example: '2025-2026', required: false })
  @IsString()
  @IsOptional()
  year?: string;

  @ApiProperty({ example: true, required: false })
  @IsBoolean()
  @IsOptional()
  isActive?: boolean;
}

export class CreateSubjectDto {
  @ApiProperty({ example: 'Anglais' })
  @IsString()
  @IsNotEmpty()
  name: string;

  @ApiProperty({ example: 1.0, default: 1.0 })
  @IsNumber()
  @IsOptional()
  coefficient?: number;

  @ApiProperty({ example: 2, default: 2, description: 'Crédits ECTS de la matière' })
  @IsInt()
  @IsOptional()
  credits?: number;

  @ApiProperty({
    example: 0.4, default: 0.4, required: false,
    description: "Poids du Contrôle Continu dans la moyenne (0 à 1). Mettre 0 (avec examWeight=1) pour une matière à note unique — Stage, Soutenance, etc.",
  })
  @IsNumber()
  @IsOptional()
  @Min(0)
  @Max(1)
  ccWeight?: number;

  @ApiProperty({
    example: 0.6, default: 0.6, required: false,
    description: 'Poids de l\'Examen Final dans la moyenne (0 à 1) — devrait compléter ccWeight à 1.',
  })
  @IsNumber()
  @IsOptional()
  @Min(0)
  @Max(1)
  examWeight?: number;

  @ApiProperty({ description: 'ID of the UE' })
  @IsString()
  @IsNotEmpty()
  ueId: string;

  @ApiProperty({ description: 'ID of the teacher (optional)', required: false })
  @IsString()
  @IsOptional()
  teacherId?: string;
}

export class UpdateSubjectDto {
  @ApiProperty({ required: false })
  @IsString()
  @IsOptional()
  name?: string;

  @ApiProperty({ required: false })
  @IsNumber()
  @IsOptional()
  coefficient?: number;

  @ApiProperty({ required: false })
  @IsInt()
  @IsOptional()
  credits?: number;

  @ApiProperty({ required: false })
  @IsNumber()
  @IsOptional()
  @Min(0)
  @Max(1)
  ccWeight?: number;

  @ApiProperty({ required: false })
  @IsNumber()
  @IsOptional()
  @Min(0)
  @Max(1)
  examWeight?: number;

  @ApiProperty({ required: false })
  @IsString()
  @IsOptional()
  ueId?: string;

  @ApiProperty({ required: false })
  @IsString()
  @IsOptional()
  teacherId?: string;
}
