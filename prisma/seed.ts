import { PrismaClient, Role } from '@prisma/client';
import * as bcrypt from 'bcrypt';
import { PrismaPg } from '@prisma/adapter-pg';
import { Pool } from 'pg';

const pool = new Pool({ connectionString: process.env.DATABASE_URL });
const adapter = new PrismaPg(pool);
const prisma = new PrismaClient({ adapter });

async function main() {
  const defaultPassword = 'Inptic2024!';
  const hashedDefault = await bcrypt.hash(defaultPassword, 10);

  // 1. Create Admin
  const adminEmail = 'admin@inptic.ga';
  const adminPassword = 'AdminPassword123!';
  const hashedAdmin = await bcrypt.hash(adminPassword, 10);

  await prisma.user.upsert({
    where: { email: adminEmail },
    update: {},
    create: {
      email: adminEmail,
      password: hashedAdmin,
      role: Role.ADMIN,
    },
  });
  console.log('✅ Admin: admin@inptic.ga / AdminPassword123!');

  // 2. Create Teacher
  const teacherEmail = 'prof@inptic.ga';
  await prisma.user.upsert({
    where: { email: teacherEmail },
    update: {},
    create: {
      email: teacherEmail,
      password: hashedDefault,
      role: Role.TEACHER,
      teacher: {
        create: {
          firstName: 'Jean',
          lastName: 'Dupont',
        },
      },
    },
  });
  console.log('✅ Teacher: prof@inptic.ga / Inptic2024!');

  // 3. Create Secretary
  const secEmail = 'secretariat@inptic.ga';
  await prisma.user.upsert({
    where: { email: secEmail },
    update: {},
    create: {
      email: secEmail,
      password: hashedDefault,
      role: Role.SECRETARY,
    },
  });
  console.log('✅ Secretary: secretariat@inptic.ga / Inptic2024!');

  // 4. Create Student
  const stdEmail = 'etudiant@inptic.ga';
  await prisma.user.upsert({
    where: { email: stdEmail },
    update: {},
    create: {
      email: stdEmail,
      password: hashedDefault,
      role: Role.STUDENT,
      student: {
        create: {
          studentId: 'INPTIC-2024-TEST',
          firstName: 'Alice',
          lastName: 'Moussa',
          class: 'LP ASUR',
        },
      },
    },
  });
  console.log('✅ Student: etudiant@inptic.ga / Inptic2024!');

  // 5. Initialize Semesters
  await prisma.semester.upsert({
    where: { id: 's5-uuid-placeholder' },
    update: {},
    create: {
      id: 's5-uuid-placeholder',
      name: 'S5',
      year: '2024-2025',
      isActive: true,
    },
  });

  await prisma.semester.upsert({
    where: { id: 's6-uuid-placeholder' },
    update: {},
    create: {
      id: 's6-uuid-placeholder',
      name: 'S6',
      year: '2024-2025',
      isActive: false,
    },
  });
  console.log('✅ Semesters (S5, S6) initialized.');
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
    await pool.end();
  });
