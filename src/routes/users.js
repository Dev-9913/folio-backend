import express    from 'express'
import { getAuth } from '@clerk/express'
import prisma      from '../db/prisma.js'
import { authenticate } from '../middleware/auth.js'

const router = express.Router()

// POST /api/users/sync
// Called by the frontend after every successful Clerk login/signup.
// Creates the user in our DB if they don't exist yet (first login),
// or updates their name/email if changed (e.g. after Google OAuth).
router.post('/sync', async (req, res) => {
  try {
    const { userId } = getAuth(req)
    if (!userId) return res.status(401).json({ error: 'Unauthorized' })

    const { name, email } = req.body

    const user = await prisma.user.upsert({
      where:  { clerkId: userId },
      update: { name: name || undefined, email: email || undefined },
      create: {
        clerkId: userId,
        name:    name  || 'Reader',
        email:   email || null,
      },
    })

    res.json(user)
  } catch (err) {
    console.error('User sync error:', err.message)
    res.status(500).json({ error: 'Sync failed' })
  }
})

// GET /api/users/me
// Returns the current user's DB record
router.get('/me', authenticate, async (req, res) => {
  try {
    const user = await prisma.user.findUnique({
      where:  { id: req.user.id },
      select: {
        id:        true,
        clerkId:   true,
        name:      true,
        email:     true,
        createdAt: true,
        _count: {
          select: {
            books:      true,
            highlights: true,
          }
        }
      }
    })
    res.json(user)
  } catch (err) {
    res.status(500).json({ error: err.message })
  }
})

export default router
