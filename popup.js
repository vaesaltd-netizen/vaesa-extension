const $status = document.getElementById('status')
const $log = document.getElementById('log')
const $refresh = document.getElementById('refresh')
const $clearCache = document.getElementById('clearCache')

function log(s) {
  const ts = new Date().toLocaleTimeString()
  $log.textContent = `[${ts}] ${s}\n` + $log.textContent
}

function call(action, payload) {
  return new Promise((resolve) => {
    try {
      chrome.runtime.sendMessage({ action, payload }, (r) => {
        const lastErr = chrome.runtime.lastError
        if (lastErr) return resolve({ ok: false, error: 'BG err: ' + lastErr.message })
        resolve(r || { ok: false, error: 'BG returned undefined' })
      })
      setTimeout(() => resolve({ ok: false, error: 'timeout 10s' }), 10000)
    } catch (e) {
      resolve({ ok: false, error: 'sendMessage threw: ' + e.message })
    }
  })
}

async function loadStatus() {
  $status.innerHTML = 'Đang ping background…'
  const ping = await call('VAESA_PING')
  if (!ping.ok) {
    $status.innerHTML = `<div class="err">❌ Background SW chết: ${ping.error}</div>`
    log('BG ping fail: ' + ping.error)
    return
  }
  const st = await call('VAESA_STATUS')
  if (!st.ok) {
    $status.innerHTML = `<div class="err">❌ STATUS lỗi: ${st.error}</div>`
    return
  }
  $status.innerHTML = `
    <div class="row"><span class="k">Version</span><span class="v">${st.version}</span></div>
    <div class="row"><span class="k">FB c_user (cookie)</span><span class="v ${st.cUser ? 'ok' : 'err'}">${st.cUser || 'chưa login'}</span></div>
    <div class="row"><span class="k">FB UID hiện tại</span><span class="v">${st.currentUID || '—'}</span></div>
    <div class="row"><span class="k">dtsg cache</span><span class="v ${st.dtsgCached ? 'ok' : 'err'}">${st.dtsgCached ? `OK (còn ${st.dtsgAgeMin}m)` : 'chưa scrape'}</span></div>
  `
}

$refresh.addEventListener('click', async () => {
  log('Refresh dtsg…')
  $refresh.disabled = true
  const r = await call('VAESA_REFRESH_DTSG')
  log(r.ok ? 'Refresh OK' : 'Refresh fail: ' + r.error)
  $refresh.disabled = false
  loadStatus()
})

$clearCache.addEventListener('click', async () => {
  log('Xoá UID cache…')
  $clearCache.disabled = true
  const r = await call('VAESA_CLEAR_UID_CACHE')
  log(r.ok ? `Đã xoá ${r.cleared} entries` : 'Xoá fail: ' + r.error)
  $clearCache.disabled = false
})

loadStatus()
