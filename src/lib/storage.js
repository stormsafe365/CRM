// Storage helpers for quote PDFs.
// Uses Supabase Storage with a private bucket (signed URLs for viewing).
// All quote PDFs go into the 'quote-pdfs' bucket, namespaced by client.

import { supabase } from './supabase'

const BUCKET = 'quote-pdfs'

// Uploads a PDF file. Returns the storage path on success.
// Path format: <client_id>/<timestamp>-<original_filename>
// Timestamp prefix prevents filename collisions.
export async function uploadQuotePdf(clientId, file) {
  if (!file) return null
  const safeName = file.name.replace(/[^a-zA-Z0-9.-]/g, '_')
  const path = `${clientId}/${Date.now()}-${safeName}`

  const { error } = await supabase.storage
    .from(BUCKET)
    .upload(path, file, {
      cacheControl: '3600',
      upsert: false,
      contentType: file.type || 'application/pdf',
    })

  if (error) throw error
  return path
}

// Uploads a generated PDF Blob (from the embedded quote builder). Same path
// convention as uploadQuotePdf. Returns the storage path.
export async function uploadQuotePdfBlob(clientId, blob, filename) {
  if (!blob) return null
  const safeName = (filename || 'quote.pdf').replace(/[^a-zA-Z0-9.-]/g, '_')
  const path = `${clientId}/${Date.now()}-${safeName}`
  const { error } = await supabase.storage
    .from(BUCKET)
    .upload(path, blob, { cacheControl: '3600', upsert: false, contentType: 'application/pdf' })
  if (error) throw error
  return path
}

// Generates a temporary signed URL (60 min) for viewing a PDF.
// We don't store signed URLs — they expire. We store the storage path
// and generate a fresh signed URL each time the user clicks "View PDF."
export async function getQuotePdfSignedUrl(path) {
  if (!path) return null
  const { data, error } = await supabase.storage
    .from(BUCKET)
    .createSignedUrl(path, 3600)
  if (error) throw error
  return data.signedUrl
}

// Deletes a PDF from storage. Used when deleting a quote.
export async function deleteQuotePdf(path) {
  if (!path) return
  await supabase.storage.from(BUCKET).remove([path])
}

// ---- Document Hub (per-client files by category) ----
// Reuses the same private bucket, namespaced by client + category:
//   <clientId>/<category>/<timestamp>-<filename>
// category ∈ 'quote' | 'contract' | 'rendering'

export async function uploadClientDoc(clientId, category, file) {
  const safe = file.name.replace(/[^a-zA-Z0-9.-]/g, '_')
  const path = `${clientId}/${category}/${Date.now()}-${safe}`
  const { error } = await supabase.storage
    .from(BUCKET)
    .upload(path, file, { cacheControl: '3600', upsert: false, contentType: file.type || undefined })
  if (error) throw error
  return path
}

// Upload a generated Blob (quote PDF, contract PDF, rendering image) into a
// Document Hub category folder, so it shows up in that category automatically.
// category ∈ 'quote' | 'contract' | 'rendering' | ...
export async function uploadClientDocBlob(clientId, category, blob, filename, contentType) {
  if (!blob) return null
  const safe = (filename || `${category}.pdf`).replace(/[^a-zA-Z0-9.-]/g, '_')
  const path = `${clientId}/${category}/${Date.now()}-${safe}`
  const { error } = await supabase.storage
    .from(BUCKET)
    .upload(path, blob, { cacheControl: '3600', upsert: false, contentType: contentType || blob.type || 'application/octet-stream' })
  if (error) throw error
  return path
}

export async function listClientDocs(clientId, category) {
  const { data, error } = await supabase.storage
    .from(BUCKET)
    .list(`${clientId}/${category}`, { sortBy: { column: 'created_at', order: 'desc' } })
  if (error) throw error
  return (data ?? [])
    .filter(f => f.name && f.name !== '.emptyFolderPlaceholder')
    .map(f => ({
      name: f.name,
      path: `${clientId}/${category}/${f.name}`,
      label: f.name.replace(/^\d+-/, ''),
      createdAt: f.created_at || f.updated_at || null,
      size: f.metadata?.size ?? null,
    }))
}

export async function getDocSignedUrl(path) {
  const { data, error } = await supabase.storage.from(BUCKET).createSignedUrl(path, 3600)
  if (error) throw error
  return data.signedUrl
}

// ---- Company-wide Document Hub ----
// Walks storage top-down: the bucket root lists only client folders that
// actually have files (empty leads never appear), so this scales with the
// number of document-bearing clients, not the whole client list.
const DOC_CATS = ['quote', 'contract', 'rendering', 'layout', 'revisions', 'additional']

function mkDoc(clientId, cat, f, path) {
  return {
    clientId,
    cat,
    path,
    name: f.name,
    label: f.name.replace(/^\d+-/, ''),
    createdAt: f.created_at || f.updated_at || null,
    size: f.metadata?.size ?? null,
    mime: f.metadata?.mimetype || '',
  }
}

export async function listAllDocs() {
  const root = await supabase.storage.from(BUCKET).list('', { limit: 2000 })
  if (root.error) throw root.error
  // Folders come back with a null id; files have an id. Client folders are the
  // null-id entries at the root.
  const clientIds = (root.data ?? [])
    .filter(e => e.id === null && e.name && e.name !== '.emptyFolderPlaceholder')
    .map(e => e.name)

  const perClient = await Promise.all(clientIds.map(async (cid) => {
    const lvl = await supabase.storage.from(BUCKET).list(cid, { limit: 2000 })
    if (lvl.error) return []
    const entries = lvl.data ?? []
    const out = []
    // Legacy loose quote PDFs sit directly under <clientId> (no category folder).
    for (const f of entries) {
      if (f.id !== null && f.name && f.name !== '.emptyFolderPlaceholder') {
        out.push(mkDoc(cid, 'quote', f, `${cid}/${f.name}`))
      }
    }
    // Category subfolders (null-id entries whose name is a known category).
    const subCats = entries.filter(e => e.id === null && DOC_CATS.includes(e.name)).map(e => e.name)
    const catLists = await Promise.all(subCats.map(async (cat) => {
      const r = await supabase.storage.from(BUCKET)
        .list(`${cid}/${cat}`, { limit: 2000, sortBy: { column: 'created_at', order: 'desc' } })
      return (r.data ?? [])
        .filter(f => f.name && f.name !== '.emptyFolderPlaceholder')
        .map(f => mkDoc(cid, cat, f, `${cid}/${cat}/${f.name}`))
    }))
    catLists.forEach(l => out.push(...l))
    return out
  }))

  return perClient.flat()
}

export async function deleteDoc(path) {
  const { error } = await supabase.storage.from(BUCKET).remove([path])
  if (error) throw error
  return true
}
