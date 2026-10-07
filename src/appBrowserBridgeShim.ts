/**
 * Runs at document start in every frame of an app tab (`AppBrowserGuestPlugin`).
 *
 * BRC-100 SDK clients `fetch` the loopback bridge. On the loopback socket any
 * app on the phone can claim any origin, so this carries those calls over the
 * tab's `handcashBrc100Channel` message channel instead, where the WebView
 * itself names the frame's origin. Pages keep using the SDK unchanged; a page
 * that talks to the channel directly gains nothing, because the origin never
 * comes from the message.
 *
 * Only string bodies are carried; anything else goes to the socket as before.
 * Plain JS in a string so no build step can rewrite it.
 */
export const APP_BROWSER_BRIDGE_CHANNEL = 'handcashBrc100Channel'

export const APP_BROWSER_BRIDGE_SHIM = String.raw`(function () {
  var channel = window.handcashBrc100Channel
  if (!channel || typeof channel.postMessage !== 'function' || window.__handcashBrc100Shim) return
  Object.defineProperty(window, '__handcashBrc100Shim', { value: true })
  var bridgeUrl = /^https?:\/\/(?:127\.0\.0\.1|localhost|\[::1\]):(?:3321|2121)(\/[^?#]*)/i
  var waiting = new Map()
  var next = 1
  channel.addEventListener('message', function (event) {
    var reply
    try { reply = JSON.parse(event.data) } catch (e) { return }
    var settle = reply && waiting.get(reply.id)
    if (!settle) return
    waiting.delete(reply.id)
    settle(reply)
  })
  var pageFetch = window.fetch.bind(window)
  window.fetch = function (input, init) {
    var request = typeof Request === 'function' && input instanceof Request ? input : null
    var url = request ? request.url : String(input && input.href !== undefined ? input.href : input)
    var match = bridgeUrl.exec(url)
    if (!match) return pageFetch(input, init)
    var method = String((init && init.method) || (request && request.method) || 'GET').toUpperCase()
    var body = init && init.body !== undefined ? Promise.resolve(init.body)
      : request && method !== 'GET' && method !== 'HEAD' ? request.clone().text()
      : Promise.resolve(null)
    return body.then(function (text) {
      if (text != null && typeof text !== 'string') return pageFetch(input, init)
      return new Promise(function (resolve, reject) {
        var id = next++
        waiting.set(id, function (reply) {
          var status = Number(reply.status)
          if (!(status >= 200 && status <= 599)) {
            reject(new TypeError('HandCash bridge unavailable'))
            return
          }
          var empty = status === 204 || status === 205 || status === 304
          resolve(new Response(empty ? null : String(reply.body || ''), {
            status: status,
            headers: { 'Content-Type': 'application/json; charset=utf-8' }
          }))
        })
        channel.postMessage(JSON.stringify({ id: id, method: method, path: match[1], body: text || '' }))
      })
    })
  }
})();`
