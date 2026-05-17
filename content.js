// VAESA Extension v3 — content script.
// Cầu nối giữa webapp (vaesa-livechat.pages.dev) và background service worker.
//
// Webapp postMessage:
//   { source: 'vaesa-app', action: '<ACTION>', reqId: '...', payload: {...} }
// Content script forward sang background, nhận response, postMessage lại:
//   { source: 'vaesa-ext', reqId: '...', result: {...} }

const EXT_VERSION = chrome.runtime.getManifest().version

// Announce ext installed cho webapp tự detect
window.postMessage({ source: 'vaesa-ext', action: 'INSTALLED', version: EXT_VERSION }, '*')

// Map từ webapp action → background action
const ACTION_MAP = {
  PING: 'VAESA_PING',
  STATUS: 'VAESA_STATUS',
  REFRESH_DTSG: 'VAESA_REFRESH_DTSG',
  CALC_UID: 'VAESA_CALC_UID',
  WARM_UID: 'VAESA_WARM_UID',
  WARM_SOCKET: 'VAESA_WARM_SOCKET',
  DEBUG_DNR: 'VAESA_DEBUG_DNR',
  SEND_TEXT: 'VAESA_SEND_TEXT',
  SEND_FILE: 'VAESA_SEND_FILE',
  SEND_TEXT_MQTT: 'VAESA_SEND_TEXT_MQTT',
  CLEAR_UID_CACHE: 'VAESA_CLEAR_UID_CACHE',
  RUN_INITIAL_SYNC: 'VAESA_RUN_INITIAL_SYNC',
  GET_SYNC_STATE: 'VAESA_GET_SYNC_STATE',
  DEBUG_DUMP_THREAD: 'VAESA_DEBUG_DUMP_THREAD',
  RELOAD_SELF: 'VAESA_RELOAD_SELF',
  RUN_COMMENT_RESOLVE: 'VAESA_RUN_COMMENT_RESOLVE',
  RESOLVE_ONE_COMMENT: 'VAESA_RESOLVE_ONE_COMMENT',
  RESOLVE_ONE_INBOX: 'VAESA_RESOLVE_ONE_INBOX',
  DEBUG_THREADLIST: 'VAESA_DEBUG_THREADLIST',
  DEBUG_INBOX_HTML: 'VAESA_DEBUG_INBOX_HTML',
  CRAWL_MBS: 'VAESA_CRAWL_MBS',
}

// Background → page push (sync progress, MQTT events...). Forward sang webapp qua postMessage.
chrome.runtime.onMessage.addListener((msg) => {
  if (msg && msg.source === 'vaesa-bridge') {
    window.postMessage(msg, '*')
  }
})

window.addEventListener('message', (e) => {
  if (e.source !== window) return
  const msg = e.data
  if (!msg || msg.source !== 'vaesa-app') return

  // Content script này bị orphan (extension đã reload) → im lặng, nhường cho
  // bản content.js mới (background re-inject khi onInstalled). Tránh trả lỗi
  // "Extension context invalidated".
  let ctxAlive = false
  try { ctxAlive = !!(chrome.runtime && chrome.runtime.id) } catch (err) {}
  if (!ctxAlive) return

  const reqId = msg.reqId
  const respond = (result) => {
    window.postMessage({ source: 'vaesa-ext', reqId, result }, '*')
  }

  // Local fast path: PING không cần qua background
  if (msg.action === 'PING') {
    respond({ ok: true, version: EXT_VERSION, alive: true })
    return
  }

  const bgAction = ACTION_MAP[msg.action]
  if (!bgAction) {
    respond({ ok: false, error: 'Unknown action: ' + msg.action })
    return
  }

  try {
    chrome.runtime.sendMessage({ action: bgAction, payload: msg.payload }, (r) => {
      const lastErr = chrome.runtime.lastError
      if (lastErr) return respond({ ok: false, error: 'BG err: ' + lastErr.message })
      respond(r || { ok: false, error: 'BG returned undefined' })
    })
  } catch (err) {
    respond({ ok: false, error: 'sendMessage threw: ' + err.message })
  }
})
