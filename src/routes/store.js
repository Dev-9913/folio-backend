import { Router }   from 'express'
import Razorpay     from 'razorpay'
import crypto       from 'crypto'
import { load }     from 'cheerio'
import prisma        from '../db/prisma.js'
import { authenticate } from '../middleware/auth.js'
import { forceRefresh } from '../services/catalogSeeder.js'

const SE_BASE = 'https://standardebooks.org'

// ── Lazy description hydration ────────────────────────────────────────────────
// Descriptions aren't on the listing pages so we fetch them on-demand when a
// user opens a book detail. Result is stored permanently so each book is only
// fetched once — ever. Subsequent opens are instant from the DB.
async function hydrateDescription(slug) {
  try {
    const res = await fetch(`${SE_BASE}/ebooks/${slug}`, {
      headers: { 'User-Agent': 'Folio/1.0', 'Accept': 'text/html' },
      signal:  AbortSignal.timeout(8000),
    })
    if (!res.ok) return null
    const html = await res.text()
    const $    = load(html)

    // SE puts a clean one-sentence description in the og:description / meta
    // description tag — no HTML markup, ideal for our detail popup.
    const desc = $('meta[name="description"]').attr('content')
               || $('meta[property="og:description"]').attr('content')
               || null

    if (desc) {
      await prisma.catalogBook.update({
        where: { id: slug },
        data:  { description: desc },
      })
    }
    return desc
  } catch {
    return null
  }
}

const router = Router()

function getRazorpay() {
  if (!process.env.RAZORPAY_KEY_ID || !process.env.RAZORPAY_KEY_SECRET) return null
  return new Razorpay({
    key_id:     process.env.RAZORPAY_KEY_ID,
    key_secret: process.env.RAZORPAY_KEY_SECRET,
  })
}

// ── Shape a CatalogBook row for the frontend ─────────────────────────────────
function shapeBook(b) {
  return {
    id:         b.id,            // SE slug — "mary-shelley/frankenstein"
    title:      b.title,
    author:     b.author,
    authorStr:  b.author,        // kept for frontend back-compat with old field name
    coverUrl:   b.coverUrl,
    epubUrl:    b.epubUrl,
    subjects:   b.subjects ?? [],
    description: b.description,
    free:       !b.isPaid,
    isPaid:     b.isPaid,
    price:      b.pricePaise,    // paise — frontend divides by 100 for display
  }
}

// ── GET /api/store/featured — Top Picks + New Releases rails ─────────────────
// Pulled straight from popularityRank/releaseRank columns — no live scraping,
// no computed scoring. Both rails come from one query each, sub-5ms.
router.get('/featured', async (_req, res) => {
  try {
    const [topPicks, newReleases] = await Promise.all([
      prisma.catalogBook.findMany({
        where:   { popularityRank: { not: null } },
        orderBy: { popularityRank: 'asc' },
        take:    12,
      }),
      prisma.catalogBook.findMany({
        where:   { releaseRank: { not: null } },
        orderBy: { releaseRank: 'asc' },
        take:    12,
      }),
    ])

    res.json({
      topPicks:    topPicks.map(shapeBook),
      newReleases: newReleases.map(shapeBook),
    })
  } catch (err) {
    console.error('[Store] /featured error:', err.message)
    res.status(502).json({ error: 'Failed to load featured books' })
  }
})

// ── GET /api/store/books?search=&page=&subject=&isPaid=&sort= ────────────────
router.get('/books', async (req, res) => {
  try {
    const { search = '', page = 1, subject = '', isPaid = '', sort = 'title' } = req.query
    const p       = Math.max(1, Number(page) || 1)
    const perPage = 20

    const where = {}

    // Token-based search — splits "Pride Austen" into ["Pride","Austen"] and
    // requires EACH token to match somewhere in title OR author. This lets
    // users search by title, by author, or mix both, in any word order,
    // without needing the exact substring. Single misspelled tokens still
    // won't fuzzy-match (would need pg_trgm for that — not worth the
    // complexity at this catalog size).
    const tokens = search.trim().split(/\s+/).filter(Boolean)
    if (tokens.length > 0) {
      where.AND = tokens.map(token => ({
        OR: [
          { title:  { contains: token, mode: 'insensitive' } },
          { author: { contains: token, mode: 'insensitive' } },
        ],
      }))
    }

    if (subject) {
      where.subjects = { has: subject }
    }

    // Free/Paid toggle — "true" → paid only, "false" → free only, omitted → both
    if (isPaid === 'true')  where.isPaid = true
    if (isPaid === 'false') where.isPaid = false

    // Sort: title (default A-Z), popular (SE's own popularity rank),
    // newest (SE's own release rank). Books without a rank are pushed to
    // the end automatically since Prisma sorts nulls last by default on asc.
    const orderBy =
      sort === 'popular' ? { popularityRank: 'asc' } :
      sort === 'newest'  ? { releaseRank:    'asc' } :
      { title: 'asc' }

    const [total, results] = await Promise.all([
      prisma.catalogBook.count({ where }),
      prisma.catalogBook.findMany({
        where,
        orderBy,
        skip:    (p - 1) * perPage,
        take:    perPage,
      }),
    ])

    res.json({
      total,
      page:    p,
      perPage,
      hasNext: p * perPage < total,
      hasPrev: p > 1,
      results: results.map(shapeBook),
    })
  } catch (err) {
    console.error('[Store] /books error:', err.message)
    res.status(502).json({ error: 'Catalog temporarily unavailable' })
  }
})

// ── GET /api/store/books/* — book detail by SE slug ───────────────────────────
// Wildcard route because slugs contain a slash: "author/title".
// Lazily fetches + stores description from SE detail page on first open.
router.get('/books/*', async (req, res) => {
  try {
    const slug = req.params[0]
    let book   = await prisma.catalogBook.findUnique({ where: { id: slug } })
    if (!book) return res.status(404).json({ error: 'Book not found' })

    // Description is null until a user first opens this book — fetch it now,
    // persist it, then return. All subsequent opens hit the DB cache (instant).
    if (!book.description) {
      const desc = await hydrateDescription(slug)
      if (desc) book = { ...book, description: desc }
    }

    res.json(shapeBook(book))
  } catch (err) {
    res.status(502).json({ error: 'Failed to load book' })
  }
})

// ── GET /api/store/subjects — fixed SE category list with live counts ────────
router.get('/subjects', async (_req, res) => {
  try {
    const books = await prisma.catalogBook.findMany({ select: { subjects: true } })
    const countMap = {}
    books.forEach(b => b.subjects.forEach(s => {
      countMap[s] = (countMap[s] || 0) + 1
    }))
    res.json(
      Object.entries(countMap)
        .sort((a, b) => b[1] - a[1])
        .map(([name, count]) => ({ name, count }))
    )
  } catch (err) {
    res.status(502).json({ error: 'Failed to load subjects' })
  }
})

// ── GET /api/store/catalog/status — for the "seeding…" frontend state ────────
router.get('/catalog/status', async (_req, res) => {
  try {
    const meta = await prisma.catalogMeta.findUnique({ where: { id: 1 } })
    res.json({
      seeded:      !!meta,
      bookCount:   meta?.bookCount ?? 0,
      lastScraped: meta?.lastScraped ?? null,
    })
  } catch {
    res.json({ seeded: false, bookCount: 0, lastScraped: null })
  }
})

// ── POST /api/store/catalog/refresh — manual force re-scrape (authenticated) ──
router.post('/catalog/refresh', authenticate, async (_req, res) => {
  try {
    const result = await forceRefresh()
    if (result.error) return res.status(502).json({ error: result.error })
    res.json({ ok: true, bookCount: result.bookCount })
  } catch (err) {
    res.status(500).json({ error: err.message })
  }
})

// ── POST /api/store/purchase/create-order ────────────────────────────────────
// Paywall check happens here: looks up the catalog row, refuses to create an
// order for a book that isn't actually marked isPaid (prevents a tampered
// client from "buying" a free book or guessing a fake price).
router.post('/purchase/create-order', authenticate, async (req, res) => {
  const { catalogBookId } = req.body
  if (!catalogBookId) return res.status(400).json({ error: 'catalogBookId required' })

  try {
    const book = await prisma.catalogBook.findUnique({ where: { id: catalogBookId } })
    if (!book) return res.status(404).json({ error: 'Book not found' })
    if (!book.isPaid) return res.status(400).json({ error: 'This book is free — no purchase needed' })

    const rzp = getRazorpay()
    if (!rzp) return res.status(503).json({ error: 'Payment service not configured' })

    const order = await rzp.orders.create({
      amount:   book.pricePaise,   // server-side price, never trust client amount
      currency: 'INR',
      receipt:  `folio_${Date.now()}`,
      notes:    { catalogBookId, bookTitle: book.title },
    })

    await prisma.purchase.create({
      data: {
        userId:          req.user.id,
        catalogBookId,
        bookTitle:       book.title,
        bookAuthor:      book.author,
        amountPaise:     book.pricePaise,
        razorpayOrderId: order.id,
        status:          'PENDING',
      },
    })

    res.json({
      orderId:  order.id,
      amount:   order.amount,
      currency: order.currency,
      key:      process.env.RAZORPAY_KEY_ID,
    })
  } catch (err) {
    console.error('[Store] create-order error:', err.message)
    res.status(500).json({ error: 'Failed to create payment order' })
  }
})

// ── POST /api/store/purchase/verify ──────────────────────────────────────────
router.post('/purchase/verify', authenticate, async (req, res) => {
  const { razorpay_order_id, razorpay_payment_id, razorpay_signature } = req.body
  if (!razorpay_order_id || !razorpay_payment_id || !razorpay_signature) {
    return res.status(400).json({ error: 'Missing payment verification fields' })
  }

  const expected = crypto
    .createHmac('sha256', process.env.RAZORPAY_KEY_SECRET)
    .update(`${razorpay_order_id}|${razorpay_payment_id}`)
    .digest('hex')

  if (expected !== razorpay_signature) {
    return res.status(400).json({ error: 'Invalid payment signature' })
  }

  try {
    // razorpayOrderId is not @unique in schema so Prisma won't accept it
    // directly in update({ where: ... }). Find the row first, then update by pk.
    const existing = await prisma.purchase.findFirst({
      where: { razorpayOrderId: razorpay_order_id },
    })
    if (!existing) return res.status(404).json({ error: 'Order not found' })

    const purchase = await prisma.purchase.update({
      where: { id: existing.id },
      data:  { razorpayPaymentId: razorpay_payment_id, status: 'PAID' },
    })
    res.json({ success: true, purchase })
  } catch (err) {
    console.error('[Store] verify error:', err.message)
    res.status(500).json({ error: 'Failed to verify payment' })
  }
})

// ── GET /api/store/purchases — user's paid purchase history ──────────────────
router.get('/purchases', authenticate, async (req, res) => {
  try {
    const purchases = await prisma.purchase.findMany({
      where:   { userId: req.user.id, status: 'PAID' },
      orderBy: { createdAt: 'desc' },
    })
    res.json(purchases)
  } catch {
    res.status(500).json({ error: 'Failed to fetch purchases' })
  }
})

export default router
