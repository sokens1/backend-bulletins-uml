import { ApiProperty } from '@nestjs/swagger';
import { IsNotEmpty, IsString, IsNumber, IsOptional, Min, Max } from 'class-validator';

export class EnterGradeDto {
  @ApiProperty({ description: 'ID of the student' })
  @IsString()
  @IsNotEmpty()
  studentId: string;

  @ApiProperty({ description: 'ID of the subject' })
  @IsString()
  @IsNotEmpty()
  subjectId: string;

  @ApiProperty({ example: 12.5, required: false })
  @IsNumber()
  @Min(0)
  @Max(20)
  @IsOptional()
  ccGrade?: number;

  @ApiProperty({ example: 14.0, required: false })
  @IsNumber()
  @Min(0)
  @Max(20)
  @IsOptional()
  examGrade?: number;

  @ApiProperty({ example: 10.0, required: false })
  @IsNumber()
  @Min(0)
  @Max(20)
  @IsOptional()
  rattrapageGrade?: number;
}

export class EnterAttendanceDto {
  @ApiProperty({ description: 'ID of the student' })
  @IsString()
  @IsNotEmpty()
  studentId: string;

  @ApiProperty({ example: 2, description: 'Number of hours absent' })
  @IsNumber()
  @Min(0)
  hoursAbsent: number;
}
