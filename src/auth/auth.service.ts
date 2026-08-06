import { Injectable, ConflictException, UnauthorizedException } from '@nestjs/common';
import { DatabaseService } from '../database/database.service';
import { RegisterDto } from './dto/register.dto';
import { LoginDto } from './dto/login.dto';
import * as bcrypt from 'bcrypt';
import { JwtService } from '@nestjs/jwt';
import { Role } from '@prisma/client';

@Injectable()
export class AuthService {
  constructor(
    private prisma: DatabaseService,
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
    const role = dto.role || Role.STUDENT;

    // 3. Create user and profile (Student or Teacher) atomically.
    // Without a transaction, a failure while creating the Student/Teacher
    // profile would leave an orphan User row (account "exists" but has no
    // profile, and can never successfully register again since the email
    // is already taken) — that half-created state is what breaks login
    // after a registration attempt that looked like it failed.
    const user = await this.prisma.$transaction(async (tx) => {
      const created = await tx.user.create({
        data: {
          email: dto.email,
          password: hashedPassword,
          role,
        },
      });

      if (role === Role.STUDENT) {
        // Public self-registration doesn't collect an official matricule/
        // class yet (those are normally assigned by the administration) —
        // default them instead of hard-failing, admin can fill them in later.
        await tx.student.create({
          data: {
            userId: created.id,
            studentId: dto.studentId || `PENDING-${Date.now()}`,
            firstName: dto.firstName,
            lastName: dto.lastName,
            class: dto.class || 'À affecter',
            birthDate: dto.birthDate ? new Date(dto.birthDate) : null,
            birthPlace: dto.birthPlace ?? null,
            bacType: dto.bacType ?? null,
            provenance: dto.provenance ?? null,
          },
        });
      } else if (role === Role.TEACHER) {
        await tx.teacher.create({
          data: {
            userId: created.id,
            firstName: dto.firstName,
            lastName: dto.lastName,
          },
        });
      }

      return created;
    });

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
