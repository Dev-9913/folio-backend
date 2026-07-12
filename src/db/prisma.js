import { PrismaClient } from '@prisma/client'

// Singleton pattern — prevents connection pool leaks on nodemon hot-reloads.
// global survives module re-evaluation within the same OS process.

const globalForPrisma = global

const prisma =
  globalForPrisma.prisma ??
  new PrismaClient({
    log: process.env.NODE_ENV === 'development'
      ? ['query', 'warn', 'error']
      : ['warn', 'error'],
  })

if (process.env.NODE_ENV !== 'production') {
  globalForPrisma.prisma = prisma
}

export default prisma
