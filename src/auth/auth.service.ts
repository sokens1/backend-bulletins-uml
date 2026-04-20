import { Injectable, ConflictException, UnauthorizedException, BadRequestException } from '@nestjs/common';
import { PrismaService } from '../database/prisma.service';
import { RegisterDto } from './dto/register.dto';
import { LoginDto } from './dto/login.dto';
import * as bcrypt from 'bcrypt';
import { JwtService } from '@nestjs/jwt';
import { Role } from '@prisma/client';

@Injectable()
export class AuthService {
  constructor(
    private prisma: PrismaService,
    private jwtService: JwtService,
  ) {}

  async register(dto: RegisterDto) {
    // 1. Check if user already exists
    const userExists = await this.prisma.user.findUnique({
      where: { email: dto.email },
    });

    if (userExists) {
      throw new ConflictException('User already exists');
    }

    // 2. Hash password
    const hashedPassword = await bcrypt.hash(dto.password, 10);

    // 3. Create user and profile (Student or Teacher)
    const user = await this.prisma.user.create({
      data: {
        email: dto.email,
        password: hashedPassword,
        role: dto.role || Role.STUDENT,
      },
    });

    if (user.role === Role.STUDENT) {
      if (!dto.studentId || !dto.class) {
        throw new BadRequestException('studentId and class are required for STUDENTS');
      }
      await this.prisma.student.create({
        data: {
          userId: user.id,
          studentId: dto.studentId,
          firstName: dto.firstName,
          lastName: dto.lastName,
          class: dto.class,
        },
      });
    } else if (user.role === Role.TEACHER) {
      await this.prisma.teacher.create({
        data: {
          userId: user.id,
          firstName: dto.firstName,
          lastName: dto.lastName,
        },
      });
    }

    // 4. Return token
    return this.signToken(user.id, user.email, user.role);
  }

  async login(dto: LoginDto) {
    // 1. Find user
    const user = await this.prisma.user.findUnique({
      where: { email: dto.email },
    });

    if (!user) {
      throw new UnauthorizedException('Invalid credentials');
    }

    // 2. Check password
    const isMatch = await bcrypt.compare(dto.password, user.password);
    if (!isMatch) {
      throw new UnauthorizedException('Invalid credentials');
    }

    // 3. Return token
    return this.signToken(user.id, user.email, user.role);
  }

  private async signToken(userId: string, email: string, role: Role) {
    const payload = { sub: userId, email, role };
    const secret = process.env.JWT_SECRET || 'secret';

    const token = await this.jwtService.signAsync(payload, {
      expiresIn: '24h',
      secret: secret,
    });

    return {
      access_token: token,
      user: {
        id: userId,
        email,
        role,
      },
    };
  }
}
