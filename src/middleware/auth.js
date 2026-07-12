import { clerkMiddleware, getAuth } from '@clerk/express'
import prisma from '../db/prisma.js'

// Global Clerk middleware — mounts on every request in server.js
// Validates the Clerk JWT automatically, no manual verification needed
export const clerkAuth = clerkMiddleware()

// Drop-in replacement for the old authenticate middleware
// Same signature (req, res, next) so all existing routes work unchanged
export async function authenticate(req, res, next) {
  try {
    const { userId } = getAuth(req)
    if (!userId) return res.status(401).json({ error: 'Unauthorized' })

    // Resolve Clerk userId to our internal DB user
    const user = await prisma.user.findUnique({ where: { clerkId: userId } })
    if (!user) return res.status(401).json({ error: 'User not found — please sync' })

    // Attach to req.user — same shape existing routes expect (id, email)
    req.user = { id: user.id, email: user.email, clerkId: userId }
    next()
  } catch (err) {
    console.error('Auth error:', err.message)
    res.status(401).json({ error: 'Unauthorized' })
  }
}
