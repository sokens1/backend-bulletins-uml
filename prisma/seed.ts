import { PrismaClient, Role } from '@prisma/client';
import * as bcrypt from 'bcrypt';
import { PrismaPg } from '@prisma/adapter-pg';
import { Pool } from 'pg';

// For Prisma 7, we must use the driver adapter even in the seed script
const pool = new Pool({ connectionString: process.env.DATABASE_URL });
const adapter = new PrismaPg(pool);
const prisma = new PrismaClient({ adapter });

async function main() {
  const adminEmail = 'admin@inptic.ga';
  const adminPassword = 'AdminPassword123!';

  // Check if admin already exists
  const existingAdmin = await prisma.user.findUnique({
    where: { email: adminEmail },
  });

  if (!existingAdmin) {
    const hashedPassword = await bcrypt.hash(adminPassword, 10);
    
    await prisma.user.create({
      data: {
        email: adminEmail,
        password: hashedPassword,
        role: Role.ADMIN,
      },
    });

    console.log('✅ Admin user created: admin@inptic.ga / AdminPassword123!');
  } else {
    console.log('ℹ️ Admin user already exists.');
  }

  // Create two Semesters by default if they don't exist
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
