import { ApiProperty } from '@nestjs/swagger';
import { IsEmail, IsNotEmpty, IsString, MinLength, IsEnum, IsOptional } from 'class-validator';
import { Role } from '@prisma/client';

export class RegisterDto {
  @ApiProperty({ example: 'user@example.com' })
  @IsEmail()
  @IsNotEmpty()
  email: string;

  @ApiProperty({ example: 'password123', minLength: 6 })
  @IsString()
  @MinLength(6)
  password: string;

  @ApiProperty({ enum: Role, default: Role.STUDENT })
  @IsEnum(Role)
  @IsOptional()
  role?: Role;

  @ApiProperty({ example: 'John' })
  @IsString()
  @IsNotEmpty()
  firstName: string;

  @ApiProperty({ example: 'Doe' })
  @IsString()
  @IsNotEmpty()
  lastName: string;

  @ApiProperty({ example: 'INPTIC-2024-001', required: false })
  @IsString()
  @IsOptional()
  studentId?: string; // Required if role is STUDENT

  @ApiProperty({ example: 'LP ASUR', required: false })
  @IsString()
  @IsOptional()
  class?: string;

  @ApiProperty({ example: '2000-01-01', required: false })
  @IsOptional()
  birthDate?: Date;

  @ApiProperty({ example: 'Libreville', required: false })
  @IsString()
  @IsOptional()
  birthPlace?: string;

  @ApiProperty({ example: 'S', required: false })
  @IsString()
  @IsOptional()
  bacType?: string;

  @ApiProperty({ example: 'Lycée National', required: false })
  @IsString()
  @IsOptional()
  provenance?: string;
}
