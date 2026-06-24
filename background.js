// VAESA Extension v3.0.0 — service worker.
//
// Port verbatim từ Retion 0.2.3.1 (EXT-0.2.3.1).
// Source: chrome-extension/src/background/background/facebook/{user,client,page}.ts
//
// Flow gửi tin >24h:
//   1. Webapp postMessage SEND_FB → content.js → background
//   2. Background.calcGlobalUid(pageId, threadId, lastMessageMs)
//      ├─ Check IndexedDB cache (90 ngày)
//      ├─ Cache miss → POST FB GraphQL graphqlbatch
//      │  doc_id 5947328892029037, limit:1, before: lastMessageMs+1000
//      ├─ Match thread.page_comm_item.comm_source_id === threadId
//      └─ Extract messaging_actor.id = global UID
//   3. Background.sendText / sendFile via business.facebook.com/messaging/send
//   4. Trả response về webapp

// ============== CONSTANTS ==============

const FB_ME_URL = 'https://www.facebook.com/me'
const FB_GRAPHQL_URL = 'https://www.facebook.com/api/graphqlbatch'
const FB_SEND_URL = 'https://business.facebook.com/messaging/send'
const FB_UPLOAD_URL = 'https://upload-business.facebook.com/ajax/mercury/upload.php'
const DOC_ID_MESSAGE = '5947328892029037'

// VAESA backend (Cloudflare Pages Functions + D1) — port kiến trúc Retion `chatbox-merge-v2.botbanhang.vn`
// nhưng đặt cùng domain với webapp để KH tự host (không phụ thuộc bên thứ 3).
const VAESA_BE_BASE = 'https://vaesa-livechat.pages.dev/api/fb-uid'

const DTSG_TTL_MS = 30 * 60 * 1000          // 30 phút (Retion dùng 30s, em nâng lên 30 phút cho VAESA real-time)
const UID_CACHE_TTL_MS = 90 * 24 * 60 * 60 * 1000  // 90 ngày (giống Retion)

const FB_ORIGINS_TO_REWRITE = [
  'https://m.facebook.com',
  'https://p-upload.facebook.com',
  'https://business.facebook.com',
  'https://upload.facebook.com',
  'https://www.facebook.com',
  'https://mbasic.facebook.com',
  'https://upload-business.facebook.com',
]

console.log('[VAESA Extension v3] service worker started')

// ============== DNR: rewrite Origin/Referer for FB requests ==============
// Port từ Retion origin.ts. Khi BG fetch FB → tự rewrite Origin/Referer = host của URL → bypass CORS.
function _installDnrRules() {
  let ruleId = 1
  const rules = FB_ORIGINS_TO_REWRITE.map((url) => ({
    id: ruleId++,
    action: {
      type: 'modifyHeaders',
      requestHeaders: [
        { header: 'Referer', operation: 'set', value: `${url}/` },
        { header: 'Origin', operation: 'set', value: url },
      ],
    },
    condition: {
      initiatorDomains: [chrome.runtime.id],
      urlFilter: `|${url}/`,
      resourceTypes: ['xmlhttprequest', 'websocket'],
    },
  }))
  // (Đã gỡ rule DNR Origin cho WS edge-chat 2026-06-16 — tầng MQTT/WS bỏ hẳn, không còn WS để rewrite.)
  chrome.declarativeNetRequest.getDynamicRules().then((existing) => {
    chrome.declarativeNetRequest.updateDynamicRules({
      removeRuleIds: existing.map(r => r.id),
      addRules: rules,
    }).then(() => console.log('[VAESA Bridge] DNR rules installed:', rules.length))
      .catch((e) => console.error('[VAESA Bridge] DNR install fail:', e?.message || e))
  })
}
chrome.runtime.onInstalled.addListener(_installDnrRules)
// onInstalled không fire khi service worker chỉ wake lại — gọi luôn để chắc chắn có rule.
_installDnrRules()

// ============== DNR: Referer ĐÚNG TRANG cho lệnh messaging/send (clone Pancake) ==============
// Pancake gọi va.set(sendUrl, makeInboxViewUrl(pageId)) trước mỗi send → Referer = URL hộp thư
// của trang. VAESA trước đây để rule generic set Referer = root → FB chặn 1404132. Rule này
// priority cao hơn rule generic nên thắng riêng cho /messaging/send. Cache theo pageId (referer
// chỉ phụ thuộc pageId) → không cập nhật DNR mỗi tin.
let _sendRefererPageId = null
const SEND_REFERER_RULE_ID = 9001
async function setSendReferer(pageId) {
  if (!pageId || _sendRefererPageId === String(pageId)) return
  const referer = `https://business.facebook.com/latest/inbox/messenger?asset_id=${encodeURIComponent(pageId)}&nav_ref=diode_page_inbox`
  try {
    await chrome.declarativeNetRequest.updateSessionRules({
      removeRuleIds: [SEND_REFERER_RULE_ID],
      addRules: [{
        id: SEND_REFERER_RULE_ID,
        priority: 100, // > rule generic (default 1) → thắng cho /messaging/send
        action: {
          type: 'modifyHeaders',
          requestHeaders: [
            { header: 'Referer', operation: 'set', value: referer },
            { header: 'Origin', operation: 'set', value: 'https://business.facebook.com' },
          ],
        },
        condition: {
          initiatorDomains: [chrome.runtime.id],
          urlFilter: '|https://business.facebook.com/messaging/send',
          resourceTypes: ['xmlhttprequest'],
        },
      }],
    })
    _sendRefererPageId = String(pageId)
    console.log('[VAESA Bridge] setSendReferer OK → Referer=inbox page', pageId)
  } catch (e) {
    console.warn('[VAESA Bridge] setSendReferer fail:', e?.message || e)
  }
}

// ============== FACEBOOK USER: scrape fb_dtsg/lsd/c_user ==============
// Port từ Retion user.ts

const _fbUser = {
  dtsg: null,
  lsd: null,
  currentUID: null,
  ttl: 0,
}

async function loadDtsg() {
  const html = await fetch(FB_ME_URL, {
    credentials: 'include',
    headers: {
      accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8',
      'accept-language': 'en-US,en;q=0.9',
    },
  }).then(r => r.text())

  // 3 regex thử tuần tự (port verbatim Retion)
  const dtsg =
    html.match(/name="fb_dtsg" value="([^"]+)"/i)?.[1] ||
    html.match(/\["DTSGInitialData"\,\[\]\,\{"token"\:"([^"]+)"/i)?.[1] ||
    html.match(/{"dtsg":{"token":"([^"]+)"/i)?.[1]

  const lsd =
    html.match(/name="lsd" value="([^"]+)"/i)?.[1] ||
    html.match(/\["LSD"\,\[\]\,\{"token"\:"([^"]+)"/i)?.[1]

  const uid = html.match(/"ACCOUNT_ID"\s*:\s*"(\d+)"/)?.[1]

  if (!dtsg) throw new Error('Không scrape được fb_dtsg — Anh chưa đăng nhập FB?')

  _fbUser.dtsg = dtsg
  _fbUser.lsd = lsd
  _fbUser.currentUID = uid
  _fbUser.ttl = Date.now() + DTSG_TTL_MS

  console.log('[VAESA Bridge] dtsg loaded, uid:', uid)
}

async function getDtsg() {
  if (_fbUser.ttl > Date.now() && _fbUser.dtsg) return _fbUser.dtsg
  await loadDtsg()
  return _fbUser.dtsg
}

async function getCurrentUid() {
  if (_fbUser.ttl > Date.now() && _fbUser.currentUID) return _fbUser.currentUID
  await loadDtsg()
  return _fbUser.currentUID
}

// ============== UID CACHE (IndexedDB) ==============
// Port từ Retion indexedDbHelper.js (chrome-extension/src/content/indexedDbHelper.js).
// Adapted cho SW context: dùng `self.indexedDB`. Store `global_user_ids`,
// keyPath: [pageId, threadId], TTL 90 ngày.
// Fallback chrome.storage.local nếu IDB unavailable (vd test env).

const IDB_DB_NAME = 'vaesa_fb_meta'
const IDB_DB_VERSION = 1
const IDB_STORE = 'global_user_ids'
let _idbPromise = null

function openIdb() {
  if (_idbPromise) return _idbPromise
  _idbPromise = new Promise((resolve, reject) => {
    try {
      if (typeof self === 'undefined' || !self.indexedDB) return reject(new Error('IndexedDB unavailable'))
      const req = self.indexedDB.open(IDB_DB_NAME, IDB_DB_VERSION)
      req.onupgradeneeded = (e) => {
        const db = e.target.result
        if (!db.objectStoreNames.contains(IDB_STORE)) {
          const store = db.createObjectStore(IDB_STORE, { keyPath: ['pageId', 'threadId'] })
          store.createIndex('insertedAt_index', 'insertedAt', { unique: false })
        }
      }
      req.onsuccess = () => resolve(req.result)
      req.onerror = () => reject(req.error || new Error('IDB open fail'))
    } catch (e) {
      reject(e)
    }
  }).catch((e) => {
    console.warn('[VAESA Bridge] IDB unavailable, fallback chrome.storage:', e?.message || e)
    return null
  })
  return _idbPromise
}

async function idbGet(pageId, threadId) {
  try {
    const db = await openIdb()
    if (!db) return null
    return await new Promise((resolve) => {
      const tx = db.transaction(IDB_STORE, 'readonly')
      const req = tx.objectStore(IDB_STORE).get([String(pageId), String(threadId)])
      req.onsuccess = () => resolve(req.result || null)
      req.onerror = () => resolve(null)
    })
  } catch { return null }
}

async function idbPut(pageId, threadId, globalUid) {
  try {
    const db = await openIdb()
    if (!db) return
    await new Promise((resolve) => {
      const tx = db.transaction(IDB_STORE, 'readwrite')
      const req = tx.objectStore(IDB_STORE).put({
        pageId: String(pageId),
        threadId: String(threadId),
        globalUid,
        insertedAt: Math.floor(Date.now() / 1000),
      })
      req.onsuccess = () => resolve()
      req.onerror = () => resolve()
    })
  } catch (e) {
    console.warn('[VAESA Bridge] idbPut fail:', e?.message)
  }
}

async function idbClear() {
  try {
    const db = await openIdb()
    if (!db) return 0
    return await new Promise((resolve) => {
      let count = 0
      const tx = db.transaction(IDB_STORE, 'readwrite')
      const store = tx.objectStore(IDB_STORE)
      const cur = store.openCursor()
      cur.onsuccess = () => {
        const c = cur.result
        if (c) { count++; c.delete(); c.continue() }
        else resolve(count)
      }
      cur.onerror = () => resolve(count)
    })
  } catch { return 0 }
}

// Purge entries older than 90 ngày (chạy mỗi lần SW boot)
async function idbPurgeExpired() {
  try {
    const db = await openIdb()
    if (!db) return
    const cutoff = Math.floor(Date.now() / 1000) - 90 * 24 * 60 * 60
    await new Promise((resolve) => {
      const tx = db.transaction(IDB_STORE, 'readwrite')
      const idx = tx.objectStore(IDB_STORE).index('insertedAt_index')
      const cur = idx.openCursor(IDBKeyRange.upperBound(cutoff))
      cur.onsuccess = () => {
        const c = cur.result
        if (c) { c.delete(); c.continue() } else resolve()
      }
      cur.onerror = () => resolve()
    })
  } catch (e) {}
}

// Schedule purge on SW boot (non-blocking)
idbPurgeExpired()

async function getCachedUid(pageId, threadId) {
  const row = await idbGet(pageId, threadId)
  if (!row?.globalUid) return null
  const ageMs = Date.now() - (row.insertedAt || 0) * 1000
  if (ageMs > UID_CACHE_TTL_MS) return null
  return row.globalUid
}

async function setCachedUid(pageId, threadId, globalUid) {
  await idbPut(pageId, threadId, globalUid)
}

// ============== CALC GLOBAL UID ==============
// Port từ Retion FacebookClient.#exchangeClientUid()
// 1 GraphQL call: limit:1, before:lastMessageMs+1000 → match comm_source_id === threadId → messaging_actor.id

// Gọi 1 batch FB GraphQL với cursor `before` (ms). Trả về { threads, oldestTime }
async function fetchThreadBatch(pageId, beforeMs, limit) {
  const dtsg = await getDtsg()
  const params = new URLSearchParams({
    batch_name: 'MessengerGraphQLThreadlistFetcher',
    av: pageId,
    fb_dtsg: dtsg,
    queries: JSON.stringify({
      o0: {
        doc_id: DOC_ID_MESSAGE,
        query_params: { limit, before: beforeMs },
      },
    }),
  })
  const res = await fetch(FB_GRAPHQL_URL, {
    method: 'POST',
    credentials: 'include',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: params,
  })
  if (!res.ok) throw new Error('FB GraphQL HTTP ' + res.status)
  let text = await res.text()
  if (text.includes('errorSummary')) {
    if (text.includes('Query Rate Limit Exceeded')) throw new Error('FB rate limit')
    if (text.includes('Sorry, something went wrong')) throw new Error('FB something went wrong')
    throw new Error('FB error: ' + text.slice(0, 200))
  }
  text = text
    .replace('{"successful_results":1,"error_results":0,"skipped_results":0}', '')
    .replace('{"successful_results":0,"error_results":1,"skipped_results":0}', '')
  const json = JSON.parse(text)
  const threads = json?.o0?.data?.viewer?.message_threads?.nodes || []
  const oldestTime = threads.length
    ? parseInt(threads[threads.length - 1].updated_time_precise) || 0
    : 0
  return { threads, oldestTime }
}

function extractUidFromThread(t) {
  // FB từ ~2026-05 trả all_participants rỗng cho thread 1:1 page↔khách.
  // UID khách lúc đó chỉ còn ở thread_key.other_user_id (góc nhìn av=pageId).
  return t?.all_participants?.nodes?.[0]?.messaging_actor?.id ||
         t?.all_participants?.edges?.[0]?.node?.messaging_actor?.id ||
         (t?.thread_key?.other_user_id ? String(t.thread_key.other_user_id) : undefined)
}

// Trả về thread identifier KHỚP với Pancake.thread_id (15-digit Mercury raw thread fbid).
// Test thực tế Đức Nguyễn (2026-05-16): Pancake.thread_id = thread_key.thread_fbid, ≠ comm_source_id.
// → ƯU TIÊN thread_fbid, fallback comm_source_id (legacy).
function extractCommIdFromThread(t) {
  return t?.thread_key?.thread_fbid || t?.page_comm_item?.comm_source_id
}

// Khớp 1 FB thread với 1 conv Pancake.
// FB có 2 mã: thread_key.thread_fbid (↔ Pancake thread_id) và
//             page_comm_item.comm_source_id (↔ Pancake thread_key bỏ 't_').
// FB từ ~2026-05 trả thread_fbid = null → BẮT BUỘC khớp được qua comm_source_id ↔ thread_key.
function threadMatchesConv(t, threadId, threadKey) {
  const fbFbid = t?.thread_key?.thread_fbid
  const fbComm = t?.page_comm_item?.comm_source_id
  if (fbFbid && threadId && String(fbFbid) === String(threadId)) return true
  if (fbComm && threadKey) {
    if (String(fbComm) === String(threadKey).replace(/^t_/, '')) return true
  }
  return false
}

// ============== VAESA BACKEND HELPERS ==============
// Gọi Cloudflare Pages Functions /api/fb-uid/* — port logic Retion REQUEST_SERVER
// nhưng KHÔNG cần Authorization (BE chấp nhận CORS open + dữ liệu không nhạy cảm).

async function beGet(path, params = {}) {
  const url = new URL(`${VAESA_BE_BASE}/${path}`)
  for (const k of Object.keys(params)) url.searchParams.set(k, params[k])
  const res = await fetch(url.toString(), { method: 'GET' })
  if (!res.ok) throw new Error(`BE ${path} HTTP ${res.status}`)
  return await res.json()
}

async function bePost(path, body) {
  const res = await fetch(`${VAESA_BE_BASE}/${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
  if (!res.ok) throw new Error(`BE ${path} HTTP ${res.status}`)
  return await res.json()
}

// Lấy meta authoritative từ BE — đây là SOURCE OF TRUTH (giống Retion's get_meta_conversation_info)
async function beGetMeta(pageId, threadId) {
  try {
    const r = await bePost('get-meta', { page_id: pageId, thread_id: threadId })
    if (r?.ok && r?.hit && r?.row) return r.row
    return null
  } catch (e) {
    console.warn('[VAESA Bridge] BE get-meta fail (sẽ fallback FB):', e?.message || e)
    return null
  }
}

// Đẩy raw conversation lên BE (giống Retion's app/ext/sync_fb_uid)
async function beSyncRaw(pageId, threads) {
  try {
    const r = await bePost('sync', { page_id: pageId, threads })
    if (!r?.ok) console.warn('[VAESA Bridge] BE sync fail:', r?.error)
    return r
  } catch (e) {
    console.warn('[VAESA Bridge] BE sync exception:', e?.message || e)
    return { ok: false }
  }
}

// Chuyển 1 FB raw thread object → row chuẩn để gửi BE
function threadToRow(t) {
  const threadId = t?.page_comm_item?.comm_source_id || t?.thread_key?.thread_fbid
  if (!threadId) return null
  const actor = t?.all_participants?.nodes?.[0]?.messaging_actor
             || t?.all_participants?.edges?.[0]?.node?.messaging_actor
  const threadKey = (typeof t?.thread_key === 'string')
    ? t.thread_key
    : (t?.thread_key?.thread_fbid ? `t_${t.thread_key.thread_fbid}` : null)
  const updatedMs = parseInt(t?.updated_time_precise) || 0
  if (!updatedMs) return null
  // all_participants có thể rỗng → fallback thread_key.other_user_id (xem extractUidFromThread).
  const clientUid = actor?.id || t?.thread_key?.other_user_id
  return {
    thread_id: String(threadId),
    client_uid: clientUid ? String(clientUid) : null,
    thread_key: threadKey,
    customer_name: actor?.name || null,
    updated_time_ms: updatedMs,
  }
}

// Ghi UID vừa resolve vào D1 ĐÚNG theo threadId Pancake — khoá mà chip + gửi tin tra cứu.
// BẮT BUỘC ghi riêng: threadToRow khoá row theo comm_source_id (≠ Pancake thread_id) nên
// row nó đẩy lên không bao giờ update được row Pancake → UID resolve xong mà D1 vẫn rỗng.
// Trả PROMISE để caller AWAIT — SW MV3 bị Chrome tắt ngay sau khi handler return; nếu ghi D1
// fire-and-forget (không await) thì POST chết giữa chừng → "quét xong mà không lưu" → F5 quét lại.
function beSaveResolvedUid(pageId, threadId, threadKey, uid, updatedMs) {
  return bePost('sync', { page_id: pageId, threads: [{
    thread_id: String(threadId),
    client_uid: String(uid),
    thread_key: threadKey || null,
    customer_name: null,
    updated_time_ms: updatedMs || 1,
  }] }).catch(() => {})
}

// Lấy UID khách — MỘT đường sạch (đúng cơ chế Pancake):
//   1. Cache IDB — đã quét trước đó.
//   2. D1 — kho lưu UID đã quét (conv Pancake không cấp sẵn UID → bấm avatar quét → lưu D1).
//   3. resolveUidByName — quét threadlist kiểu Pancake (ge.findThread): khớp threadId/tên,
//      cascade INBOX→ARCHIVED. Quét được → lưu D1 + cache cho lần sau.
// Đã BỎ: cursor-query + paginate-scan params-tối-giản (code cũ thời Retion — FB trả
// thiếu all_participants nên hay sai). Pancake chỉ có findThread, không có 2 thứ kia.
async function calcGlobalUid({ pageId, threadId, threadKey, lastMessageMs, customerName }) {
  if (!pageId) throw new Error('Thiếu pageId')
  if (!threadId && !customerName) throw new Error('Thiếu threadId/customerName')

  // 1. Cache IDB
  if (threadId) {
    const cached = await getCachedUid(pageId, threadId)
    if (cached) return cached
  }

  // 2. D1 — kho UID đã quét
  let convThreadKey = threadKey || ''
  if (threadId) {
    const beRow = await beGetMeta(pageId, threadId)
    if (beRow?.client_uid) {
      await setCachedUid(pageId, threadId, beRow.client_uid)
      console.log(`[VAESA Bridge] UID OK (D1): page=${pageId} thread=${threadId} → ${beRow.client_uid}`)
      return beRow.client_uid
    }
    convThreadKey = convThreadKey || beRow?.thread_key || ''
  }

  // 3. Quét kiểu Pancake (findThread) — khớp threadId hoặc tên khách.
  const uid = await resolveUidByName({
    pageId, customerName, threadId, threadKey: convThreadKey,
    convUpdatedMs: lastMessageMs,
  })
  if (!uid) throw new Error('Không quét được UID khách')
  if (threadId) await setCachedUid(pageId, threadId, uid)
  await beSaveResolvedUid(pageId, threadId || customerName, convThreadKey, uid, lastMessageMs || Date.now())
  console.log(`[VAESA Bridge] UID OK (findThread): page=${pageId} thread=${threadId || customerName} → ${uid}`)
  return uid
}

// ============== INITIAL SYNC (Phase 1) ==============
// Port từ Retion SYNC_FB_UID_V2 — quét toàn bộ thread của 1 page, đẩy lên BE D1.
// Resumable: state lưu trên BE, lần sau chạy tiếp từ cursor đã lưu.
//
// Anti rate-limit: delay 2s/batch, retry 2 phút khi FB chặn (giống Retion).

const SYNC_BATCH_LIMIT = 100         // threads per batch (giống Retion LIMIT)
const SYNC_BATCH_DELAY_MS = 2000     // 2s giữa batches
const SYNC_RATE_LIMIT_RETRY_MS = 2 * 60 * 1000  // 2 phút khi bị block
const SYNC_MAX_BATCHES = 500         // safety: ~50k thread per page

const _syncStateInFlight = {}        // pageId → boolean (tránh chạy đồng thời)

async function runInitialSync({ pageId, onProgress }) {
  if (!pageId) throw new Error('Thiếu pageId')
  if (_syncStateInFlight[pageId]) {
    return { ok: false, error: 'Sync đang chạy cho page này, đợi xong rồi chạy lại' }
  }
  _syncStateInFlight[pageId] = true

  try {
    // 1. Đọc state cũ từ BE → resume nếu có cursor dở
    let state
    try {
      const r = await beGet('sync-state', { page_id: pageId })
      state = r?.state
    } catch (e) {
      console.warn('[VAESA Bridge] read sync-state fail (sẽ tạo mới):', e?.message)
    }

    let cursorBefore = state?.last_cursor_before_ms || (Date.now() + 86400000)
    let totalSynced = state?.total_synced || 0

    await bePost('sync-state', { page_id: pageId, status: 'running', error_message: null })

    const broadcastProgress = (extra = {}) => {
      try {
        chrome.runtime.sendMessage({
          source: 'vaesa-bridge',
          event: 'SYNC_FB_UID_PROGRESS',
          pageId,
          total_synced: totalSynced,
          cursor_before_ms: cursorBefore,
          ...extra,
        }).catch(() => {})
      } catch {}
      if (typeof onProgress === 'function') {
        try { onProgress({ totalSynced, cursorBefore, ...extra }) } catch {}
      }
    }

    let batchIdx = 0
    let consecutiveEmpty = 0

    while (batchIdx < SYNC_MAX_BATCHES) {
      let result
      try {
        result = await fetchThreadBatch(pageId, cursorBefore, SYNC_BATCH_LIMIT)
      } catch (e) {
        const msg = e?.message || String(e)
        if (msg.includes('rate limit') || msg.includes('something went wrong')) {
          broadcastProgress({ rate_limited: true })
          console.warn(`[VAESA Bridge] Rate limit batch ${batchIdx} — đợi 2 phút retry`)
          await new Promise(r => setTimeout(r, SYNC_RATE_LIMIT_RETRY_MS))
          continue
        }
        // Lỗi khác: dừng + lưu error
        await bePost('sync-state', { page_id: pageId, status: 'error', error_message: msg }).catch(() => {})
        broadcastProgress({ error: msg })
        throw e
      }

      const { threads, oldestTime } = result
      if (!threads.length) {
        consecutiveEmpty++
        if (consecutiveEmpty >= 2) break
      } else {
        consecutiveEmpty = 0
      }

      // Đẩy raw lên BE (BE tự parse + upsert atomic)
      if (threads.length) {
        try {
          await bePost('sync', { page_id: pageId, raw_conversation: { o0: { data: { viewer: { message_threads: { nodes: threads } } } } } })
          totalSynced += threads.length
        } catch (e) {
          console.warn(`[VAESA Bridge] BE sync batch ${batchIdx} fail:`, e?.message)
        }
      }

      // Cache IDB cũng song song
      for (const t of threads) {
        const cs = extractCommIdFromThread(t)
        const uid = extractUidFromThread(t)
        if (cs && uid) await setCachedUid(pageId, cs, uid)
      }

      // Next cursor = thread cuối cùng (oldest in batch)
      if (oldestTime && oldestTime !== cursorBefore) {
        cursorBefore = oldestTime
      } else {
        // không tiến được nữa (FB cap pagination)
        break
      }

      // Lưu state để resume
      await bePost('sync-state', {
        page_id: pageId,
        status: 'running',
        last_cursor_before_ms: cursorBefore,
        total_synced: totalSynced,
      }).catch(() => {})

      broadcastProgress({})
      batchIdx++

      // Delay anti rate-limit
      await new Promise(r => setTimeout(r, SYNC_BATCH_DELAY_MS))
    }

    await bePost('sync-state', { page_id: pageId, status: 'done', total_synced: totalSynced }).catch(() => {})
    broadcastProgress({ done: true })
    console.log(`[VAESA Bridge] Initial sync xong page=${pageId}: ${totalSynced} threads trong ${batchIdx} batches`)
    return { ok: true, total_synced: totalSynced, batches: batchIdx }
  } finally {
    _syncStateInFlight[pageId] = false
  }
}

// ============== COMMENT GLOBAL ID RESOLVER (Phase 1C) ==============
// Port từ Pancake pancake_business_logic.js getGlobalIdFromComment.
// Conv bình luận: tải HTML post FB → tìm comment theo legacy_fbid → lấy author.id (UID thật).
// Bình luận KHÔNG vướng giới hạn 334 của messenger threadlist.

// Trích 1 object JSON cân ngoặc bắt đầu từ vị trí ký tự '{' tại `start`.
// Port logic BracketStack — bỏ qua ngoặc nằm trong chuỗi.
function extractBalancedJson(str, start) {
  let depth = 0, inStr = false, esc = false
  for (let i = start; i < str.length; i++) {
    const c = str[i]
    if (inStr) {
      if (esc) esc = false
      else if (c === '\\') esc = true
      else if (c === '"') inStr = false
    } else {
      if (c === '"') inStr = true
      else if (c === '{') depth++
      else if (c === '}') { depth--; if (depth === 0) return str.slice(start, i + 1) }
    }
  }
  return null
}

// Duyệt đệ quy object đã parse, tìm node bình luận có legacy_fbid/id khớp → trả author.id.
function findCommentAuthorIdDeep(obj, commentId, depth = 0) {
  if (!obj || typeof obj !== 'object' || depth > 45) return null
  if ((obj.legacy_fbid != null && String(obj.legacy_fbid) === commentId) ||
      (obj.id != null && String(obj.id) === commentId)) {
    const a = obj.author
    if (a?.id) return String(a.id)
  }
  for (const k in obj) {
    const v = obj[k]
    if (v && typeof v === 'object') {
      const r = findCommentAuthorIdDeep(v, commentId, depth + 1)
      if (r) return r
    }
  }
  return null
}

// Resolve UID khách từ 1 bình luận.
//   postId       — Pancake conv.post_id (dạng "{owner}_{postLegacy}") — có thể null
//   commentId    — comment legacy id (= Pancake conv.id phần sau '_')
//   customerName — tên khách (= Pancake `convName`). Dùng cho CÁCH 3
//                  searchCommentByUserName — cách ƯU TIÊN của Pancake `Oe.getComment`.
async function resolveCommentGlobalId({ postId, commentId, customerName }) {
  if (!commentId) throw new Error('Thiếu commentId')
  const commentShort = String(commentId).includes('_')
    ? String(commentId).split('_').pop()
    : String(commentId)
  const postShort = postId && String(postId).includes('_')
    ? String(postId).split('_').pop()
    : (postId ? String(postId) : null)

  // CÁCH 1 — port Pancake getGlobalIdFromLiveComment (cách Pancake ƯU TIÊN cho comment):
  // tải trang m.facebook.com của bài viết kèm comment_id; avatar người bình luận nằm
  // trong phần tử `data-sigil="feed_story_ring{UID}"` → bắt thẳng UID. m.facebook HTML
  // nhẹ + ổn định hơn www nên Pancake thử cách này trước.
  if (postShort) {
    try {
      const mRes = await fetch(`https://m.facebook.com/${postShort}?comment_id=${commentShort}`, {
        credentials: 'include',
        headers: {
          accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
          'accept-language': 'en-US,en;q=0.9',
        },
      })
      if (mRes.ok) {
        const mHtml = await mRes.text()
        const ring = mHtml.match(/data-sigil="comment">[\s\S]*?data-sigil="feed_story_ring(\d+)/)
        if (ring) return String(ring[1])

        // CÁCH 1b — port nhánh fallback của getGlobalIdFromLiveComment: nếu regex
        // feed_story_ring trượt, Pancake quét mọi khối JSON `"comments":` trong CÙNG
        // HTML m.facebook, tìm edge có node.legacy_token khớp conv rồi lấy node.author.id.
        const CMARK = '"comments":'
        let from = 0
        for (;;) {
          const ci = mHtml.indexOf(CMARK, from)
          if (ci < 0) break
          from = ci + CMARK.length
          if (mHtml[from] !== '{') continue
          const objStr = extractBalancedJson(mHtml, from)
          if (!objStr) continue
          let parsed
          try { parsed = JSON.parse(objStr) } catch { continue }
          const edges = Array.isArray(parsed?.edges) ? parsed.edges : []
          // Pancake so legacy_token == convId đầy đủ; VAESA chỉ có commentShort nên
          // khớp khi legacy_token kết thúc bằng comment id đó (id comment là duy nhất).
          const hit = edges.find((f) => {
            const lt = String(f?.node?.legacy_token || '')
            return lt === commentShort || lt.endsWith('_' + commentShort)
          })
          const uid = hit?.node?.author?.id
          if (uid) return String(uid)
        }
      }
    } catch (e) {
      // m.facebook lỗi → rơi xuống cách www.facebook bên dưới
    }
  }

  // CÁCH 2 — www.facebook.com HTML (port getGlobalIdFromComment). Ưu tiên post +
  // comment_id (FB load đúng comment vào context); fallback chỉ comment id.
  const url = postShort
    ? `https://www.facebook.com/${postShort}?comment_id=${commentShort}`
    : `https://www.facebook.com/${commentShort}`

  const res = await fetch(url, {
    credentials: 'include',
    headers: {
      accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
      'accept-language': 'en-US,en;q=0.9',
    },
  })
  if (!res.ok) throw new Error('FB post HTTP ' + res.status)
  const html = await res.text()

  // Cách 1: regex thẳng — tìm vị trí legacy_fbid của comment rồi bắt author.id gần đó.
  // Node comment FB: {"author":{"__typename":"User","id":"<UID>",...},..."legacy_fbid":"<cmt>"...}
  const marker = `"legacy_fbid":"${commentShort}"`
  let idx = html.indexOf(marker)
  if (idx > -1) {
    // author thường đứng TRƯỚC legacy_fbid trong cùng node → quét ngược ~4000 ký tự
    const back = html.slice(Math.max(0, idx - 4000), idx)
    const authorMatches = [...back.matchAll(/"author":\{[^{}]*?"id":"(\d+)"/g)]
    if (authorMatches.length) return String(authorMatches[authorMatches.length - 1][1])
    // hoặc author đứng sau
    const fwd = html.slice(idx, idx + 4000)
    const fm = fwd.match(/"author":\{[^{}]*?"id":"(\d+)"/)
    if (fm) return String(fm[1])
  }

  // Cách 2: parse các khối Relay rồi duyệt đệ quy.
  const RELAY_RE = /(?:RelayPreloader_\w+|RelayPrefetchedStreamCache)",\[\],(\{)/g
  let m
  while ((m = RELAY_RE.exec(html))) {
    const objStart = m.index + m[0].length - 1
    const objStr = extractBalancedJson(html, objStart)
    if (!objStr) continue
    let parsed
    try { parsed = JSON.parse(objStr) } catch { continue }
    const uid = findCommentAuthorIdDeep(parsed, commentShort)
    if (uid) return uid
  }

  // CÁCH 3 — port nhánh THỨ 4 của Pancake getGlobalIdFromLiveComment (class `Oe`):
  // crawl HỘP BÌNH LUẬN BUSINESS (business.facebook.com/latest/inbox/facebook). Cách 1/2
  // chỉ đọc HTML public của post — comment ẩn / post cũ / post hạn chế hiển thị không có
  // node trong HTML đó nên trượt. Hộp bình luận business thì luôn thấy được mọi comment
  // gửi vào page (kể cả comment khách đã tự xoá khỏi public). Pancake gọi đúng các
  // GraphQL query mà giao diện comment-inbox của FB dùng để lấy author.id.
  if (postShort) {
    try {
      const uid = await resolveCommentViaBusinessInbox(postId, postShort, commentShort, commentId, customerName)
      if (uid) return uid
    } catch (e) {
      console.warn('[VAESA Bridge] CÁCH 3 business inbox fail:', e?.message || e)
    }
  }

  throw new Error(`Không tìm thấy bình luận ${commentShort} trong post (KH có thể đã xoá comment)`)
}

// ============== CÁCH 3 — PORT Pancake class `Oe` (business comment inbox) ==============
// Port verbatim flow của class `Oe` + nhánh 4 getGlobalIdFromLiveComment trong
// background.js-BW_XvyNi.js (Pancake ext 0.5.45):
//   Oe.init()                → getHtmlBusinessCommentsView + dựng base/graphql
//   Oe.getComment()          → searchCommentByUserName (ƯU TIÊN) → nếu trượt thì
//                              getCommentThread → getCommentDetailHeader
//                              → getViewDetailHeaderTitle → findComment
//   trả về _.node.author.id  (= UID khách)
//
// ĐIỂM KHÁC BIỆT (đã ghi chú rõ — KHÔNG bịa hành vi):
//  1. Pancake resolve `doc_id` ĐỘNG: class `R` tải HTML hộp bình luận → đọc resource_map
//     → tải các file JS bundle → regex `name:"<query>",id:"<docid>"`. VAESA port y hệt cơ
//     chế đó trong loadBizDocIds() (regex JS thuần, không hardcode doc_id — doc_id FB hay
//     đổi nên hardcode sẽ hỏng).
//  2. Pancake `re.buildParams()` scrape ~20 field session từ HTML. VAESA chỉ gửi tập tối
//     thiểu đã VERIFY chạy được ở mbsSearchUid (av/fb_dtsg/lsd + header x-fb-lsd) — FB
//     chấp nhận tập này cho mọi query business GraphQL.
//  3. `Oe.getComment` thử `searchCommentByUserName` TRƯỚC (cần convName = tên khách),
//     chỉ fallback `getCommentThread` khi cách kia trượt. VAESA port đủ cả hai:
//     resolveCommentGlobalId nhận thêm `customerName` để chạy được cách ưu tiên này.

// Tên các GraphQL query của hộp bình luận business — copy verbatim từ Pancake. doc_id
// sẽ resolve động theo tên này (biến minify Pancake ghi trong ngoặc).
const BIZ_Q_COMMENT_THREAD_LIST = 'BizInboxCommentThreadListContainerQuery'   // He
const BIZ_Q_COMMENT_DETAIL_HEADER = 'BizInboxCommentDetailViewHeaderContainerQuery' // qt
const BIZ_Q_DETAIL_HEADER_TITLE = 'BizInboxCommentDetailViewHeaderFacebookTitleQuery' // $t
const BIZ_Q_COMMENT_LIST_ROOT = 'CommentListComponentsRootQuery'             // Ga
// searchCommentByUserName dùng thêm 3 query — Te/ht/Re (xem grep Pancake source):
const BIZ_Q_CUSTOMER_SEARCH = 'BizInboxCustomerRelaySearchSourceQuery'       // Te — page_unified_customer_search
const BIZ_Q_SEARCH_RESULT_LIST = 'BizInboxSearchResultListContainerQuery'    // ht — CrmUnifiedContact.facebook_comms
const BIZ_Q_POST_DETAIL_WRAPPER = 'BizInboxPostDetailViewWrapperQuery'       // Re — comment_list_renderer

// Cache doc_id đã resolve trong phiên service worker (Pancake cũng cache qua class `R`).
const _bizDocIds = {}

// Port Oe.getHtmlBusinessCommentsView — tải HTML view hộp bình luận FB của page.
async function getHtmlBusinessCommentsView(pageId) {
  const url = `https://business.facebook.com/latest/inbox/facebook?asset_id=${pageId}&thread_type=FB_PAGE_POST`
  const res = await fetch(url, {
    credentials: 'include',
    headers: {
      accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
      'accept-language': 'en-US,en;q=0.9',
    },
  })
  if (!res.ok) throw new Error('business comment view HTTP ' + res.status)
  return await res.text()
}

// Port R.loadResource — tải 1 file JS bundle của FB rồi regex bóc cặp (queryName → doc_id).
// Copy VERBATIM 5 regex pattern của Pancake R.loadResource (background.js dòng 7784):
//   1. operationKind:"...",name:"<q>",id:"<docid>"
//   2. id:"<docid>",(...,)?name:"<q>"                (đảo thứ tự id↔name)
//   3. __d("<q>"...__getDocID=function(){return"<docid>"      — CHỈ khi 1+2 trượt
//   4. __d("<q>_instagramRelayOperation"...exports="<docid>"  — CHỈ khi vẫn trượt
//   5. __d("<q>_facebookRelayOperation"...exports="<docid>"   — luôn nối thêm
async function extractDocIdsFromJs(jsUrl, queryNames) {
  let src = ''
  try {
    src = await fetch(jsUrl, { credentials: 'include' }).then(r => r.text())
  } catch (e) {
    return {}
  }
  const names = queryNames.join('|')
  const out = {}
  // hits: mảng {name, id} — Pancake duyệt NGƯỢC rồi set, ở đây gom rồi set tuần tự.
  let hits = []
  const collect = (re, nameIdx, idIdx) => {
    let mm
    while ((mm = re.exec(src))) hits.push({ name: mm[nameIdx], id: mm[idIdx] })
  }
  collect(new RegExp('operationKind:"(?:[^"]+)",name:"(' + names + ')",id:"(\\d+)"', 'g'), 1, 2)
  collect(new RegExp('id:"(\\d+)",(?:[^:]+:.+,)?name:"(' + names + ')"', 'g'), 2, 1)
  if (!hits.length) {
    collect(new RegExp('__d\\("(' + names + ')".+?__getDocID=function\\(\\)\\{return"(\\d+)"', 'g'), 1, 2)
  }
  if (!hits.length) {
    collect(new RegExp('__d\\("(' + names + ')_instagramRelayOperation".+?exports="(\\d+)"', 'g'), 1, 2)
  }
  collect(new RegExp('__d\\("(' + names + ')_facebookRelayOperation".+?exports="(\\d+)"', 'g'), 1, 2)
  for (const h of hits) out[h.name] = h.id
  return out
}

// Port R.loadDocIdsFromView + makeResourceMap/getResourceNeedsLoad — tải HTML view,
// gom URL các file JS (từ resource_map và thẻ <script src>), rồi resolve doc_id.
async function loadBizDocIds(pageId, html, queryNames) {
  const need = queryNames.filter(n => !_bizDocIds[n])
  if (!need.length) return
  // Gom URL file JS: (a) thẻ <script src="...">, (b) các khối "resource_map"/"rsrcMap".
  const jsUrls = new Set()
  for (const m of html.matchAll(/<script[^>]+src="([^"]+\.js[^"]*)"/g)) jsUrls.add(m[1])
  for (const mark of ['"resource_map":', '"rsrcMap":']) {
    let from = 0
    for (;;) {
      const ci = html.indexOf(mark, from)
      if (ci < 0) break
      from = ci + mark.length
      const objStr = extractBalancedJson(html, from)
      if (!objStr) continue
      let map
      try { map = JSON.parse(objStr) } catch { continue }
      // resource_map: { hash: { src, type } } — chỉ lấy entry JS.
      for (const k in map) {
        const v = map[k]
        if (v && typeof v === 'object' && typeof v.src === 'string' && /\.js/.test(v.src)) {
          jsUrls.add(v.src)
        }
      }
    }
  }
  // Pancake tải JS theo lô 6 file song song, dừng sớm khi đã đủ doc_id.
  const urls = [...jsUrls]
  for (let i = 0; i < urls.length; i += 6) {
    const batch = urls.slice(i, i + 6)
    const results = await Promise.all(batch.map(u => extractDocIdsFromJs(u, need)))
    for (const r of results) Object.assign(_bizDocIds, r)
    if (need.every(n => _bizDocIds[n])) break
  }
}

// Port Y.graphql — gọi 1 query GraphQL tới endpoint business comment-inbox.
// Tập param tối thiểu đã verify ở mbsSearchUid (av + fb_dtsg + lsd + friendly-name).
async function bizGraphql(pageId, queryName, variables, tokens) {
  const docId = _bizDocIds[queryName]
  if (!docId) throw new Error('Thiếu doc_id ' + queryName)
  const body = new URLSearchParams()
  body.set('av', String(pageId))
  body.set('fb_dtsg', tokens.dtsg)
  body.set('lsd', tokens.lsd)
  body.set('fb_api_caller_class', 'RelayModern')
  body.set('fb_api_req_friendly_name', queryName)
  body.set('variables', JSON.stringify(variables))
  body.set('doc_id', docId)
  const res = await fetch('https://business.facebook.com/api/graphql/', {
    method: 'POST',
    credentials: 'include',
    headers: {
      'content-type': 'application/x-www-form-urlencoded',
      'x-fb-friendly-name': queryName,
      'x-fb-lsd': tokens.lsd,
      'x-asbd-id': '359341',
    },
    body: body.toString(),
  })
  const txt = await res.text()
  let data
  try { data = JSON.parse(txt) } catch { throw new Error(queryName + ' trả về không phải JSON (HTTP ' + res.status + ')') }
  if (data?.errors?.length) throw new Error(queryName + ' error: ' + (data.errors[0]?.message || 'unknown'))
  return data
}

// Port Y.graphql với parseResponse = (ye) => ye.text() — query trả TEXT thô (Pancake
// dùng cho BizInboxPostDetailViewWrapperQuery vì response không phải JSON thuần mà là
// chuỗi chứa nhiều block JSON streaming). Gửi kèm tham số __comet_req=11... như Pancake.
async function bizGraphqlText(pageId, queryName, variables, tokens) {
  const docId = _bizDocIds[queryName]
  if (!docId) throw new Error('Thiếu doc_id ' + queryName)
  const body = new URLSearchParams()
  body.set('av', String(pageId))
  body.set('fb_dtsg', tokens.dtsg)
  body.set('lsd', tokens.lsd)
  body.set('fb_api_caller_class', 'RelayModern')
  body.set('fb_api_req_friendly_name', queryName)
  body.set('variables', JSON.stringify(variables))
  body.set('doc_id', docId)
  // tham số extra verbatim Pancake (đối số thứ 3 của graphql cho query Re).
  body.set('__aaid', '0')
  body.set('__ccg', 'EXCELLENT')
  body.set('__comet_req', '11')
  body.set('__jssesw', '1')
  body.set('server_timestamps', 'true')
  const res = await fetch('https://business.facebook.com/api/graphql/', {
    method: 'POST',
    credentials: 'include',
    headers: {
      'content-type': 'application/x-www-form-urlencoded',
      'x-fb-friendly-name': queryName,
      'x-fb-lsd': tokens.lsd,
      'x-asbd-id': '359341',
    },
    body: body.toString(),
  })
  return await res.text()
}

// Port Oe.getCommentDetailHeader — trả commItem (có comm_source_id = fb post id).
async function bizGetCommentDetailHeader(pageId, commItemId, tokens) {
  const d = await bizGraphql(pageId, BIZ_Q_COMMENT_DETAIL_HEADER, { commItemID: commItemId }, tokens)
  return d?.data?.commItem || null
}

// Port Oe.getCommentThread — duyệt danh sách comm_item của hộp bình luận (đệ quy theo
// cursor), tìm comm_item có comm_source_id == fb post id. Pancake giới hạn 10 vòng.
async function bizGetCommentThread(pageId, postShort, tokens, depth = 0, cursor = null) {
  const vars = {
    pageID: String(pageId),
    count: 20,
    cursor,
    filterType: null,
    filterIsReadStatus: null,
    filterOwnerID: null,
    filterStatus: 'TODO',
    platformFilter: 'FACEBOOK',
    isHighlightedComment: false,
    isStarsComment: false,
  }
  const d = await bizGraphql(pageId, BIZ_Q_COMMENT_THREAD_LIST, vars, tokens)
  const conn = d?.data?.page?.business_comm_items
  const edges = conn?.edges || []
  for (const edge of edges) {
    const header = await bizGetCommentDetailHeader(pageId, edge?.node?.id, tokens).catch(() => null)
    if (header && String(header.comm_source_id) === String(postShort)) return edge
  }
  if (depth < 10 && conn?.page_info?.end_cursor) {
    return bizGetCommentThread(pageId, postShort, tokens, depth + 1, conn.page_info.end_cursor)
  }
  return null
}

// Port Oe.getViewDetailHeaderTitle — từ post id (target_id của commItem) lấy feedback
// object của post (feedback.id dùng làm input cho findComment).
async function bizGetViewDetailHeaderTitle(pageId, postId, tokens) {
  const d = await bizGraphql(pageId, BIZ_Q_DETAIL_HEADER_TITLE, { postID: postId }, tokens)
  return d?.data?.facebook_post?.feedback || null
}

// Port Oe.findComment — query CommentListComponentsRootQuery theo feedback id rồi tìm
// edge có node.legacy_fbid == comment id → trả node.author.id (UID khách).
async function bizFindComment(pageId, feedbackId, commentShort, tokens) {
  const vars = {
    commentsIntentToken: 'RANKED_UNFILTERED_CHRONOLOGICAL_REPLIES_INTENT_V1',
    feedLocation: 'BUSINESS_COMMENT_INBOX_TAB',
    feedbackSource: 107,
    focusCommentID: null,
    scale: 1,
    useDefaultActor: false,
    id: feedbackId,
  }
  const d = await bizGraphql(pageId, BIZ_Q_COMMENT_LIST_ROOT, vars, tokens)
  const comments = d?.data?.node?.comment_rendering_instance_for_feed_location?.comments
  const edges = comments?.edges || []
  // khớp trực tiếp theo legacy_fbid (Pancake làm y hệt trong findComment + findTargetComment)
  for (const edge of edges) {
    if (String(edge?.node?.legacy_fbid) === String(commentShort)) {
      const uid = edge?.node?.author?.id
      if (uid) return String(uid)
    }
    // comment có thể là reply lồng — quét luôn replies (port findTargetComment đệ quy)
    const replyEdges = edge?.node?.feedback?.comment_rendering_instance_for_feed_location
      ?.comments?.edges || []
    for (const re of replyEdges) {
      if (String(re?.node?.legacy_fbid) === String(commentShort)) {
        const uid = re?.node?.author?.id
        if (uid) return String(uid)
      }
    }
  }
  return null
}

// Port helper Pancake `U` — quét toàn chuỗi, sau MỖI lần gặp `marker` trích object
// JSON cân ngoặc liền sau → trả MẢNG các chuỗi JSON. (extractBalancedJson chỉ lấy 1).
function extractAllJsonAfterMarker(str, marker) {
  const out = []
  let from = 0
  for (;;) {
    const ci = str.indexOf(marker, from)
    if (ci < 0) break
    from = ci + marker.length
    // bỏ khoảng trắng tới ký tự '{'
    let p = from
    while (p < str.length && (str[p] === ' ' || str[p] === '\n' || str[p] === '\r' || str[p] === '\t')) p++
    if (str[p] !== '{') continue
    const objStr = extractBalancedJson(str, p)
    if (objStr) { out.push(objStr); from = p + objStr.length }
  }
  return out
}

// ============== Port Oe.searchCommentByUserName (cách ƯU TIÊN của Pancake) ==============
// Pancake `Oe.getComment` gọi searchCommentByUserName TRƯỚC getCommentThread. Cần convName
// (= tên khách). Flow verbatim (background.js dòng 2414–2625):
//   1. graphql(Te) = page_unified_customer_search {pageID,count:5,cursor:null,
//      searchTerm:convName,channel:'FACEBOOK',selectedIgAssetId:null}
//   2. lọc edges có node.name === convName
//   3. nếu đúng 1 match & allowPrioritySearchByName & node.user.id
//        → trả {node:{author:{id: node.user.id}}}  (KẾT THÚC SỚM)
//   4. ngược lại: với mỗi match → graphql(ht) = CrmUnifiedContact.facebook_comms
//      {count:null,cursor:null,pageCustomerID: node.id}
//   5. với mỗi facebook_comms edge → commItemID = node.parent_item.id || node.node.id
//      → graphql(Re, ee, ...) = BizInboxPostDetailViewWrapperQuery (parse .text())
//   6. quét '"comment_list_renderer":' trong response → feedback.id (gọi findComment)
//      và comment_rendering...comments.edges → khớp node.legacy_fbid === comment id
// allowPrioritySearchByName: theo yêu cầu coi như TRUE.
async function bizSearchCommentByUserName(pageId, convId, convName, postShort, tokens) {
  if (!convName) return null
  // convId Pancake dạng "{post}_{comment}" → e = comment legacy id phần sau '_'.
  const commentLegacy = String(convId).includes('_') ? String(convId).split('_')[1] : String(convId)

  // bước 1 — page_unified_customer_search.
  const searchVars = {
    pageID: String(pageId),
    count: 5,
    cursor: null,
    searchTerm: convName,
    channel: 'FACEBOOK',
    selectedIgAssetId: null,
  }
  const a = await bizGraphql(pageId, BIZ_Q_CUSTOMER_SEARCH, searchVars, tokens)
  const edges = a?.data?.page?.page_unified_customer_search?.edges
  if (!edges || !edges.length) return null

  // bước 2 — lọc edges có node.name === convName (so khớp tuyệt đối, đúng Pancake).
  const matched = edges.filter((F) => F?.node?.name === convName)

  // bước 3 — đúng 1 match + có user.id → trả ngay {node:{author:{id}}}.
  if (matched.length === 1 && matched[0]?.node?.user?.id) {
    return { node: { author: { id: String(matched[0].node.user.id) } } }
  }

  // bước 4-6 — với mỗi match, query facebook_comms rồi crawl comment_list_renderer.
  for (const F of matched) {
    const commsVars = { count: null, cursor: null, pageCustomerID: F?.node?.id }
    let N
    try {
      N = await bizGraphql(pageId, BIZ_Q_SEARCH_RESULT_LIST, commsVars, tokens)
    } catch (e) { continue }
    const commEdges = N?.data?.CrmUnifiedContact?.facebook_comms?.edges
    if (!commEdges || !commEdges.length) continue

    for (const k of commEdges) {
      const commItemID = k?.node?.parent_item?.id || k?.node?.node?.id
      if (!commItemID) continue
      // bước 5 — BizInboxPostDetailViewWrapperQuery, response trả TEXT (không phải JSON
      // thuần), ee = bộ biến verbatim Pancake (dòng 2546-2563).
      const ee = {
        commItemID,
        feedLocation: 'BUSINESS_COMMENT_INBOX_TAB',
        feedbackSource: 107,
        focusCommentID: null,
        privacySelectorRenderLocation: 'BUSINESS_COMMENT_INBOX_TAB',
        scale: 1,
        useDefaultActor: false,
        renderLocation: 'business_comment_inbox_tab',
        __relay_internal__pv__CometImmersivePhotoCanUserDisable3DMotionrelayprovider: false,
        __relay_internal__pv__IsWorkUserrelayprovider: false,
        __relay_internal__pv__IsMergQAPollsrelayprovider: false,
        __relay_internal__pv__CometUFIReactionsEnableShortNamerelayprovider: false,
        __relay_internal__pv__CometUFIShareActionMigrationrelayprovider: true,
        __relay_internal__pv__IncludeCommentWithAttachmentrelayprovider: true,
        __relay_internal__pv__StoriesArmadilloReplyEnabledrelayprovider: false,
        __relay_internal__pv__EventCometCardImage_prefetchEventImagerelayprovider: false,
      }
      let de
      try {
        de = await bizGraphqlText(pageId, BIZ_Q_POST_DETAIL_WRAPPER, ee, tokens)
      } catch (e) { continue }

      // bước 6 — quét mọi block '"comment_list_renderer":' (port Pancake `U(de,...)`).
      const blocks = extractAllJsonAfterMarker(de, '"comment_list_renderer":')
      let feedbackIds = []
      for (const blk of blocks) {
        try {
          const he = JSON.parse(blk)
          if (he?.feedback?.id) feedbackIds.push(he.feedback.id)
          const cEdges = he?.feedback?.comment_rendering_instance_for_feed_location?.comments?.edges
          if (cEdges && cEdges.length) {
            for (const xe of cEdges) {
              // Pancake: node.legacy_fbid === e (comment legacy id) → trả nguyên edge.
              if (String(xe?.node?.legacy_fbid) === String(commentLegacy)) return xe
            }
          }
          // các feedback id còn lại → findComment tuần tự (Pancake làm y hệt).
          feedbackIds = feedbackIds.filter(Boolean)
          for (const fid of feedbackIds) {
            const ue = await bizFindCommentEdge(pageId, convId, fid, tokens)
            if (ue) return ue
          }
        } catch (e) { /* block lỗi → bỏ qua, đúng Pancake try/catch rỗng */ }
      }
    }
  }
  return null
}

// Port Oe.findComment — query CommentListComponentsRootQuery theo feedback id, trả
// nguyên EDGE khớp node.legacy_fbid (Pancake trả `d` = edge, .node.author.id là UID).
async function bizFindCommentEdge(pageId, convId, feedbackId, tokens) {
  const commentLegacy = String(convId).includes('_') ? String(convId).split('_')[1] : String(convId)
  const vars = {
    commentsIntentToken: 'RANKED_UNFILTERED_CHRONOLOGICAL_REPLIES_INTENT_V1',
    feedLocation: 'BUSINESS_COMMENT_INBOX_TAB',
    feedbackSource: 107,
    focusCommentID: null,
    scale: 1,
    useDefaultActor: false,
    id: feedbackId,
  }
  let d
  try {
    d = await bizGraphql(pageId, BIZ_Q_COMMENT_LIST_ROOT, vars, tokens)
  } catch (e) { return null }
  const edges = d?.data?.node?.comment_rendering_instance_for_feed_location?.comments?.edges || []
  for (const edge of edges) {
    if (String(edge?.node?.legacy_fbid) === String(commentLegacy)) return edge
    const replyEdges = edge?.node?.feedback?.comment_rendering_instance_for_feed_location
      ?.comments?.edges || []
    for (const re of replyEdges) {
      if (String(re?.node?.legacy_fbid) === String(commentLegacy)) return re
    }
  }
  return null
}

// Điều phối CÁCH 3 — port Oe.getComment(): searchCommentByUserName (ưu tiên) → getCommentThread.
async function resolveCommentViaBusinessInbox(postId, postShort, commentShort, convId, customerName) {
  const pageId = postId && String(postId).includes('_')
    ? String(postId).split('_')[0]
    : null
  if (!pageId) throw new Error('CÁCH 3: không suy ra được pageId từ postId')

  // init() — tải HTML hộp bình luận business để resolve doc_id (port Oe.init + R).
  const html = await getHtmlBusinessCommentsView(pageId)
  await loadBizDocIds(pageId, html, [
    BIZ_Q_COMMENT_THREAD_LIST, BIZ_Q_COMMENT_DETAIL_HEADER,
    BIZ_Q_DETAIL_HEADER_TITLE, BIZ_Q_COMMENT_LIST_ROOT,
    BIZ_Q_CUSTOMER_SEARCH, BIZ_Q_SEARCH_RESULT_LIST, BIZ_Q_POST_DETAIL_WRAPPER,
  ])
  // token dtsg/lsd lấy từ chính trang business (tái dùng mbsFetchTokens đã verify).
  const tokens = await mbsFetchTokens()

  // convIdFull = "{post}_{comment}" — Pancake `Oe.convId`. postId Pancake = "{page}_{post}".
  const convIdFull = `${postShort}_${commentShort}`

  // (1) ƯU TIÊN — searchCommentByUserName (port Oe.getComment nhánh đầu).
  if (customerName) {
    try {
      const found = await bizSearchCommentByUserName(pageId, convIdFull, customerName, postShort, tokens)
      // Pancake trả {node:{author:{id}}} → UID = node.author.id.
      const uid = found?.node?.author?.id
      if (uid) return String(uid)
    } catch (e) {
      console.warn('[VAESA Bridge] searchCommentByUserName fail:', e?.message || e)
    }
  }

  // (2) FALLBACK — getCommentThread → header → feedback id → findComment.
  const threadEdge = await bizGetCommentThread(pageId, postShort, tokens)
  if (!threadEdge) return null
  const header = await bizGetCommentDetailHeader(pageId, threadEdge?.node?.id, tokens)
  if (!header) return null
  const feedback = await bizGetViewDetailHeaderTitle(pageId, header.target_id, tokens)
  if (!feedback) return null
  return await bizFindComment(pageId, feedback.id, commentShort, tokens)
}

// ============== PHASE 2: RESOLVE UID CONV CŨ (port Pancake ge.findThread) ==============
// Conv cũ (>1 năm) KHÔNG có thread_id/thread_key/global_id — chỉ có TÊN khách + PSID.
// Soi extension Pancake thật (bản 0.5.45, class `ge`): bấm avatar → GET_GLOBAL_ID_FOR_CONV
// → getGlobalIdFromInbox → bước 3 `findThread`: quét threadlist tìm thread KHỚP TÊN KHÁCH.
//   - Query: MessengerGraphQLThreadlistFetcher (cùng doc_id VAESA đã dùng) NHƯNG phải gửi
//     ĐỦ query_params (threadlistViewFieldsOnly:false...) thì FB mới trả all_participants
//     (có tên khách). Thiếu params → all_participants rỗng → không khớp tên được.
//   - Conv cũ nằm ở tag ARCHIVED, không phải INBOX → phải cascade tag: INBOX → ARCHIVED
//     → PAGE_BACKGROUND → OTHER (đúng thứ tự Pancake findThread).
//   - UID khách = thread.thread_key.other_user_id.
// Verify trực tiếp 2026-05-17: Nguyễn Văn Tiệp (1/2025) → 100003292173187.

const THREADLIST_FULL_PARAMS = {
  isWorkUser: false,
  includeDeliveryReceipts: true,
  includeSeqID: false,
  is_work_teamwork_not_putting_muted_in_unreads: false,
  threadlistViewFieldsOnly: false,
}
const FINDTHREAD_TAG_CASCADE = [['INBOX'], ['ARCHIVED'], ['PAGE_BACKGROUND'], ['OTHER']]
const FINDTHREAD_LIMIT = 20         // Hr — threads/batch
const FINDTHREAD_MAX_PER_TAG = 200  // Mo — quét tối đa /tag rồi chuyển tag

// Threadlist fetch với ĐỦ query_params (khác fetchThreadBatch tối giản) → FB trả
// all_participants kèm tên. Trả mảng node thread.
async function fetchThreadListFull(pageId, beforeMs, tags) {
  const dtsg = await getDtsg()
  const params = new URLSearchParams({
    batch_name: 'MessengerGraphQLThreadlistFetcher',
    av: String(pageId),
    fb_dtsg: dtsg,
    queries: JSON.stringify({
      o0: {
        doc_id: DOC_ID_MESSAGE,
        query_params: { limit: FINDTHREAD_LIMIT, tags, before: beforeMs, ...THREADLIST_FULL_PARAMS },
      },
    }),
  })
  const res = await fetch(FB_GRAPHQL_URL, {
    method: 'POST',
    credentials: 'include',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: params,
  })
  if (!res.ok) throw new Error('FB GraphQL HTTP ' + res.status)
  let text = await res.text()
  if (text.includes('Query Rate Limit Exceeded')) throw new Error('FB rate limit')
  text = text
    .replace('{"successful_results":1,"error_results":0,"skipped_results":0}', '')
    .replace('{"successful_results":0,"error_results":1,"skipped_results":0}', '')
  const json = JSON.parse(text)
  return json?.o0?.data?.viewer?.message_threads?.nodes || []
}

// Tên các participant của 1 thread (all_participants có thể là edges[] hoặc nodes[]).
function threadParticipantNames(t) {
  const edges = t?.all_participants?.edges || []
  const nodes = t?.all_participants?.nodes || []
  return edges.map(e => e?.node?.messaging_actor?.name)
    .concat(nodes.map(n => n?.messaging_actor?.name))
    .filter(Boolean)
}

// Port Pancake ge.findThread — quét threadlist tìm thread theo TÊN khách
// (hoặc threadId/threadKey nếu có). Trả UID (thread_key.other_user_id) hoặc throw.
async function resolveUidByName({ pageId, customerName, convUpdatedMs, threadId, threadKey, psid }) {
  if (!pageId) throw new Error('resolveUidByName: thiếu pageId')
  if (!customerName && !threadId && !threadKey) {
    throw new Error('resolveUidByName: thiếu customerName/threadId/threadKey')
  }
  const name = customerName ? String(customerName).trim() : ''
  const tKey = threadKey ? String(threadKey).replace(/^t_/, '') : ''
  const pid = psid ? String(psid) : ''
  // Cursor: GIỐNG PANCAKE = conversationUpdatedTime + 60s. Mốc nay CHÍNH XÁC nhờ webapp parse UTC
  // (trước lệch 7h → quét trượt window). BUG cũ +7 NGÀY → cạn 200/tag trước khi tới thread đích.
  const baseCursor = Number(convUpdatedMs) > 0 ? Number(convUpdatedMs) + 60000 : Date.now()

  // isAllActorArePage — CLONE Pancake: đúng 2 participant + MỌI messaging_actor.__typename==='Page'
  // (khách hiển thị vai trò page) → lúc đó khớp bằng PSID trong participants.
  const allActorsArePage = (t) => {
    const edges = t?.all_participants?.edges
    if (!Array.isArray(edges) || edges.length !== 2) return false
    return !edges.find((r) => r?.node?.messaging_actor?.__typename !== 'Page')
  }
  // KHỚP theo ID (ƯU TIÊN — clone Pancake findThread): thread kiểu page → PSID; còn lại →
  // page_comm_item.id/comm_source_id === threadId, hoặc comm_source_id === threadKey, hoặc thread_fbid.
  const matchById = (t) => {
    if (pid && allActorsArePage(t)) {
      const ids = (t?.all_participants?.edges || []).map((e) => String(e?.node?.messaging_actor?.id || ''))
      if (ids.includes(pid)) return true
    }
    if (threadId) {
      const id = String(threadId)
      if (t?.page_comm_item?.id === id || t?.page_comm_item?.comm_source_id === id ||
          t?.thread_key?.thread_fbid === id) return true
    }
    if (tKey && t?.page_comm_item?.comm_source_id === tKey) return true
    return false
  }
  // KHỚP theo TÊN — chỉ là LƯỢT CUỐI khi KHÔNG có ID nào khớp (clone Pancake: name fallback gated,
  // KHÔNG ưu tiên). BUG CŨ: tên ngang hàng ID trong cùng 1 find → vớ nhầm khách TRÙNG TÊN đứng trước.
  const matchByName = (t) => !!(name && threadParticipantNames(t).includes(name))

  // CLONE Pancake extractGlobalId: UID khách LUÔN = thread_key.other_user_id.
  const uidOf = (t) => {
    const uid = t?.thread_key?.other_user_id
    return uid && String(uid) !== String(pageId) ? String(uid) : ''
  }

  // Quét cascade tag (INBOX→ARCHIVED→...) bằng 1 hàm khớp; trả uid hoặc ''.
  const scanFrom = async (startBefore, matchFn, label) => {
    for (const tags of FINDTHREAD_TAG_CASCADE) {
      let before = startBefore
      let scanned = 0
      while (scanned < FINDTHREAD_MAX_PER_TAG) {
        let nodes
        try {
          nodes = await fetchThreadListFull(pageId, before, tags)
        } catch (e) {
          console.warn(`[VAESA Bridge] threadlist ${tags} fail:`, e?.message || e)
          break
        }
        if (!nodes.length) break
        scanned += nodes.length
        const hit = nodes.find(matchFn)
        if (hit) {
          const uid = uidOf(hit)
          if (uid) {
            console.log(`[VAESA Bridge] resolveUidByName OK (${label}/${tags}): "${name || threadId}" → ${uid}`)
            return uid
          }
        }
        if (nodes.length < FINDTHREAD_LIMIT) break  // hết thread trong tag này
        const last = parseInt(nodes[nodes.length - 1].updated_time_precise) || 0
        if (!last || last >= before) break          // không lùi được nữa → tránh lặp vô hạn
        before = last
      }
    }
    return ''
  }

  // 1) ƯU TIÊN khớp ID (2 mốc: conv-time + hiện tại) — cách Pancake mặc định dùng.
  let uid = await scanFrom(baseCursor, matchById, 'id')
  if (!uid) uid = await scanFrom(Date.now(), matchById, 'id')
  // 2) LƯỢT CUỐI: khớp tên — CHỈ khi ID hoàn toàn không ra (phòng conv không có ID khớp). KHÔNG
  //    bao giờ để tên đè ID → hết lẫn khách trùng tên.
  if (!uid && name) uid = await scanFrom(baseCursor, matchByName, 'name')
  if (!uid && name) uid = await scanFrom(Date.now(), matchByName, 'name')
  if (uid) return uid
  throw new Error(`Không tìm thấy thread cho "${name || threadId}" (đã quét INBOX/ARCHIVED/PAGE_BACKGROUND/OTHER)`)
}

// ============== INBOX GLOBAL ID RESOLVER (Phase 1C — inbox) ==============
// Phần fetchInboxHtml/extractInboxGlobalId giữ lại cho debug (VAESA_DEBUG_INBOX_HTML).
// Cách resolve THẬT: resolveUidByName ở trên (quét threadlist khớp tên).

async function fetchInboxHtml(pageId, threadId) {
  const url = `https://business.facebook.com/latest/inbox/all?asset_id=${pageId}&selected_item_id=${threadId}`
  const res = await fetch(url, {
    credentials: 'include',
    headers: {
      accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
      'accept-language': 'en-US,en;q=0.9',
    },
  })
  if (!res.ok) throw new Error('FB inbox HTTP ' + res.status)
  return await res.text()
}

// Trích global_id khách từ HTML inbox. Thử nhiều pattern, loại trừ pageId.
function extractInboxGlobalId(html, pageId, threadId) {
  const candidates = new Map()  // id → số lần xuất hiện
  const add = (id) => {
    if (!id || id === String(pageId)) return
    candidates.set(id, (candidates.get(id) || 0) + 1)
  }

  // Pattern 1: thread_key.other_user_id (chính xác nhất cho thread 1:1)
  for (const m of html.matchAll(/"other_user_id":"?(\d{6,})"?/g)) add(m[1])
  // Pattern 2: messaging_actor id
  for (const m of html.matchAll(/"messaging_actor":\{[^{}]*?"id":"(\d{6,})"/g)) add(m[1])
  // Pattern 3: entity_id trong context link
  for (const m of html.matchAll(/entity_id=(\d{6,})/g)) add(m[1])
  // Pattern 4: setBusinessThreadInfo / thread bootstrap — cặp threadId ↔ id
  for (const m of html.matchAll(/"thread_fbid":"?(\d{6,})"?[^}]*?"other_user_id":"?(\d{6,})"?/g)) add(m[2])

  // Loại các id rõ ràng không phải khách: pageId, threadId
  candidates.delete(String(threadId))

  if (!candidates.size) return null
  // Chọn id xuất hiện nhiều nhất
  let best = null, bestN = 0
  for (const [id, n] of candidates) { if (n > bestN) { best = id; bestN = n } }
  return best
}

async function resolveInboxGlobalId({ pageId, threadId, customerName, convUpdatedMs, threadKey, psid }) {
  // Phase 2: quét threadlist khớp ID (ưu tiên) → tên (lượt cuối), port Pancake findThread.
  return await resolveUidByName({ pageId, customerName, convUpdatedMs, threadId, threadKey, psid })
}

// ============== PHASE 1C — resolve hàng loạt conv comment thiếu UID ==============
const COMMENT_RESOLVE_DELAY_MS = 1500   // nghỉ giữa mỗi conv (anti rate-limit)
const COMMENT_RESOLVE_MAX = 1000

async function runCommentResolve({ pageId, onProgress }) {
  if (!pageId) throw new Error('Thiếu pageId')

  // Lấy danh sách conv thiếu UID từ BE
  let rows = []
  try {
    const r = await beGet('missing', { page_id: pageId, limit: COMMENT_RESOLVE_MAX })
    rows = (r?.rows || []).filter(x => x.post_id || x.pancake_conv_id)
  } catch (e) {
    console.warn('[VAESA Bridge] đọc /missing fail:', e?.message)
    return { ok: false, error: e?.message }
  }

  let resolved = 0, failed = 0, idx = 0
  const broadcast = (extra = {}) => {
    try {
      chrome.runtime.sendMessage({
        source: 'vaesa-bridge', event: 'COMMENT_RESOLVE_PROGRESS',
        pageId, resolved, failed, total: rows.length, ...extra,
      }).catch(() => {})
    } catch {}
    if (typeof onProgress === 'function') { try { onProgress({ resolved, failed, total: rows.length, ...extra }) } catch {} }
  }

  for (const row of rows) {
    idx++
    try {
      let uid = null
      if (row.post_id) {
        // Conv bình luận → resolve qua comment HTML
        const convId = row.pancake_conv_id || ''
        const commentId = convId.includes('_') ? convId.split('_').pop() : (row.page_comm_id || '')
        if (commentId) uid = await resolveCommentGlobalId({ postId: row.post_id, commentId, customerName: row.customer_name })
      } else if (row.thread_id || row.customer_name) {
        // Conv inbox → quét threadlist khớp tên khách (Phase 2 — port Pancake findThread)
        uid = await resolveInboxGlobalId({
          pageId,
          threadId: row.thread_id,
          threadKey: row.thread_key,
          customerName: row.customer_name,
          convUpdatedMs: row.updated_time_ms,
        })
      }
      if (uid) {
        await bePost('sync', {
          page_id: pageId,
          threads: [{ thread_id: row.thread_id, client_uid: uid, updated_time_ms: row.updated_time_ms || Date.now() }],
        }).catch(() => {})
        await setCachedUid(pageId, row.thread_id, uid)
        resolved++
        console.log(`[VAESA Bridge] Phase1C resolved: ${row.customer_name} → ${uid}`)
      } else {
        failed++
      }
    } catch (e) {
      failed++
      console.warn(`[VAESA Bridge] Phase1C fail ${row.customer_name}:`, e?.message)
    }
    broadcast({})
    await new Promise(r => setTimeout(r, COMMENT_RESOLVE_DELAY_MS))
  }

  broadcast({ done: true })
  console.log(`[VAESA Bridge] Phase 1C xong: resolved=${resolved} failed=${failed}/${rows.length}`)
  return { ok: true, resolved, failed, total: rows.length }
}

// ============== SEND TEXT (Mercury HTTP minimal) ==============
// Port từ Retion FacebookPage.sendText. KHÔNG có other_user_fbid / __spin_* / __s / __usid / __dyn / __hsi.

function encodeMessageKey(key) {
  let result = ''
  for (; '0' != key; ) {
    let n = 0
    let s = ''
    for (let i = 0; i < key.length; i++) {
      if ((n = 2 * n + parseInt(key[i], 10)) >= 10) {
        s = s + '1'
        n = n - 10
      } else {
        s = s + '0'
      }
    }
    result = n.toString() + result
    key = s.slice(s.indexOf('1'))
  }
  return result
}

function calcMessageKey() {
  const time = Date.now()
  const salt = Math.floor(4294967296 * Math.random())
  const saltStr = ('0000000000000000000000' + salt.toString(2)).slice(-22)
  return encodeMessageKey((time.toString(2) + saltStr).slice(-63))
}

async function buildSendBody({ pageId, clientUid, text, imageIds, audioIds, videoIds, fileIds }) {
  const dtsg = await getDtsg()
  const messageKey = calcMessageKey()
  const hasAtt = !!(
    (imageIds && imageIds.length) ||
    (audioIds && audioIds.length) ||
    (videoIds && videoIds.length) ||
    (fileIds && fileIds.length)
  )
  const body = {
    client_id: 'mercury',
    action_type: 'ma-type:user-generated-message',
    source: 'source:page_unified_inbox',
    message_id: messageKey,
    offline_threading_id: messageKey,
    'specific_to_list[0]': `fbid:${clientUid}`,
    'specific_to_list[1]': `fbid:${pageId}`,
    timestamp: Date.now(),
    request_user_id: pageId,
    fb_dtsg: dtsg,
    __a: 1,
    has_attachment: hasAtt,
  }
  if (text) body.body = text
  if (imageIds && imageIds.length) imageIds.forEach((id, i) => { body[`image_ids[${i}]`] = id })
  if (audioIds && audioIds.length) audioIds.forEach((id, i) => { body[`audio_ids[${i}]`] = id })
  if (videoIds && videoIds.length) videoIds.forEach((id, i) => { body[`video_ids[${i}]`] = id })
  if (fileIds && fileIds.length) fileIds.forEach((id, i) => { body[`file_ids[${i}]`] = id })
  return body
}

async function sendFBMessage(body) {
  const params = new URLSearchParams(body)
  const res = await fetch(FB_SEND_URL, {
    method: 'POST',
    credentials: 'include',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: params,
  })
  const text = await res.text()
  return { status: res.status, text }
}

function parseFBResponse(text) {
  if (!text) return { ok: false, error: 'Empty response' }
  // ❌ TRƯỚC: coi error_payload là FAIL → tin ĐÃ GIAO nhưng báo #10 (user xác nhận 2026-06-24).
  // ✅ Clone Pancake isResponseSuccess (0.5.49): payload.actions[].message_id HOẶC error_payload
  //    đều là "đã xử lý xong" → KHÔNG fail oan. error_payload (không kèm errorSummary) rơi xuống
  //    nhánh JSON.parse bên dưới → có json.payload → ok:true. Lỗi THẬT (1404132) có errorSummary
  //    → vẫn fail ở nhánh dưới. (Bỏ dòng fail-on-error_payload cũ.)
  if (text.includes('Not Found <br')) return { ok: false, error: 'FB Not Found' }
  if (text.includes('"errorSummary":')) {
    const summary = text.match(/"errorSummary":"([^"]+)"/)?.[1]
    const errCode = text.match(/"error":(\d+)/)?.[1]
    const desc = text.match(/"errorDescription":"([^"]+)"/)?.[1]
    return { ok: false, error: `FB ${errCode || ''}: ${desc || summary || 'unknown'}`, raw: text.slice(0, 400) }
  }
  try {
    const clean = text.replace(/^for ?\(;;\);/, '')
    const json = JSON.parse(clean)
    if (json?.payload) return { ok: true, payload: json.payload }
    return { ok: false, error: 'No payload in response' }
  } catch {
    return { ok: false, error: 'Parse fail', raw: text.slice(0, 300) }
  }
}

// ============== UPLOAD FILE (mercury/upload.php) ==============
// Port từ Retion FacebookPage.#updateOneFile

async function uploadOneFile({ pageId, fileBase64, fileMime, fileName }) {
  // Khớp Pancake doUpload (0.5.49): upload URL kèm ĐỦ session params (buildParams: jazoest/__spin/
  // __hsi/__hs/__rev/dpr/force_blue/__spin_dev_mhenv...), KHÔNG chỉ __a+fb_dtsg. Thiếu jazoest/
  // session → FB cờ upload VIDEO (nặng, soi kỹ) → trả video_id KHÔNG gửi được → SEND 1404132.
  // Ảnh nhẹ hơn nên trước đây vẫn lọt với params tối giản; video thì bị chặn.
  const ctx = await pcGetCtx(pageId)
  const params = pcBuildParams(ctx)
  params.request_user_id = pageId
  const url = new URL(FB_UPLOAD_URL)
  Object.keys(params).forEach((k) => { if (params[k] != null) url.searchParams.set(k, String(params[k])) })

  // Convert base64 → Blob
  const binaryString = atob(fileBase64)
  const bytes = new Uint8Array(binaryString.length)
  for (let i = 0; i < binaryString.length; i++) bytes[i] = binaryString.charCodeAt(i)
  const blob = new Blob([bytes], { type: fileMime || 'image/jpeg' })

  const formData = new FormData()
  // Khớp Pancake doUpload (0.5.49): field upload = `upload_<random 1024-1034>` (KHÔNG phải 'file').
  // FB mercury phân biệt field này khi xử lý VIDEO → trả video_id gửi được. Field 'file' chỉ lọt
  // với ảnh; video thì upload trả rỗng ("Không upload được") hoặc video_id không gửi được.
  const _uploadField = 'upload_' + [1024, 1025, 1026, 1027, 1028, 1029, 1030, 1031, 1032, 1033, 1034][Math.floor(Math.random() * 10)]
  formData.append(_uploadField, blob, fileName || 'image.jpg')

  const res = await fetch(url.toString(), {
    method: 'POST',
    credentials: 'include',
    body: formData,
  })
  const text = await res.text()

  if (!text || text.includes('"errorSummary":"Sorry, something went wrong"')) {
    throw new Error('Upload failed')
  }
  if (text.includes('Insufficient Permission')) {
    throw new Error('Upload no permission — anh không phải admin page')
  }

  const json = JSON.parse(text.replace(/^for ?\(;;\);/, ''))
  const meta = json?.payload?.metadata?.[0]
  if (!meta) throw new Error('Upload không trả metadata')
  // KHỚP Pancake doUpload (0.5.49): lấy id theo thứ tự fbid → video_id → file_id → gif_id
  // (+ image_id/audio_id cho VAESA). VAESA TRƯỚC THIẾU `fbid` → upload VIDEO (FB hay trả fbid,
  // KHÔNG có video_id) bị ném "Upload không trả id" → "Không upload được file nào". Đó là gốc lỗi video.
  // `kind` suy từ MIME input (fbid generic không cho biết loại) để send build đúng field.
  const id = meta.fbid || meta.video_id || meta.file_id || meta.gif_id || meta.image_id || meta.audio_id
  if (!id) throw new Error('Upload không trả id (fbid/video/file/image/audio)')
  const mt = String(fileMime || '').toLowerCase()
  let kind = 'file'
  if (mt.startsWith('image')) kind = 'image'
  else if (mt.startsWith('video')) kind = 'video'
  else if (mt.startsWith('audio')) kind = 'audio'
  return { id, kind }
}

// ============== GỬI TIN KIỂU PANCAKE (port sendInbox / buildSendParams) ==============
// Port nguyên cơ chế gửi của Pancake (extension 0.5.45, class InboxNormal):
//   - Quét "ctx phiên" FB từ trang inbox (Base.ctxFromHtml) → cache 1h (lastLoadHtmlAt).
//   - buildSendParams: body Mercury ĐẦY ĐỦ tham số phiên (buildParams).
//   - POST business.facebook.com/messaging/send/ (có dấu / cuối — đúng Pancake).
// Đường này ưu tiên; lỗi → fallback đường Mercury tối giản cũ (vẫn chạy tốt).

const PC_CTX_TTL_MS = 60 * 60 * 1000   // 1h — giống Pancake (base.lastLoadHtmlAt)
const _pcCtxCache = {}                 // pageId → { ctx, ts }
let _pcReqCount = 50                   // giống Base.request_count khởi tạo 50

// Port Base.ctxFromHtml — quét tham số phiên từ HTML trang inbox (regex, không cần offscreen
// eval: SiteData FB render ra JSON hợp lệ → JSON.parse được).
function pcParseCtx(html) {
  const ctx = {}
  const g = (re) => html.match(re)?.[1]
  ctx.userID = g(/\\?"USER_ID\\?":\\?"(\d+)\\?"/i) || g(/"ACCOUNT_ID"\s*:\s*"(\d+)"/)
  ctx.dtsg = g(/"DTSGInitData",\[\],\{"token":"([^"]+)"/) ||
             g(/"DTSGInitialData",\[\],\{"token":"([^"]+)"/) ||
             g(/name="fb_dtsg" value="([^"]+)"/)
  ctx.lsd = g(/"LSD",\[\],\{"token":"([^"]+)"/) || g(/name="lsd" value="([^"]+)"/)
  ctx.client_revision = g(/"client_revision":(\d+)/)
  // SprinkleConfig — quyết định cách tính jazoest
  const sp = html.match(/"SprinkleConfig",\[\],\{"param_name":"([^"]+)","version":(\d+),"should_randomize":(true|false)\}/)
  ctx.sprinkle = sp
    ? { param_name: sp[1], version: parseInt(sp[2]), should_randomize: sp[3] === 'true' }
    : { param_name: 'jazoest', version: 2, should_randomize: false }
  // SiteData — object cấu hình phiên (rev, hsi, spin...). Cắt khối {...} cân ngoặc rồi JSON.parse.
  const sdMark = html.indexOf('"SiteData",[],')
  if (sdMark > -1) {
    const brace = html.indexOf('{', sdMark)
    if (brace > -1) {
      const objStr = extractBalancedJson(html, brace)
      if (objStr) { try { ctx.SiteData = JSON.parse(objStr) } catch {} }
    }
  }
  return ctx
}

// Port Base.calcJazoest / calcJazoestV2.
function pcCalcJazoest(dtsg, sprinkle) {
  let sum = 0
  for (let i = 0; i < dtsg.length; i++) sum += dtsg.charCodeAt(i)
  if (sprinkle.version === 2) return sprinkle.should_randomize ? String(sum) : '2' + sum
  let s = ''
  for (let i = 0; i < dtsg.length; i++) s += dtsg.charCodeAt(i)
  return '2' + s
}

// Port Base.buildParams — tham số phiên gắn vào mọi request.
function pcBuildParams(ctx) {
  const t = { __user: ctx.userID || '0', __a: 1, __req: (_pcReqCount++).toString(36) }
  const sd = ctx.SiteData
  if (sd) {
    t.__csr = ''
    t.__beoa = sd.be_one_ahead ? 1 : 0
    if (sd.pkg_cohort != null) t.__pc = sd.pkg_cohort
    if (sd.pr != null) t.dpr = sd.pr
    t.__rev = sd.client_revision
    if (sd.hsi != null) t.__hsi = sd.hsi
    if (sd.haste_session != null) t.__hs = sd.haste_session
    t.__comet_req = sd.is_comet ? 1 : 0
    if (sd.spin) {
      t.__spin_r = sd.__spin_r
      t.__spin_b = sd.__spin_b
      t.__spin_t = sd.__spin_t
      // Pancake: __spin_dev_mhenv NẰM TRONG khối if(spin), chỉ khi có giá trị.
      if (sd.__spin_dev_mhenv) t.__spin_dev_mhenv = sd.__spin_dev_mhenv
    }
    // Pancake: force_blue CHỈ khi SiteData.force_blue (KHÔNG vô điều kiện như em sửa nhầm trước).
    if (sd.force_blue) t.force_blue = 1
    // (Pancake còn t.__s = webSession.getId() + __ccg từ WebConnectionClassServerGuess — VAESA
    //  chưa parse được 2 nguồn này nên bỏ giống Pancake-khi-không-có; KHÔNG bịa giá trị.)
  }
  if (!t.__rev && ctx.client_revision) t.__rev = ctx.client_revision
  if (ctx.dtsg) {
    t.fb_dtsg = ctx.dtsg
    t[ctx.sprinkle.param_name] = pcCalcJazoest(ctx.dtsg, ctx.sprinkle)
  }
  // Pancake buildParams dòng cuối: t.lsd = e.lsd → CÓ gửi lsd. KHÔI PHỤC (em đọc thiếu rồi
  // xoá nhầm ở commit trước — đây đúng là lỗi "đọc sót rồi suy diễn" anh nhắc).
  if (ctx.lsd) t.lsd = ctx.lsd
  return t
}

// Port Z.generateOfflineThreadingID + h().
function pcH(e) {
  let t = ''
  while (e !== '0') {
    let a = 0, s = ''
    for (let r = 0; r < e.length; r++) {
      a = a * 2 + parseInt(e[r], 10)
      if (a >= 10) { s += '1'; a -= 10 } else { s += '0' }
    }
    t = a.toString() + t
    e = s.slice(s.indexOf('1'))
  }
  return t
}
function pcOfflineThreadingID() {
  let e = Date.now()
  let t = Math.floor(Math.random() * 4294967296)
  t = ('0000000000000000000000' + t.toString(2)).slice(-22)
  e = e.toString(2) + t
  return pcH(e.slice(-63))
}

// Port InboxNormal.buildSendParams (nhánh facebook).
function pcBuildSendParams({ pageId, globalUid, text, imageIds, audioIds, videoIds, fileIds, ctx }) {
  const otid = pcOfflineThreadingID()
  let u = {
    body: text || '',
    offline_threading_id: otid,
    source: 'source:page_unified_inbox',
    timestamp: Date.now(),
    request_user_id: pageId,
  }
  // Pancake buildSendParams: Object.assign(u, buildParams(), { __usid: generateUsid() }) — và
  // generateUsid() TRẢ null → Pancake gửi __usid=null. KHÔI PHỤC (trước em xoá nhầm = lệch Pancake).
  u = Object.assign(u, pcBuildParams(ctx), { __usid: null })
  u['specific_to_list[0]'] = 'fbid:' + globalUid
  u['specific_to_list[1]'] = 'fbid:' + pageId
  u.other_user_fbid = globalUid
  u.message_id = otid
  u.client = 'mercury'
  u.action_type = 'ma-type:user-generated-message'
  u.ephemeral_ttl_mode = 0
  const hasAtt = !!(
    (imageIds && imageIds.length) ||
    (audioIds && audioIds.length) ||
    (videoIds && videoIds.length) ||
    (fileIds && fileIds.length)
  )
  u.has_attachment = hasAtt
  if (imageIds && imageIds.length) imageIds.forEach((id, i) => { u['image_ids[' + i + ']'] = id })
  if (audioIds && audioIds.length) audioIds.forEach((id, i) => { u['audio_ids[' + i + ']'] = id })
  if (videoIds && videoIds.length) videoIds.forEach((id, i) => { u['video_ids[' + i + ']'] = id })
  if (fileIds && fileIds.length)   fileIds.forEach((id, i)   => { u['file_ids['  + i + ']'] = id })
  return u
}

// Lấy ctx phiên cho page — cache 1h. force=true bỏ cache (warm/refresh).
async function pcGetCtx(pageId, force) {
  const c = _pcCtxCache[pageId]
  if (!force && c && Date.now() - c.ts < PC_CTX_TTL_MS) return c.ctx
  const url = `https://business.facebook.com/latest/inbox/messenger?asset_id=${encodeURIComponent(pageId)}`
  const res = await fetch(url, {
    credentials: 'include',
    headers: { accept: 'text/html,*/*', 'accept-language': 'en-US,en;q=0.9' },
  })
  if (!res.ok) throw new Error('Tải trang inbox lỗi HTTP ' + res.status)
  const ctx = pcParseCtx(await res.text())
  if (!ctx.dtsg) throw new Error('Không quét được fb_dtsg từ trang inbox')
  ctx.refererUrl = url
  _pcCtxCache[pageId] = { ctx, ts: Date.now() }
  console.log(`[VAESA Bridge] pcGetCtx OK page=${pageId} (dtsg+SiteData${ctx.SiteData ? '✓' : '✗'})`)
  return ctx
}

// Gửi 1 tin kiểu Pancake — POST business.facebook.com/messaging/send/.
async function sendViaPancake({ pageId, globalUid, text, imageIds, audioIds, videoIds, fileIds }) {
  if (!globalUid) throw new Error('sendViaPancake: thiếu UID khách')
  const ctx = await pcGetCtx(pageId)
  const params = pcBuildSendParams({ pageId, globalUid, text, imageIds, audioIds, videoIds, fileIds, ctx })
  const body = Object.keys(params)
    .map(k => encodeURIComponent(k) + '=' + encodeURIComponent(params[k]))
    .join('&')
  // Clone Pancake: trước khi gửi, đặt Referer của messaging/send = URL HỘP THƯ đúng trang
  // (makeInboxViewUrl). Pancake làm `va.set(sendUrl, inboxUrl)` trước mỗi send; thiếu bước này
  // FB anti-abuse coi request không đến từ trang inbox thật → chặn 1404132. (buildHeaders của
  // Pancake cho endpoint này gần như RỖNG nên KHÔNG kèm x-fb-lsd/x-asbd-id — đã verify source.)
  await setSendReferer(pageId)
  const res = await fetch('https://business.facebook.com/messaging/send/', {
    method: 'POST',
    credentials: 'include',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body,
  })
  const txt = await res.text()
  const parsed = parseFBResponse(txt)
  if (!parsed.ok) {
    // ctx có thể hết hạn (dtsg xoay) → bust cache để lần sau quét lại.
    if (/dtsg|csrf|1357\d{3}|login/i.test(parsed.error || '')) delete _pcCtxCache[pageId]
    throw new Error(parsed.error || 'Pancake send fail (HTTP ' + res.status + ')')
  }
  return parsed
}

// ============== TOP-LEVEL ACTIONS ==============

async function actionSendText({ pageId, threadId, threadKey, lastMessageMs, body, globalUid, customerName }) {
  const clientUid = globalUid || await calcGlobalUid({ pageId, threadId, threadKey, lastMessageMs, customerName })
  // Đường Pancake (port sendInbox) — ưu tiên.
  try {
    const r = await sendViaPancake({ pageId, globalUid: clientUid, text: body })
    return { ok: true, clientUid, payload: r.payload, via: 'pancake' }
  } catch (e) {
    console.warn('[VAESA Bridge] Pancake send fail, fallback Mercury cũ:', e?.message || e)
  }
  // Fallback: Mercury tối giản cũ (vẫn chạy tốt).
  const sendBody = await buildSendBody({ pageId, clientUid, text: body })
  const { text } = await sendFBMessage(sendBody)
  const parsed = parseFBResponse(text)
  if (!parsed.ok) throw new Error(parsed.error || 'Gửi thất bại')
  return { ok: true, clientUid, payload: parsed.payload, via: 'mercury' }
}

async function actionSendFile({ pageId, threadId, threadKey, lastMessageMs, body, files, globalUid, customerName }) {
  const clientUid = globalUid || await calcGlobalUid({ pageId, threadId, threadKey, lastMessageMs, customerName })

  // Upload từng file, gom theo loại (image / audio / video / file) — FB Mercury upload
  // trả KEY KHÁC NHAU theo mime input (`image_id` / `audio_id` / `video_id` / `file_id`),
  // và send params dùng field tương ứng (`image_ids[i]` / `audio_ids[i]`...).
  const byKind = { image: [], audio: [], video: [], file: [] }
  for (const f of files || []) {
    try {
      const up = await uploadOneFile({
        pageId,
        fileBase64: f.data,
        fileMime: f.type,
        fileName: f.name,
      })
      if (up?.id) (byKind[up.kind] || byKind.file).push(up.id)
    } catch (e) {
      console.warn('[VAESA Bridge] upload 1 file fail:', e?.message || e)
    }
  }
  const totalUploaded = byKind.image.length + byKind.audio.length + byKind.video.length + byKind.file.length
  if (!totalUploaded) throw new Error('Không upload được file nào')

  const sendArgs = {
    pageId, globalUid: clientUid, text: body,
    imageIds: byKind.image, audioIds: byKind.audio,
    videoIds: byKind.video, fileIds: byKind.file,
  }

  // Đường Pancake — ưu tiên.
  let pancakeErr = null
  try {
    const r = await sendViaPancake(sendArgs)
    return { ok: true, clientUid, attachments: byKind, payload: r.payload, via: 'pancake' }
  } catch (e) {
    pancakeErr = e
    console.warn('[VAESA Bridge] Pancake send (file) fail, fallback Mercury cũ:', e?.message || e)
  }
  // Fallback: Mercury tối giản cũ.
  let mercuryErr = null
  try {
    const sendBody = await buildSendBody({ pageId, clientUid, text: body,
      imageIds: byKind.image, audioIds: byKind.audio, videoIds: byKind.video, fileIds: byKind.file })
    const { text } = await sendFBMessage(sendBody)
    const parsed = parseFBResponse(text)
    if (!parsed.ok) throw new Error(parsed.error || 'Gửi thất bại')
    return { ok: true, clientUid, attachments: byKind, payload: parsed.payload, via: 'mercury' }
  } catch (e) {
    mercuryErr = e
  }
  // ĐÃ GỠ tầng socket/MQTT (2026-06-16): port từ Retion (tự mở WS trong service worker, tự bịa
  // khung MQTT) SAI kiến trúc → FB trả 502. Đối chiếu source Pancake thật (ext 0.5.48): extension
  // KHÔNG có code WebSocket/MQTT, cú gửi socket nằm ở web app; và Pancake coi 1545041 là cannotRetry
  // (chỉ socket cho 1545012/3252001/1390008). → báo lỗi sạch như Pancake.
  throw mercuryErr || pancakeErr || new Error('Gửi file thất bại')
}

// Gửi tin với fb_id ĐÃ có sẵn (web app lấy từ /contents/facebook is_reusable=false) — KHÔNG khiêng
// file ở máy. CLONE Pancake (verify MCP 2026-06-17): gửi ảnh >24h = tham chiếu image_ids → Mercury,
// ~1-2s. Dùng cho CHAT THỦ CÔNG (gửi 1-1). actionSendFile (upload bytes) giữ cho gửi loạt + fallback.
async function actionSendPreuploaded({ pageId, threadId, threadKey, lastMessageMs, body, globalUid, customerName, imageIds, videoIds, fileIds, audioIds }) {
  const clientUid = globalUid || await calcGlobalUid({ pageId, threadId, threadKey, lastMessageMs, customerName })
  const img = Array.isArray(imageIds) ? imageIds.filter(Boolean) : []
  const vid = Array.isArray(videoIds) ? videoIds.filter(Boolean) : []
  const fil = Array.isArray(fileIds) ? fileIds.filter(Boolean) : []
  const aud = Array.isArray(audioIds) ? audioIds.filter(Boolean) : []
  if (!img.length && !vid.length && !fil.length && !aud.length && !(body && body.trim())) {
    throw new Error('Không có nội dung gửi (preuploaded)')
  }
  const sendArgs = { pageId, globalUid: clientUid, text: body, imageIds: img, audioIds: aud, videoIds: vid, fileIds: fil }
  const attachments = { image: img, audio: aud, video: vid, file: fil }
  let pancakeErr = null
  try {
    const r = await sendViaPancake(sendArgs)
    return { ok: true, clientUid, attachments, payload: r.payload, via: 'pancake' }
  } catch (e) {
    pancakeErr = e
    console.warn('[VAESA Bridge] Pancake send (preuploaded) fail, fallback Mercury cũ:', e?.message || e)
  }
  const sendBody = await buildSendBody({ pageId, clientUid, text: body,
    imageIds: img, audioIds: aud, videoIds: vid, fileIds: fil })
  const { text } = await sendFBMessage(sendBody)
  const parsed = parseFBResponse(text)
  if (!parsed.ok) throw new Error(parsed.error || pancakeErr?.message || 'Gửi thất bại')
  return { ok: true, clientUid, attachments, payload: parsed.payload, via: 'mercury' }
}

async function actionStatus() {
  try {
    const fbCookie = await chrome.cookies.get({ url: 'https://www.facebook.com', name: 'c_user' })
    return {
      ok: true,
      version: chrome.runtime.getManifest().version,
      cUser: fbCookie?.value || null,
      dtsgCached: !!(_fbUser.dtsg && _fbUser.ttl > Date.now()),
      dtsgAgeMin: _fbUser.ttl ? Math.max(0, Math.round((_fbUser.ttl - Date.now()) / 60000)) : null,
      currentUID: _fbUser.currentUID || null,
    }
  } catch (e) {
    return { ok: false, error: String(e?.message || e) }
  }
}

// ============== MESSAGE LISTENER ==============

// ============== CRAWL META BUSINESS SUITE ==============
// Đọc danh sách hội thoại (threadList) từ React của trang MBS.
// Mở MBS trong 1 cửa sổ minimized → executeScript world MAIN đọc React fiber →
// trả [{name, uid, snippet, ts}] → đóng cửa sổ. uid = threadFBID = UID FB thật.

// ===== BẢN NHANH: gọi thẳng GraphQL search của MBS (~1-2s, không mở cửa sổ) =====
// Đã verify 2026-05-17: param BẮT BUỘC `av`=pageID (act-as-page) + header x-fb-lsd.
// Lấy fb_dtsg + lsd tươi từ trang business.facebook.com.
async function mbsFetchTokens() {
  const res = await fetch('https://business.facebook.com/latest/home', { credentials: 'include' })
  const html = await res.text()
  const dm = html.match(/"DTSGInitialData",\[\],\{"token":"([^"]+)"/)
  let lm = html.match(/\["LSD",\[\],\{"token":"([^"]+)"/)
  if (!lm) lm = html.match(/"lsd":\{"token":"([^"]+)"/)
  if (!dm) throw new Error('Không lấy được fb_dtsg từ business.facebook.com')
  if (!lm) throw new Error('Không lấy được lsd từ business.facebook.com')
  return { dtsg: dm[1], lsd: lm[1] }
}

// Gọi BizInboxCustomerRelaySearchSourceQuery → tìm khách theo tên.
// Trả [{name, uid, username}]. uid = data.page.page_unified_customer_search.edges[].node.user.id
async function mbsSearchUid(pageId, searchTerm) {
  const { dtsg, lsd } = await mbsFetchTokens()
  const body = new URLSearchParams()
  body.set('av', String(pageId)) // BẮT BUỘC — act as page, thiếu thì trả rỗng
  body.set('fb_dtsg', dtsg)
  body.set('lsd', lsd)
  body.set('fb_api_caller_class', 'RelayModern')
  body.set('fb_api_req_friendly_name', 'BizInboxCustomerRelaySearchSourceQuery')
  body.set('variables', JSON.stringify({
    pageID: String(pageId), count: 10, cursor: null,
    searchTerm: String(searchTerm), channel: 'ALL', selectedIgAssetId: null,
  }))
  body.set('doc_id', '26057142707244566')
  const res = await fetch('https://business.facebook.com/api/graphql/', {
    method: 'POST',
    credentials: 'include',
    headers: {
      'content-type': 'application/x-www-form-urlencoded',
      'x-fb-friendly-name': 'BizInboxCustomerRelaySearchSourceQuery',
      'x-fb-lsd': lsd,
      'x-asbd-id': '359341',
    },
    body: body.toString(),
  })
  const txt = await res.text()
  let data
  try { data = JSON.parse(txt) } catch (e) { throw new Error('GraphQL trả về không phải JSON (HTTP ' + res.status + ')') }
  if (data?.errors?.length) throw new Error('GraphQL error: ' + (data.errors[0]?.message || 'unknown'))
  const edges = data?.data?.page?.page_unified_customer_search?.edges || []
  return edges
    .map((e) => ({
      name: e?.node?.name || '',
      uid: String(e?.node?.user?.id || ''),
      username: e?.node?.user?.username || '',
    }))
    .filter((x) => x.uid)
}

// Hàm chạy TRONG trang MBS (world MAIN) — phải tự chứa, không tham chiếu ngoài.
// Quét MỌI React root (FB Comet có nhiều root) → lấy threadList (inbox mặc định,
// mỗi item có threadFBID = UID) + entry.messengerThreadID (kết quả ô tìm kiếm).
function mbsExtractThreadList() {
  function getFiber(el) {
    const k = Object.keys(el).find((x) => x.startsWith('__reactFiber$'))
    return k ? el[k] : null
  }
  function elText(n) {
    if (n == null) return ''
    if (typeof n === 'string' || typeof n === 'number') return String(n)
    if (Array.isArray(n)) return n.map(elText).join('')
    if (n && n.props && n.props.children !== undefined) return elText(n.props.children)
    return ''
  }
  const roots = []
  for (const el of document.querySelectorAll('body *')) {
    for (const k in el) {
      if (k.startsWith('__reactContainer$')) {
        try { const c = el[k]; if (c && c.current) roots.push(c.current) } catch (e) {}
      }
    }
    if (roots.length > 40) break
  }
  if (!roots.length) {
    for (const el of document.querySelectorAll('div,span,li')) {
      const f = getFiber(el)
      if (f) { let r = f, u = 0; while (r.return && u < 30000) { r = r.return; u++ } roots.push(r); break }
    }
  }
  let threadList = null
  const entries = []
  const seenE = new WeakSet()
  for (const root of roots) {
    const stack = [root]
    let guard = 0
    while (stack.length && guard < 250000) {
      guard++
      const f = stack.pop()
      if (!f) continue
      const p = f.memoizedProps
      if (p && typeof p === 'object') {
        if (!threadList && Array.isArray(p.threadList) && p.threadList[0] && p.threadList[0].threadFBID) {
          threadList = p.threadList
        }
        const e = p.entry
        if (e && typeof e === 'object' && e.messengerThreadID && !seenE.has(e)) {
          seenE.add(e); entries.push(e)
        }
      }
      if (f.child) stack.push(f.child)
      if (f.sibling) stack.push(f.sibling)
    }
  }
  const out = []
  if (threadList) {
    for (const t of threadList) {
      if (!t || !t.threadFBID) continue
      let sn = ''
      try { sn = elText(t.snippet).replace(/\s+/g, ' ').trim() } catch (e) {}
      out.push({ name: t.title || '', uid: String(t.threadFBID), snippet: sn.slice(0, 80), ts: Number(t.timestamp) || 0, src: 'list' })
    }
  }
  for (const e of entries) {
    out.push({ name: '', uid: String(e.messengerThreadID), snippet: '', ts: 0, src: 'search' })
  }
  if (!out.length) {
    let loginish = false
    try { loginish = !!document.querySelector('input[type="password"],input[name="email"],form[action*="login"]') } catch (e) {}
    return {
      ok: false, threads: [], searchCount: 0,
      diag: {
        title: (document.title || '').slice(0, 50),
        rootCount: roots.length,
        loginish,
        bodyLen: ((document.body && document.body.innerText) || '').length,
      },
    }
  }
  return { ok: true, threads: out, hasList: !!threadList, searchCount: entries.length }
}

// Gõ từ khoá vào ô tìm kiếm MBS (chạy world MAIN).
function mbsTypeSearch(query) {
  const inp = [...document.querySelectorAll('input')].find((i) => {
    const s = (i.placeholder || '') + ' ' + (i.getAttribute('aria-label') || '')
    return /Tìm kiếm|Search/i.test(s)
  })
  if (!inp) return { ok: false }
  inp.focus()
  const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set
  setter.call(inp, query)
  inp.dispatchEvent(new Event('input', { bubbles: true }))
  inp.dispatchEvent(new KeyboardEvent('keydown', { bubbles: true, key: 'a' }))
  inp.dispatchEvent(new KeyboardEvent('keyup', { bubbles: true, key: 'a' }))
  return { ok: true }
}

// payload: { pageId, query? } — query có → tìm kiếm trong MBS để quét user bất kỳ.
async function actionCrawlMbs(payload) {
  const pageId = String(payload?.pageId || '')
  const query = String(payload?.query || '').trim()
  if (!pageId) return { ok: false, error: 'Thiếu pageId' }
  console.log('[VAESA MBS] crawl start', { pageId, query })
  // BẢN NHANH — có query → gọi GraphQL search trực tiếp (~1-2s, KHÔNG mở cửa sổ).
  // Luôn trả kết quả/lỗi ở đây, không rơi xuống cửa sổ nữa.
  if (query) {
    try {
      const results = await mbsSearchUid(pageId, query)
      console.log('[VAESA MBS] graphql search', { hits: results.length })
      return {
        ok: true, mode: 'search', searchCount: results.length,
        threads: results.map((r) => ({ name: r.name, uid: r.uid, username: r.username, snippet: '', ts: 0, src: 'search' })),
      }
    } catch (e) {
      console.log('[VAESA MBS] graphql search FAIL:', String(e?.message || e))
      return { ok: false, error: 'MBS search: ' + String(e?.message || e) }
    }
  }
  const url = `https://business.facebook.com/latest/inbox/all/?asset_id=${encodeURIComponent(pageId)}&mailbox_id=${encodeURIComponent(pageId)}`
  let winId = null
  let tabId = null
  try {
    // Cửa sổ MBS phải FOCUS — minimized/không-focus bị Chrome throttle, FB Comet
    // không bung được danh sách hội thoại. Mở cửa sổ nhỏ ở góc, sẽ tự đóng sau ~1 phút.
    const win = await chrome.windows.create({ url, focused: true, width: 560, height: 680, top: 24, left: 24 })
    winId = win?.id
    tabId = win?.tabs?.[0]?.id
    if (!tabId) return { ok: false, error: 'Không mở được MBS' }
    await new Promise((resolve, reject) => {
      const to = setTimeout(() => { done(); reject(new Error('MBS tải quá lâu')) }, 30000)
      function onUpd(id, info) { if (id === tabId && info.status === 'complete') { done(); resolve() } }
      function done() { clearTimeout(to); chrome.tabs.onUpdated.removeListener(onUpd) }
      chrome.tabs.onUpdated.addListener(onUpd)
    })
    // Có query → gõ vào ô tìm kiếm MBS (sau khi trang render xong)
    if (query) {
      await new Promise((r) => setTimeout(r, 3000))
      for (let i = 0; i < 5; i++) {
        try {
          const o = await chrome.scripting.executeScript({ target: { tabId }, world: 'MAIN', func: mbsTypeSearch, args: [query] })
          if (o?.[0]?.result?.ok) break
        } catch (e) {}
        await new Promise((r) => setTimeout(r, 1000))
      }
      await new Promise((r) => setTimeout(r, 4000)) // chờ kết quả tìm kiếm
    }
    // Chờ FB Comet bung app inbox rồi mới poll
    await new Promise((r) => setTimeout(r, 4000))
    // Poll executeScript tới khi đọc được dữ liệu (FB Comet render chậm)
    let result = null
    let lastRes = null
    for (let i = 0; i < 45; i++) {
      await new Promise((r) => setTimeout(r, 1500))
      try {
        const out = await chrome.scripting.executeScript({ target: { tabId }, world: 'MAIN', func: mbsExtractThreadList })
        const res = out?.[0]?.result
        if (res) {
          lastRes = res
          if (res.ok && (query ? res.searchCount > 0 : res.threads.length)) { result = res; break }
        }
      } catch (e) {}
    }
    if (!result) {
      const d = lastRes?.diag
      console.log('[VAESA MBS] crawl FAIL', d)
      return { ok: false, error: 'Không đọc được dữ liệu MBS' + (d ? ' — ' + JSON.stringify(d) : ' (timeout/không render)') }
    }
    console.log('[VAESA MBS] crawl done', { mode: query ? 'search' : 'list', threads: result.threads.length, searchCount: result.searchCount })
    return { ok: true, threads: result.threads, mode: query ? 'search' : 'list', searchCount: result.searchCount || 0 }
  } catch (e) {
    return { ok: false, error: String(e?.message || e) }
  } finally {
    if (winId != null) { try { await chrome.windows.remove(winId) } catch (e) {} }
  }
}

// Khi extension được cài / cập nhật / reload — re-inject content.js vào mọi tab
// webapp đang mở để chúng nối lại extension mới (NV không phải tự F5 trang).
chrome.runtime.onInstalled.addListener(async () => {
  try {
    const tabs = await chrome.tabs.query({ url: 'https://vaesa-livechat.pages.dev/*' })
    for (const t of tabs) {
      if (!t.id) continue
      try {
        await chrome.scripting.executeScript({ target: { tabId: t.id }, files: ['content.js'] })
      } catch (e) {}
    }
  } catch (e) {}
})

chrome.runtime.onMessage.addListener((req, sender, sendResponse) => {
  console.log('[VAESA Bridge] msg in:', req?.action)
  const dispatch = async () => {
    switch (req?.action) {
      case 'VAESA_PING':
        return { ok: true, version: chrome.runtime.getManifest().version, alive: true }
      case 'VAESA_STATUS':
        return await actionStatus()
      case 'VAESA_REFRESH_DTSG':
        await loadDtsg()
        return { ok: true }
      case 'VAESA_CALC_UID':
        return { ok: true, globalUid: await calcGlobalUid(req.payload || {}) }
      case 'VAESA_LOOKUP_UID': {
        // Tra UID đã lưu (cache IDB + D1) — KHÔNG quét Facebook. Dùng lúc mở conv để
        // khôi phục UID đã quét lần trước → khỏi bấm avatar lại.
        const { pageId, threadId, psid } = req.payload || {}
        const keys = [threadId, psid].filter(Boolean).map(String)
        for (const k of keys) {
          const c = await getCachedUid(pageId, k)
          if (c) return { ok: true, globalUid: c }
        }
        for (const k of keys) {
          try {
            const row = await beGetMeta(pageId, k)
            if (row?.client_uid) {
              await setCachedUid(pageId, k, row.client_uid)
              return { ok: true, globalUid: String(row.client_uid) }
            }
          } catch {}
        }
        return { ok: true, globalUid: null }
      }
      case 'VAESA_WARM_UID': {
        // Warm UID khi NV mở hội thoại — light mode (cursor, không paginate).
        // Resolve được → write-through D1 (đã có sẵn trong calcGlobalUid). Fail thì im lặng.
        // Đồng thời warm ctx phiên Pancake (fire-and-forget) → lúc gửi tức thì.
        const wp = req.payload || {}
        if (wp.pageId) pcGetCtx(String(wp.pageId)).catch(() => {})
        try {
          const uid = await calcGlobalUid({ ...wp, lightMode: true })
          return { ok: true, globalUid: uid, warmed: true }
        } catch (e) {
          return { ok: true, warmed: false, reason: String(e?.message || e) }
        }
      }
      case 'VAESA_DEBUG_DNR': {
        // Debug — dump DNR rules + matched rules để xác minh rule edge-chat có áp dụng không.
        const rules = await chrome.declarativeNetRequest.getDynamicRules()
        let matched = null
        try {
          const mr = await chrome.declarativeNetRequest.getMatchedRules({})
          matched = mr?.rulesMatchedInfo?.map(x => ({ id: x.rule?.ruleId, ts: x.timeStamp })) || []
        } catch (e) { matched = 'err: ' + String(e?.message || e) }
        return {
          ok: true,
          ruleCount: rules.length,
          wsRule: rules.find(r => r.condition?.resourceTypes?.includes('websocket') && /edge-chat/.test(r.condition?.urlFilter || '')) || null,
          matched,
        }
      }
      case 'VAESA_SEND_TEXT':
        return await actionSendText(req.payload || {})
      case 'VAESA_SEND_FILE':
        return await actionSendFile(req.payload || {})
      case 'VAESA_SEND_PREUPLOADED':
        return await actionSendPreuploaded(req.payload || {})
      case 'VAESA_CLEAR_UID_CACHE': {
        const cleared = await idbClear()
        // Legacy: cũng dọn chrome.storage.local từ v3.0.x trước khi đổi sang IDB.
        const all = await chrome.storage.local.get(null)
        const legacyKeys = Object.keys(all).filter(k => k.startsWith('vaesa_uid_v3:'))
        if (legacyKeys.length) await chrome.storage.local.remove(legacyKeys)
        return { ok: true, cleared: cleared + legacyKeys.length }
      }
      case 'VAESA_RUN_INITIAL_SYNC':
        // Async: fire-and-forget, progress qua chrome.runtime.sendMessage broadcast.
        runInitialSync(req.payload || {}).catch((e) => console.error('[VAESA Bridge] sync error:', e?.message || e))
        return { ok: true, started: true }
      case 'VAESA_RUN_COMMENT_RESOLVE':
        runCommentResolve(req.payload || {}).catch((e) => console.error('[VAESA Bridge] comment resolve error:', e?.message || e))
        return { ok: true, started: true }
      case 'VAESA_RESOLVE_ONE_COMMENT':
        // Resolve 1 conv comment on-demand, trả UID ngay.
        // payload: { postId, commentId, customerName } — customerName cho CÁCH 3
        // searchCommentByUserName (cách ưu tiên của Pancake Oe.getComment).
        return { ok: true, globalUid: await resolveCommentGlobalId(req.payload || {}) }
      case 'VAESA_RESOLVE_ONE_INBOX': {
        // Resolve 1 conv inbox CŨ on-demand (Phase 2 — quét threadlist khớp tên).
        // payload: { pageId, customerName, convUpdatedMs, psid?, threadId?, threadKey? }
        const { pageId, customerName, convUpdatedMs, psid, threadId, threadKey } = req.payload || {}
        const uid = await resolveUidByName({ pageId, customerName, convUpdatedMs, threadId, threadKey, psid })
        // Cache theo khoá ổn định của conv cũ (PSID), fallback threadId.
        const cacheKey = psid || threadId
        if (cacheKey) {
          await setCachedUid(pageId, cacheKey, uid)
          await beSaveResolvedUid(pageId, cacheKey, threadKey || null, uid, convUpdatedMs || Date.now())
        }
        return { ok: true, globalUid: uid }
      }
      case 'VAESA_DEBUG_PC_CTX': {
        // Debug — quét ctx phiên Pancake, trả tóm tắt (không gửi gì).
        const { pageId } = req.payload || {}
        const ctx = await pcGetCtx(String(pageId), true)
        const sd = ctx.SiteData || {}
        const params = pcBuildSendParams({ pageId: String(pageId), globalUid: '100000000000000', text: 'x', ctx })
        return {
          ok: true,
          hasDtsg: !!ctx.dtsg, hasLsd: !!ctx.lsd, userID: ctx.userID || null,
          hasSiteData: !!ctx.SiteData,
          siteDataKeys: Object.keys(sd).slice(0, 30),
          sprinkle: ctx.sprinkle,
          jazoest: ctx.dtsg ? pcCalcJazoest(ctx.dtsg, ctx.sprinkle) : null,
          sendParamKeys: Object.keys(params),
        }
      }
      case 'VAESA_DEBUG_THREADLIST': {
        // Debug Phase 2 — threadlist fetch với FULL query_params kiểu Pancake findThread.
        const { pageId, beforeMs, tags } = req.payload || {}
        const dtsg = await getDtsg()
        const params = new URLSearchParams({
          batch_name: 'MessengerGraphQLThreadlistFetcher',
          av: String(pageId), fb_dtsg: dtsg,
          queries: JSON.stringify({ o0: {
            doc_id: DOC_ID_MESSAGE,
            query_params: {
              limit: 20, tags: tags || ['INBOX'], before: beforeMs,
              isWorkUser: false, includeDeliveryReceipts: true, includeSeqID: false,
              is_work_teamwork_not_putting_muted_in_unreads: false,
              threadlistViewFieldsOnly: false,
            },
          } }),
        })
        const res = await fetch(FB_GRAPHQL_URL, {
          method: 'POST', credentials: 'include',
          headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: params,
        })
        let text = await res.text()
        text = text.replace('{"successful_results":1,"error_results":0,"skipped_results":0}', '')
                   .replace('{"successful_results":0,"error_results":1,"skipped_results":0}', '')
        let json
        try { json = JSON.parse(text) } catch { return { ok: false, raw: text.slice(0, 400) } }
        const nodes = json?.o0?.data?.viewer?.message_threads?.nodes || []
        return {
          ok: true, count: nodes.length,
          errors: (json?.o0?.errors || []).map(e => e.message),
          sample: nodes.slice(0, 10).map(n => ({
            names: (n.all_participants?.edges || []).map(p => (p.node?.messaging_actor || {}).name)
                   .concat((n.all_participants?.nodes || []).map(p => (p.messaging_actor || {}).name)),
            other_user_id: n.thread_key?.other_user_id,
            thread_fbid: n.thread_key?.thread_fbid,
            updated: n.updated_time_precise,
            pageCommId: n.page_comm_item?.id,
          })),
        }
      }
      case 'VAESA_GET_SYNC_STATE':
        return await beGet('sync-state', { page_id: req.payload?.pageId || '' })
      case 'VAESA_RELOAD_SELF':
        // Tự reload extension — nạp lại code mới từ disk (unpacked ext).
        // Trả response TRƯỚC khi reload để webapp biết lệnh đã nhận.
        setTimeout(() => chrome.runtime.reload(), 300)
        return { ok: true, reloading: true }
      case 'VAESA_DEBUG_DUMP_THREAD': {
        // Debug only — fetch 1 raw thread of page và trả về toàn bộ object để inspect shape.
        const { pageId, beforeMs } = req.payload || {}
        const { threads } = await fetchThreadBatch(pageId, beforeMs || (Date.now() + 86400000), 1)
        return { ok: true, raw: threads[0] || null, keys: threads[0] ? Object.keys(threads[0]) : [] }
      }
      case 'VAESA_DEBUG_INBOX_HTML': {
        // Debug — fetch inbox HTML, trả về candidate IDs để tinh chỉnh parser.
        const { pageId, threadId } = req.payload || {}
        const html = await fetchInboxHtml(pageId, threadId)
        const grab = (re, n = 8) => [...new Set([...html.matchAll(re)].map(m => m[1]))].slice(0, n)
        return {
          ok: true,
          htmlLen: html.length,
          other_user_id: grab(/"other_user_id":"?(\d{6,})"?/g),
          messaging_actor: grab(/"messaging_actor":\{[^{}]*?"id":"(\d{6,})"/g),
          entity_id: grab(/entity_id=(\d{6,})/g),
          thread_fbid: grab(/"thread_fbid":"?(\d{6,})"?/g),
          parsed: extractInboxGlobalId(html, pageId, threadId),
        }
      }
      case 'VAESA_CRAWL_MBS':
        return await actionCrawlMbs(req.payload || {})
      default:
        return { ok: false, error: 'Unknown action: ' + req?.action }
    }
  }
  dispatch().then(sendResponse).catch((e) => {
    console.error('[VAESA Bridge] action error:', e?.message || e)
    sendResponse({ ok: false, error: String(e?.message || e) })
  })
  return true
})

// ============== AUTO-RELOAD KHI FILE DISK ĐƯỢC UPDATE ==============
// Vấn đề: update.bat (qua VBS Startup) overwrite các file extension trên disk, nhưng Chrome
// KHÔNG tự reload extension unpacked → runtime giữ bản cũ, NV phải tự bấm Reload ở chrome://extensions.
// Fix: mỗi 60s đọc lại manifest.json từ disk (qua chrome.runtime.getURL + cache no-cache), so
// version với bản đang chạy. Khác → chrome.runtime.reload() → Chrome reload, picks up bản mới.
const _VAESA_LOADED_VERSION = chrome.runtime.getManifest().version
async function _vaesaCheckDiskVersion() {
  try {
    const url = chrome.runtime.getURL('manifest.json') + '?t=' + Date.now()
    const res = await fetch(url, { cache: 'no-cache' })
    const m = await res.json()
    if (m?.version && m.version !== _VAESA_LOADED_VERSION) {
      console.log('[VAESA] disk = v' + m.version + ', runtime = v' + _VAESA_LOADED_VERSION + ' → reload')
      chrome.runtime.reload()
    }
  } catch {}
}
setInterval(_vaesaCheckDiskVersion, 60 * 1000)
_vaesaCheckDiskVersion()
