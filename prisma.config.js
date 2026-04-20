require('dotenv').config();
const { defineConfig } = require("@prisma/config");

module.exports = defineConfig({
  schema: "prisma/schema.prisma",
  datasource: {
    url: process.env.DATABASE_URL,
  },
  migrations: {
    seed: 'ts-node prisma/seed.ts',
  },
});
