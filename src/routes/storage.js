import express from 'express'
import multer  from 'multer'
import { uploadEpub, getSignedUrl } from '../config/storage.js'
import { authenticate } from '../middleware/auth.js'
import prisma from '../db/prisma.js'

const router  = express.Router()
// Store file in memory as buffer — no disk writes on server
const upload  = multer({ storage: multer.memoryStorage(), limits: { fileSize: 50 * 1024 * 1024 } })

// POST /api/books/:bookId/upload — upload EPUB to Supabase Storage
router.post('/upload/:bookId', authenticate, upload.single('epub'), async (req, res) => {
  try {
    const { bookId } = req.params
    if (!req.file) return res.status(400).json({ error: 'No file provided' })

    await uploadEpub(bookId, req.file.buffer, req.file.mimetype)

    // Mark book as cloud-synced in DB
    await prisma.book.upsert({
      where:  { id: bookId },
      update: { cloudSynced: true },
      create: {
        id:          bookId,
        userId:      req.user.id,
        title:       req.body.title       || 'Unknown',
        author:      req.body.author      || 'Unknown',
        cloudSynced: true,
      },
    })

    res.json({ success: true, bookId })
  } catch (err) {
    console.error('Upload error:', err.message)
    res.status(500).json({ error: err.message })
  }
})

// GET /api/books/:bookId/download-url — get signed download URL
router.get('/download-url/:bookId', authenticate, async (req, res) => {
  try {
    const signedUrl = await getSignedUrl(req.params.bookId)
    res.json({ url: signedUrl })
  } catch (err) {
    res.status(500).json({ error: err.message })
  }
})

export default router