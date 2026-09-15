// Stamp an already-SIGNED contract (the DocuSign download / scan / photo the
// rep uploaded to the Doc Hub) with the StormSafe logo + DEPOSIT PAID mark on
// every page. This is the "fully executed copy" sent back to the client as the
// bill of sale — signatures stay exactly as they were signed; we only overlay.
// PDFs are stamped page-by-page; images (a phone photo of the signed page) are
// wrapped into a single-page PDF first.
import { PDFDocument, StandardFonts, degrees, rgb } from 'pdf-lib'

const GREEN = rgb(0x15 / 255, 0x80 / 255, 0x3d / 255)

async function fetchLogoBytes() {
  // The CRM serves its brand logo from the app root (public/logo.png).
  try {
    const res = await fetch('/logo.png')
    if (!res.ok) return null
    return new Uint8Array(await res.arrayBuffer())
  } catch {
    return null
  }
}

function drawStamp(page, font, logoImg) {
  const { width, height } = page.getSize()
  const cx = width / 2
  const cy = height / 2
  const text = 'DEPOSIT PAID'
  const size = Math.min(46, width / 12)
  const textW = font.widthOfTextAtSize(text, size)
  const rot = degrees(27)
  const th = (27 * Math.PI) / 180
  // pdf-lib rotates each element around its OWN bottom-left origin. To keep the
  // logo, box and text aligned as one rotated stamp, we anchor everything to a
  // shared origin and convert local (dx,dy) offsets through the rotation.
  const local = (ox, oy, dx, dy) => [
    ox + dx * Math.cos(th) - dy * Math.sin(th),
    oy + dx * Math.sin(th) + dy * Math.cos(th),
  ]

  const padX = 26
  const padY = 14
  const boxW = textW + padX * 2
  const boxH = size + padY * 2
  // Shared origin = the stamp box's bottom-left, positioned so the box is
  // roughly centred on the page.
  const ox = cx - (boxW / 2) * Math.cos(th) + (boxH / 2) * Math.sin(th) - 10
  const oy = cy - (boxW / 2) * Math.sin(th) - (boxH / 2) * Math.cos(th) - 20

  page.drawRectangle({
    x: ox, y: oy, width: boxW, height: boxH,
    borderColor: GREEN, borderWidth: 4,
    opacity: 0, borderOpacity: 0.18, rotate: rot,
  })
  const [tx, ty] = local(ox, oy, padX, padY + size * 0.12)
  page.drawText(text, { x: tx, y: ty, size, font, color: GREEN, opacity: 0.18, rotate: rot })

  if (logoImg) {
    const lw = Math.min(240, width * 0.42)
    const lh = (logoImg.height / logoImg.width) * lw
    const [lx, ly] = local(ox, oy, (boxW - lw) / 2, boxH + 24)
    page.drawImage(logoImg, { x: lx, y: ly, width: lw, height: lh, rotate: rot, opacity: 0.12 })
  }
}

/**
 * Stamp a signed contract file. `bytes` = the original file, `contentType` its
 * mime (application/pdf or image/*). Returns a Blob of the stamped PDF.
 */
export async function stampExecutedPdf(bytes, contentType) {
  const logoBytes = await fetchLogoBytes()
  let doc

  if (/^image\//.test(contentType || '')) {
    // A photo/scan image: wrap it into a letter-sized PDF page, then stamp.
    doc = await PDFDocument.create()
    const img = /png$/i.test(contentType)
      ? await doc.embedPng(bytes)
      : await doc.embedJpg(bytes)
    const pageW = 612
    const pageH = 792
    const scale = Math.min(pageW / img.width, pageH / img.height)
    const w = img.width * scale
    const h = img.height * scale
    const page = doc.addPage([pageW, pageH])
    page.drawImage(img, { x: (pageW - w) / 2, y: (pageH - h) / 2, width: w, height: h })
  } else {
    doc = await PDFDocument.load(bytes, { ignoreEncryption: true })
  }

  const font = await doc.embedFont(StandardFonts.HelveticaBold)
  let logoImg = null
  if (logoBytes) {
    try { logoImg = await doc.embedPng(logoBytes) } catch { logoImg = null }
  }
  for (const page of doc.getPages()) drawStamp(page, font, logoImg)

  const out = await doc.save()
  return new Blob([out], { type: 'application/pdf' })
}
