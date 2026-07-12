import 'dotenv/config'
import express   from 'express'
import cors      from 'cors'
import helmet    from 'helmet'
import morgan    from 'morgan'
import rateLimit from 'express-rate-limit'

import prisma            from './db/prisma.js'
import { connectRedis }  from './config/redis.js'
import { clerkAuth }     from './middleware/auth.js'
import bookRoutes        from './routes/books.js'
import shelfRoutes       from './routes/shelves.js'
import aiRoutes          from './routes/ai.js'
import highlightRoutes   from './routes/highlights.js'
import chatRoutes        from './routes/chats.js'
import storageRoutes     from './routes/storage.js'
import userRoutes        from './routes/users.js'
import storeRoutes       from './routes/store.js'
import { seedCatalog }   from './services/catalogSeeder.js'

const app  = express()
const PORT = process.env.PORT || 3001

app.use(helmet())
app.use(cors({ origin: process.env.CORS_ORIGIN || '*' }))
app.use(morgan('dev'))
app.use(express.json({ limit: '10mb' }))
app.use(rateLimit({ windowMs: 15 * 60_000, max: 300 }))

// Clerk auth middleware — must come before all protected routes
// Validates every request's Bearer token against Clerk's JWKS
app.use(clerkAuth)

// Routes
app.use('/api/users',      userRoutes)
app.use('/api/books',      bookRoutes)
app.use('/api/shelves',    shelfRoutes)
app.use('/api/ai',         aiRoutes)
app.use('/api/highlights', highlightRoutes)
app.use('/api/chats',      chatRoutes)
app.use('/api/storage',    storageRoutes)
app.use('/api/store',      storeRoutes)

// Health check — no auth required
app.get('/health', async (_req, res) => {
  try {
    await prisma.$queryRaw`SELECT 1`
    res.json({ status: 'ok', db: 'connected', timestamp: new Date() })
  } catch {
    res.status(503).json({ status: 'error', db: 'disconnected' })
  }
})

app.use((_req, res) => res.status(404).json({ error: 'Not found' }))
app.use((err, _req, res, _next) => {
  console.error(err.stack)
  res.status(500).json({ error: 'Internal server error' })
})

async function start() {
  await connectRedis()
  await prisma.$connect()
  console.log('✅ Prisma connected to PostgreSQL')

  app.listen(PORT, () => console.log(`🚀 Folio backend on port ${PORT}`))

  // Catalog seeding runs in the background — server accepts requests
  // immediately regardless of scrape duration. If the catalog table is
  // empty (first-ever deploy) or older than 7 days, this kicks off a
  // re-scrape; otherwise it's a near-instant no-op (one SELECT).
  // Errors are caught and logged inside seedCatalog itself — they never
  // crash the server or block any request.
  seedCatalog().then((result) => {
    if (result?.skipped) {
      console.log(`📚 Catalog fresh — ${result.bookCount} books cached`)
    } else if (result?.error) {
      console.warn('📚 Catalog seed failed (server still running):', result.error)
    } else {
      console.log(`📚 Catalog refreshed — ${result.bookCount} books`)
    }
  })
}

start().catch(err => {
  console.error('Fatal startup error:', err)
  process.exit(1)
})