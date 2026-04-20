import { ApiProperty } from '@nestjs/swagger';
import { IsNotEmpty, IsString, IsBoolean, IsOptional, IsInt, IsNumber } from 'class-validator';

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

export class CreateSubjectDto {
  @ApiProperty({ example: 'Anglais' })
  @IsString()
  @IsNotEmpty()
  name: string;

  @ApiProperty({ example: 1.0, default: 1.0 })
  @IsNumber()
  @IsOptional()
  coefficient?: number;

  @ApiProperty({ description: 'ID of the UE' })
  @IsString()
  @IsNotEmpty()
  ueId: string;

  @ApiProperty({ description: 'ID of the teacher (optional)', required: false })
  @IsString()
  @IsOptional()
  teacherId?: string;
}
