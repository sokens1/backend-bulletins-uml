import { PrismaClient, Role } from '@prisma/client';
import * as bcrypt from 'bcrypt';

const prisma = new PrismaClient();

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
  const s5 = await prisma.semester.upsert({
    where: { id: 's5-uuid-placeholder' }, // Simple fixed IDs for seeding
    update: {},
    create: {
      id: 's5-uuid-placeholder',
      name: 'S5',
      year: '2024-2025',
      isActive: true,
    },
  });

  const s6 = await prisma.semester.upsert({
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
  });
