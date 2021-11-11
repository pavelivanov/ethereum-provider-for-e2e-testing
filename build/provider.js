/******/ (() => { // webpackBootstrap
/******/ 	var __webpack_modules__ = ({

/***/ "./node_modules/eth-provider/ConnectionManager/index.js":
/*!**************************************************************!*\
  !*** ./node_modules/eth-provider/ConnectionManager/index.js ***!
  \**************************************************************/
/***/ ((module, __unused_webpack_exports, __webpack_require__) => {

const EventEmitter = __webpack_require__(/*! events */ "./node_modules/events/events.js")

const dev = "development" === 'development'

class ConnectionManager extends EventEmitter {
  constructor (connections, targets, options) {
    super()
    this.targets = targets
    this.options = options
    this.connections = connections
    this.connected = false
    this.status = 'loading'
    this.interval = options.interval || 5000
    this.name = options.name || 'default'
    this.inSetup = true
    this.connect()
  }

  connect (index = 0) {
    if (dev && index === 0) console.log(`\n\n\n\nA connection cycle started for provider with name: ${this.name}`)

    if (this.connection && this.connection.status === 'connected' && index >= this.connection.index) {
      if (dev) console.log('Stopping connection cycle becasuse we\'re already connected to a higher priority provider')
    } else if (this.targets.length === 0) {
      if (dev) console.log('No valid targets supplied')
    } else {
      const { protocol, location } = this.targets[index]
      this.connection = this.connections[protocol](location, this.options)

      this.connection.on('error', err => {
        if (!this.connected) return this.connectionError(index, err)
        if (this.listenerCount('error')) return this.emit('error', err)
        console.warn('eth-provider - Uncaught connection error: ' + err.message)
      })

      this.connection.on('close', () => {
        this.connected = false
        this.emitClose()
        if (!this.closing) this.refresh()
      })

      this.connection.on('connect', () => {
        this.connection.target = this.targets[index]
        this.connection.index = index
        this.targets[index].status = this.connection.status
        this.connected = true
        this.inSetup = false
        if (dev) console.log('Successfully connected to: ' + this.targets[index].location)
        this.emit('connect')
      })

      this.connection.on('data', data => this.emit('data', data))
      this.connection.on('payload', payload => this.emit('payload', payload))
    }
  }

  refresh (interval = this.interval) {
    if (dev) console.log(`Reconnect queued for ${(interval / 1000).toFixed(2)}s in the future`)
    clearTimeout(this.connectTimer)
    this.connectTimer = setTimeout(() => this.connect(), interval)
  }

  connectionError (index, err) {
    if (this.connection && this.connection.close) this.connection.close()

    this.targets[index].status = err
    if (this.targets.length - 1 === index) {
      this.inSetup = false
      if (dev) console.warn('eth-provider unable to connect to any targets, view connection cycle summary: ', this.targets)
      this.refresh()
    } else { // Not last target, move on the next connection option
      this.connect(++index)
    }
  }

  emitClose () {
    this.emit('close')
  }

  close () {
    this.closing = true
    if (this.connection && this.connection.close && !this.connection.closed) {
      this.connection.close() // Let event bubble from here
    } else {
      this.emit('close')
    }
    clearTimeout(this.connectTimer)
    clearTimeout(this.setupTimer)
  }

  error (payload, message, code = -1) {
    this.emit('payload', { id: payload.id, jsonrpc: payload.jsonrpc, error: { message, code } })
  }

  send (payload) {
    if (this.inSetup) {
      this.setupTimer = setTimeout(() => this.send(payload), 100)
    } else if (this.connection.closed) {
      this.error(payload, 'Not connected', 4900)
    } else {
      this.connection.send(payload)
    }
  }
}

module.exports = ConnectionManager


/***/ }),

/***/ "./node_modules/eth-provider/browser.js":
/*!**********************************************!*\
  !*** ./node_modules/eth-provider/browser.js ***!
  \**********************************************/
/***/ ((module, __unused_webpack_exports, __webpack_require__) => {

const resolve = __webpack_require__(/*! ./resolve */ "./node_modules/eth-provider/resolve/index.js")
const provider = __webpack_require__(/*! ./provider */ "./node_modules/eth-provider/provider/index.js")
const presets = __webpack_require__(/*! ./presets */ "./node_modules/eth-provider/presets/index.js")

const injected = {
  ethereum: typeof window !== 'undefined' && typeof window.ethereum !== 'undefined' ? window.ethereum : null,
  web3: typeof window !== 'undefined' && typeof window.web3 !== 'undefined' ? window.web3.currentProvider : null
}
const ws = typeof window !== 'undefined' && typeof window.WebSocket !== 'undefined' ? window.WebSocket : null
const XHR = typeof window !== 'undefined' && typeof window.XMLHttpRequest !== 'undefined' ? window.XMLHttpRequest : null

if (injected.ethereum) injected.ethereum.__isProvider = true

const connections = {
  injected: injected.ethereum || __webpack_require__(/*! ./connections/injected */ "./node_modules/eth-provider/connections/injected.js")(injected.web3),
  ipc: __webpack_require__(/*! ./connections/unavailable */ "./node_modules/eth-provider/connections/unavailable.js")('IPC connections are unavliable in the browser'),
  ws: __webpack_require__(/*! ./connections/ws */ "./node_modules/eth-provider/connections/ws.js")(ws),
  http: __webpack_require__(/*! ./connections/http */ "./node_modules/eth-provider/connections/http.js")(XHR)
}

module.exports = (targets, options) => {
  if (targets && !Array.isArray(targets) && typeof targets === 'object' && !options) {
    options = targets
    targets = undefined
  }
  if (!targets) targets = ['injected', 'frame']
  if (!options) options = {}

  targets = [].concat(targets)

  targets.forEach(t => {
    if (t.startsWith('alchemy') && !options.alchemyId) throw new Error('Alchemy was included as a connection target but no Alchemy project ID was passed in options e.g. { alchemyId: \'123abc\' }')
    if (t.startsWith('infura') && !options.infuraId) throw new Error('Infura was included as a connection target but no Infura project ID was passed in options e.g. { infuraId: \'123abc\' }')
  })

  const sets = presets(options)

  return provider(connections, resolve(targets, sets), options)
}


/***/ }),

/***/ "./node_modules/eth-provider/connections/http.js":
/*!*******************************************************!*\
  !*** ./node_modules/eth-provider/connections/http.js ***!
  \*******************************************************/
/***/ ((module, __unused_webpack_exports, __webpack_require__) => {

const EventEmitter = __webpack_require__(/*! events */ "./node_modules/events/events.js")
const { v4: uuid } = __webpack_require__(/*! uuid */ "./node_modules/uuid/dist/esm-browser/index.js")

const dev = "development" === 'development'

let XHR

class HTTPConnection extends EventEmitter {
  constructor (_XHR, url, options) {
    super()
    XHR = _XHR
    this.options = options
    this.connected = false
    this.subscriptions = false
    this.status = 'loading'
    this.url = url
    this.pollId = uuid()
    setTimeout(() => this.create(), 0)
    this._emit = (...args) => !this.closed ? this.emit(...args) : null
  }

  create () {
    if (!XHR) return this._emit('error', new Error('No HTTP transport available'))
    this.on('error', () => { if (this.connected) this.close() })
    this.init()
  }

  init () {
    this.send({ jsonrpc: '2.0', method: 'net_version', params: [], id: 1 }, (err, response) => {
      if (err) return this._emit('error', err)
      this.connected = true
      this._emit('connect')
      this.send({ jsonrpc: '2.0', id: 1, method: 'eth_pollSubscriptions', params: [this.pollId, 'immediate'] }, (err, response) => {
        if (!err) {
          this.subscriptions = true
          this.pollSubscriptions()
        }
      })
    })
  }

  pollSubscriptions () {
    this.send({ jsonrpc: '2.0', id: 1, method: 'eth_pollSubscriptions', params: [this.pollId] }, (err, result) => {
      if (err) {
        this.subscriptionTimeout = setTimeout(() => this.pollSubscriptions(), 10000)
        return this._emit('error', err)
      } else {
        if (!this.closed) this.subscriptionTimeout = this.pollSubscriptions()
        if (result) {
          result.map(p => {
            let parse
            try { parse = JSON.parse(p) } catch (e) { parse = false }
            return parse
          }).filter(n => n).forEach(p => this._emit('payload', p))
        }
      }
    })
  }

  close () {
    if (dev) console.log('Closing HTTP connection')

    clearTimeout(this.subscriptionTimeout)

    this._emit('close')
    this.closed = true
    this.removeAllListeners()
  }

  filterStatus (res) {
    if (res.status >= 200 && res.status < 300) return res
    const error = new Error(res.statusText)
    error.res = res
    throw error.message
  }

  error (payload, message, code = -1) {
    this._emit('payload', { id: payload.id, jsonrpc: payload.jsonrpc, error: { message, code } })
  }

  send (payload, internal) {
    if (this.closed) return this.error(payload, 'Not connected')
    if (payload.method === 'eth_subscribe') {
      if (this.subscriptions) {
        payload.pollId = this.pollId
      } else {
        return this.error(payload, 'Subscriptions are not supported by this HTTP endpoint')
      }
    }
    const xhr = new XHR()
    let responded = false
    const res = (err, result) => {
      if (!responded) {
        xhr.abort()
        responded = true
        if (internal) {
          internal(err, result)
        } else {
          const { id, jsonrpc } = payload
          const load = err ? { id, jsonrpc, error: { message: err.message, code: err.code } } : { id, jsonrpc, result }
          this._emit('payload', load)
        }
      }
    }
    xhr.open('POST', this.url, true)
    xhr.setRequestHeader('Content-Type', 'application/json')
    // Below not working becasue XHR lib blocks it claiming "restricted header"
    // if (this.options.origin) xhr.setRequestHeader('Origin', this.options.origin)
    xhr.timeout = 60 * 1000
    xhr.onerror = res
    xhr.ontimeout = res
    xhr.onreadystatechange = () => {
      if (xhr.readyState === 4) {
        try {
          const response = JSON.parse(xhr.responseText)
          res(response.error, response.result)
        } catch (e) {
          res(e)
        }
      }
    }
    xhr.send(JSON.stringify(payload))
  }
}

module.exports = XHR => (url, options) => new HTTPConnection(XHR, url, options)


/***/ }),

/***/ "./node_modules/eth-provider/connections/injected.js":
/*!***********************************************************!*\
  !*** ./node_modules/eth-provider/connections/injected.js ***!
  \***********************************************************/
/***/ ((module, __unused_webpack_exports, __webpack_require__) => {

const EventEmitter = __webpack_require__(/*! events */ "./node_modules/events/events.js")

class InjectedConnection extends EventEmitter {
  constructor (_injected, options) {
    super()
    if (_injected) {
      setTimeout(() => this.emit('error', new Error('Injected web3 provider is not currently supported')), 0)
    } else {
      setTimeout(() => this.emit('error', new Error('No injected provider found')), 0)
    }
  }
}

module.exports = injected => options => new InjectedConnection(injected, options)


/***/ }),

/***/ "./node_modules/eth-provider/connections/unavailable.js":
/*!**************************************************************!*\
  !*** ./node_modules/eth-provider/connections/unavailable.js ***!
  \**************************************************************/
/***/ ((module, __unused_webpack_exports, __webpack_require__) => {

const EventEmitter = __webpack_require__(/*! events */ "./node_modules/events/events.js")

class UnavailableConnection extends EventEmitter {
  constructor (message) {
    super()
    setTimeout(() => this.emit('error', new Error(message)), 0)
  }
}

module.exports = message => () => new UnavailableConnection(message)


/***/ }),

/***/ "./node_modules/eth-provider/connections/ws.js":
/*!*****************************************************!*\
  !*** ./node_modules/eth-provider/connections/ws.js ***!
  \*****************************************************/
/***/ ((module, __unused_webpack_exports, __webpack_require__) => {

const EventEmitter = __webpack_require__(/*! events */ "./node_modules/events/events.js")
const parse = __webpack_require__(/*! ../parse */ "./node_modules/eth-provider/parse/index.js")
const dev = "development" === 'development'

let WebSocket

class WebSocketConnection extends EventEmitter {
  constructor (_WebSocket, url, options) {
    super()

    this.onError = this.onError.bind(this)
    this.onMessage = this.onMessage.bind(this)
    this.onOpen = this.onOpen.bind(this)
    this.onClose = this.onClose.bind(this)

    WebSocket = _WebSocket
    setTimeout(() => this.create(url, options), 0)
  }

  create (url, options) {
    if (!WebSocket) this.emit('error', new Error('No WebSocket transport available'))
    try { this.socket = new WebSocket(url, [], { origin: options.origin }) } catch (e) { return this.emit('error', e) }

    this.socket.addEventListener('error', this.onError)
    this.socket.addEventListener('open', this.onOpen)
    this.socket.addEventListener('close', this.onClose)
  }

  onOpen () {
    this.emit('connect')

    this.socket.addEventListener('message', this.onMessage)
  }

  onMessage (message) {
    const data = typeof message.data === 'string' ? message.data : ''
    parse(data, (err, payloads) => {
      if (err) return //
      payloads.forEach(load => {
        if (Array.isArray(load)) {
          load.forEach(payload => this.emit('payload', payload))
        } else {
          this.emit('payload', load)
        }
      })
    })
  }

  onError (err) {
    this.emit('error', err)
  }

  onClose (e) {
    clearTimeout(this.closeTimeout)

    if (this.socket) {
      this.socket.removeEventListener('open', this.onOpen)
      this.socket.removeEventListener('close', this.onClose)
      this.socket.removeEventListener('message', this.onMessage)
      this.socket.removeEventListener('error', this.onError)
      this.socket = null
    }

    this.closed = true

    if (dev) console.log(`Closing WebSocket connection, reason: ${e.reason} (code ${e.code})`)

    this.emit('close')
    this.removeAllListeners()
  }

  close () {
    if (this.socket) {
      this.socket.close()

      // give the socket close event some time to fire, otherwise we can clean up
      // and close everything manually
      this.closeTimeout = setTimeout(() => {
        this.onClose()
      }, 1000)
    } else {
      this.onClose()
    }
  }

  error (payload, message, code = -1) {
    this.emit('payload', { id: payload.id, jsonrpc: payload.jsonrpc, error: { message, code } })
  }

  send (payload) {
    if (this.socket && this.socket.readyState === this.socket.CONNECTING) {
      setTimeout(_ => this.send(payload), 10)
    } else if (!this.socket || this.socket.readyState > 1) {
      this.connected = false
      this.error(payload, 'Not connected')
    } else {
      this.socket.send(JSON.stringify(payload))
    }
  }
}

module.exports = WebSocket => (url, cb) => new WebSocketConnection(WebSocket, url, cb)


/***/ }),

/***/ "./node_modules/eth-provider/node_modules/ethereum-provider/index.js":
/*!***************************************************************************!*\
  !*** ./node_modules/eth-provider/node_modules/ethereum-provider/index.js ***!
  \***************************************************************************/
/***/ ((module, __unused_webpack_exports, __webpack_require__) => {

const EventEmitter = __webpack_require__(/*! events */ "./node_modules/events/events.js")

class EthereumProvider extends EventEmitter {
  constructor (connection) {
    super()

    this.enable = this.enable.bind(this)
    this._send = this._send.bind(this)
    this.send = this.send.bind(this)
    this._sendBatch = this._sendBatch.bind(this)
    this.subscribe = this.subscribe.bind(this)
    this.unsubscribe = this.unsubscribe.bind(this)
    this.sendAsync = this.sendAsync.bind(this)
    this.sendAsyncBatch = this.sendAsyncBatch.bind(this)
    this.isConnected = this.isConnected.bind(this)
    this.close = this.close.bind(this)
    this.request = this.request.bind(this)
    this.connected = false

    this.nextId = 1

    this.promises = {}
    this.subscriptions = []
    this.connection = connection
    this.connection.on('connect', () => this.checkConnection())
    this.connection.on('close', () => {
      this.connected = false
      this.emit('close')
      this.emit('disconnect')
    })
    this.connection.on('payload', payload => {
      const { id, method, error, result } = payload
      if (typeof id !== 'undefined') {
        if (this.promises[id]) { // Fulfill promise
          const requestMethod = this.promises[id].method
          if (requestMethod && ['eth_accounts', 'eth_requestAccounts'].includes(requestMethod)) {
            const accounts = result || []

            this.accounts = accounts
            this.selectedAddress = accounts[0]
            this.coinbase = accounts[0]
          }

          payload.error ? this.promises[id].reject(error) : this.promises[id].resolve(result)
          delete this.promises[id]
        }
      } else if (method && method.indexOf('_subscription') > -1) { // Emit subscription result
        // Events: connect, disconnect, chainChanged, accountsChanged, message
        this.emit(payload.params.subscription, payload.params.result)
        this.emit(method, payload.params) // Older EIP-1193
        this.emit('message', { // Latest EIP-1193
          type: payload.method,
          data: {
            subscription: payload.params.subscription,
            result: payload.params.result
          }
        })
        this.emit('data', payload) // Backwards Compatibility
      }
    })
    this.on('newListener', (event, listener) => {
      if (event === 'chainChanged' && !this.attemptedChainSubscription && this.connected) {
        this.startChainSubscription()
      } else if (event === 'accountsChanged' && !this.attemptedAccountsSubscription && this.connected) {
        this.startAccountsSubscription()
      } else if (event === 'networkChanged' && !this.attemptedNetworkSubscription && this.connected) {
        this.startNetworkSubscription()
        console.warn('The networkChanged event is being deprecated, use chainChainged instead')
      }
    })
  }

  async checkConnection (retry) {
    if (this.checkConnectionRunning || this.connected) return
    this.checkConnectionRunning = true
    try {
      this.networkVersion = await this._send('net_version', [], false)
      this.chainId = await this._send('eth_chainId', [], false)

      this.checkConnectionRunning = false
      this.connected = true
      this.emit('connect', { chainId: this.chainId })

      clearTimeout(this.checkConnectionTimer)

      if (this.listenerCount('networkChanged') && !this.attemptedNetworkSubscription) this.startNetworkSubscription()
      if (this.listenerCount('chainChanged') && !this.attemptedChainSubscription) this.startNetworkSubscription()
      if (this.listenerCount('accountsChanged') && !this.attemptedAccountsSubscription) this.startAccountsSubscription()
    } catch (e) {
      if (!retry) setTimeout(() => this.checkConnection(true), 1000)
      this.checkConnectionTimer = setInterval(() => this.checkConnection(true), 4000)
      this.checkConnectionRunning = false
      this.connected = false
    }
  }

  async startNetworkSubscription () {
    this.attemptedNetworkSubscription = true
    try {
      const networkChanged = await this.subscribe('eth_subscribe', 'networkChanged')
      this.on(networkChanged, netId => {
        this.networkVersion = netId
        this.emit('networkChanged', netId)
      })
    } catch (e) {
      console.warn('Unable to subscribe to networkChanged', e)
    }
  }

  async startChainSubscription () {
    this.attemptedChainSubscription = true
    try {
      const chainChanged = await this.subscribe('eth_subscribe', 'chainChanged')
      this.on(chainChanged, netId => {
        this.chainId = netId
        this.emit('chainChanged', netId)
      })
    } catch (e) {
      console.warn('Unable to subscribe to chainChanged', e)
    }
  }

  async startAccountsSubscription () {
    this.attemptedAccountsSubscription = true
    try {
      const accountsChanged = await this.subscribe('eth_subscribe', 'accountsChanged')
      this.on(accountsChanged, accounts => {
        this.selectedAddress = accounts[0]
        this.emit('accountsChanged', accounts)
      })
    } catch (e) {
      console.warn('Unable to subscribe to accountsChanged', e)
    }
  }

  enable () {
    return new Promise((resolve, reject) => {
      this._send('eth_accounts').then(accounts => {
        if (accounts.length > 0) {
          this.accounts = accounts
          this.selectedAddress = accounts[0]
          this.coinbase = accounts[0]

          this.emit('enable')

          resolve(accounts)
        } else {
          const err = new Error('User Denied Full Provider')
          err.code = 4001
          reject(err)
        }
      }).catch(reject)
    })
  }

  _send (method, params = [], waitForConnection = true) {
    const sendFn = (resolve, reject) => {
      let payload
      if (typeof method === 'object' && method !== null) {
        payload = method
        payload.params = payload.params || []
        payload.jsonrpc = '2.0'
        payload.id = this.nextId++
      } else {
        payload = { jsonrpc: '2.0', id: this.nextId++, method, params }
      }
      this.promises[payload.id] = { resolve, reject, method }
      if (!payload.method || typeof payload.method !== 'string') {
        this.promises[payload.id].reject(new Error('Method is not a valid string.'))
        delete this.promises[payload.id]
      } else if (!(payload.params instanceof Array)) {
        this.promises[payload.id].reject(new Error('Params is not a valid array.'))
        delete this.promises[payload.id]
      } else {
        this.connection.send(payload)
      }
    }

    if (this.connected || !waitForConnection) {
      return new Promise(sendFn)
    }

    return new Promise((resolve, reject) => {
      const resolveSend = () => {
        clearTimeout(disconnectTimer)
        return resolve(new Promise(sendFn))
      }

      const disconnectTimer = setTimeout(() => {
        this.off('connect', resolveSend)
        reject(new Error('Not connected'))
      }, 5000)

      this.once('connect', resolveSend)
    })
  }

  send (methodOrPayload, callbackOrArgs) { // Send can be clobbered, proxy sendPromise for backwards compatibility
    if (
      typeof methodOrPayload === 'string' &&
      (!callbackOrArgs || Array.isArray(callbackOrArgs))
    ) {
      return this._send(methodOrPayload, callbackOrArgs)
      }

    if (
      methodOrPayload &&
      typeof methodOrPayload === 'object' &&
      typeof callbackOrArgs === 'function'
    ) {
      // a callback was passed to send(), forward everything to sendAsync()
      return this.sendAsync(methodOrPayload, callbackOrArgs)
    }

    return this.request(methodOrPayload)
  }

  _sendBatch (requests) {
    return Promise.all(requests.map(payload => this._send(payload.method, payload.params)))
  }

  subscribe (type, method, params = []) {
    return this._send(type, [method, ...params]).then(id => {
      this.subscriptions.push(id)
      return id
    })
  }

  unsubscribe (type, id) {
    return this._send(type, [id]).then(success => {
      if (success) {
        this.subscriptions = this.subscriptions.filter(_id => _id !== id) // Remove subscription
        this.removeAllListeners(id) // Remove listeners
        return success
      }
    })
  }

  sendAsync (payload, cb) { // Backwards Compatibility
    if (!cb || typeof cb !== 'function') return cb(new Error('Invalid or undefined callback provided to sendAsync'))
    if (!payload) return cb(new Error('Invalid Payload'))
    // sendAsync can be called with an array for batch requests used by web3.js 0.x
    // this is not part of EIP-1193's backwards compatibility but we still want to support it
    payload.jsonrpc = '2.0'
    payload.id = payload.id || this.nextId++
    if (payload instanceof Array) {
      return this.sendAsyncBatch(payload, cb)
    } else {
      return this._send(payload.method, payload.params).then(result => {
        cb(null, { id: payload.id, jsonrpc: payload.jsonrpc, result })
      }).catch(err => {
        cb(err)
      })
    }
  }

  sendAsyncBatch (payload, cb) {
    return this._sendBatch(payload).then((results) => {
      const result = results.map((entry, index) => {
        return { id: payload[index].id, jsonrpc: payload[index].jsonrpc, result: entry }
      })
      cb(null, result)
    }).catch(err => {
      cb(err)
    })
  }

  // _sendSync (payload) {
  //   let result

  //   switch (payload.method) {
  //     case 'eth_accounts':
  //       result = this.selectedAddress ? [this.selectedAddress] : []
  //       break

  //     case 'eth_coinbase':
  //       result = this.selectedAddress || null
  //       break

  //     case 'eth_uninstallFilter':
  //       this._send(payload)
  //       result = true

  //     case 'net_version':
  //       result = this.networkVersion || null
  //       break

  //     default:
  //       throw new Error(`unsupported method ${payload.method}`)
  //   }

  //   return {
  //     id: payload.id,
  //     jsonrpc: payload.jsonrpc,
  //     result
  //   }
  // }

  isConnected () { // Backwards Compatibility
    return this.connected
  }

  close () {
    if (this.connection && this.connection.close) this.connection.close()
    this.connected = false
    const error = new Error('Provider closed, subscription lost, please subscribe again.')
    this.subscriptions.forEach(id => this.emit(id, error)) // Send Error objects to any open subscriptions
    this.subscriptions = [] // Clear subscriptions

    this.chainId = undefined
    this.networkVersion = undefined
    this.selectedAddress = undefined
  }

  request (payload) {
    return this._send(payload.method, payload.params)
  }
}

module.exports = EthereumProvider


/***/ }),

/***/ "./node_modules/eth-provider/parse/index.js":
/*!**************************************************!*\
  !*** ./node_modules/eth-provider/parse/index.js ***!
  \**************************************************/
/***/ ((module) => {

let last, timeout

module.exports = (res, cb) => {
  const values = []
  res
    .replace(/\}[\n\r]?\{/g, '}|--|{') // }{
    .replace(/\}\][\n\r]?\[\{/g, '}]|--|[{') // }][{
    .replace(/\}[\n\r]?\[\{/g, '}|--|[{') // }[{
    .replace(/\}\][\n\r]?\{/g, '}]|--|{') // }]{
    .split('|--|')
    .forEach(data => {
      if (last) data = last + data // prepend the last chunk
      let result
      try {
        result = JSON.parse(data)
      } catch (e) {
        last = data
        clearTimeout(timeout) // restart timeout
        timeout = setTimeout(() => cb(new Error('Parse response timeout')), 15 * 1000)
        return
      }
      clearTimeout(timeout)
      last = null
      if (result) values.push(result)
    })
  cb(null, values)
}


/***/ }),

/***/ "./node_modules/eth-provider/presets/index.js":
/*!****************************************************!*\
  !*** ./node_modules/eth-provider/presets/index.js ***!
  \****************************************************/
/***/ ((module) => {

module.exports = (options = {}) => {
  return {
    injected: ['injected'],
    frame: ['ws://127.0.0.1:1248', 'http://127.0.0.1:1248'],
    direct: ['ws://127.0.0.1:8546', 'http://127.0.0.1:8545'], // IPC paths will be prepended in Node/Electron
    infura: [`wss://mainnet.infura.io/ws/v3/${options.infuraId}`, `https://mainnet.infura.io/v3/${options.infuraId}`],
    alchemy: [`wss://eth-mainnet.ws.alchemyapi.io/v2/${options.alchemyId}`, `https://eth-mainnet.alchemyapi.io/v2/${options.alchemyId}`],
    infuraRopsten: [`wss://ropsten.infura.io/ws/v3/${options.infuraId}`, `https://ropsten.infura.io/v3/${options.infuraId}`],
    alchemyRopsten: [`wss://eth-ropsten.ws.alchemyapi.io/v2/${options.alchemyId}`, `https://eth-ropsten.alchemyapi.io/v2/${options.alchemyId}`],
    infuraRinkeby: [`wss://rinkeby.infura.io/ws/v3/${options.infuraId}`, `https://rinkeby.infura.io/v3/${options.infuraId}`],
    alchemyRinkeby: [`wss://eth-rinkeby.ws.alchemyapi.io/v2/${options.alchemyId}`, `https://eth-rinkeby.alchemyapi.io/v2/${options.alchemyId}`],
    infuraKovan: [`wss://kovan.infura.io/ws/v3/${options.infuraId}`, `https://kovan.infura.io/v3/${options.infuraId}`],
    alchemyKovan: [`wss://eth-kovan.ws.alchemyapi.io/v2/${options.alchemyId}`, `https://eth-kovan.alchemyapi.io/v2/${options.alchemyId}`],
    infuraGoerli: [`wss://goerli.infura.io/ws/v3/${options.infuraId}`, `https://goerli.infura.io/ws/v3/${options.infuraId}`],
    alchemyGoerli: [`wss://eth-goerli.ws.alchemyapi.io/v2/${options.alchemyId}`, `https://eth-goerli.alchemyapi.io/v2/${options.alchemyId}`],
    infuraPolygon: [`wss://polygon-mainnet.infura.io/ws/v3/${options.infuraId}`, `https://polygon-mainnet.infura.io/v3/${options.infuraId}`],
    infuraArbitrum: [`wss://arbitrum-mainnet.infura.io/ws/v3/${options.infuraId}`, `https://arbitrum-mainnet.infura.io/v3/${options.infuraId}`],
    infuraOptimism: [`wss://optimism-mainnet.infura.io/ws/v3/${options.infuraId}`, `https://optimism-mainnet.infura.io/v3/${options.infuraId}`],
    idChain: ['wss://idchain.one/ws/'],
    xDai: ['https://rpc.xdaichain.com', 'https://dai.poa.network'],
    optimism: ['https://mainnet.optimism.io']
  }
}


/***/ }),

/***/ "./node_modules/eth-provider/provider/index.js":
/*!*****************************************************!*\
  !*** ./node_modules/eth-provider/provider/index.js ***!
  \*****************************************************/
/***/ ((module, __unused_webpack_exports, __webpack_require__) => {

const EventEmitter = __webpack_require__(/*! events */ "./node_modules/events/events.js")
const EthereumProvider = __webpack_require__(/*! ethereum-provider */ "./node_modules/eth-provider/node_modules/ethereum-provider/index.js")
const ConnectionManager = __webpack_require__(/*! ../ConnectionManager */ "./node_modules/eth-provider/ConnectionManager/index.js")

const monitor = provider => {
  function update (status) {
    provider.status = status
    if (provider instanceof EventEmitter) provider.emit('status', status)
  }

  async function checkSyncing () {
    try {
      if (await provider.send('eth_syncing')) {
        update('syncing')
      }
    } catch (e) {
      // don't do anything if it can't be determined whether the node is syncing or not
    }
  }

  async function checkConnected () {
    if (provider.inSetup) return setTimeout(checkConnected, 1000)

    try {
      await provider.send('eth_chainId')
      update('connected')

      setTimeout(checkSyncing, 500)
    } catch (e) {
      update('disconnected')
    }
  }

  update('loading')
  checkConnected()
  provider.on('connect', () => checkConnected())
  provider.on('close', () => update('disconnected'))
  return provider
}

module.exports = (connections, targets, options) => {
  // If window.ethereum and injected is a target in any priority, return ethereum provider
  if (connections.injected.__isProvider && targets.map(t => t.type).indexOf('injected') > -1) {
    delete connections.injected.__isProvider
    return monitor(connections.injected)
  }
  const provider = new EthereumProvider(new ConnectionManager(connections, targets, options))
  provider.setMaxListeners(128)
  return monitor(provider)
}


/***/ }),

/***/ "./node_modules/eth-provider/resolve/index.js":
/*!****************************************************!*\
  !*** ./node_modules/eth-provider/resolve/index.js ***!
  \****************************************************/
/***/ ((module) => {

const getProtocol = location => {
  if (location === 'injected') return 'injected'
  if (location.endsWith('.ipc')) return 'ipc'
  if (location.startsWith('wss://') || location.startsWith('ws://')) return 'ws'
  if (location.startsWith('https://') || location.startsWith('http://')) return 'http'
  return ''
}

module.exports = (targets, presets) => {
  return [].concat(...[].concat(targets).map(provider => {
    if (presets[provider]) {
      return presets[provider].map(location => ({ type: provider, location, protocol: getProtocol(location) }))
    } else {
      return { type: 'custom', location: provider, protocol: getProtocol(provider) }
    }
  })).filter(provider => {
    if (provider.protocol || provider.type === 'injected') {
      return true
    } else {
      console.log('eth-provider | Invalid provider preset/location: "' + provider.location + '"')
      return false
    }
  })
}


/***/ }),

/***/ "./node_modules/events/events.js":
/*!***************************************!*\
  !*** ./node_modules/events/events.js ***!
  \***************************************/
/***/ ((module) => {

"use strict";
// Copyright Joyent, Inc. and other Node contributors.
//
// Permission is hereby granted, free of charge, to any person obtaining a
// copy of this software and associated documentation files (the
// "Software"), to deal in the Software without restriction, including
// without limitation the rights to use, copy, modify, merge, publish,
// distribute, sublicense, and/or sell copies of the Software, and to permit
// persons to whom the Software is furnished to do so, subject to the
// following conditions:
//
// The above copyright notice and this permission notice shall be included
// in all copies or substantial portions of the Software.
//
// THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS
// OR IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF
// MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN
// NO EVENT SHALL THE AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM,
// DAMAGES OR OTHER LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR
// OTHERWISE, ARISING FROM, OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE
// USE OR OTHER DEALINGS IN THE SOFTWARE.



var R = typeof Reflect === 'object' ? Reflect : null
var ReflectApply = R && typeof R.apply === 'function'
  ? R.apply
  : function ReflectApply(target, receiver, args) {
    return Function.prototype.apply.call(target, receiver, args);
  }

var ReflectOwnKeys
if (R && typeof R.ownKeys === 'function') {
  ReflectOwnKeys = R.ownKeys
} else if (Object.getOwnPropertySymbols) {
  ReflectOwnKeys = function ReflectOwnKeys(target) {
    return Object.getOwnPropertyNames(target)
      .concat(Object.getOwnPropertySymbols(target));
  };
} else {
  ReflectOwnKeys = function ReflectOwnKeys(target) {
    return Object.getOwnPropertyNames(target);
  };
}

function ProcessEmitWarning(warning) {
  if (console && console.warn) console.warn(warning);
}

var NumberIsNaN = Number.isNaN || function NumberIsNaN(value) {
  return value !== value;
}

function EventEmitter() {
  EventEmitter.init.call(this);
}
module.exports = EventEmitter;
module.exports.once = once;

// Backwards-compat with node 0.10.x
EventEmitter.EventEmitter = EventEmitter;

EventEmitter.prototype._events = undefined;
EventEmitter.prototype._eventsCount = 0;
EventEmitter.prototype._maxListeners = undefined;

// By default EventEmitters will print a warning if more than 10 listeners are
// added to it. This is a useful default which helps finding memory leaks.
var defaultMaxListeners = 10;

function checkListener(listener) {
  if (typeof listener !== 'function') {
    throw new TypeError('The "listener" argument must be of type Function. Received type ' + typeof listener);
  }
}

Object.defineProperty(EventEmitter, 'defaultMaxListeners', {
  enumerable: true,
  get: function() {
    return defaultMaxListeners;
  },
  set: function(arg) {
    if (typeof arg !== 'number' || arg < 0 || NumberIsNaN(arg)) {
      throw new RangeError('The value of "defaultMaxListeners" is out of range. It must be a non-negative number. Received ' + arg + '.');
    }
    defaultMaxListeners = arg;
  }
});

EventEmitter.init = function() {

  if (this._events === undefined ||
      this._events === Object.getPrototypeOf(this)._events) {
    this._events = Object.create(null);
    this._eventsCount = 0;
  }

  this._maxListeners = this._maxListeners || undefined;
};

// Obviously not all Emitters should be limited to 10. This function allows
// that to be increased. Set to zero for unlimited.
EventEmitter.prototype.setMaxListeners = function setMaxListeners(n) {
  if (typeof n !== 'number' || n < 0 || NumberIsNaN(n)) {
    throw new RangeError('The value of "n" is out of range. It must be a non-negative number. Received ' + n + '.');
  }
  this._maxListeners = n;
  return this;
};

function _getMaxListeners(that) {
  if (that._maxListeners === undefined)
    return EventEmitter.defaultMaxListeners;
  return that._maxListeners;
}

EventEmitter.prototype.getMaxListeners = function getMaxListeners() {
  return _getMaxListeners(this);
};

EventEmitter.prototype.emit = function emit(type) {
  var args = [];
  for (var i = 1; i < arguments.length; i++) args.push(arguments[i]);
  var doError = (type === 'error');

  var events = this._events;
  if (events !== undefined)
    doError = (doError && events.error === undefined);
  else if (!doError)
    return false;

  // If there is no 'error' event listener then throw.
  if (doError) {
    var er;
    if (args.length > 0)
      er = args[0];
    if (er instanceof Error) {
      // Note: The comments on the `throw` lines are intentional, they show
      // up in Node's output if this results in an unhandled exception.
      throw er; // Unhandled 'error' event
    }
    // At least give some kind of context to the user
    var err = new Error('Unhandled error.' + (er ? ' (' + er.message + ')' : ''));
    err.context = er;
    throw err; // Unhandled 'error' event
  }

  var handler = events[type];

  if (handler === undefined)
    return false;

  if (typeof handler === 'function') {
    ReflectApply(handler, this, args);
  } else {
    var len = handler.length;
    var listeners = arrayClone(handler, len);
    for (var i = 0; i < len; ++i)
      ReflectApply(listeners[i], this, args);
  }

  return true;
};

function _addListener(target, type, listener, prepend) {
  var m;
  var events;
  var existing;

  checkListener(listener);

  events = target._events;
  if (events === undefined) {
    events = target._events = Object.create(null);
    target._eventsCount = 0;
  } else {
    // To avoid recursion in the case that type === "newListener"! Before
    // adding it to the listeners, first emit "newListener".
    if (events.newListener !== undefined) {
      target.emit('newListener', type,
                  listener.listener ? listener.listener : listener);

      // Re-assign `events` because a newListener handler could have caused the
      // this._events to be assigned to a new object
      events = target._events;
    }
    existing = events[type];
  }

  if (existing === undefined) {
    // Optimize the case of one listener. Don't need the extra array object.
    existing = events[type] = listener;
    ++target._eventsCount;
  } else {
    if (typeof existing === 'function') {
      // Adding the second element, need to change to array.
      existing = events[type] =
        prepend ? [listener, existing] : [existing, listener];
      // If we've already got an array, just append.
    } else if (prepend) {
      existing.unshift(listener);
    } else {
      existing.push(listener);
    }

    // Check for listener leak
    m = _getMaxListeners(target);
    if (m > 0 && existing.length > m && !existing.warned) {
      existing.warned = true;
      // No error code for this since it is a Warning
      // eslint-disable-next-line no-restricted-syntax
      var w = new Error('Possible EventEmitter memory leak detected. ' +
                          existing.length + ' ' + String(type) + ' listeners ' +
                          'added. Use emitter.setMaxListeners() to ' +
                          'increase limit');
      w.name = 'MaxListenersExceededWarning';
      w.emitter = target;
      w.type = type;
      w.count = existing.length;
      ProcessEmitWarning(w);
    }
  }

  return target;
}

EventEmitter.prototype.addListener = function addListener(type, listener) {
  return _addListener(this, type, listener, false);
};

EventEmitter.prototype.on = EventEmitter.prototype.addListener;

EventEmitter.prototype.prependListener =
    function prependListener(type, listener) {
      return _addListener(this, type, listener, true);
    };

function onceWrapper() {
  if (!this.fired) {
    this.target.removeListener(this.type, this.wrapFn);
    this.fired = true;
    if (arguments.length === 0)
      return this.listener.call(this.target);
    return this.listener.apply(this.target, arguments);
  }
}

function _onceWrap(target, type, listener) {
  var state = { fired: false, wrapFn: undefined, target: target, type: type, listener: listener };
  var wrapped = onceWrapper.bind(state);
  wrapped.listener = listener;
  state.wrapFn = wrapped;
  return wrapped;
}

EventEmitter.prototype.once = function once(type, listener) {
  checkListener(listener);
  this.on(type, _onceWrap(this, type, listener));
  return this;
};

EventEmitter.prototype.prependOnceListener =
    function prependOnceListener(type, listener) {
      checkListener(listener);
      this.prependListener(type, _onceWrap(this, type, listener));
      return this;
    };

// Emits a 'removeListener' event if and only if the listener was removed.
EventEmitter.prototype.removeListener =
    function removeListener(type, listener) {
      var list, events, position, i, originalListener;

      checkListener(listener);

      events = this._events;
      if (events === undefined)
        return this;

      list = events[type];
      if (list === undefined)
        return this;

      if (list === listener || list.listener === listener) {
        if (--this._eventsCount === 0)
          this._events = Object.create(null);
        else {
          delete events[type];
          if (events.removeListener)
            this.emit('removeListener', type, list.listener || listener);
        }
      } else if (typeof list !== 'function') {
        position = -1;

        for (i = list.length - 1; i >= 0; i--) {
          if (list[i] === listener || list[i].listener === listener) {
            originalListener = list[i].listener;
            position = i;
            break;
          }
        }

        if (position < 0)
          return this;

        if (position === 0)
          list.shift();
        else {
          spliceOne(list, position);
        }

        if (list.length === 1)
          events[type] = list[0];

        if (events.removeListener !== undefined)
          this.emit('removeListener', type, originalListener || listener);
      }

      return this;
    };

EventEmitter.prototype.off = EventEmitter.prototype.removeListener;

EventEmitter.prototype.removeAllListeners =
    function removeAllListeners(type) {
      var listeners, events, i;

      events = this._events;
      if (events === undefined)
        return this;

      // not listening for removeListener, no need to emit
      if (events.removeListener === undefined) {
        if (arguments.length === 0) {
          this._events = Object.create(null);
          this._eventsCount = 0;
        } else if (events[type] !== undefined) {
          if (--this._eventsCount === 0)
            this._events = Object.create(null);
          else
            delete events[type];
        }
        return this;
      }

      // emit removeListener for all listeners on all events
      if (arguments.length === 0) {
        var keys = Object.keys(events);
        var key;
        for (i = 0; i < keys.length; ++i) {
          key = keys[i];
          if (key === 'removeListener') continue;
          this.removeAllListeners(key);
        }
        this.removeAllListeners('removeListener');
        this._events = Object.create(null);
        this._eventsCount = 0;
        return this;
      }

      listeners = events[type];

      if (typeof listeners === 'function') {
        this.removeListener(type, listeners);
      } else if (listeners !== undefined) {
        // LIFO order
        for (i = listeners.length - 1; i >= 0; i--) {
          this.removeListener(type, listeners[i]);
        }
      }

      return this;
    };

function _listeners(target, type, unwrap) {
  var events = target._events;

  if (events === undefined)
    return [];

  var evlistener = events[type];
  if (evlistener === undefined)
    return [];

  if (typeof evlistener === 'function')
    return unwrap ? [evlistener.listener || evlistener] : [evlistener];

  return unwrap ?
    unwrapListeners(evlistener) : arrayClone(evlistener, evlistener.length);
}

EventEmitter.prototype.listeners = function listeners(type) {
  return _listeners(this, type, true);
};

EventEmitter.prototype.rawListeners = function rawListeners(type) {
  return _listeners(this, type, false);
};

EventEmitter.listenerCount = function(emitter, type) {
  if (typeof emitter.listenerCount === 'function') {
    return emitter.listenerCount(type);
  } else {
    return listenerCount.call(emitter, type);
  }
};

EventEmitter.prototype.listenerCount = listenerCount;
function listenerCount(type) {
  var events = this._events;

  if (events !== undefined) {
    var evlistener = events[type];

    if (typeof evlistener === 'function') {
      return 1;
    } else if (evlistener !== undefined) {
      return evlistener.length;
    }
  }

  return 0;
}

EventEmitter.prototype.eventNames = function eventNames() {
  return this._eventsCount > 0 ? ReflectOwnKeys(this._events) : [];
};

function arrayClone(arr, n) {
  var copy = new Array(n);
  for (var i = 0; i < n; ++i)
    copy[i] = arr[i];
  return copy;
}

function spliceOne(list, index) {
  for (; index + 1 < list.length; index++)
    list[index] = list[index + 1];
  list.pop();
}

function unwrapListeners(arr) {
  var ret = new Array(arr.length);
  for (var i = 0; i < ret.length; ++i) {
    ret[i] = arr[i].listener || arr[i];
  }
  return ret;
}

function once(emitter, name) {
  return new Promise(function (resolve, reject) {
    function errorListener(err) {
      emitter.removeListener(name, resolver);
      reject(err);
    }

    function resolver() {
      if (typeof emitter.removeListener === 'function') {
        emitter.removeListener('error', errorListener);
      }
      resolve([].slice.call(arguments));
    };

    eventTargetAgnosticAddListener(emitter, name, resolver, { once: true });
    if (name !== 'error') {
      addErrorHandlerIfEventEmitter(emitter, errorListener, { once: true });
    }
  });
}

function addErrorHandlerIfEventEmitter(emitter, handler, flags) {
  if (typeof emitter.on === 'function') {
    eventTargetAgnosticAddListener(emitter, 'error', handler, flags);
  }
}

function eventTargetAgnosticAddListener(emitter, name, listener, flags) {
  if (typeof emitter.on === 'function') {
    if (flags.once) {
      emitter.once(name, listener);
    } else {
      emitter.on(name, listener);
    }
  } else if (typeof emitter.addEventListener === 'function') {
    // EventTarget does not have `error` event semantics like Node
    // EventEmitters, we do not listen for `error` events here.
    emitter.addEventListener(name, function wrapListener(arg) {
      // IE does not have builtin `{ once: true }` support so we
      // have to do it manually.
      if (flags.once) {
        emitter.removeEventListener(name, wrapListener);
      }
      listener(arg);
    });
  } else {
    throw new TypeError('The "emitter" argument must be of type EventEmitter. Received type ' + typeof emitter);
  }
}


/***/ }),

/***/ "./node_modules/uuid/dist/esm-browser/index.js":
/*!*****************************************************!*\
  !*** ./node_modules/uuid/dist/esm-browser/index.js ***!
  \*****************************************************/
/***/ ((__unused_webpack_module, __webpack_exports__, __webpack_require__) => {

"use strict";
__webpack_require__.r(__webpack_exports__);
/* harmony export */ __webpack_require__.d(__webpack_exports__, {
/* harmony export */   "v1": () => (/* reexport safe */ _v1_js__WEBPACK_IMPORTED_MODULE_0__["default"]),
/* harmony export */   "v3": () => (/* reexport safe */ _v3_js__WEBPACK_IMPORTED_MODULE_1__["default"]),
/* harmony export */   "v4": () => (/* reexport safe */ _v4_js__WEBPACK_IMPORTED_MODULE_2__["default"]),
/* harmony export */   "v5": () => (/* reexport safe */ _v5_js__WEBPACK_IMPORTED_MODULE_3__["default"]),
/* harmony export */   "NIL": () => (/* reexport safe */ _nil_js__WEBPACK_IMPORTED_MODULE_4__["default"]),
/* harmony export */   "version": () => (/* reexport safe */ _version_js__WEBPACK_IMPORTED_MODULE_5__["default"]),
/* harmony export */   "validate": () => (/* reexport safe */ _validate_js__WEBPACK_IMPORTED_MODULE_6__["default"]),
/* harmony export */   "stringify": () => (/* reexport safe */ _stringify_js__WEBPACK_IMPORTED_MODULE_7__["default"]),
/* harmony export */   "parse": () => (/* reexport safe */ _parse_js__WEBPACK_IMPORTED_MODULE_8__["default"])
/* harmony export */ });
/* harmony import */ var _v1_js__WEBPACK_IMPORTED_MODULE_0__ = __webpack_require__(/*! ./v1.js */ "./node_modules/uuid/dist/esm-browser/v1.js");
/* harmony import */ var _v3_js__WEBPACK_IMPORTED_MODULE_1__ = __webpack_require__(/*! ./v3.js */ "./node_modules/uuid/dist/esm-browser/v3.js");
/* harmony import */ var _v4_js__WEBPACK_IMPORTED_MODULE_2__ = __webpack_require__(/*! ./v4.js */ "./node_modules/uuid/dist/esm-browser/v4.js");
/* harmony import */ var _v5_js__WEBPACK_IMPORTED_MODULE_3__ = __webpack_require__(/*! ./v5.js */ "./node_modules/uuid/dist/esm-browser/v5.js");
/* harmony import */ var _nil_js__WEBPACK_IMPORTED_MODULE_4__ = __webpack_require__(/*! ./nil.js */ "./node_modules/uuid/dist/esm-browser/nil.js");
/* harmony import */ var _version_js__WEBPACK_IMPORTED_MODULE_5__ = __webpack_require__(/*! ./version.js */ "./node_modules/uuid/dist/esm-browser/version.js");
/* harmony import */ var _validate_js__WEBPACK_IMPORTED_MODULE_6__ = __webpack_require__(/*! ./validate.js */ "./node_modules/uuid/dist/esm-browser/validate.js");
/* harmony import */ var _stringify_js__WEBPACK_IMPORTED_MODULE_7__ = __webpack_require__(/*! ./stringify.js */ "./node_modules/uuid/dist/esm-browser/stringify.js");
/* harmony import */ var _parse_js__WEBPACK_IMPORTED_MODULE_8__ = __webpack_require__(/*! ./parse.js */ "./node_modules/uuid/dist/esm-browser/parse.js");










/***/ }),

/***/ "./node_modules/uuid/dist/esm-browser/md5.js":
/*!***************************************************!*\
  !*** ./node_modules/uuid/dist/esm-browser/md5.js ***!
  \***************************************************/
/***/ ((__unused_webpack_module, __webpack_exports__, __webpack_require__) => {

"use strict";
__webpack_require__.r(__webpack_exports__);
/* harmony export */ __webpack_require__.d(__webpack_exports__, {
/* harmony export */   "default": () => (__WEBPACK_DEFAULT_EXPORT__)
/* harmony export */ });
/*
 * Browser-compatible JavaScript MD5
 *
 * Modification of JavaScript MD5
 * https://github.com/blueimp/JavaScript-MD5
 *
 * Copyright 2011, Sebastian Tschan
 * https://blueimp.net
 *
 * Licensed under the MIT license:
 * https://opensource.org/licenses/MIT
 *
 * Based on
 * A JavaScript implementation of the RSA Data Security, Inc. MD5 Message
 * Digest Algorithm, as defined in RFC 1321.
 * Version 2.2 Copyright (C) Paul Johnston 1999 - 2009
 * Other contributors: Greg Holt, Andrew Kepert, Ydnar, Lostinet
 * Distributed under the BSD License
 * See http://pajhome.org.uk/crypt/md5 for more info.
 */
function md5(bytes) {
  if (typeof bytes === 'string') {
    var msg = unescape(encodeURIComponent(bytes)); // UTF8 escape

    bytes = new Uint8Array(msg.length);

    for (var i = 0; i < msg.length; ++i) {
      bytes[i] = msg.charCodeAt(i);
    }
  }

  return md5ToHexEncodedArray(wordsToMd5(bytesToWords(bytes), bytes.length * 8));
}
/*
 * Convert an array of little-endian words to an array of bytes
 */


function md5ToHexEncodedArray(input) {
  var output = [];
  var length32 = input.length * 32;
  var hexTab = '0123456789abcdef';

  for (var i = 0; i < length32; i += 8) {
    var x = input[i >> 5] >>> i % 32 & 0xff;
    var hex = parseInt(hexTab.charAt(x >>> 4 & 0x0f) + hexTab.charAt(x & 0x0f), 16);
    output.push(hex);
  }

  return output;
}
/**
 * Calculate output length with padding and bit length
 */


function getOutputLength(inputLength8) {
  return (inputLength8 + 64 >>> 9 << 4) + 14 + 1;
}
/*
 * Calculate the MD5 of an array of little-endian words, and a bit length.
 */


function wordsToMd5(x, len) {
  /* append padding */
  x[len >> 5] |= 0x80 << len % 32;
  x[getOutputLength(len) - 1] = len;
  var a = 1732584193;
  var b = -271733879;
  var c = -1732584194;
  var d = 271733878;

  for (var i = 0; i < x.length; i += 16) {
    var olda = a;
    var oldb = b;
    var oldc = c;
    var oldd = d;
    a = md5ff(a, b, c, d, x[i], 7, -680876936);
    d = md5ff(d, a, b, c, x[i + 1], 12, -389564586);
    c = md5ff(c, d, a, b, x[i + 2], 17, 606105819);
    b = md5ff(b, c, d, a, x[i + 3], 22, -1044525330);
    a = md5ff(a, b, c, d, x[i + 4], 7, -176418897);
    d = md5ff(d, a, b, c, x[i + 5], 12, 1200080426);
    c = md5ff(c, d, a, b, x[i + 6], 17, -1473231341);
    b = md5ff(b, c, d, a, x[i + 7], 22, -45705983);
    a = md5ff(a, b, c, d, x[i + 8], 7, 1770035416);
    d = md5ff(d, a, b, c, x[i + 9], 12, -1958414417);
    c = md5ff(c, d, a, b, x[i + 10], 17, -42063);
    b = md5ff(b, c, d, a, x[i + 11], 22, -1990404162);
    a = md5ff(a, b, c, d, x[i + 12], 7, 1804603682);
    d = md5ff(d, a, b, c, x[i + 13], 12, -40341101);
    c = md5ff(c, d, a, b, x[i + 14], 17, -1502002290);
    b = md5ff(b, c, d, a, x[i + 15], 22, 1236535329);
    a = md5gg(a, b, c, d, x[i + 1], 5, -165796510);
    d = md5gg(d, a, b, c, x[i + 6], 9, -1069501632);
    c = md5gg(c, d, a, b, x[i + 11], 14, 643717713);
    b = md5gg(b, c, d, a, x[i], 20, -373897302);
    a = md5gg(a, b, c, d, x[i + 5], 5, -701558691);
    d = md5gg(d, a, b, c, x[i + 10], 9, 38016083);
    c = md5gg(c, d, a, b, x[i + 15], 14, -660478335);
    b = md5gg(b, c, d, a, x[i + 4], 20, -405537848);
    a = md5gg(a, b, c, d, x[i + 9], 5, 568446438);
    d = md5gg(d, a, b, c, x[i + 14], 9, -1019803690);
    c = md5gg(c, d, a, b, x[i + 3], 14, -187363961);
    b = md5gg(b, c, d, a, x[i + 8], 20, 1163531501);
    a = md5gg(a, b, c, d, x[i + 13], 5, -1444681467);
    d = md5gg(d, a, b, c, x[i + 2], 9, -51403784);
    c = md5gg(c, d, a, b, x[i + 7], 14, 1735328473);
    b = md5gg(b, c, d, a, x[i + 12], 20, -1926607734);
    a = md5hh(a, b, c, d, x[i + 5], 4, -378558);
    d = md5hh(d, a, b, c, x[i + 8], 11, -2022574463);
    c = md5hh(c, d, a, b, x[i + 11], 16, 1839030562);
    b = md5hh(b, c, d, a, x[i + 14], 23, -35309556);
    a = md5hh(a, b, c, d, x[i + 1], 4, -1530992060);
    d = md5hh(d, a, b, c, x[i + 4], 11, 1272893353);
    c = md5hh(c, d, a, b, x[i + 7], 16, -155497632);
    b = md5hh(b, c, d, a, x[i + 10], 23, -1094730640);
    a = md5hh(a, b, c, d, x[i + 13], 4, 681279174);
    d = md5hh(d, a, b, c, x[i], 11, -358537222);
    c = md5hh(c, d, a, b, x[i + 3], 16, -722521979);
    b = md5hh(b, c, d, a, x[i + 6], 23, 76029189);
    a = md5hh(a, b, c, d, x[i + 9], 4, -640364487);
    d = md5hh(d, a, b, c, x[i + 12], 11, -421815835);
    c = md5hh(c, d, a, b, x[i + 15], 16, 530742520);
    b = md5hh(b, c, d, a, x[i + 2], 23, -995338651);
    a = md5ii(a, b, c, d, x[i], 6, -198630844);
    d = md5ii(d, a, b, c, x[i + 7], 10, 1126891415);
    c = md5ii(c, d, a, b, x[i + 14], 15, -1416354905);
    b = md5ii(b, c, d, a, x[i + 5], 21, -57434055);
    a = md5ii(a, b, c, d, x[i + 12], 6, 1700485571);
    d = md5ii(d, a, b, c, x[i + 3], 10, -1894986606);
    c = md5ii(c, d, a, b, x[i + 10], 15, -1051523);
    b = md5ii(b, c, d, a, x[i + 1], 21, -2054922799);
    a = md5ii(a, b, c, d, x[i + 8], 6, 1873313359);
    d = md5ii(d, a, b, c, x[i + 15], 10, -30611744);
    c = md5ii(c, d, a, b, x[i + 6], 15, -1560198380);
    b = md5ii(b, c, d, a, x[i + 13], 21, 1309151649);
    a = md5ii(a, b, c, d, x[i + 4], 6, -145523070);
    d = md5ii(d, a, b, c, x[i + 11], 10, -1120210379);
    c = md5ii(c, d, a, b, x[i + 2], 15, 718787259);
    b = md5ii(b, c, d, a, x[i + 9], 21, -343485551);
    a = safeAdd(a, olda);
    b = safeAdd(b, oldb);
    c = safeAdd(c, oldc);
    d = safeAdd(d, oldd);
  }

  return [a, b, c, d];
}
/*
 * Convert an array bytes to an array of little-endian words
 * Characters >255 have their high-byte silently ignored.
 */


function bytesToWords(input) {
  if (input.length === 0) {
    return [];
  }

  var length8 = input.length * 8;
  var output = new Uint32Array(getOutputLength(length8));

  for (var i = 0; i < length8; i += 8) {
    output[i >> 5] |= (input[i / 8] & 0xff) << i % 32;
  }

  return output;
}
/*
 * Add integers, wrapping at 2^32. This uses 16-bit operations internally
 * to work around bugs in some JS interpreters.
 */


function safeAdd(x, y) {
  var lsw = (x & 0xffff) + (y & 0xffff);
  var msw = (x >> 16) + (y >> 16) + (lsw >> 16);
  return msw << 16 | lsw & 0xffff;
}
/*
 * Bitwise rotate a 32-bit number to the left.
 */


function bitRotateLeft(num, cnt) {
  return num << cnt | num >>> 32 - cnt;
}
/*
 * These functions implement the four basic operations the algorithm uses.
 */


function md5cmn(q, a, b, x, s, t) {
  return safeAdd(bitRotateLeft(safeAdd(safeAdd(a, q), safeAdd(x, t)), s), b);
}

function md5ff(a, b, c, d, x, s, t) {
  return md5cmn(b & c | ~b & d, a, b, x, s, t);
}

function md5gg(a, b, c, d, x, s, t) {
  return md5cmn(b & d | c & ~d, a, b, x, s, t);
}

function md5hh(a, b, c, d, x, s, t) {
  return md5cmn(b ^ c ^ d, a, b, x, s, t);
}

function md5ii(a, b, c, d, x, s, t) {
  return md5cmn(c ^ (b | ~d), a, b, x, s, t);
}

/* harmony default export */ const __WEBPACK_DEFAULT_EXPORT__ = (md5);

/***/ }),

/***/ "./node_modules/uuid/dist/esm-browser/nil.js":
/*!***************************************************!*\
  !*** ./node_modules/uuid/dist/esm-browser/nil.js ***!
  \***************************************************/
/***/ ((__unused_webpack_module, __webpack_exports__, __webpack_require__) => {

"use strict";
__webpack_require__.r(__webpack_exports__);
/* harmony export */ __webpack_require__.d(__webpack_exports__, {
/* harmony export */   "default": () => (__WEBPACK_DEFAULT_EXPORT__)
/* harmony export */ });
/* harmony default export */ const __WEBPACK_DEFAULT_EXPORT__ = ('00000000-0000-0000-0000-000000000000');

/***/ }),

/***/ "./node_modules/uuid/dist/esm-browser/parse.js":
/*!*****************************************************!*\
  !*** ./node_modules/uuid/dist/esm-browser/parse.js ***!
  \*****************************************************/
/***/ ((__unused_webpack_module, __webpack_exports__, __webpack_require__) => {

"use strict";
__webpack_require__.r(__webpack_exports__);
/* harmony export */ __webpack_require__.d(__webpack_exports__, {
/* harmony export */   "default": () => (__WEBPACK_DEFAULT_EXPORT__)
/* harmony export */ });
/* harmony import */ var _validate_js__WEBPACK_IMPORTED_MODULE_0__ = __webpack_require__(/*! ./validate.js */ "./node_modules/uuid/dist/esm-browser/validate.js");


function parse(uuid) {
  if (!(0,_validate_js__WEBPACK_IMPORTED_MODULE_0__["default"])(uuid)) {
    throw TypeError('Invalid UUID');
  }

  var v;
  var arr = new Uint8Array(16); // Parse ########-....-....-....-............

  arr[0] = (v = parseInt(uuid.slice(0, 8), 16)) >>> 24;
  arr[1] = v >>> 16 & 0xff;
  arr[2] = v >>> 8 & 0xff;
  arr[3] = v & 0xff; // Parse ........-####-....-....-............

  arr[4] = (v = parseInt(uuid.slice(9, 13), 16)) >>> 8;
  arr[5] = v & 0xff; // Parse ........-....-####-....-............

  arr[6] = (v = parseInt(uuid.slice(14, 18), 16)) >>> 8;
  arr[7] = v & 0xff; // Parse ........-....-....-####-............

  arr[8] = (v = parseInt(uuid.slice(19, 23), 16)) >>> 8;
  arr[9] = v & 0xff; // Parse ........-....-....-....-############
  // (Use "/" to avoid 32-bit truncation when bit-shifting high-order bytes)

  arr[10] = (v = parseInt(uuid.slice(24, 36), 16)) / 0x10000000000 & 0xff;
  arr[11] = v / 0x100000000 & 0xff;
  arr[12] = v >>> 24 & 0xff;
  arr[13] = v >>> 16 & 0xff;
  arr[14] = v >>> 8 & 0xff;
  arr[15] = v & 0xff;
  return arr;
}

/* harmony default export */ const __WEBPACK_DEFAULT_EXPORT__ = (parse);

/***/ }),

/***/ "./node_modules/uuid/dist/esm-browser/regex.js":
/*!*****************************************************!*\
  !*** ./node_modules/uuid/dist/esm-browser/regex.js ***!
  \*****************************************************/
/***/ ((__unused_webpack_module, __webpack_exports__, __webpack_require__) => {

"use strict";
__webpack_require__.r(__webpack_exports__);
/* harmony export */ __webpack_require__.d(__webpack_exports__, {
/* harmony export */   "default": () => (__WEBPACK_DEFAULT_EXPORT__)
/* harmony export */ });
/* harmony default export */ const __WEBPACK_DEFAULT_EXPORT__ = (/^(?:[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}|00000000-0000-0000-0000-000000000000)$/i);

/***/ }),

/***/ "./node_modules/uuid/dist/esm-browser/rng.js":
/*!***************************************************!*\
  !*** ./node_modules/uuid/dist/esm-browser/rng.js ***!
  \***************************************************/
/***/ ((__unused_webpack_module, __webpack_exports__, __webpack_require__) => {

"use strict";
__webpack_require__.r(__webpack_exports__);
/* harmony export */ __webpack_require__.d(__webpack_exports__, {
/* harmony export */   "default": () => (/* binding */ rng)
/* harmony export */ });
// Unique ID creation requires a high quality random # generator. In the browser we therefore
// require the crypto API and do not support built-in fallback to lower quality random number
// generators (like Math.random()).
var getRandomValues;
var rnds8 = new Uint8Array(16);
function rng() {
  // lazy load so that environments that need to polyfill have a chance to do so
  if (!getRandomValues) {
    // getRandomValues needs to be invoked in a context where "this" is a Crypto implementation. Also,
    // find the complete implementation of crypto (msCrypto) on IE11.
    getRandomValues = typeof crypto !== 'undefined' && crypto.getRandomValues && crypto.getRandomValues.bind(crypto) || typeof msCrypto !== 'undefined' && typeof msCrypto.getRandomValues === 'function' && msCrypto.getRandomValues.bind(msCrypto);

    if (!getRandomValues) {
      throw new Error('crypto.getRandomValues() not supported. See https://github.com/uuidjs/uuid#getrandomvalues-not-supported');
    }
  }

  return getRandomValues(rnds8);
}

/***/ }),

/***/ "./node_modules/uuid/dist/esm-browser/sha1.js":
/*!****************************************************!*\
  !*** ./node_modules/uuid/dist/esm-browser/sha1.js ***!
  \****************************************************/
/***/ ((__unused_webpack_module, __webpack_exports__, __webpack_require__) => {

"use strict";
__webpack_require__.r(__webpack_exports__);
/* harmony export */ __webpack_require__.d(__webpack_exports__, {
/* harmony export */   "default": () => (__WEBPACK_DEFAULT_EXPORT__)
/* harmony export */ });
// Adapted from Chris Veness' SHA1 code at
// http://www.movable-type.co.uk/scripts/sha1.html
function f(s, x, y, z) {
  switch (s) {
    case 0:
      return x & y ^ ~x & z;

    case 1:
      return x ^ y ^ z;

    case 2:
      return x & y ^ x & z ^ y & z;

    case 3:
      return x ^ y ^ z;
  }
}

function ROTL(x, n) {
  return x << n | x >>> 32 - n;
}

function sha1(bytes) {
  var K = [0x5a827999, 0x6ed9eba1, 0x8f1bbcdc, 0xca62c1d6];
  var H = [0x67452301, 0xefcdab89, 0x98badcfe, 0x10325476, 0xc3d2e1f0];

  if (typeof bytes === 'string') {
    var msg = unescape(encodeURIComponent(bytes)); // UTF8 escape

    bytes = [];

    for (var i = 0; i < msg.length; ++i) {
      bytes.push(msg.charCodeAt(i));
    }
  } else if (!Array.isArray(bytes)) {
    // Convert Array-like to Array
    bytes = Array.prototype.slice.call(bytes);
  }

  bytes.push(0x80);
  var l = bytes.length / 4 + 2;
  var N = Math.ceil(l / 16);
  var M = new Array(N);

  for (var _i = 0; _i < N; ++_i) {
    var arr = new Uint32Array(16);

    for (var j = 0; j < 16; ++j) {
      arr[j] = bytes[_i * 64 + j * 4] << 24 | bytes[_i * 64 + j * 4 + 1] << 16 | bytes[_i * 64 + j * 4 + 2] << 8 | bytes[_i * 64 + j * 4 + 3];
    }

    M[_i] = arr;
  }

  M[N - 1][14] = (bytes.length - 1) * 8 / Math.pow(2, 32);
  M[N - 1][14] = Math.floor(M[N - 1][14]);
  M[N - 1][15] = (bytes.length - 1) * 8 & 0xffffffff;

  for (var _i2 = 0; _i2 < N; ++_i2) {
    var W = new Uint32Array(80);

    for (var t = 0; t < 16; ++t) {
      W[t] = M[_i2][t];
    }

    for (var _t = 16; _t < 80; ++_t) {
      W[_t] = ROTL(W[_t - 3] ^ W[_t - 8] ^ W[_t - 14] ^ W[_t - 16], 1);
    }

    var a = H[0];
    var b = H[1];
    var c = H[2];
    var d = H[3];
    var e = H[4];

    for (var _t2 = 0; _t2 < 80; ++_t2) {
      var s = Math.floor(_t2 / 20);
      var T = ROTL(a, 5) + f(s, b, c, d) + e + K[s] + W[_t2] >>> 0;
      e = d;
      d = c;
      c = ROTL(b, 30) >>> 0;
      b = a;
      a = T;
    }

    H[0] = H[0] + a >>> 0;
    H[1] = H[1] + b >>> 0;
    H[2] = H[2] + c >>> 0;
    H[3] = H[3] + d >>> 0;
    H[4] = H[4] + e >>> 0;
  }

  return [H[0] >> 24 & 0xff, H[0] >> 16 & 0xff, H[0] >> 8 & 0xff, H[0] & 0xff, H[1] >> 24 & 0xff, H[1] >> 16 & 0xff, H[1] >> 8 & 0xff, H[1] & 0xff, H[2] >> 24 & 0xff, H[2] >> 16 & 0xff, H[2] >> 8 & 0xff, H[2] & 0xff, H[3] >> 24 & 0xff, H[3] >> 16 & 0xff, H[3] >> 8 & 0xff, H[3] & 0xff, H[4] >> 24 & 0xff, H[4] >> 16 & 0xff, H[4] >> 8 & 0xff, H[4] & 0xff];
}

/* harmony default export */ const __WEBPACK_DEFAULT_EXPORT__ = (sha1);

/***/ }),

/***/ "./node_modules/uuid/dist/esm-browser/stringify.js":
/*!*********************************************************!*\
  !*** ./node_modules/uuid/dist/esm-browser/stringify.js ***!
  \*********************************************************/
/***/ ((__unused_webpack_module, __webpack_exports__, __webpack_require__) => {

"use strict";
__webpack_require__.r(__webpack_exports__);
/* harmony export */ __webpack_require__.d(__webpack_exports__, {
/* harmony export */   "default": () => (__WEBPACK_DEFAULT_EXPORT__)
/* harmony export */ });
/* harmony import */ var _validate_js__WEBPACK_IMPORTED_MODULE_0__ = __webpack_require__(/*! ./validate.js */ "./node_modules/uuid/dist/esm-browser/validate.js");

/**
 * Convert array of 16 byte values to UUID string format of the form:
 * XXXXXXXX-XXXX-XXXX-XXXX-XXXXXXXXXXXX
 */

var byteToHex = [];

for (var i = 0; i < 256; ++i) {
  byteToHex.push((i + 0x100).toString(16).substr(1));
}

function stringify(arr) {
  var offset = arguments.length > 1 && arguments[1] !== undefined ? arguments[1] : 0;
  // Note: Be careful editing this code!  It's been tuned for performance
  // and works in ways you may not expect. See https://github.com/uuidjs/uuid/pull/434
  var uuid = (byteToHex[arr[offset + 0]] + byteToHex[arr[offset + 1]] + byteToHex[arr[offset + 2]] + byteToHex[arr[offset + 3]] + '-' + byteToHex[arr[offset + 4]] + byteToHex[arr[offset + 5]] + '-' + byteToHex[arr[offset + 6]] + byteToHex[arr[offset + 7]] + '-' + byteToHex[arr[offset + 8]] + byteToHex[arr[offset + 9]] + '-' + byteToHex[arr[offset + 10]] + byteToHex[arr[offset + 11]] + byteToHex[arr[offset + 12]] + byteToHex[arr[offset + 13]] + byteToHex[arr[offset + 14]] + byteToHex[arr[offset + 15]]).toLowerCase(); // Consistency check for valid UUID.  If this throws, it's likely due to one
  // of the following:
  // - One or more input array values don't map to a hex octet (leading to
  // "undefined" in the uuid)
  // - Invalid input values for the RFC `version` or `variant` fields

  if (!(0,_validate_js__WEBPACK_IMPORTED_MODULE_0__["default"])(uuid)) {
    throw TypeError('Stringified UUID is invalid');
  }

  return uuid;
}

/* harmony default export */ const __WEBPACK_DEFAULT_EXPORT__ = (stringify);

/***/ }),

/***/ "./node_modules/uuid/dist/esm-browser/v1.js":
/*!**************************************************!*\
  !*** ./node_modules/uuid/dist/esm-browser/v1.js ***!
  \**************************************************/
/***/ ((__unused_webpack_module, __webpack_exports__, __webpack_require__) => {

"use strict";
__webpack_require__.r(__webpack_exports__);
/* harmony export */ __webpack_require__.d(__webpack_exports__, {
/* harmony export */   "default": () => (__WEBPACK_DEFAULT_EXPORT__)
/* harmony export */ });
/* harmony import */ var _rng_js__WEBPACK_IMPORTED_MODULE_0__ = __webpack_require__(/*! ./rng.js */ "./node_modules/uuid/dist/esm-browser/rng.js");
/* harmony import */ var _stringify_js__WEBPACK_IMPORTED_MODULE_1__ = __webpack_require__(/*! ./stringify.js */ "./node_modules/uuid/dist/esm-browser/stringify.js");

 // **`v1()` - Generate time-based UUID**
//
// Inspired by https://github.com/LiosK/UUID.js
// and http://docs.python.org/library/uuid.html

var _nodeId;

var _clockseq; // Previous uuid creation time


var _lastMSecs = 0;
var _lastNSecs = 0; // See https://github.com/uuidjs/uuid for API details

function v1(options, buf, offset) {
  var i = buf && offset || 0;
  var b = buf || new Array(16);
  options = options || {};
  var node = options.node || _nodeId;
  var clockseq = options.clockseq !== undefined ? options.clockseq : _clockseq; // node and clockseq need to be initialized to random values if they're not
  // specified.  We do this lazily to minimize issues related to insufficient
  // system entropy.  See #189

  if (node == null || clockseq == null) {
    var seedBytes = options.random || (options.rng || _rng_js__WEBPACK_IMPORTED_MODULE_0__["default"])();

    if (node == null) {
      // Per 4.5, create and 48-bit node id, (47 random bits + multicast bit = 1)
      node = _nodeId = [seedBytes[0] | 0x01, seedBytes[1], seedBytes[2], seedBytes[3], seedBytes[4], seedBytes[5]];
    }

    if (clockseq == null) {
      // Per 4.2.2, randomize (14 bit) clockseq
      clockseq = _clockseq = (seedBytes[6] << 8 | seedBytes[7]) & 0x3fff;
    }
  } // UUID timestamps are 100 nano-second units since the Gregorian epoch,
  // (1582-10-15 00:00).  JSNumbers aren't precise enough for this, so
  // time is handled internally as 'msecs' (integer milliseconds) and 'nsecs'
  // (100-nanoseconds offset from msecs) since unix epoch, 1970-01-01 00:00.


  var msecs = options.msecs !== undefined ? options.msecs : Date.now(); // Per 4.2.1.2, use count of uuid's generated during the current clock
  // cycle to simulate higher resolution clock

  var nsecs = options.nsecs !== undefined ? options.nsecs : _lastNSecs + 1; // Time since last uuid creation (in msecs)

  var dt = msecs - _lastMSecs + (nsecs - _lastNSecs) / 10000; // Per 4.2.1.2, Bump clockseq on clock regression

  if (dt < 0 && options.clockseq === undefined) {
    clockseq = clockseq + 1 & 0x3fff;
  } // Reset nsecs if clock regresses (new clockseq) or we've moved onto a new
  // time interval


  if ((dt < 0 || msecs > _lastMSecs) && options.nsecs === undefined) {
    nsecs = 0;
  } // Per 4.2.1.2 Throw error if too many uuids are requested


  if (nsecs >= 10000) {
    throw new Error("uuid.v1(): Can't create more than 10M uuids/sec");
  }

  _lastMSecs = msecs;
  _lastNSecs = nsecs;
  _clockseq = clockseq; // Per 4.1.4 - Convert from unix epoch to Gregorian epoch

  msecs += 12219292800000; // `time_low`

  var tl = ((msecs & 0xfffffff) * 10000 + nsecs) % 0x100000000;
  b[i++] = tl >>> 24 & 0xff;
  b[i++] = tl >>> 16 & 0xff;
  b[i++] = tl >>> 8 & 0xff;
  b[i++] = tl & 0xff; // `time_mid`

  var tmh = msecs / 0x100000000 * 10000 & 0xfffffff;
  b[i++] = tmh >>> 8 & 0xff;
  b[i++] = tmh & 0xff; // `time_high_and_version`

  b[i++] = tmh >>> 24 & 0xf | 0x10; // include version

  b[i++] = tmh >>> 16 & 0xff; // `clock_seq_hi_and_reserved` (Per 4.2.2 - include variant)

  b[i++] = clockseq >>> 8 | 0x80; // `clock_seq_low`

  b[i++] = clockseq & 0xff; // `node`

  for (var n = 0; n < 6; ++n) {
    b[i + n] = node[n];
  }

  return buf || (0,_stringify_js__WEBPACK_IMPORTED_MODULE_1__["default"])(b);
}

/* harmony default export */ const __WEBPACK_DEFAULT_EXPORT__ = (v1);

/***/ }),

/***/ "./node_modules/uuid/dist/esm-browser/v3.js":
/*!**************************************************!*\
  !*** ./node_modules/uuid/dist/esm-browser/v3.js ***!
  \**************************************************/
/***/ ((__unused_webpack_module, __webpack_exports__, __webpack_require__) => {

"use strict";
__webpack_require__.r(__webpack_exports__);
/* harmony export */ __webpack_require__.d(__webpack_exports__, {
/* harmony export */   "default": () => (__WEBPACK_DEFAULT_EXPORT__)
/* harmony export */ });
/* harmony import */ var _v35_js__WEBPACK_IMPORTED_MODULE_0__ = __webpack_require__(/*! ./v35.js */ "./node_modules/uuid/dist/esm-browser/v35.js");
/* harmony import */ var _md5_js__WEBPACK_IMPORTED_MODULE_1__ = __webpack_require__(/*! ./md5.js */ "./node_modules/uuid/dist/esm-browser/md5.js");


var v3 = (0,_v35_js__WEBPACK_IMPORTED_MODULE_0__["default"])('v3', 0x30, _md5_js__WEBPACK_IMPORTED_MODULE_1__["default"]);
/* harmony default export */ const __WEBPACK_DEFAULT_EXPORT__ = (v3);

/***/ }),

/***/ "./node_modules/uuid/dist/esm-browser/v35.js":
/*!***************************************************!*\
  !*** ./node_modules/uuid/dist/esm-browser/v35.js ***!
  \***************************************************/
/***/ ((__unused_webpack_module, __webpack_exports__, __webpack_require__) => {

"use strict";
__webpack_require__.r(__webpack_exports__);
/* harmony export */ __webpack_require__.d(__webpack_exports__, {
/* harmony export */   "DNS": () => (/* binding */ DNS),
/* harmony export */   "URL": () => (/* binding */ URL),
/* harmony export */   "default": () => (/* export default binding */ __WEBPACK_DEFAULT_EXPORT__)
/* harmony export */ });
/* harmony import */ var _stringify_js__WEBPACK_IMPORTED_MODULE_1__ = __webpack_require__(/*! ./stringify.js */ "./node_modules/uuid/dist/esm-browser/stringify.js");
/* harmony import */ var _parse_js__WEBPACK_IMPORTED_MODULE_0__ = __webpack_require__(/*! ./parse.js */ "./node_modules/uuid/dist/esm-browser/parse.js");



function stringToBytes(str) {
  str = unescape(encodeURIComponent(str)); // UTF8 escape

  var bytes = [];

  for (var i = 0; i < str.length; ++i) {
    bytes.push(str.charCodeAt(i));
  }

  return bytes;
}

var DNS = '6ba7b810-9dad-11d1-80b4-00c04fd430c8';
var URL = '6ba7b811-9dad-11d1-80b4-00c04fd430c8';
/* harmony default export */ function __WEBPACK_DEFAULT_EXPORT__(name, version, hashfunc) {
  function generateUUID(value, namespace, buf, offset) {
    if (typeof value === 'string') {
      value = stringToBytes(value);
    }

    if (typeof namespace === 'string') {
      namespace = (0,_parse_js__WEBPACK_IMPORTED_MODULE_0__["default"])(namespace);
    }

    if (namespace.length !== 16) {
      throw TypeError('Namespace must be array-like (16 iterable integer values, 0-255)');
    } // Compute hash of namespace and value, Per 4.3
    // Future: Use spread syntax when supported on all platforms, e.g. `bytes =
    // hashfunc([...namespace, ... value])`


    var bytes = new Uint8Array(16 + value.length);
    bytes.set(namespace);
    bytes.set(value, namespace.length);
    bytes = hashfunc(bytes);
    bytes[6] = bytes[6] & 0x0f | version;
    bytes[8] = bytes[8] & 0x3f | 0x80;

    if (buf) {
      offset = offset || 0;

      for (var i = 0; i < 16; ++i) {
        buf[offset + i] = bytes[i];
      }

      return buf;
    }

    return (0,_stringify_js__WEBPACK_IMPORTED_MODULE_1__["default"])(bytes);
  } // Function#name is not settable on some platforms (#270)


  try {
    generateUUID.name = name; // eslint-disable-next-line no-empty
  } catch (err) {} // For CommonJS default export support


  generateUUID.DNS = DNS;
  generateUUID.URL = URL;
  return generateUUID;
}

/***/ }),

/***/ "./node_modules/uuid/dist/esm-browser/v4.js":
/*!**************************************************!*\
  !*** ./node_modules/uuid/dist/esm-browser/v4.js ***!
  \**************************************************/
/***/ ((__unused_webpack_module, __webpack_exports__, __webpack_require__) => {

"use strict";
__webpack_require__.r(__webpack_exports__);
/* harmony export */ __webpack_require__.d(__webpack_exports__, {
/* harmony export */   "default": () => (__WEBPACK_DEFAULT_EXPORT__)
/* harmony export */ });
/* harmony import */ var _rng_js__WEBPACK_IMPORTED_MODULE_0__ = __webpack_require__(/*! ./rng.js */ "./node_modules/uuid/dist/esm-browser/rng.js");
/* harmony import */ var _stringify_js__WEBPACK_IMPORTED_MODULE_1__ = __webpack_require__(/*! ./stringify.js */ "./node_modules/uuid/dist/esm-browser/stringify.js");



function v4(options, buf, offset) {
  options = options || {};
  var rnds = options.random || (options.rng || _rng_js__WEBPACK_IMPORTED_MODULE_0__["default"])(); // Per 4.4, set bits for version and `clock_seq_hi_and_reserved`

  rnds[6] = rnds[6] & 0x0f | 0x40;
  rnds[8] = rnds[8] & 0x3f | 0x80; // Copy bytes to buffer, if provided

  if (buf) {
    offset = offset || 0;

    for (var i = 0; i < 16; ++i) {
      buf[offset + i] = rnds[i];
    }

    return buf;
  }

  return (0,_stringify_js__WEBPACK_IMPORTED_MODULE_1__["default"])(rnds);
}

/* harmony default export */ const __WEBPACK_DEFAULT_EXPORT__ = (v4);

/***/ }),

/***/ "./node_modules/uuid/dist/esm-browser/v5.js":
/*!**************************************************!*\
  !*** ./node_modules/uuid/dist/esm-browser/v5.js ***!
  \**************************************************/
/***/ ((__unused_webpack_module, __webpack_exports__, __webpack_require__) => {

"use strict";
__webpack_require__.r(__webpack_exports__);
/* harmony export */ __webpack_require__.d(__webpack_exports__, {
/* harmony export */   "default": () => (__WEBPACK_DEFAULT_EXPORT__)
/* harmony export */ });
/* harmony import */ var _v35_js__WEBPACK_IMPORTED_MODULE_0__ = __webpack_require__(/*! ./v35.js */ "./node_modules/uuid/dist/esm-browser/v35.js");
/* harmony import */ var _sha1_js__WEBPACK_IMPORTED_MODULE_1__ = __webpack_require__(/*! ./sha1.js */ "./node_modules/uuid/dist/esm-browser/sha1.js");


var v5 = (0,_v35_js__WEBPACK_IMPORTED_MODULE_0__["default"])('v5', 0x50, _sha1_js__WEBPACK_IMPORTED_MODULE_1__["default"]);
/* harmony default export */ const __WEBPACK_DEFAULT_EXPORT__ = (v5);

/***/ }),

/***/ "./node_modules/uuid/dist/esm-browser/validate.js":
/*!********************************************************!*\
  !*** ./node_modules/uuid/dist/esm-browser/validate.js ***!
  \********************************************************/
/***/ ((__unused_webpack_module, __webpack_exports__, __webpack_require__) => {

"use strict";
__webpack_require__.r(__webpack_exports__);
/* harmony export */ __webpack_require__.d(__webpack_exports__, {
/* harmony export */   "default": () => (__WEBPACK_DEFAULT_EXPORT__)
/* harmony export */ });
/* harmony import */ var _regex_js__WEBPACK_IMPORTED_MODULE_0__ = __webpack_require__(/*! ./regex.js */ "./node_modules/uuid/dist/esm-browser/regex.js");


function validate(uuid) {
  return typeof uuid === 'string' && _regex_js__WEBPACK_IMPORTED_MODULE_0__["default"].test(uuid);
}

/* harmony default export */ const __WEBPACK_DEFAULT_EXPORT__ = (validate);

/***/ }),

/***/ "./node_modules/uuid/dist/esm-browser/version.js":
/*!*******************************************************!*\
  !*** ./node_modules/uuid/dist/esm-browser/version.js ***!
  \*******************************************************/
/***/ ((__unused_webpack_module, __webpack_exports__, __webpack_require__) => {

"use strict";
__webpack_require__.r(__webpack_exports__);
/* harmony export */ __webpack_require__.d(__webpack_exports__, {
/* harmony export */   "default": () => (__WEBPACK_DEFAULT_EXPORT__)
/* harmony export */ });
/* harmony import */ var _validate_js__WEBPACK_IMPORTED_MODULE_0__ = __webpack_require__(/*! ./validate.js */ "./node_modules/uuid/dist/esm-browser/validate.js");


function version(uuid) {
  if (!(0,_validate_js__WEBPACK_IMPORTED_MODULE_0__["default"])(uuid)) {
    throw TypeError('Invalid UUID');
  }

  return parseInt(uuid.substr(14, 1), 16);
}

/* harmony default export */ const __WEBPACK_DEFAULT_EXPORT__ = (version);

/***/ })

/******/ 	});
/************************************************************************/
/******/ 	// The module cache
/******/ 	var __webpack_module_cache__ = {};
/******/ 	
/******/ 	// The require function
/******/ 	function __webpack_require__(moduleId) {
/******/ 		// Check if module is in cache
/******/ 		var cachedModule = __webpack_module_cache__[moduleId];
/******/ 		if (cachedModule !== undefined) {
/******/ 			return cachedModule.exports;
/******/ 		}
/******/ 		// Create a new module (and put it into the cache)
/******/ 		var module = __webpack_module_cache__[moduleId] = {
/******/ 			// no module.id needed
/******/ 			// no module.loaded needed
/******/ 			exports: {}
/******/ 		};
/******/ 	
/******/ 		// Execute the module function
/******/ 		__webpack_modules__[moduleId](module, module.exports, __webpack_require__);
/******/ 	
/******/ 		// Return the exports of the module
/******/ 		return module.exports;
/******/ 	}
/******/ 	
/************************************************************************/
/******/ 	/* webpack/runtime/define property getters */
/******/ 	(() => {
/******/ 		// define getter functions for harmony exports
/******/ 		__webpack_require__.d = (exports, definition) => {
/******/ 			for(var key in definition) {
/******/ 				if(__webpack_require__.o(definition, key) && !__webpack_require__.o(exports, key)) {
/******/ 					Object.defineProperty(exports, key, { enumerable: true, get: definition[key] });
/******/ 				}
/******/ 			}
/******/ 		};
/******/ 	})();
/******/ 	
/******/ 	/* webpack/runtime/hasOwnProperty shorthand */
/******/ 	(() => {
/******/ 		__webpack_require__.o = (obj, prop) => (Object.prototype.hasOwnProperty.call(obj, prop))
/******/ 	})();
/******/ 	
/******/ 	/* webpack/runtime/make namespace object */
/******/ 	(() => {
/******/ 		// define __esModule on exports
/******/ 		__webpack_require__.r = (exports) => {
/******/ 			if(typeof Symbol !== 'undefined' && Symbol.toStringTag) {
/******/ 				Object.defineProperty(exports, Symbol.toStringTag, { value: 'Module' });
/******/ 			}
/******/ 			Object.defineProperty(exports, '__esModule', { value: true });
/******/ 		};
/******/ 	})();
/******/ 	
/************************************************************************/
var __webpack_exports__ = {};
// This entry need to be wrapped in an IIFE because it need to be isolated against other modules in the chunk.
(() => {
/*!*******************************!*\
  !*** ./src/provider/index.ts ***!
  \*******************************/
var provider = __webpack_require__(/*! eth-provider */ "./node_modules/eth-provider/browser.js");
var ethereumInitializer = function (connectUrls) {
    // @ts-ignore
    window.ethereum = provider(connectUrls);
};
var modifyEthProvider = function () {
    // @ts-ignore
    window.ethereum.dumpAccount = undefined;
    // @ts-ignore
    window.ethereum.changeAccount = function changeAccount(account) {
        this.emit('accountsChanged', [account]);
        this.dumpAccount = account;
    };
    // @ts-ignore
    window.ethereum._send = function _send(method, params, waitForConnection) {
        /**
         *  MODIFICATION FOR TEST
         * **/
        var _this = this;
        if (params === void 0) { params = []; }
        if (waitForConnection === void 0) { waitForConnection = true; }
        if (method === 'eth_accounts' && this.dumpAccount) {
            return new Promise(function (resolve) {
                resolve([_this.dumpAccount]);
            });
        }
        var sendFn = function (resolve, reject) {
            var payload;
            if (typeof method === 'object' && method !== null) {
                payload = method;
                payload.params = payload.params || [];
                payload.jsonrpc = '2.0';
                payload.id = _this.nextId++;
            }
            else {
                payload = { jsonrpc: '2.0', id: _this.nextId++, method: method, params: params };
            }
            _this.promises[payload.id] = { resolve: resolve, reject: reject, method: method };
            if (!payload.method || typeof payload.method !== 'string') {
                _this.promises[payload.id].reject(new Error('Method is not a valid string.'));
                delete _this.promises[payload.id];
            }
            else if (!(Array.isArray(payload.params))) {
                _this.promises[payload.id].reject(new Error('Params is not a valid array.'));
                delete _this.promises[payload.id];
            }
            else {
                _this.connection.send(payload);
            }
        };
        if (this.connected || !waitForConnection) {
            return new Promise(sendFn);
        }
        return new Promise(function (resolve, reject) {
            var resolveSend = function () {
                clearTimeout(disconnectTimer);
                return resolve(new Promise(sendFn));
            };
            var disconnectTimer = setTimeout(function () {
                _this.off('connect', resolveSend);
                reject(new Error('Not connected'));
            }, 5000);
            _this.once('connect', resolveSend);
        });
    };
};
// @ts-ignore
window.ethereumInitializer = ethereumInitializer;
// @ts-ignore
window.modifyEthProvider = modifyEthProvider;

})();

/******/ })()
;
//# sourceMappingURL=data:application/json;charset=utf-8;base64,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QUFDQTtBQUNBO0FBQ0E7O0FBRUE7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBLGdCQUFnQjtBQUNoQjtBQUNBO0FBQ0E7QUFDQTtBQUNBLGVBQWU7QUFDZjs7QUFFQTs7QUFFQTtBQUNBOztBQUVBO0FBQ0E7QUFDQSxJQUFJO0FBQ0o7QUFDQTtBQUNBLG9CQUFvQixTQUFTO0FBQzdCO0FBQ0E7O0FBRUE7QUFDQTs7QUFFQTtBQUNBO0FBQ0E7QUFDQTs7QUFFQTs7QUFFQTtBQUNBO0FBQ0E7QUFDQTtBQUNBLElBQUk7QUFDSjtBQUNBO0FBQ0E7QUFDQTtBQUNBOztBQUVBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTs7QUFFQTtBQUNBO0FBQ0E7QUFDQTtBQUNBLElBQUk7QUFDSjtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0EsTUFBTTtBQUNOO0FBQ0EsTUFBTTtBQUNOO0FBQ0E7O0FBRUE7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTs7QUFFQTtBQUNBOztBQUVBO0FBQ0E7QUFDQTs7QUFFQTs7QUFFQTtBQUNBO0FBQ0E7QUFDQTs7QUFFQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7O0FBRUE7QUFDQSxnQkFBZ0I7QUFDaEI7QUFDQTtBQUNBO0FBQ0E7QUFDQTs7QUFFQTtBQUNBO0FBQ0E7QUFDQTtBQUNBOztBQUVBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTs7QUFFQTtBQUNBO0FBQ0E7QUFDQTs7QUFFQTs7QUFFQTtBQUNBO0FBQ0E7O0FBRUE7QUFDQTtBQUNBOztBQUVBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQSxRQUFRO0FBQ1I7O0FBRUEsa0NBQWtDLFFBQVE7QUFDMUM7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBOztBQUVBO0FBQ0E7O0FBRUE7QUFDQTtBQUNBO0FBQ0E7QUFDQTs7QUFFQTtBQUNBOztBQUVB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Ozs7O0FDSGM7O0FBRS9CO0FBQ0EscUNBQXFDLHNEQUFVO0FBQy9DOztBQUVBLGlFQUFlLFFBQVE7Ozs7Ozs7Ozs7Ozs7Ozs7QUNOYzs7QUFFckM7QUFDQSxPQUFPLHdEQUFRO0FBQ2Y7QUFDQTs7QUFFQTtBQUNBOztBQUVBLGlFQUFlLE9BQU87Ozs7OztVQ1Z0QjtVQUNBOztVQUVBO1VBQ0E7VUFDQTtVQUNBO1VBQ0E7VUFDQTtVQUNBO1VBQ0E7VUFDQTtVQUNBO1VBQ0E7VUFDQTtVQUNBOztVQUVBO1VBQ0E7O1VBRUE7VUFDQTtVQUNBOzs7OztXQ3RCQTtXQUNBO1dBQ0E7V0FDQTtXQUNBLHlDQUF5Qyx3Q0FBd0M7V0FDakY7V0FDQTtXQUNBOzs7OztXQ1BBOzs7OztXQ0FBO1dBQ0E7V0FDQTtXQUNBLHVEQUF1RCxpQkFBaUI7V0FDeEU7V0FDQSxnREFBZ0QsYUFBYTtXQUM3RDs7Ozs7Ozs7OztBQ05BLGVBQWUsbUJBQU8sQ0FBQyw0REFBYztBQUNyQztBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQSxpQ0FBaUM7QUFDakMsNENBQTRDO0FBQzVDO0FBQ0E7QUFDQTtBQUNBLGFBQWE7QUFDYjtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBLDRCQUE0QjtBQUM1QjtBQUNBLDJDQUEyQztBQUMzQztBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0EsYUFBYTtBQUNiO0FBQ0EsU0FBUztBQUNUO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQSIsInNvdXJjZXMiOlsid2VicGFjazovL2V0aGVyZXVtLXByb3ZpZGVyLWZvci1lMmUtdGVzdGluZy8uL25vZGVfbW9kdWxlcy9ldGgtcHJvdmlkZXIvQ29ubmVjdGlvbk1hbmFnZXIvaW5kZXguanMiLCJ3ZWJwYWNrOi8vZXRoZXJldW0tcHJvdmlkZXItZm9yLWUyZS10ZXN0aW5nLy4vbm9kZV9tb2R1bGVzL2V0aC1wcm92aWRlci9icm93c2VyLmpzIiwid2VicGFjazovL2V0aGVyZXVtLXByb3ZpZGVyLWZvci1lMmUtdGVzdGluZy8uL25vZGVfbW9kdWxlcy9ldGgtcHJvdmlkZXIvY29ubmVjdGlvbnMvaHR0cC5qcyIsIndlYnBhY2s6Ly9ldGhlcmV1bS1wcm92aWRlci1mb3ItZTJlLXRlc3RpbmcvLi9ub2RlX21vZHVsZXMvZXRoLXByb3ZpZGVyL2Nvbm5lY3Rpb25zL2luamVjdGVkLmpzIiwid2VicGFjazovL2V0aGVyZXVtLXByb3ZpZGVyLWZvci1lMmUtdGVzdGluZy8uL25vZGVfbW9kdWxlcy9ldGgtcHJvdmlkZXIvY29ubmVjdGlvbnMvdW5hdmFpbGFibGUuanMiLCJ3ZWJwYWNrOi8vZXRoZXJldW0tcHJvdmlkZXItZm9yLWUyZS10ZXN0aW5nLy4vbm9kZV9tb2R1bGVzL2V0aC1wcm92aWRlci9jb25uZWN0aW9ucy93cy5qcyIsIndlYnBhY2s6Ly9ldGhlcmV1bS1wcm92aWRlci1mb3ItZTJlLXRlc3RpbmcvLi9ub2RlX21vZHVsZXMvZXRoLXByb3ZpZGVyL25vZGVfbW9kdWxlcy9ldGhlcmV1bS1wcm92aWRlci9pbmRleC5qcyIsIndlYnBhY2s6Ly9ldGhlcmV1bS1wcm92aWRlci1mb3ItZTJlLXRlc3RpbmcvLi9ub2RlX21vZHVsZXMvZXRoLXByb3ZpZGVyL3BhcnNlL2luZGV4LmpzIiwid2VicGFjazovL2V0aGVyZXVtLXByb3ZpZGVyLWZvci1lMmUtdGVzdGluZy8uL25vZGVfbW9kdWxlcy9ldGgtcHJvdmlkZXIvcHJlc2V0cy9pbmRleC5qcyIsIndlYnBhY2s6Ly9ldGhlcmV1bS1wcm92aWRlci1mb3ItZTJlLXRlc3RpbmcvLi9ub2RlX21vZHVsZXMvZXRoLXByb3ZpZGVyL3Byb3ZpZGVyL2luZGV4LmpzIiwid2VicGFjazovL2V0aGVyZXVtLXByb3ZpZGVyLWZvci1lMmUtdGVzdGluZy8uL25vZGVfbW9kdWxlcy9ldGgtcHJvdmlkZXIvcmVzb2x2ZS9pbmRleC5qcyIsIndlYnBhY2s6Ly9ldGhlcmV1bS1wcm92aWRlci1mb3ItZTJlLXRlc3RpbmcvLi9ub2RlX21vZHVsZXMvZXZlbnRzL2V2ZW50cy5qcyIsIndlYnBhY2s6Ly9ldGhlcmV1bS1wcm92aWRlci1mb3ItZTJlLXRlc3RpbmcvLi9ub2RlX21vZHVsZXMvdXVpZC9kaXN0L2VzbS1icm93c2VyL2luZGV4LmpzIiwid2VicGFjazovL2V0aGVyZXVtLXByb3ZpZGVyLWZvci1lMmUtdGVzdGluZy8uL25vZGVfbW9kdWxlcy91dWlkL2Rpc3QvZXNtLWJyb3dzZXIvbWQ1LmpzIiwid2VicGFjazovL2V0aGVyZXVtLXByb3ZpZGVyLWZvci1lMmUtdGVzdGluZy8uL25vZGVfbW9kdWxlcy91dWlkL2Rpc3QvZXNtLWJyb3dzZXIvbmlsLmpzIiwid2VicGFjazovL2V0aGVyZXVtLXByb3ZpZGVyLWZvci1lMmUtdGVzdGluZy8uL25vZGVfbW9kdWxlcy91dWlkL2Rpc3QvZXNtLWJyb3dzZXIvcGFyc2UuanMiLCJ3ZWJwYWNrOi8vZXRoZXJldW0tcHJvdmlkZXItZm9yLWUyZS10ZXN0aW5nLy4vbm9kZV9tb2R1bGVzL3V1aWQvZGlzdC9lc20tYnJvd3Nlci9yZWdleC5qcyIsIndlYnBhY2s6Ly9ldGhlcmV1bS1wcm92aWRlci1mb3ItZTJlLXRlc3RpbmcvLi9ub2RlX21vZHVsZXMvdXVpZC9kaXN0L2VzbS1icm93c2VyL3JuZy5qcyIsIndlYnBhY2s6Ly9ldGhlcmV1bS1wcm92aWRlci1mb3ItZTJlLXRlc3RpbmcvLi9ub2RlX21vZHVsZXMvdXVpZC9kaXN0L2VzbS1icm93c2VyL3NoYTEuanMiLCJ3ZWJwYWNrOi8vZXRoZXJldW0tcHJvdmlkZXItZm9yLWUyZS10ZXN0aW5nLy4vbm9kZV9tb2R1bGVzL3V1aWQvZGlzdC9lc20tYnJvd3Nlci9zdHJpbmdpZnkuanMiLCJ3ZWJwYWNrOi8vZXRoZXJldW0tcHJvdmlkZXItZm9yLWUyZS10ZXN0aW5nLy4vbm9kZV9tb2R1bGVzL3V1aWQvZGlzdC9lc20tYnJvd3Nlci92MS5qcyIsIndlYnBhY2s6Ly9ldGhlcmV1bS1wcm92aWRlci1mb3ItZTJlLXRlc3RpbmcvLi9ub2RlX21vZHVsZXMvdXVpZC9kaXN0L2VzbS1icm93c2VyL3YzLmpzIiwid2VicGFjazovL2V0aGVyZXVtLXByb3ZpZGVyLWZvci1lMmUtdGVzdGluZy8uL25vZGVfbW9kdWxlcy91dWlkL2Rpc3QvZXNtLWJyb3dzZXIvdjM1LmpzIiwid2VicGFjazovL2V0aGVyZXVtLXByb3ZpZGVyLWZvci1lMmUtdGVzdGluZy8uL25vZGVfbW9kdWxlcy91dWlkL2Rpc3QvZXNtLWJyb3dzZXIvdjQuanMiLCJ3ZWJwYWNrOi8vZXRoZXJldW0tcHJvdmlkZXItZm9yLWUyZS10ZXN0aW5nLy4vbm9kZV9tb2R1bGVzL3V1aWQvZGlzdC9lc20tYnJvd3Nlci92NS5qcyIsIndlYnBhY2s6Ly9ldGhlcmV1bS1wcm92aWRlci1mb3ItZTJlLXRlc3RpbmcvLi9ub2RlX21vZHVsZXMvdXVpZC9kaXN0L2VzbS1icm93c2VyL3ZhbGlkYXRlLmpzIiwid2VicGFjazovL2V0aGVyZXVtLXByb3ZpZGVyLWZvci1lMmUtdGVzdGluZy8uL25vZGVfbW9kdWxlcy91dWlkL2Rpc3QvZXNtLWJyb3dzZXIvdmVyc2lvbi5qcyIsIndlYnBhY2s6Ly9ldGhlcmV1bS1wcm92aWRlci1mb3ItZTJlLXRlc3Rpbmcvd2VicGFjay9ib290c3RyYXAiLCJ3ZWJwYWNrOi8vZXRoZXJldW0tcHJvdmlkZXItZm9yLWUyZS10ZXN0aW5nL3dlYnBhY2svcnVudGltZS9kZWZpbmUgcHJvcGVydHkgZ2V0dGVycyIsIndlYnBhY2s6Ly9ldGhlcmV1bS1wcm92aWRlci1mb3ItZTJlLXRlc3Rpbmcvd2VicGFjay9ydW50aW1lL2hhc093blByb3BlcnR5IHNob3J0aGFuZCIsIndlYnBhY2s6Ly9ldGhlcmV1bS1wcm92aWRlci1mb3ItZTJlLXRlc3Rpbmcvd2VicGFjay9ydW50aW1lL21ha2UgbmFtZXNwYWNlIG9iamVjdCIsIndlYnBhY2s6Ly9ldGhlcmV1bS1wcm92aWRlci1mb3ItZTJlLXRlc3RpbmcvLi9zcmMvcHJvdmlkZXIvaW5kZXgudHMiXSwic291cmNlc0NvbnRlbnQiOlsiY29uc3QgRXZlbnRFbWl0dGVyID0gcmVxdWlyZSgnZXZlbnRzJylcblxuY29uc3QgZGV2ID0gcHJvY2Vzcy5lbnYuTk9ERV9FTlYgPT09ICdkZXZlbG9wbWVudCdcblxuY2xhc3MgQ29ubmVjdGlvbk1hbmFnZXIgZXh0ZW5kcyBFdmVudEVtaXR0ZXIge1xuICBjb25zdHJ1Y3RvciAoY29ubmVjdGlvbnMsIHRhcmdldHMsIG9wdGlvbnMpIHtcbiAgICBzdXBlcigpXG4gICAgdGhpcy50YXJnZXRzID0gdGFyZ2V0c1xuICAgIHRoaXMub3B0aW9ucyA9IG9wdGlvbnNcbiAgICB0aGlzLmNvbm5lY3Rpb25zID0gY29ubmVjdGlvbnNcbiAgICB0aGlzLmNvbm5lY3RlZCA9IGZhbHNlXG4gICAgdGhpcy5zdGF0dXMgPSAnbG9hZGluZydcbiAgICB0aGlzLmludGVydmFsID0gb3B0aW9ucy5pbnRlcnZhbCB8fCA1MDAwXG4gICAgdGhpcy5uYW1lID0gb3B0aW9ucy5uYW1lIHx8ICdkZWZhdWx0J1xuICAgIHRoaXMuaW5TZXR1cCA9IHRydWVcbiAgICB0aGlzLmNvbm5lY3QoKVxuICB9XG5cbiAgY29ubmVjdCAoaW5kZXggPSAwKSB7XG4gICAgaWYgKGRldiAmJiBpbmRleCA9PT0gMCkgY29uc29sZS5sb2coYFxcblxcblxcblxcbkEgY29ubmVjdGlvbiBjeWNsZSBzdGFydGVkIGZvciBwcm92aWRlciB3aXRoIG5hbWU6ICR7dGhpcy5uYW1lfWApXG5cbiAgICBpZiAodGhpcy5jb25uZWN0aW9uICYmIHRoaXMuY29ubmVjdGlvbi5zdGF0dXMgPT09ICdjb25uZWN0ZWQnICYmIGluZGV4ID49IHRoaXMuY29ubmVjdGlvbi5pbmRleCkge1xuICAgICAgaWYgKGRldikgY29uc29sZS5sb2coJ1N0b3BwaW5nIGNvbm5lY3Rpb24gY3ljbGUgYmVjYXN1c2Ugd2VcXCdyZSBhbHJlYWR5IGNvbm5lY3RlZCB0byBhIGhpZ2hlciBwcmlvcml0eSBwcm92aWRlcicpXG4gICAgfSBlbHNlIGlmICh0aGlzLnRhcmdldHMubGVuZ3RoID09PSAwKSB7XG4gICAgICBpZiAoZGV2KSBjb25zb2xlLmxvZygnTm8gdmFsaWQgdGFyZ2V0cyBzdXBwbGllZCcpXG4gICAgfSBlbHNlIHtcbiAgICAgIGNvbnN0IHsgcHJvdG9jb2wsIGxvY2F0aW9uIH0gPSB0aGlzLnRhcmdldHNbaW5kZXhdXG4gICAgICB0aGlzLmNvbm5lY3Rpb24gPSB0aGlzLmNvbm5lY3Rpb25zW3Byb3RvY29sXShsb2NhdGlvbiwgdGhpcy5vcHRpb25zKVxuXG4gICAgICB0aGlzLmNvbm5lY3Rpb24ub24oJ2Vycm9yJywgZXJyID0+IHtcbiAgICAgICAgaWYgKCF0aGlzLmNvbm5lY3RlZCkgcmV0dXJuIHRoaXMuY29ubmVjdGlvbkVycm9yKGluZGV4LCBlcnIpXG4gICAgICAgIGlmICh0aGlzLmxpc3RlbmVyQ291bnQoJ2Vycm9yJykpIHJldHVybiB0aGlzLmVtaXQoJ2Vycm9yJywgZXJyKVxuICAgICAgICBjb25zb2xlLndhcm4oJ2V0aC1wcm92aWRlciAtIFVuY2F1Z2h0IGNvbm5lY3Rpb24gZXJyb3I6ICcgKyBlcnIubWVzc2FnZSlcbiAgICAgIH0pXG5cbiAgICAgIHRoaXMuY29ubmVjdGlvbi5vbignY2xvc2UnLCAoKSA9PiB7XG4gICAgICAgIHRoaXMuY29ubmVjdGVkID0gZmFsc2VcbiAgICAgICAgdGhpcy5lbWl0Q2xvc2UoKVxuICAgICAgICBpZiAoIXRoaXMuY2xvc2luZykgdGhpcy5yZWZyZXNoKClcbiAgICAgIH0pXG5cbiAgICAgIHRoaXMuY29ubmVjdGlvbi5vbignY29ubmVjdCcsICgpID0+IHtcbiAgICAgICAgdGhpcy5jb25uZWN0aW9uLnRhcmdldCA9IHRoaXMudGFyZ2V0c1tpbmRleF1cbiAgICAgICAgdGhpcy5jb25uZWN0aW9uLmluZGV4ID0gaW5kZXhcbiAgICAgICAgdGhpcy50YXJnZXRzW2luZGV4XS5zdGF0dXMgPSB0aGlzLmNvbm5lY3Rpb24uc3RhdHVzXG4gICAgICAgIHRoaXMuY29ubmVjdGVkID0gdHJ1ZVxuICAgICAgICB0aGlzLmluU2V0dXAgPSBmYWxzZVxuICAgICAgICBpZiAoZGV2KSBjb25zb2xlLmxvZygnU3VjY2Vzc2Z1bGx5IGNvbm5lY3RlZCB0bzogJyArIHRoaXMudGFyZ2V0c1tpbmRleF0ubG9jYXRpb24pXG4gICAgICAgIHRoaXMuZW1pdCgnY29ubmVjdCcpXG4gICAgICB9KVxuXG4gICAgICB0aGlzLmNvbm5lY3Rpb24ub24oJ2RhdGEnLCBkYXRhID0+IHRoaXMuZW1pdCgnZGF0YScsIGRhdGEpKVxuICAgICAgdGhpcy5jb25uZWN0aW9uLm9uKCdwYXlsb2FkJywgcGF5bG9hZCA9PiB0aGlzLmVtaXQoJ3BheWxvYWQnLCBwYXlsb2FkKSlcbiAgICB9XG4gIH1cblxuICByZWZyZXNoIChpbnRlcnZhbCA9IHRoaXMuaW50ZXJ2YWwpIHtcbiAgICBpZiAoZGV2KSBjb25zb2xlLmxvZyhgUmVjb25uZWN0IHF1ZXVlZCBmb3IgJHsoaW50ZXJ2YWwgLyAxMDAwKS50b0ZpeGVkKDIpfXMgaW4gdGhlIGZ1dHVyZWApXG4gICAgY2xlYXJUaW1lb3V0KHRoaXMuY29ubmVjdFRpbWVyKVxuICAgIHRoaXMuY29ubmVjdFRpbWVyID0gc2V0VGltZW91dCgoKSA9PiB0aGlzLmNvbm5lY3QoKSwgaW50ZXJ2YWwpXG4gIH1cblxuICBjb25uZWN0aW9uRXJyb3IgKGluZGV4LCBlcnIpIHtcbiAgICBpZiAodGhpcy5jb25uZWN0aW9uICYmIHRoaXMuY29ubmVjdGlvbi5jbG9zZSkgdGhpcy5jb25uZWN0aW9uLmNsb3NlKClcblxuICAgIHRoaXMudGFyZ2V0c1tpbmRleF0uc3RhdHVzID0gZXJyXG4gICAgaWYgKHRoaXMudGFyZ2V0cy5sZW5ndGggLSAxID09PSBpbmRleCkge1xuICAgICAgdGhpcy5pblNldHVwID0gZmFsc2VcbiAgICAgIGlmIChkZXYpIGNvbnNvbGUud2FybignZXRoLXByb3ZpZGVyIHVuYWJsZSB0byBjb25uZWN0IHRvIGFueSB0YXJnZXRzLCB2aWV3IGNvbm5lY3Rpb24gY3ljbGUgc3VtbWFyeTogJywgdGhpcy50YXJnZXRzKVxuICAgICAgdGhpcy5yZWZyZXNoKClcbiAgICB9IGVsc2UgeyAvLyBOb3QgbGFzdCB0YXJnZXQsIG1vdmUgb24gdGhlIG5leHQgY29ubmVjdGlvbiBvcHRpb25cbiAgICAgIHRoaXMuY29ubmVjdCgrK2luZGV4KVxuICAgIH1cbiAgfVxuXG4gIGVtaXRDbG9zZSAoKSB7XG4gICAgdGhpcy5lbWl0KCdjbG9zZScpXG4gIH1cblxuICBjbG9zZSAoKSB7XG4gICAgdGhpcy5jbG9zaW5nID0gdHJ1ZVxuICAgIGlmICh0aGlzLmNvbm5lY3Rpb24gJiYgdGhpcy5jb25uZWN0aW9uLmNsb3NlICYmICF0aGlzLmNvbm5lY3Rpb24uY2xvc2VkKSB7XG4gICAgICB0aGlzLmNvbm5lY3Rpb24uY2xvc2UoKSAvLyBMZXQgZXZlbnQgYnViYmxlIGZyb20gaGVyZVxuICAgIH0gZWxzZSB7XG4gICAgICB0aGlzLmVtaXQoJ2Nsb3NlJylcbiAgICB9XG4gICAgY2xlYXJUaW1lb3V0KHRoaXMuY29ubmVjdFRpbWVyKVxuICAgIGNsZWFyVGltZW91dCh0aGlzLnNldHVwVGltZXIpXG4gIH1cblxuICBlcnJvciAocGF5bG9hZCwgbWVzc2FnZSwgY29kZSA9IC0xKSB7XG4gICAgdGhpcy5lbWl0KCdwYXlsb2FkJywgeyBpZDogcGF5bG9hZC5pZCwganNvbnJwYzogcGF5bG9hZC5qc29ucnBjLCBlcnJvcjogeyBtZXNzYWdlLCBjb2RlIH0gfSlcbiAgfVxuXG4gIHNlbmQgKHBheWxvYWQpIHtcbiAgICBpZiAodGhpcy5pblNldHVwKSB7XG4gICAgICB0aGlzLnNldHVwVGltZXIgPSBzZXRUaW1lb3V0KCgpID0+IHRoaXMuc2VuZChwYXlsb2FkKSwgMTAwKVxuICAgIH0gZWxzZSBpZiAodGhpcy5jb25uZWN0aW9uLmNsb3NlZCkge1xuICAgICAgdGhpcy5lcnJvcihwYXlsb2FkLCAnTm90IGNvbm5lY3RlZCcsIDQ5MDApXG4gICAgfSBlbHNlIHtcbiAgICAgIHRoaXMuY29ubmVjdGlvbi5zZW5kKHBheWxvYWQpXG4gICAgfVxuICB9XG59XG5cbm1vZHVsZS5leHBvcnRzID0gQ29ubmVjdGlvbk1hbmFnZXJcbiIsImNvbnN0IHJlc29sdmUgPSByZXF1aXJlKCcuL3Jlc29sdmUnKVxuY29uc3QgcHJvdmlkZXIgPSByZXF1aXJlKCcuL3Byb3ZpZGVyJylcbmNvbnN0IHByZXNldHMgPSByZXF1aXJlKCcuL3ByZXNldHMnKVxuXG5jb25zdCBpbmplY3RlZCA9IHtcbiAgZXRoZXJldW06IHR5cGVvZiB3aW5kb3cgIT09ICd1bmRlZmluZWQnICYmIHR5cGVvZiB3aW5kb3cuZXRoZXJldW0gIT09ICd1bmRlZmluZWQnID8gd2luZG93LmV0aGVyZXVtIDogbnVsbCxcbiAgd2ViMzogdHlwZW9mIHdpbmRvdyAhPT0gJ3VuZGVmaW5lZCcgJiYgdHlwZW9mIHdpbmRvdy53ZWIzICE9PSAndW5kZWZpbmVkJyA/IHdpbmRvdy53ZWIzLmN1cnJlbnRQcm92aWRlciA6IG51bGxcbn1cbmNvbnN0IHdzID0gdHlwZW9mIHdpbmRvdyAhPT0gJ3VuZGVmaW5lZCcgJiYgdHlwZW9mIHdpbmRvdy5XZWJTb2NrZXQgIT09ICd1bmRlZmluZWQnID8gd2luZG93LldlYlNvY2tldCA6IG51bGxcbmNvbnN0IFhIUiA9IHR5cGVvZiB3aW5kb3cgIT09ICd1bmRlZmluZWQnICYmIHR5cGVvZiB3aW5kb3cuWE1MSHR0cFJlcXVlc3QgIT09ICd1bmRlZmluZWQnID8gd2luZG93LlhNTEh0dHBSZXF1ZXN0IDogbnVsbFxuXG5pZiAoaW5qZWN0ZWQuZXRoZXJldW0pIGluamVjdGVkLmV0aGVyZXVtLl9faXNQcm92aWRlciA9IHRydWVcblxuY29uc3QgY29ubmVjdGlvbnMgPSB7XG4gIGluamVjdGVkOiBpbmplY3RlZC5ldGhlcmV1bSB8fCByZXF1aXJlKCcuL2Nvbm5lY3Rpb25zL2luamVjdGVkJykoaW5qZWN0ZWQud2ViMyksXG4gIGlwYzogcmVxdWlyZSgnLi9jb25uZWN0aW9ucy91bmF2YWlsYWJsZScpKCdJUEMgY29ubmVjdGlvbnMgYXJlIHVuYXZsaWFibGUgaW4gdGhlIGJyb3dzZXInKSxcbiAgd3M6IHJlcXVpcmUoJy4vY29ubmVjdGlvbnMvd3MnKSh3cyksXG4gIGh0dHA6IHJlcXVpcmUoJy4vY29ubmVjdGlvbnMvaHR0cCcpKFhIUilcbn1cblxubW9kdWxlLmV4cG9ydHMgPSAodGFyZ2V0cywgb3B0aW9ucykgPT4ge1xuICBpZiAodGFyZ2V0cyAmJiAhQXJyYXkuaXNBcnJheSh0YXJnZXRzKSAmJiB0eXBlb2YgdGFyZ2V0cyA9PT0gJ29iamVjdCcgJiYgIW9wdGlvbnMpIHtcbiAgICBvcHRpb25zID0gdGFyZ2V0c1xuICAgIHRhcmdldHMgPSB1bmRlZmluZWRcbiAgfVxuICBpZiAoIXRhcmdldHMpIHRhcmdldHMgPSBbJ2luamVjdGVkJywgJ2ZyYW1lJ11cbiAgaWYgKCFvcHRpb25zKSBvcHRpb25zID0ge31cblxuICB0YXJnZXRzID0gW10uY29uY2F0KHRhcmdldHMpXG5cbiAgdGFyZ2V0cy5mb3JFYWNoKHQgPT4ge1xuICAgIGlmICh0LnN0YXJ0c1dpdGgoJ2FsY2hlbXknKSAmJiAhb3B0aW9ucy5hbGNoZW15SWQpIHRocm93IG5ldyBFcnJvcignQWxjaGVteSB3YXMgaW5jbHVkZWQgYXMgYSBjb25uZWN0aW9uIHRhcmdldCBidXQgbm8gQWxjaGVteSBwcm9qZWN0IElEIHdhcyBwYXNzZWQgaW4gb3B0aW9ucyBlLmcuIHsgYWxjaGVteUlkOiBcXCcxMjNhYmNcXCcgfScpXG4gICAgaWYgKHQuc3RhcnRzV2l0aCgnaW5mdXJhJykgJiYgIW9wdGlvbnMuaW5mdXJhSWQpIHRocm93IG5ldyBFcnJvcignSW5mdXJhIHdhcyBpbmNsdWRlZCBhcyBhIGNvbm5lY3Rpb24gdGFyZ2V0IGJ1dCBubyBJbmZ1cmEgcHJvamVjdCBJRCB3YXMgcGFzc2VkIGluIG9wdGlvbnMgZS5nLiB7IGluZnVyYUlkOiBcXCcxMjNhYmNcXCcgfScpXG4gIH0pXG5cbiAgY29uc3Qgc2V0cyA9IHByZXNldHMob3B0aW9ucylcblxuICByZXR1cm4gcHJvdmlkZXIoY29ubmVjdGlvbnMsIHJlc29sdmUodGFyZ2V0cywgc2V0cyksIG9wdGlvbnMpXG59XG4iLCJjb25zdCBFdmVudEVtaXR0ZXIgPSByZXF1aXJlKCdldmVudHMnKVxuY29uc3QgeyB2NDogdXVpZCB9ID0gcmVxdWlyZSgndXVpZCcpXG5cbmNvbnN0IGRldiA9IHByb2Nlc3MuZW52Lk5PREVfRU5WID09PSAnZGV2ZWxvcG1lbnQnXG5cbmxldCBYSFJcblxuY2xhc3MgSFRUUENvbm5lY3Rpb24gZXh0ZW5kcyBFdmVudEVtaXR0ZXIge1xuICBjb25zdHJ1Y3RvciAoX1hIUiwgdXJsLCBvcHRpb25zKSB7XG4gICAgc3VwZXIoKVxuICAgIFhIUiA9IF9YSFJcbiAgICB0aGlzLm9wdGlvbnMgPSBvcHRpb25zXG4gICAgdGhpcy5jb25uZWN0ZWQgPSBmYWxzZVxuICAgIHRoaXMuc3Vic2NyaXB0aW9ucyA9IGZhbHNlXG4gICAgdGhpcy5zdGF0dXMgPSAnbG9hZGluZydcbiAgICB0aGlzLnVybCA9IHVybFxuICAgIHRoaXMucG9sbElkID0gdXVpZCgpXG4gICAgc2V0VGltZW91dCgoKSA9PiB0aGlzLmNyZWF0ZSgpLCAwKVxuICAgIHRoaXMuX2VtaXQgPSAoLi4uYXJncykgPT4gIXRoaXMuY2xvc2VkID8gdGhpcy5lbWl0KC4uLmFyZ3MpIDogbnVsbFxuICB9XG5cbiAgY3JlYXRlICgpIHtcbiAgICBpZiAoIVhIUikgcmV0dXJuIHRoaXMuX2VtaXQoJ2Vycm9yJywgbmV3IEVycm9yKCdObyBIVFRQIHRyYW5zcG9ydCBhdmFpbGFibGUnKSlcbiAgICB0aGlzLm9uKCdlcnJvcicsICgpID0+IHsgaWYgKHRoaXMuY29ubmVjdGVkKSB0aGlzLmNsb3NlKCkgfSlcbiAgICB0aGlzLmluaXQoKVxuICB9XG5cbiAgaW5pdCAoKSB7XG4gICAgdGhpcy5zZW5kKHsganNvbnJwYzogJzIuMCcsIG1ldGhvZDogJ25ldF92ZXJzaW9uJywgcGFyYW1zOiBbXSwgaWQ6IDEgfSwgKGVyciwgcmVzcG9uc2UpID0+IHtcbiAgICAgIGlmIChlcnIpIHJldHVybiB0aGlzLl9lbWl0KCdlcnJvcicsIGVycilcbiAgICAgIHRoaXMuY29ubmVjdGVkID0gdHJ1ZVxuICAgICAgdGhpcy5fZW1pdCgnY29ubmVjdCcpXG4gICAgICB0aGlzLnNlbmQoeyBqc29ucnBjOiAnMi4wJywgaWQ6IDEsIG1ldGhvZDogJ2V0aF9wb2xsU3Vic2NyaXB0aW9ucycsIHBhcmFtczogW3RoaXMucG9sbElkLCAnaW1tZWRpYXRlJ10gfSwgKGVyciwgcmVzcG9uc2UpID0+IHtcbiAgICAgICAgaWYgKCFlcnIpIHtcbiAgICAgICAgICB0aGlzLnN1YnNjcmlwdGlvbnMgPSB0cnVlXG4gICAgICAgICAgdGhpcy5wb2xsU3Vic2NyaXB0aW9ucygpXG4gICAgICAgIH1cbiAgICAgIH0pXG4gICAgfSlcbiAgfVxuXG4gIHBvbGxTdWJzY3JpcHRpb25zICgpIHtcbiAgICB0aGlzLnNlbmQoeyBqc29ucnBjOiAnMi4wJywgaWQ6IDEsIG1ldGhvZDogJ2V0aF9wb2xsU3Vic2NyaXB0aW9ucycsIHBhcmFtczogW3RoaXMucG9sbElkXSB9LCAoZXJyLCByZXN1bHQpID0+IHtcbiAgICAgIGlmIChlcnIpIHtcbiAgICAgICAgdGhpcy5zdWJzY3JpcHRpb25UaW1lb3V0ID0gc2V0VGltZW91dCgoKSA9PiB0aGlzLnBvbGxTdWJzY3JpcHRpb25zKCksIDEwMDAwKVxuICAgICAgICByZXR1cm4gdGhpcy5fZW1pdCgnZXJyb3InLCBlcnIpXG4gICAgICB9IGVsc2Uge1xuICAgICAgICBpZiAoIXRoaXMuY2xvc2VkKSB0aGlzLnN1YnNjcmlwdGlvblRpbWVvdXQgPSB0aGlzLnBvbGxTdWJzY3JpcHRpb25zKClcbiAgICAgICAgaWYgKHJlc3VsdCkge1xuICAgICAgICAgIHJlc3VsdC5tYXAocCA9PiB7XG4gICAgICAgICAgICBsZXQgcGFyc2VcbiAgICAgICAgICAgIHRyeSB7IHBhcnNlID0gSlNPTi5wYXJzZShwKSB9IGNhdGNoIChlKSB7IHBhcnNlID0gZmFsc2UgfVxuICAgICAgICAgICAgcmV0dXJuIHBhcnNlXG4gICAgICAgICAgfSkuZmlsdGVyKG4gPT4gbikuZm9yRWFjaChwID0+IHRoaXMuX2VtaXQoJ3BheWxvYWQnLCBwKSlcbiAgICAgICAgfVxuICAgICAgfVxuICAgIH0pXG4gIH1cblxuICBjbG9zZSAoKSB7XG4gICAgaWYgKGRldikgY29uc29sZS5sb2coJ0Nsb3NpbmcgSFRUUCBjb25uZWN0aW9uJylcblxuICAgIGNsZWFyVGltZW91dCh0aGlzLnN1YnNjcmlwdGlvblRpbWVvdXQpXG5cbiAgICB0aGlzLl9lbWl0KCdjbG9zZScpXG4gICAgdGhpcy5jbG9zZWQgPSB0cnVlXG4gICAgdGhpcy5yZW1vdmVBbGxMaXN0ZW5lcnMoKVxuICB9XG5cbiAgZmlsdGVyU3RhdHVzIChyZXMpIHtcbiAgICBpZiAocmVzLnN0YXR1cyA+PSAyMDAgJiYgcmVzLnN0YXR1cyA8IDMwMCkgcmV0dXJuIHJlc1xuICAgIGNvbnN0IGVycm9yID0gbmV3IEVycm9yKHJlcy5zdGF0dXNUZXh0KVxuICAgIGVycm9yLnJlcyA9IHJlc1xuICAgIHRocm93IGVycm9yLm1lc3NhZ2VcbiAgfVxuXG4gIGVycm9yIChwYXlsb2FkLCBtZXNzYWdlLCBjb2RlID0gLTEpIHtcbiAgICB0aGlzLl9lbWl0KCdwYXlsb2FkJywgeyBpZDogcGF5bG9hZC5pZCwganNvbnJwYzogcGF5bG9hZC5qc29ucnBjLCBlcnJvcjogeyBtZXNzYWdlLCBjb2RlIH0gfSlcbiAgfVxuXG4gIHNlbmQgKHBheWxvYWQsIGludGVybmFsKSB7XG4gICAgaWYgKHRoaXMuY2xvc2VkKSByZXR1cm4gdGhpcy5lcnJvcihwYXlsb2FkLCAnTm90IGNvbm5lY3RlZCcpXG4gICAgaWYgKHBheWxvYWQubWV0aG9kID09PSAnZXRoX3N1YnNjcmliZScpIHtcbiAgICAgIGlmICh0aGlzLnN1YnNjcmlwdGlvbnMpIHtcbiAgICAgICAgcGF5bG9hZC5wb2xsSWQgPSB0aGlzLnBvbGxJZFxuICAgICAgfSBlbHNlIHtcbiAgICAgICAgcmV0dXJuIHRoaXMuZXJyb3IocGF5bG9hZCwgJ1N1YnNjcmlwdGlvbnMgYXJlIG5vdCBzdXBwb3J0ZWQgYnkgdGhpcyBIVFRQIGVuZHBvaW50JylcbiAgICAgIH1cbiAgICB9XG4gICAgY29uc3QgeGhyID0gbmV3IFhIUigpXG4gICAgbGV0IHJlc3BvbmRlZCA9IGZhbHNlXG4gICAgY29uc3QgcmVzID0gKGVyciwgcmVzdWx0KSA9PiB7XG4gICAgICBpZiAoIXJlc3BvbmRlZCkge1xuICAgICAgICB4aHIuYWJvcnQoKVxuICAgICAgICByZXNwb25kZWQgPSB0cnVlXG4gICAgICAgIGlmIChpbnRlcm5hbCkge1xuICAgICAgICAgIGludGVybmFsKGVyciwgcmVzdWx0KVxuICAgICAgICB9IGVsc2Uge1xuICAgICAgICAgIGNvbnN0IHsgaWQsIGpzb25ycGMgfSA9IHBheWxvYWRcbiAgICAgICAgICBjb25zdCBsb2FkID0gZXJyID8geyBpZCwganNvbnJwYywgZXJyb3I6IHsgbWVzc2FnZTogZXJyLm1lc3NhZ2UsIGNvZGU6IGVyci5jb2RlIH0gfSA6IHsgaWQsIGpzb25ycGMsIHJlc3VsdCB9XG4gICAgICAgICAgdGhpcy5fZW1pdCgncGF5bG9hZCcsIGxvYWQpXG4gICAgICAgIH1cbiAgICAgIH1cbiAgICB9XG4gICAgeGhyLm9wZW4oJ1BPU1QnLCB0aGlzLnVybCwgdHJ1ZSlcbiAgICB4aHIuc2V0UmVxdWVzdEhlYWRlcignQ29udGVudC1UeXBlJywgJ2FwcGxpY2F0aW9uL2pzb24nKVxuICAgIC8vIEJlbG93IG5vdCB3b3JraW5nIGJlY2FzdWUgWEhSIGxpYiBibG9ja3MgaXQgY2xhaW1pbmcgXCJyZXN0cmljdGVkIGhlYWRlclwiXG4gICAgLy8gaWYgKHRoaXMub3B0aW9ucy5vcmlnaW4pIHhoci5zZXRSZXF1ZXN0SGVhZGVyKCdPcmlnaW4nLCB0aGlzLm9wdGlvbnMub3JpZ2luKVxuICAgIHhoci50aW1lb3V0ID0gNjAgKiAxMDAwXG4gICAgeGhyLm9uZXJyb3IgPSByZXNcbiAgICB4aHIub250aW1lb3V0ID0gcmVzXG4gICAgeGhyLm9ucmVhZHlzdGF0ZWNoYW5nZSA9ICgpID0+IHtcbiAgICAgIGlmICh4aHIucmVhZHlTdGF0ZSA9PT0gNCkge1xuICAgICAgICB0cnkge1xuICAgICAgICAgIGNvbnN0IHJlc3BvbnNlID0gSlNPTi5wYXJzZSh4aHIucmVzcG9uc2VUZXh0KVxuICAgICAgICAgIHJlcyhyZXNwb25zZS5lcnJvciwgcmVzcG9uc2UucmVzdWx0KVxuICAgICAgICB9IGNhdGNoIChlKSB7XG4gICAgICAgICAgcmVzKGUpXG4gICAgICAgIH1cbiAgICAgIH1cbiAgICB9XG4gICAgeGhyLnNlbmQoSlNPTi5zdHJpbmdpZnkocGF5bG9hZCkpXG4gIH1cbn1cblxubW9kdWxlLmV4cG9ydHMgPSBYSFIgPT4gKHVybCwgb3B0aW9ucykgPT4gbmV3IEhUVFBDb25uZWN0aW9uKFhIUiwgdXJsLCBvcHRpb25zKVxuIiwiY29uc3QgRXZlbnRFbWl0dGVyID0gcmVxdWlyZSgnZXZlbnRzJylcblxuY2xhc3MgSW5qZWN0ZWRDb25uZWN0aW9uIGV4dGVuZHMgRXZlbnRFbWl0dGVyIHtcbiAgY29uc3RydWN0b3IgKF9pbmplY3RlZCwgb3B0aW9ucykge1xuICAgIHN1cGVyKClcbiAgICBpZiAoX2luamVjdGVkKSB7XG4gICAgICBzZXRUaW1lb3V0KCgpID0+IHRoaXMuZW1pdCgnZXJyb3InLCBuZXcgRXJyb3IoJ0luamVjdGVkIHdlYjMgcHJvdmlkZXIgaXMgbm90IGN1cnJlbnRseSBzdXBwb3J0ZWQnKSksIDApXG4gICAgfSBlbHNlIHtcbiAgICAgIHNldFRpbWVvdXQoKCkgPT4gdGhpcy5lbWl0KCdlcnJvcicsIG5ldyBFcnJvcignTm8gaW5qZWN0ZWQgcHJvdmlkZXIgZm91bmQnKSksIDApXG4gICAgfVxuICB9XG59XG5cbm1vZHVsZS5leHBvcnRzID0gaW5qZWN0ZWQgPT4gb3B0aW9ucyA9PiBuZXcgSW5qZWN0ZWRDb25uZWN0aW9uKGluamVjdGVkLCBvcHRpb25zKVxuIiwiY29uc3QgRXZlbnRFbWl0dGVyID0gcmVxdWlyZSgnZXZlbnRzJylcblxuY2xhc3MgVW5hdmFpbGFibGVDb25uZWN0aW9uIGV4dGVuZHMgRXZlbnRFbWl0dGVyIHtcbiAgY29uc3RydWN0b3IgKG1lc3NhZ2UpIHtcbiAgICBzdXBlcigpXG4gICAgc2V0VGltZW91dCgoKSA9PiB0aGlzLmVtaXQoJ2Vycm9yJywgbmV3IEVycm9yKG1lc3NhZ2UpKSwgMClcbiAgfVxufVxuXG5tb2R1bGUuZXhwb3J0cyA9IG1lc3NhZ2UgPT4gKCkgPT4gbmV3IFVuYXZhaWxhYmxlQ29ubmVjdGlvbihtZXNzYWdlKVxuIiwiY29uc3QgRXZlbnRFbWl0dGVyID0gcmVxdWlyZSgnZXZlbnRzJylcbmNvbnN0IHBhcnNlID0gcmVxdWlyZSgnLi4vcGFyc2UnKVxuY29uc3QgZGV2ID0gcHJvY2Vzcy5lbnYuTk9ERV9FTlYgPT09ICdkZXZlbG9wbWVudCdcblxubGV0IFdlYlNvY2tldFxuXG5jbGFzcyBXZWJTb2NrZXRDb25uZWN0aW9uIGV4dGVuZHMgRXZlbnRFbWl0dGVyIHtcbiAgY29uc3RydWN0b3IgKF9XZWJTb2NrZXQsIHVybCwgb3B0aW9ucykge1xuICAgIHN1cGVyKClcblxuICAgIHRoaXMub25FcnJvciA9IHRoaXMub25FcnJvci5iaW5kKHRoaXMpXG4gICAgdGhpcy5vbk1lc3NhZ2UgPSB0aGlzLm9uTWVzc2FnZS5iaW5kKHRoaXMpXG4gICAgdGhpcy5vbk9wZW4gPSB0aGlzLm9uT3Blbi5iaW5kKHRoaXMpXG4gICAgdGhpcy5vbkNsb3NlID0gdGhpcy5vbkNsb3NlLmJpbmQodGhpcylcblxuICAgIFdlYlNvY2tldCA9IF9XZWJTb2NrZXRcbiAgICBzZXRUaW1lb3V0KCgpID0+IHRoaXMuY3JlYXRlKHVybCwgb3B0aW9ucyksIDApXG4gIH1cblxuICBjcmVhdGUgKHVybCwgb3B0aW9ucykge1xuICAgIGlmICghV2ViU29ja2V0KSB0aGlzLmVtaXQoJ2Vycm9yJywgbmV3IEVycm9yKCdObyBXZWJTb2NrZXQgdHJhbnNwb3J0IGF2YWlsYWJsZScpKVxuICAgIHRyeSB7IHRoaXMuc29ja2V0ID0gbmV3IFdlYlNvY2tldCh1cmwsIFtdLCB7IG9yaWdpbjogb3B0aW9ucy5vcmlnaW4gfSkgfSBjYXRjaCAoZSkgeyByZXR1cm4gdGhpcy5lbWl0KCdlcnJvcicsIGUpIH1cblxuICAgIHRoaXMuc29ja2V0LmFkZEV2ZW50TGlzdGVuZXIoJ2Vycm9yJywgdGhpcy5vbkVycm9yKVxuICAgIHRoaXMuc29ja2V0LmFkZEV2ZW50TGlzdGVuZXIoJ29wZW4nLCB0aGlzLm9uT3BlbilcbiAgICB0aGlzLnNvY2tldC5hZGRFdmVudExpc3RlbmVyKCdjbG9zZScsIHRoaXMub25DbG9zZSlcbiAgfVxuXG4gIG9uT3BlbiAoKSB7XG4gICAgdGhpcy5lbWl0KCdjb25uZWN0JylcblxuICAgIHRoaXMuc29ja2V0LmFkZEV2ZW50TGlzdGVuZXIoJ21lc3NhZ2UnLCB0aGlzLm9uTWVzc2FnZSlcbiAgfVxuXG4gIG9uTWVzc2FnZSAobWVzc2FnZSkge1xuICAgIGNvbnN0IGRhdGEgPSB0eXBlb2YgbWVzc2FnZS5kYXRhID09PSAnc3RyaW5nJyA/IG1lc3NhZ2UuZGF0YSA6ICcnXG4gICAgcGFyc2UoZGF0YSwgKGVyciwgcGF5bG9hZHMpID0+IHtcbiAgICAgIGlmIChlcnIpIHJldHVybiAvL1xuICAgICAgcGF5bG9hZHMuZm9yRWFjaChsb2FkID0+IHtcbiAgICAgICAgaWYgKEFycmF5LmlzQXJyYXkobG9hZCkpIHtcbiAgICAgICAgICBsb2FkLmZvckVhY2gocGF5bG9hZCA9PiB0aGlzLmVtaXQoJ3BheWxvYWQnLCBwYXlsb2FkKSlcbiAgICAgICAgfSBlbHNlIHtcbiAgICAgICAgICB0aGlzLmVtaXQoJ3BheWxvYWQnLCBsb2FkKVxuICAgICAgICB9XG4gICAgICB9KVxuICAgIH0pXG4gIH1cblxuICBvbkVycm9yIChlcnIpIHtcbiAgICB0aGlzLmVtaXQoJ2Vycm9yJywgZXJyKVxuICB9XG5cbiAgb25DbG9zZSAoZSkge1xuICAgIGNsZWFyVGltZW91dCh0aGlzLmNsb3NlVGltZW91dClcblxuICAgIGlmICh0aGlzLnNvY2tldCkge1xuICAgICAgdGhpcy5zb2NrZXQucmVtb3ZlRXZlbnRMaXN0ZW5lcignb3BlbicsIHRoaXMub25PcGVuKVxuICAgICAgdGhpcy5zb2NrZXQucmVtb3ZlRXZlbnRMaXN0ZW5lcignY2xvc2UnLCB0aGlzLm9uQ2xvc2UpXG4gICAgICB0aGlzLnNvY2tldC5yZW1vdmVFdmVudExpc3RlbmVyKCdtZXNzYWdlJywgdGhpcy5vbk1lc3NhZ2UpXG4gICAgICB0aGlzLnNvY2tldC5yZW1vdmVFdmVudExpc3RlbmVyKCdlcnJvcicsIHRoaXMub25FcnJvcilcbiAgICAgIHRoaXMuc29ja2V0ID0gbnVsbFxuICAgIH1cblxuICAgIHRoaXMuY2xvc2VkID0gdHJ1ZVxuXG4gICAgaWYgKGRldikgY29uc29sZS5sb2coYENsb3NpbmcgV2ViU29ja2V0IGNvbm5lY3Rpb24sIHJlYXNvbjogJHtlLnJlYXNvbn0gKGNvZGUgJHtlLmNvZGV9KWApXG5cbiAgICB0aGlzLmVtaXQoJ2Nsb3NlJylcbiAgICB0aGlzLnJlbW92ZUFsbExpc3RlbmVycygpXG4gIH1cblxuICBjbG9zZSAoKSB7XG4gICAgaWYgKHRoaXMuc29ja2V0KSB7XG4gICAgICB0aGlzLnNvY2tldC5jbG9zZSgpXG5cbiAgICAgIC8vIGdpdmUgdGhlIHNvY2tldCBjbG9zZSBldmVudCBzb21lIHRpbWUgdG8gZmlyZSwgb3RoZXJ3aXNlIHdlIGNhbiBjbGVhbiB1cFxuICAgICAgLy8gYW5kIGNsb3NlIGV2ZXJ5dGhpbmcgbWFudWFsbHlcbiAgICAgIHRoaXMuY2xvc2VUaW1lb3V0ID0gc2V0VGltZW91dCgoKSA9PiB7XG4gICAgICAgIHRoaXMub25DbG9zZSgpXG4gICAgICB9LCAxMDAwKVxuICAgIH0gZWxzZSB7XG4gICAgICB0aGlzLm9uQ2xvc2UoKVxuICAgIH1cbiAgfVxuXG4gIGVycm9yIChwYXlsb2FkLCBtZXNzYWdlLCBjb2RlID0gLTEpIHtcbiAgICB0aGlzLmVtaXQoJ3BheWxvYWQnLCB7IGlkOiBwYXlsb2FkLmlkLCBqc29ucnBjOiBwYXlsb2FkLmpzb25ycGMsIGVycm9yOiB7IG1lc3NhZ2UsIGNvZGUgfSB9KVxuICB9XG5cbiAgc2VuZCAocGF5bG9hZCkge1xuICAgIGlmICh0aGlzLnNvY2tldCAmJiB0aGlzLnNvY2tldC5yZWFkeVN0YXRlID09PSB0aGlzLnNvY2tldC5DT05ORUNUSU5HKSB7XG4gICAgICBzZXRUaW1lb3V0KF8gPT4gdGhpcy5zZW5kKHBheWxvYWQpLCAxMClcbiAgICB9IGVsc2UgaWYgKCF0aGlzLnNvY2tldCB8fCB0aGlzLnNvY2tldC5yZWFkeVN0YXRlID4gMSkge1xuICAgICAgdGhpcy5jb25uZWN0ZWQgPSBmYWxzZVxuICAgICAgdGhpcy5lcnJvcihwYXlsb2FkLCAnTm90IGNvbm5lY3RlZCcpXG4gICAgfSBlbHNlIHtcbiAgICAgIHRoaXMuc29ja2V0LnNlbmQoSlNPTi5zdHJpbmdpZnkocGF5bG9hZCkpXG4gICAgfVxuICB9XG59XG5cbm1vZHVsZS5leHBvcnRzID0gV2ViU29ja2V0ID0+ICh1cmwsIGNiKSA9PiBuZXcgV2ViU29ja2V0Q29ubmVjdGlvbihXZWJTb2NrZXQsIHVybCwgY2IpXG4iLCJjb25zdCBFdmVudEVtaXR0ZXIgPSByZXF1aXJlKCdldmVudHMnKVxuXG5jbGFzcyBFdGhlcmV1bVByb3ZpZGVyIGV4dGVuZHMgRXZlbnRFbWl0dGVyIHtcbiAgY29uc3RydWN0b3IgKGNvbm5lY3Rpb24pIHtcbiAgICBzdXBlcigpXG5cbiAgICB0aGlzLmVuYWJsZSA9IHRoaXMuZW5hYmxlLmJpbmQodGhpcylcbiAgICB0aGlzLl9zZW5kID0gdGhpcy5fc2VuZC5iaW5kKHRoaXMpXG4gICAgdGhpcy5zZW5kID0gdGhpcy5zZW5kLmJpbmQodGhpcylcbiAgICB0aGlzLl9zZW5kQmF0Y2ggPSB0aGlzLl9zZW5kQmF0Y2guYmluZCh0aGlzKVxuICAgIHRoaXMuc3Vic2NyaWJlID0gdGhpcy5zdWJzY3JpYmUuYmluZCh0aGlzKVxuICAgIHRoaXMudW5zdWJzY3JpYmUgPSB0aGlzLnVuc3Vic2NyaWJlLmJpbmQodGhpcylcbiAgICB0aGlzLnNlbmRBc3luYyA9IHRoaXMuc2VuZEFzeW5jLmJpbmQodGhpcylcbiAgICB0aGlzLnNlbmRBc3luY0JhdGNoID0gdGhpcy5zZW5kQXN5bmNCYXRjaC5iaW5kKHRoaXMpXG4gICAgdGhpcy5pc0Nvbm5lY3RlZCA9IHRoaXMuaXNDb25uZWN0ZWQuYmluZCh0aGlzKVxuICAgIHRoaXMuY2xvc2UgPSB0aGlzLmNsb3NlLmJpbmQodGhpcylcbiAgICB0aGlzLnJlcXVlc3QgPSB0aGlzLnJlcXVlc3QuYmluZCh0aGlzKVxuICAgIHRoaXMuY29ubmVjdGVkID0gZmFsc2VcblxuICAgIHRoaXMubmV4dElkID0gMVxuXG4gICAgdGhpcy5wcm9taXNlcyA9IHt9XG4gICAgdGhpcy5zdWJzY3JpcHRpb25zID0gW11cbiAgICB0aGlzLmNvbm5lY3Rpb24gPSBjb25uZWN0aW9uXG4gICAgdGhpcy5jb25uZWN0aW9uLm9uKCdjb25uZWN0JywgKCkgPT4gdGhpcy5jaGVja0Nvbm5lY3Rpb24oKSlcbiAgICB0aGlzLmNvbm5lY3Rpb24ub24oJ2Nsb3NlJywgKCkgPT4ge1xuICAgICAgdGhpcy5jb25uZWN0ZWQgPSBmYWxzZVxuICAgICAgdGhpcy5lbWl0KCdjbG9zZScpXG4gICAgICB0aGlzLmVtaXQoJ2Rpc2Nvbm5lY3QnKVxuICAgIH0pXG4gICAgdGhpcy5jb25uZWN0aW9uLm9uKCdwYXlsb2FkJywgcGF5bG9hZCA9PiB7XG4gICAgICBjb25zdCB7IGlkLCBtZXRob2QsIGVycm9yLCByZXN1bHQgfSA9IHBheWxvYWRcbiAgICAgIGlmICh0eXBlb2YgaWQgIT09ICd1bmRlZmluZWQnKSB7XG4gICAgICAgIGlmICh0aGlzLnByb21pc2VzW2lkXSkgeyAvLyBGdWxmaWxsIHByb21pc2VcbiAgICAgICAgICBjb25zdCByZXF1ZXN0TWV0aG9kID0gdGhpcy5wcm9taXNlc1tpZF0ubWV0aG9kXG4gICAgICAgICAgaWYgKHJlcXVlc3RNZXRob2QgJiYgWydldGhfYWNjb3VudHMnLCAnZXRoX3JlcXVlc3RBY2NvdW50cyddLmluY2x1ZGVzKHJlcXVlc3RNZXRob2QpKSB7XG4gICAgICAgICAgICBjb25zdCBhY2NvdW50cyA9IHJlc3VsdCB8fCBbXVxuXG4gICAgICAgICAgICB0aGlzLmFjY291bnRzID0gYWNjb3VudHNcbiAgICAgICAgICAgIHRoaXMuc2VsZWN0ZWRBZGRyZXNzID0gYWNjb3VudHNbMF1cbiAgICAgICAgICAgIHRoaXMuY29pbmJhc2UgPSBhY2NvdW50c1swXVxuICAgICAgICAgIH1cblxuICAgICAgICAgIHBheWxvYWQuZXJyb3IgPyB0aGlzLnByb21pc2VzW2lkXS5yZWplY3QoZXJyb3IpIDogdGhpcy5wcm9taXNlc1tpZF0ucmVzb2x2ZShyZXN1bHQpXG4gICAgICAgICAgZGVsZXRlIHRoaXMucHJvbWlzZXNbaWRdXG4gICAgICAgIH1cbiAgICAgIH0gZWxzZSBpZiAobWV0aG9kICYmIG1ldGhvZC5pbmRleE9mKCdfc3Vic2NyaXB0aW9uJykgPiAtMSkgeyAvLyBFbWl0IHN1YnNjcmlwdGlvbiByZXN1bHRcbiAgICAgICAgLy8gRXZlbnRzOiBjb25uZWN0LCBkaXNjb25uZWN0LCBjaGFpbkNoYW5nZWQsIGFjY291bnRzQ2hhbmdlZCwgbWVzc2FnZVxuICAgICAgICB0aGlzLmVtaXQocGF5bG9hZC5wYXJhbXMuc3Vic2NyaXB0aW9uLCBwYXlsb2FkLnBhcmFtcy5yZXN1bHQpXG4gICAgICAgIHRoaXMuZW1pdChtZXRob2QsIHBheWxvYWQucGFyYW1zKSAvLyBPbGRlciBFSVAtMTE5M1xuICAgICAgICB0aGlzLmVtaXQoJ21lc3NhZ2UnLCB7IC8vIExhdGVzdCBFSVAtMTE5M1xuICAgICAgICAgIHR5cGU6IHBheWxvYWQubWV0aG9kLFxuICAgICAgICAgIGRhdGE6IHtcbiAgICAgICAgICAgIHN1YnNjcmlwdGlvbjogcGF5bG9hZC5wYXJhbXMuc3Vic2NyaXB0aW9uLFxuICAgICAgICAgICAgcmVzdWx0OiBwYXlsb2FkLnBhcmFtcy5yZXN1bHRcbiAgICAgICAgICB9XG4gICAgICAgIH0pXG4gICAgICAgIHRoaXMuZW1pdCgnZGF0YScsIHBheWxvYWQpIC8vIEJhY2t3YXJkcyBDb21wYXRpYmlsaXR5XG4gICAgICB9XG4gICAgfSlcbiAgICB0aGlzLm9uKCduZXdMaXN0ZW5lcicsIChldmVudCwgbGlzdGVuZXIpID0+IHtcbiAgICAgIGlmIChldmVudCA9PT0gJ2NoYWluQ2hhbmdlZCcgJiYgIXRoaXMuYXR0ZW1wdGVkQ2hhaW5TdWJzY3JpcHRpb24gJiYgdGhpcy5jb25uZWN0ZWQpIHtcbiAgICAgICAgdGhpcy5zdGFydENoYWluU3Vic2NyaXB0aW9uKClcbiAgICAgIH0gZWxzZSBpZiAoZXZlbnQgPT09ICdhY2NvdW50c0NoYW5nZWQnICYmICF0aGlzLmF0dGVtcHRlZEFjY291bnRzU3Vic2NyaXB0aW9uICYmIHRoaXMuY29ubmVjdGVkKSB7XG4gICAgICAgIHRoaXMuc3RhcnRBY2NvdW50c1N1YnNjcmlwdGlvbigpXG4gICAgICB9IGVsc2UgaWYgKGV2ZW50ID09PSAnbmV0d29ya0NoYW5nZWQnICYmICF0aGlzLmF0dGVtcHRlZE5ldHdvcmtTdWJzY3JpcHRpb24gJiYgdGhpcy5jb25uZWN0ZWQpIHtcbiAgICAgICAgdGhpcy5zdGFydE5ldHdvcmtTdWJzY3JpcHRpb24oKVxuICAgICAgICBjb25zb2xlLndhcm4oJ1RoZSBuZXR3b3JrQ2hhbmdlZCBldmVudCBpcyBiZWluZyBkZXByZWNhdGVkLCB1c2UgY2hhaW5DaGFpbmdlZCBpbnN0ZWFkJylcbiAgICAgIH1cbiAgICB9KVxuICB9XG5cbiAgYXN5bmMgY2hlY2tDb25uZWN0aW9uIChyZXRyeSkge1xuICAgIGlmICh0aGlzLmNoZWNrQ29ubmVjdGlvblJ1bm5pbmcgfHwgdGhpcy5jb25uZWN0ZWQpIHJldHVyblxuICAgIHRoaXMuY2hlY2tDb25uZWN0aW9uUnVubmluZyA9IHRydWVcbiAgICB0cnkge1xuICAgICAgdGhpcy5uZXR3b3JrVmVyc2lvbiA9IGF3YWl0IHRoaXMuX3NlbmQoJ25ldF92ZXJzaW9uJywgW10sIGZhbHNlKVxuICAgICAgdGhpcy5jaGFpbklkID0gYXdhaXQgdGhpcy5fc2VuZCgnZXRoX2NoYWluSWQnLCBbXSwgZmFsc2UpXG5cbiAgICAgIHRoaXMuY2hlY2tDb25uZWN0aW9uUnVubmluZyA9IGZhbHNlXG4gICAgICB0aGlzLmNvbm5lY3RlZCA9IHRydWVcbiAgICAgIHRoaXMuZW1pdCgnY29ubmVjdCcsIHsgY2hhaW5JZDogdGhpcy5jaGFpbklkIH0pXG5cbiAgICAgIGNsZWFyVGltZW91dCh0aGlzLmNoZWNrQ29ubmVjdGlvblRpbWVyKVxuXG4gICAgICBpZiAodGhpcy5saXN0ZW5lckNvdW50KCduZXR3b3JrQ2hhbmdlZCcpICYmICF0aGlzLmF0dGVtcHRlZE5ldHdvcmtTdWJzY3JpcHRpb24pIHRoaXMuc3RhcnROZXR3b3JrU3Vic2NyaXB0aW9uKClcbiAgICAgIGlmICh0aGlzLmxpc3RlbmVyQ291bnQoJ2NoYWluQ2hhbmdlZCcpICYmICF0aGlzLmF0dGVtcHRlZENoYWluU3Vic2NyaXB0aW9uKSB0aGlzLnN0YXJ0TmV0d29ya1N1YnNjcmlwdGlvbigpXG4gICAgICBpZiAodGhpcy5saXN0ZW5lckNvdW50KCdhY2NvdW50c0NoYW5nZWQnKSAmJiAhdGhpcy5hdHRlbXB0ZWRBY2NvdW50c1N1YnNjcmlwdGlvbikgdGhpcy5zdGFydEFjY291bnRzU3Vic2NyaXB0aW9uKClcbiAgICB9IGNhdGNoIChlKSB7XG4gICAgICBpZiAoIXJldHJ5KSBzZXRUaW1lb3V0KCgpID0+IHRoaXMuY2hlY2tDb25uZWN0aW9uKHRydWUpLCAxMDAwKVxuICAgICAgdGhpcy5jaGVja0Nvbm5lY3Rpb25UaW1lciA9IHNldEludGVydmFsKCgpID0+IHRoaXMuY2hlY2tDb25uZWN0aW9uKHRydWUpLCA0MDAwKVxuICAgICAgdGhpcy5jaGVja0Nvbm5lY3Rpb25SdW5uaW5nID0gZmFsc2VcbiAgICAgIHRoaXMuY29ubmVjdGVkID0gZmFsc2VcbiAgICB9XG4gIH1cblxuICBhc3luYyBzdGFydE5ldHdvcmtTdWJzY3JpcHRpb24gKCkge1xuICAgIHRoaXMuYXR0ZW1wdGVkTmV0d29ya1N1YnNjcmlwdGlvbiA9IHRydWVcbiAgICB0cnkge1xuICAgICAgY29uc3QgbmV0d29ya0NoYW5nZWQgPSBhd2FpdCB0aGlzLnN1YnNjcmliZSgnZXRoX3N1YnNjcmliZScsICduZXR3b3JrQ2hhbmdlZCcpXG4gICAgICB0aGlzLm9uKG5ldHdvcmtDaGFuZ2VkLCBuZXRJZCA9PiB7XG4gICAgICAgIHRoaXMubmV0d29ya1ZlcnNpb24gPSBuZXRJZFxuICAgICAgICB0aGlzLmVtaXQoJ25ldHdvcmtDaGFuZ2VkJywgbmV0SWQpXG4gICAgICB9KVxuICAgIH0gY2F0Y2ggKGUpIHtcbiAgICAgIGNvbnNvbGUud2FybignVW5hYmxlIHRvIHN1YnNjcmliZSB0byBuZXR3b3JrQ2hhbmdlZCcsIGUpXG4gICAgfVxuICB9XG5cbiAgYXN5bmMgc3RhcnRDaGFpblN1YnNjcmlwdGlvbiAoKSB7XG4gICAgdGhpcy5hdHRlbXB0ZWRDaGFpblN1YnNjcmlwdGlvbiA9IHRydWVcbiAgICB0cnkge1xuICAgICAgY29uc3QgY2hhaW5DaGFuZ2VkID0gYXdhaXQgdGhpcy5zdWJzY3JpYmUoJ2V0aF9zdWJzY3JpYmUnLCAnY2hhaW5DaGFuZ2VkJylcbiAgICAgIHRoaXMub24oY2hhaW5DaGFuZ2VkLCBuZXRJZCA9PiB7XG4gICAgICAgIHRoaXMuY2hhaW5JZCA9IG5ldElkXG4gICAgICAgIHRoaXMuZW1pdCgnY2hhaW5DaGFuZ2VkJywgbmV0SWQpXG4gICAgICB9KVxuICAgIH0gY2F0Y2ggKGUpIHtcbiAgICAgIGNvbnNvbGUud2FybignVW5hYmxlIHRvIHN1YnNjcmliZSB0byBjaGFpbkNoYW5nZWQnLCBlKVxuICAgIH1cbiAgfVxuXG4gIGFzeW5jIHN0YXJ0QWNjb3VudHNTdWJzY3JpcHRpb24gKCkge1xuICAgIHRoaXMuYXR0ZW1wdGVkQWNjb3VudHNTdWJzY3JpcHRpb24gPSB0cnVlXG4gICAgdHJ5IHtcbiAgICAgIGNvbnN0IGFjY291bnRzQ2hhbmdlZCA9IGF3YWl0IHRoaXMuc3Vic2NyaWJlKCdldGhfc3Vic2NyaWJlJywgJ2FjY291bnRzQ2hhbmdlZCcpXG4gICAgICB0aGlzLm9uKGFjY291bnRzQ2hhbmdlZCwgYWNjb3VudHMgPT4ge1xuICAgICAgICB0aGlzLnNlbGVjdGVkQWRkcmVzcyA9IGFjY291bnRzWzBdXG4gICAgICAgIHRoaXMuZW1pdCgnYWNjb3VudHNDaGFuZ2VkJywgYWNjb3VudHMpXG4gICAgICB9KVxuICAgIH0gY2F0Y2ggKGUpIHtcbiAgICAgIGNvbnNvbGUud2FybignVW5hYmxlIHRvIHN1YnNjcmliZSB0byBhY2NvdW50c0NoYW5nZWQnLCBlKVxuICAgIH1cbiAgfVxuXG4gIGVuYWJsZSAoKSB7XG4gICAgcmV0dXJuIG5ldyBQcm9taXNlKChyZXNvbHZlLCByZWplY3QpID0+IHtcbiAgICAgIHRoaXMuX3NlbmQoJ2V0aF9hY2NvdW50cycpLnRoZW4oYWNjb3VudHMgPT4ge1xuICAgICAgICBpZiAoYWNjb3VudHMubGVuZ3RoID4gMCkge1xuICAgICAgICAgIHRoaXMuYWNjb3VudHMgPSBhY2NvdW50c1xuICAgICAgICAgIHRoaXMuc2VsZWN0ZWRBZGRyZXNzID0gYWNjb3VudHNbMF1cbiAgICAgICAgICB0aGlzLmNvaW5iYXNlID0gYWNjb3VudHNbMF1cblxuICAgICAgICAgIHRoaXMuZW1pdCgnZW5hYmxlJylcblxuICAgICAgICAgIHJlc29sdmUoYWNjb3VudHMpXG4gICAgICAgIH0gZWxzZSB7XG4gICAgICAgICAgY29uc3QgZXJyID0gbmV3IEVycm9yKCdVc2VyIERlbmllZCBGdWxsIFByb3ZpZGVyJylcbiAgICAgICAgICBlcnIuY29kZSA9IDQwMDFcbiAgICAgICAgICByZWplY3QoZXJyKVxuICAgICAgICB9XG4gICAgICB9KS5jYXRjaChyZWplY3QpXG4gICAgfSlcbiAgfVxuXG4gIF9zZW5kIChtZXRob2QsIHBhcmFtcyA9IFtdLCB3YWl0Rm9yQ29ubmVjdGlvbiA9IHRydWUpIHtcbiAgICBjb25zdCBzZW5kRm4gPSAocmVzb2x2ZSwgcmVqZWN0KSA9PiB7XG4gICAgICBsZXQgcGF5bG9hZFxuICAgICAgaWYgKHR5cGVvZiBtZXRob2QgPT09ICdvYmplY3QnICYmIG1ldGhvZCAhPT0gbnVsbCkge1xuICAgICAgICBwYXlsb2FkID0gbWV0aG9kXG4gICAgICAgIHBheWxvYWQucGFyYW1zID0gcGF5bG9hZC5wYXJhbXMgfHwgW11cbiAgICAgICAgcGF5bG9hZC5qc29ucnBjID0gJzIuMCdcbiAgICAgICAgcGF5bG9hZC5pZCA9IHRoaXMubmV4dElkKytcbiAgICAgIH0gZWxzZSB7XG4gICAgICAgIHBheWxvYWQgPSB7IGpzb25ycGM6ICcyLjAnLCBpZDogdGhpcy5uZXh0SWQrKywgbWV0aG9kLCBwYXJhbXMgfVxuICAgICAgfVxuICAgICAgdGhpcy5wcm9taXNlc1twYXlsb2FkLmlkXSA9IHsgcmVzb2x2ZSwgcmVqZWN0LCBtZXRob2QgfVxuICAgICAgaWYgKCFwYXlsb2FkLm1ldGhvZCB8fCB0eXBlb2YgcGF5bG9hZC5tZXRob2QgIT09ICdzdHJpbmcnKSB7XG4gICAgICAgIHRoaXMucHJvbWlzZXNbcGF5bG9hZC5pZF0ucmVqZWN0KG5ldyBFcnJvcignTWV0aG9kIGlzIG5vdCBhIHZhbGlkIHN0cmluZy4nKSlcbiAgICAgICAgZGVsZXRlIHRoaXMucHJvbWlzZXNbcGF5bG9hZC5pZF1cbiAgICAgIH0gZWxzZSBpZiAoIShwYXlsb2FkLnBhcmFtcyBpbnN0YW5jZW9mIEFycmF5KSkge1xuICAgICAgICB0aGlzLnByb21pc2VzW3BheWxvYWQuaWRdLnJlamVjdChuZXcgRXJyb3IoJ1BhcmFtcyBpcyBub3QgYSB2YWxpZCBhcnJheS4nKSlcbiAgICAgICAgZGVsZXRlIHRoaXMucHJvbWlzZXNbcGF5bG9hZC5pZF1cbiAgICAgIH0gZWxzZSB7XG4gICAgICAgIHRoaXMuY29ubmVjdGlvbi5zZW5kKHBheWxvYWQpXG4gICAgICB9XG4gICAgfVxuXG4gICAgaWYgKHRoaXMuY29ubmVjdGVkIHx8ICF3YWl0Rm9yQ29ubmVjdGlvbikge1xuICAgICAgcmV0dXJuIG5ldyBQcm9taXNlKHNlbmRGbilcbiAgICB9XG5cbiAgICByZXR1cm4gbmV3IFByb21pc2UoKHJlc29sdmUsIHJlamVjdCkgPT4ge1xuICAgICAgY29uc3QgcmVzb2x2ZVNlbmQgPSAoKSA9PiB7XG4gICAgICAgIGNsZWFyVGltZW91dChkaXNjb25uZWN0VGltZXIpXG4gICAgICAgIHJldHVybiByZXNvbHZlKG5ldyBQcm9taXNlKHNlbmRGbikpXG4gICAgICB9XG5cbiAgICAgIGNvbnN0IGRpc2Nvbm5lY3RUaW1lciA9IHNldFRpbWVvdXQoKCkgPT4ge1xuICAgICAgICB0aGlzLm9mZignY29ubmVjdCcsIHJlc29sdmVTZW5kKVxuICAgICAgICByZWplY3QobmV3IEVycm9yKCdOb3QgY29ubmVjdGVkJykpXG4gICAgICB9LCA1MDAwKVxuXG4gICAgICB0aGlzLm9uY2UoJ2Nvbm5lY3QnLCByZXNvbHZlU2VuZClcbiAgICB9KVxuICB9XG5cbiAgc2VuZCAobWV0aG9kT3JQYXlsb2FkLCBjYWxsYmFja09yQXJncykgeyAvLyBTZW5kIGNhbiBiZSBjbG9iYmVyZWQsIHByb3h5IHNlbmRQcm9taXNlIGZvciBiYWNrd2FyZHMgY29tcGF0aWJpbGl0eVxuICAgIGlmIChcbiAgICAgIHR5cGVvZiBtZXRob2RPclBheWxvYWQgPT09ICdzdHJpbmcnICYmXG4gICAgICAoIWNhbGxiYWNrT3JBcmdzIHx8IEFycmF5LmlzQXJyYXkoY2FsbGJhY2tPckFyZ3MpKVxuICAgICkge1xuICAgICAgcmV0dXJuIHRoaXMuX3NlbmQobWV0aG9kT3JQYXlsb2FkLCBjYWxsYmFja09yQXJncylcbiAgICAgIH1cblxuICAgIGlmIChcbiAgICAgIG1ldGhvZE9yUGF5bG9hZCAmJlxuICAgICAgdHlwZW9mIG1ldGhvZE9yUGF5bG9hZCA9PT0gJ29iamVjdCcgJiZcbiAgICAgIHR5cGVvZiBjYWxsYmFja09yQXJncyA9PT0gJ2Z1bmN0aW9uJ1xuICAgICkge1xuICAgICAgLy8gYSBjYWxsYmFjayB3YXMgcGFzc2VkIHRvIHNlbmQoKSwgZm9yd2FyZCBldmVyeXRoaW5nIHRvIHNlbmRBc3luYygpXG4gICAgICByZXR1cm4gdGhpcy5zZW5kQXN5bmMobWV0aG9kT3JQYXlsb2FkLCBjYWxsYmFja09yQXJncylcbiAgICB9XG5cbiAgICByZXR1cm4gdGhpcy5yZXF1ZXN0KG1ldGhvZE9yUGF5bG9hZClcbiAgfVxuXG4gIF9zZW5kQmF0Y2ggKHJlcXVlc3RzKSB7XG4gICAgcmV0dXJuIFByb21pc2UuYWxsKHJlcXVlc3RzLm1hcChwYXlsb2FkID0+IHRoaXMuX3NlbmQocGF5bG9hZC5tZXRob2QsIHBheWxvYWQucGFyYW1zKSkpXG4gIH1cblxuICBzdWJzY3JpYmUgKHR5cGUsIG1ldGhvZCwgcGFyYW1zID0gW10pIHtcbiAgICByZXR1cm4gdGhpcy5fc2VuZCh0eXBlLCBbbWV0aG9kLCAuLi5wYXJhbXNdKS50aGVuKGlkID0+IHtcbiAgICAgIHRoaXMuc3Vic2NyaXB0aW9ucy5wdXNoKGlkKVxuICAgICAgcmV0dXJuIGlkXG4gICAgfSlcbiAgfVxuXG4gIHVuc3Vic2NyaWJlICh0eXBlLCBpZCkge1xuICAgIHJldHVybiB0aGlzLl9zZW5kKHR5cGUsIFtpZF0pLnRoZW4oc3VjY2VzcyA9PiB7XG4gICAgICBpZiAoc3VjY2Vzcykge1xuICAgICAgICB0aGlzLnN1YnNjcmlwdGlvbnMgPSB0aGlzLnN1YnNjcmlwdGlvbnMuZmlsdGVyKF9pZCA9PiBfaWQgIT09IGlkKSAvLyBSZW1vdmUgc3Vic2NyaXB0aW9uXG4gICAgICAgIHRoaXMucmVtb3ZlQWxsTGlzdGVuZXJzKGlkKSAvLyBSZW1vdmUgbGlzdGVuZXJzXG4gICAgICAgIHJldHVybiBzdWNjZXNzXG4gICAgICB9XG4gICAgfSlcbiAgfVxuXG4gIHNlbmRBc3luYyAocGF5bG9hZCwgY2IpIHsgLy8gQmFja3dhcmRzIENvbXBhdGliaWxpdHlcbiAgICBpZiAoIWNiIHx8IHR5cGVvZiBjYiAhPT0gJ2Z1bmN0aW9uJykgcmV0dXJuIGNiKG5ldyBFcnJvcignSW52YWxpZCBvciB1bmRlZmluZWQgY2FsbGJhY2sgcHJvdmlkZWQgdG8gc2VuZEFzeW5jJykpXG4gICAgaWYgKCFwYXlsb2FkKSByZXR1cm4gY2IobmV3IEVycm9yKCdJbnZhbGlkIFBheWxvYWQnKSlcbiAgICAvLyBzZW5kQXN5bmMgY2FuIGJlIGNhbGxlZCB3aXRoIGFuIGFycmF5IGZvciBiYXRjaCByZXF1ZXN0cyB1c2VkIGJ5IHdlYjMuanMgMC54XG4gICAgLy8gdGhpcyBpcyBub3QgcGFydCBvZiBFSVAtMTE5MydzIGJhY2t3YXJkcyBjb21wYXRpYmlsaXR5IGJ1dCB3ZSBzdGlsbCB3YW50IHRvIHN1cHBvcnQgaXRcbiAgICBwYXlsb2FkLmpzb25ycGMgPSAnMi4wJ1xuICAgIHBheWxvYWQuaWQgPSBwYXlsb2FkLmlkIHx8IHRoaXMubmV4dElkKytcbiAgICBpZiAocGF5bG9hZCBpbnN0YW5jZW9mIEFycmF5KSB7XG4gICAgICByZXR1cm4gdGhpcy5zZW5kQXN5bmNCYXRjaChwYXlsb2FkLCBjYilcbiAgICB9IGVsc2Uge1xuICAgICAgcmV0dXJuIHRoaXMuX3NlbmQocGF5bG9hZC5tZXRob2QsIHBheWxvYWQucGFyYW1zKS50aGVuKHJlc3VsdCA9PiB7XG4gICAgICAgIGNiKG51bGwsIHsgaWQ6IHBheWxvYWQuaWQsIGpzb25ycGM6IHBheWxvYWQuanNvbnJwYywgcmVzdWx0IH0pXG4gICAgICB9KS5jYXRjaChlcnIgPT4ge1xuICAgICAgICBjYihlcnIpXG4gICAgICB9KVxuICAgIH1cbiAgfVxuXG4gIHNlbmRBc3luY0JhdGNoIChwYXlsb2FkLCBjYikge1xuICAgIHJldHVybiB0aGlzLl9zZW5kQmF0Y2gocGF5bG9hZCkudGhlbigocmVzdWx0cykgPT4ge1xuICAgICAgY29uc3QgcmVzdWx0ID0gcmVzdWx0cy5tYXAoKGVudHJ5LCBpbmRleCkgPT4ge1xuICAgICAgICByZXR1cm4geyBpZDogcGF5bG9hZFtpbmRleF0uaWQsIGpzb25ycGM6IHBheWxvYWRbaW5kZXhdLmpzb25ycGMsIHJlc3VsdDogZW50cnkgfVxuICAgICAgfSlcbiAgICAgIGNiKG51bGwsIHJlc3VsdClcbiAgICB9KS5jYXRjaChlcnIgPT4ge1xuICAgICAgY2IoZXJyKVxuICAgIH0pXG4gIH1cblxuICAvLyBfc2VuZFN5bmMgKHBheWxvYWQpIHtcbiAgLy8gICBsZXQgcmVzdWx0XG5cbiAgLy8gICBzd2l0Y2ggKHBheWxvYWQubWV0aG9kKSB7XG4gIC8vICAgICBjYXNlICdldGhfYWNjb3VudHMnOlxuICAvLyAgICAgICByZXN1bHQgPSB0aGlzLnNlbGVjdGVkQWRkcmVzcyA/IFt0aGlzLnNlbGVjdGVkQWRkcmVzc10gOiBbXVxuICAvLyAgICAgICBicmVha1xuXG4gIC8vICAgICBjYXNlICdldGhfY29pbmJhc2UnOlxuICAvLyAgICAgICByZXN1bHQgPSB0aGlzLnNlbGVjdGVkQWRkcmVzcyB8fCBudWxsXG4gIC8vICAgICAgIGJyZWFrXG5cbiAgLy8gICAgIGNhc2UgJ2V0aF91bmluc3RhbGxGaWx0ZXInOlxuICAvLyAgICAgICB0aGlzLl9zZW5kKHBheWxvYWQpXG4gIC8vICAgICAgIHJlc3VsdCA9IHRydWVcblxuICAvLyAgICAgY2FzZSAnbmV0X3ZlcnNpb24nOlxuICAvLyAgICAgICByZXN1bHQgPSB0aGlzLm5ldHdvcmtWZXJzaW9uIHx8IG51bGxcbiAgLy8gICAgICAgYnJlYWtcblxuICAvLyAgICAgZGVmYXVsdDpcbiAgLy8gICAgICAgdGhyb3cgbmV3IEVycm9yKGB1bnN1cHBvcnRlZCBtZXRob2QgJHtwYXlsb2FkLm1ldGhvZH1gKVxuICAvLyAgIH1cblxuICAvLyAgIHJldHVybiB7XG4gIC8vICAgICBpZDogcGF5bG9hZC5pZCxcbiAgLy8gICAgIGpzb25ycGM6IHBheWxvYWQuanNvbnJwYyxcbiAgLy8gICAgIHJlc3VsdFxuICAvLyAgIH1cbiAgLy8gfVxuXG4gIGlzQ29ubmVjdGVkICgpIHsgLy8gQmFja3dhcmRzIENvbXBhdGliaWxpdHlcbiAgICByZXR1cm4gdGhpcy5jb25uZWN0ZWRcbiAgfVxuXG4gIGNsb3NlICgpIHtcbiAgICBpZiAodGhpcy5jb25uZWN0aW9uICYmIHRoaXMuY29ubmVjdGlvbi5jbG9zZSkgdGhpcy5jb25uZWN0aW9uLmNsb3NlKClcbiAgICB0aGlzLmNvbm5lY3RlZCA9IGZhbHNlXG4gICAgY29uc3QgZXJyb3IgPSBuZXcgRXJyb3IoJ1Byb3ZpZGVyIGNsb3NlZCwgc3Vic2NyaXB0aW9uIGxvc3QsIHBsZWFzZSBzdWJzY3JpYmUgYWdhaW4uJylcbiAgICB0aGlzLnN1YnNjcmlwdGlvbnMuZm9yRWFjaChpZCA9PiB0aGlzLmVtaXQoaWQsIGVycm9yKSkgLy8gU2VuZCBFcnJvciBvYmplY3RzIHRvIGFueSBvcGVuIHN1YnNjcmlwdGlvbnNcbiAgICB0aGlzLnN1YnNjcmlwdGlvbnMgPSBbXSAvLyBDbGVhciBzdWJzY3JpcHRpb25zXG5cbiAgICB0aGlzLmNoYWluSWQgPSB1bmRlZmluZWRcbiAgICB0aGlzLm5ldHdvcmtWZXJzaW9uID0gdW5kZWZpbmVkXG4gICAgdGhpcy5zZWxlY3RlZEFkZHJlc3MgPSB1bmRlZmluZWRcbiAgfVxuXG4gIHJlcXVlc3QgKHBheWxvYWQpIHtcbiAgICByZXR1cm4gdGhpcy5fc2VuZChwYXlsb2FkLm1ldGhvZCwgcGF5bG9hZC5wYXJhbXMpXG4gIH1cbn1cblxubW9kdWxlLmV4cG9ydHMgPSBFdGhlcmV1bVByb3ZpZGVyXG4iLCJsZXQgbGFzdCwgdGltZW91dFxuXG5tb2R1bGUuZXhwb3J0cyA9IChyZXMsIGNiKSA9PiB7XG4gIGNvbnN0IHZhbHVlcyA9IFtdXG4gIHJlc1xuICAgIC5yZXBsYWNlKC9cXH1bXFxuXFxyXT9cXHsvZywgJ318LS18eycpIC8vIH17XG4gICAgLnJlcGxhY2UoL1xcfVxcXVtcXG5cXHJdP1xcW1xcey9nLCAnfV18LS18W3snKSAvLyB9XVt7XG4gICAgLnJlcGxhY2UoL1xcfVtcXG5cXHJdP1xcW1xcey9nLCAnfXwtLXxbeycpIC8vIH1be1xuICAgIC5yZXBsYWNlKC9cXH1cXF1bXFxuXFxyXT9cXHsvZywgJ31dfC0tfHsnKSAvLyB9XXtcbiAgICAuc3BsaXQoJ3wtLXwnKVxuICAgIC5mb3JFYWNoKGRhdGEgPT4ge1xuICAgICAgaWYgKGxhc3QpIGRhdGEgPSBsYXN0ICsgZGF0YSAvLyBwcmVwZW5kIHRoZSBsYXN0IGNodW5rXG4gICAgICBsZXQgcmVzdWx0XG4gICAgICB0cnkge1xuICAgICAgICByZXN1bHQgPSBKU09OLnBhcnNlKGRhdGEpXG4gICAgICB9IGNhdGNoIChlKSB7XG4gICAgICAgIGxhc3QgPSBkYXRhXG4gICAgICAgIGNsZWFyVGltZW91dCh0aW1lb3V0KSAvLyByZXN0YXJ0IHRpbWVvdXRcbiAgICAgICAgdGltZW91dCA9IHNldFRpbWVvdXQoKCkgPT4gY2IobmV3IEVycm9yKCdQYXJzZSByZXNwb25zZSB0aW1lb3V0JykpLCAxNSAqIDEwMDApXG4gICAgICAgIHJldHVyblxuICAgICAgfVxuICAgICAgY2xlYXJUaW1lb3V0KHRpbWVvdXQpXG4gICAgICBsYXN0ID0gbnVsbFxuICAgICAgaWYgKHJlc3VsdCkgdmFsdWVzLnB1c2gocmVzdWx0KVxuICAgIH0pXG4gIGNiKG51bGwsIHZhbHVlcylcbn1cbiIsIm1vZHVsZS5leHBvcnRzID0gKG9wdGlvbnMgPSB7fSkgPT4ge1xuICByZXR1cm4ge1xuICAgIGluamVjdGVkOiBbJ2luamVjdGVkJ10sXG4gICAgZnJhbWU6IFsnd3M6Ly8xMjcuMC4wLjE6MTI0OCcsICdodHRwOi8vMTI3LjAuMC4xOjEyNDgnXSxcbiAgICBkaXJlY3Q6IFsnd3M6Ly8xMjcuMC4wLjE6ODU0NicsICdodHRwOi8vMTI3LjAuMC4xOjg1NDUnXSwgLy8gSVBDIHBhdGhzIHdpbGwgYmUgcHJlcGVuZGVkIGluIE5vZGUvRWxlY3Ryb25cbiAgICBpbmZ1cmE6IFtgd3NzOi8vbWFpbm5ldC5pbmZ1cmEuaW8vd3MvdjMvJHtvcHRpb25zLmluZnVyYUlkfWAsIGBodHRwczovL21haW5uZXQuaW5mdXJhLmlvL3YzLyR7b3B0aW9ucy5pbmZ1cmFJZH1gXSxcbiAgICBhbGNoZW15OiBbYHdzczovL2V0aC1tYWlubmV0LndzLmFsY2hlbXlhcGkuaW8vdjIvJHtvcHRpb25zLmFsY2hlbXlJZH1gLCBgaHR0cHM6Ly9ldGgtbWFpbm5ldC5hbGNoZW15YXBpLmlvL3YyLyR7b3B0aW9ucy5hbGNoZW15SWR9YF0sXG4gICAgaW5mdXJhUm9wc3RlbjogW2B3c3M6Ly9yb3BzdGVuLmluZnVyYS5pby93cy92My8ke29wdGlvbnMuaW5mdXJhSWR9YCwgYGh0dHBzOi8vcm9wc3Rlbi5pbmZ1cmEuaW8vdjMvJHtvcHRpb25zLmluZnVyYUlkfWBdLFxuICAgIGFsY2hlbXlSb3BzdGVuOiBbYHdzczovL2V0aC1yb3BzdGVuLndzLmFsY2hlbXlhcGkuaW8vdjIvJHtvcHRpb25zLmFsY2hlbXlJZH1gLCBgaHR0cHM6Ly9ldGgtcm9wc3Rlbi5hbGNoZW15YXBpLmlvL3YyLyR7b3B0aW9ucy5hbGNoZW15SWR9YF0sXG4gICAgaW5mdXJhUmlua2VieTogW2B3c3M6Ly9yaW5rZWJ5LmluZnVyYS5pby93cy92My8ke29wdGlvbnMuaW5mdXJhSWR9YCwgYGh0dHBzOi8vcmlua2VieS5pbmZ1cmEuaW8vdjMvJHtvcHRpb25zLmluZnVyYUlkfWBdLFxuICAgIGFsY2hlbXlSaW5rZWJ5OiBbYHdzczovL2V0aC1yaW5rZWJ5LndzLmFsY2hlbXlhcGkuaW8vdjIvJHtvcHRpb25zLmFsY2hlbXlJZH1gLCBgaHR0cHM6Ly9ldGgtcmlua2VieS5hbGNoZW15YXBpLmlvL3YyLyR7b3B0aW9ucy5hbGNoZW15SWR9YF0sXG4gICAgaW5mdXJhS292YW46IFtgd3NzOi8va292YW4uaW5mdXJhLmlvL3dzL3YzLyR7b3B0aW9ucy5pbmZ1cmFJZH1gLCBgaHR0cHM6Ly9rb3Zhbi5pbmZ1cmEuaW8vdjMvJHtvcHRpb25zLmluZnVyYUlkfWBdLFxuICAgIGFsY2hlbXlLb3ZhbjogW2B3c3M6Ly9ldGgta292YW4ud3MuYWxjaGVteWFwaS5pby92Mi8ke29wdGlvbnMuYWxjaGVteUlkfWAsIGBodHRwczovL2V0aC1rb3Zhbi5hbGNoZW15YXBpLmlvL3YyLyR7b3B0aW9ucy5hbGNoZW15SWR9YF0sXG4gICAgaW5mdXJhR29lcmxpOiBbYHdzczovL2dvZXJsaS5pbmZ1cmEuaW8vd3MvdjMvJHtvcHRpb25zLmluZnVyYUlkfWAsIGBodHRwczovL2dvZXJsaS5pbmZ1cmEuaW8vd3MvdjMvJHtvcHRpb25zLmluZnVyYUlkfWBdLFxuICAgIGFsY2hlbXlHb2VybGk6IFtgd3NzOi8vZXRoLWdvZXJsaS53cy5hbGNoZW15YXBpLmlvL3YyLyR7b3B0aW9ucy5hbGNoZW15SWR9YCwgYGh0dHBzOi8vZXRoLWdvZXJsaS5hbGNoZW15YXBpLmlvL3YyLyR7b3B0aW9ucy5hbGNoZW15SWR9YF0sXG4gICAgaW5mdXJhUG9seWdvbjogW2B3c3M6Ly9wb2x5Z29uLW1haW5uZXQuaW5mdXJhLmlvL3dzL3YzLyR7b3B0aW9ucy5pbmZ1cmFJZH1gLCBgaHR0cHM6Ly9wb2x5Z29uLW1haW5uZXQuaW5mdXJhLmlvL3YzLyR7b3B0aW9ucy5pbmZ1cmFJZH1gXSxcbiAgICBpbmZ1cmFBcmJpdHJ1bTogW2B3c3M6Ly9hcmJpdHJ1bS1tYWlubmV0LmluZnVyYS5pby93cy92My8ke29wdGlvbnMuaW5mdXJhSWR9YCwgYGh0dHBzOi8vYXJiaXRydW0tbWFpbm5ldC5pbmZ1cmEuaW8vdjMvJHtvcHRpb25zLmluZnVyYUlkfWBdLFxuICAgIGluZnVyYU9wdGltaXNtOiBbYHdzczovL29wdGltaXNtLW1haW5uZXQuaW5mdXJhLmlvL3dzL3YzLyR7b3B0aW9ucy5pbmZ1cmFJZH1gLCBgaHR0cHM6Ly9vcHRpbWlzbS1tYWlubmV0LmluZnVyYS5pby92My8ke29wdGlvbnMuaW5mdXJhSWR9YF0sXG4gICAgaWRDaGFpbjogWyd3c3M6Ly9pZGNoYWluLm9uZS93cy8nXSxcbiAgICB4RGFpOiBbJ2h0dHBzOi8vcnBjLnhkYWljaGFpbi5jb20nLCAnaHR0cHM6Ly9kYWkucG9hLm5ldHdvcmsnXSxcbiAgICBvcHRpbWlzbTogWydodHRwczovL21haW5uZXQub3B0aW1pc20uaW8nXVxuICB9XG59XG4iLCJjb25zdCBFdmVudEVtaXR0ZXIgPSByZXF1aXJlKCdldmVudHMnKVxuY29uc3QgRXRoZXJldW1Qcm92aWRlciA9IHJlcXVpcmUoJ2V0aGVyZXVtLXByb3ZpZGVyJylcbmNvbnN0IENvbm5lY3Rpb25NYW5hZ2VyID0gcmVxdWlyZSgnLi4vQ29ubmVjdGlvbk1hbmFnZXInKVxuXG5jb25zdCBtb25pdG9yID0gcHJvdmlkZXIgPT4ge1xuICBmdW5jdGlvbiB1cGRhdGUgKHN0YXR1cykge1xuICAgIHByb3ZpZGVyLnN0YXR1cyA9IHN0YXR1c1xuICAgIGlmIChwcm92aWRlciBpbnN0YW5jZW9mIEV2ZW50RW1pdHRlcikgcHJvdmlkZXIuZW1pdCgnc3RhdHVzJywgc3RhdHVzKVxuICB9XG5cbiAgYXN5bmMgZnVuY3Rpb24gY2hlY2tTeW5jaW5nICgpIHtcbiAgICB0cnkge1xuICAgICAgaWYgKGF3YWl0IHByb3ZpZGVyLnNlbmQoJ2V0aF9zeW5jaW5nJykpIHtcbiAgICAgICAgdXBkYXRlKCdzeW5jaW5nJylcbiAgICAgIH1cbiAgICB9IGNhdGNoIChlKSB7XG4gICAgICAvLyBkb24ndCBkbyBhbnl0aGluZyBpZiBpdCBjYW4ndCBiZSBkZXRlcm1pbmVkIHdoZXRoZXIgdGhlIG5vZGUgaXMgc3luY2luZyBvciBub3RcbiAgICB9XG4gIH1cblxuICBhc3luYyBmdW5jdGlvbiBjaGVja0Nvbm5lY3RlZCAoKSB7XG4gICAgaWYgKHByb3ZpZGVyLmluU2V0dXApIHJldHVybiBzZXRUaW1lb3V0KGNoZWNrQ29ubmVjdGVkLCAxMDAwKVxuXG4gICAgdHJ5IHtcbiAgICAgIGF3YWl0IHByb3ZpZGVyLnNlbmQoJ2V0aF9jaGFpbklkJylcbiAgICAgIHVwZGF0ZSgnY29ubmVjdGVkJylcblxuICAgICAgc2V0VGltZW91dChjaGVja1N5bmNpbmcsIDUwMClcbiAgICB9IGNhdGNoIChlKSB7XG4gICAgICB1cGRhdGUoJ2Rpc2Nvbm5lY3RlZCcpXG4gICAgfVxuICB9XG5cbiAgdXBkYXRlKCdsb2FkaW5nJylcbiAgY2hlY2tDb25uZWN0ZWQoKVxuICBwcm92aWRlci5vbignY29ubmVjdCcsICgpID0+IGNoZWNrQ29ubmVjdGVkKCkpXG4gIHByb3ZpZGVyLm9uKCdjbG9zZScsICgpID0+IHVwZGF0ZSgnZGlzY29ubmVjdGVkJykpXG4gIHJldHVybiBwcm92aWRlclxufVxuXG5tb2R1bGUuZXhwb3J0cyA9IChjb25uZWN0aW9ucywgdGFyZ2V0cywgb3B0aW9ucykgPT4ge1xuICAvLyBJZiB3aW5kb3cuZXRoZXJldW0gYW5kIGluamVjdGVkIGlzIGEgdGFyZ2V0IGluIGFueSBwcmlvcml0eSwgcmV0dXJuIGV0aGVyZXVtIHByb3ZpZGVyXG4gIGlmIChjb25uZWN0aW9ucy5pbmplY3RlZC5fX2lzUHJvdmlkZXIgJiYgdGFyZ2V0cy5tYXAodCA9PiB0LnR5cGUpLmluZGV4T2YoJ2luamVjdGVkJykgPiAtMSkge1xuICAgIGRlbGV0ZSBjb25uZWN0aW9ucy5pbmplY3RlZC5fX2lzUHJvdmlkZXJcbiAgICByZXR1cm4gbW9uaXRvcihjb25uZWN0aW9ucy5pbmplY3RlZClcbiAgfVxuICBjb25zdCBwcm92aWRlciA9IG5ldyBFdGhlcmV1bVByb3ZpZGVyKG5ldyBDb25uZWN0aW9uTWFuYWdlcihjb25uZWN0aW9ucywgdGFyZ2V0cywgb3B0aW9ucykpXG4gIHByb3ZpZGVyLnNldE1heExpc3RlbmVycygxMjgpXG4gIHJldHVybiBtb25pdG9yKHByb3ZpZGVyKVxufVxuIiwiY29uc3QgZ2V0UHJvdG9jb2wgPSBsb2NhdGlvbiA9PiB7XG4gIGlmIChsb2NhdGlvbiA9PT0gJ2luamVjdGVkJykgcmV0dXJuICdpbmplY3RlZCdcbiAgaWYgKGxvY2F0aW9uLmVuZHNXaXRoKCcuaXBjJykpIHJldHVybiAnaXBjJ1xuICBpZiAobG9jYXRpb24uc3RhcnRzV2l0aCgnd3NzOi8vJykgfHwgbG9jYXRpb24uc3RhcnRzV2l0aCgnd3M6Ly8nKSkgcmV0dXJuICd3cydcbiAgaWYgKGxvY2F0aW9uLnN0YXJ0c1dpdGgoJ2h0dHBzOi8vJykgfHwgbG9jYXRpb24uc3RhcnRzV2l0aCgnaHR0cDovLycpKSByZXR1cm4gJ2h0dHAnXG4gIHJldHVybiAnJ1xufVxuXG5tb2R1bGUuZXhwb3J0cyA9ICh0YXJnZXRzLCBwcmVzZXRzKSA9PiB7XG4gIHJldHVybiBbXS5jb25jYXQoLi4uW10uY29uY2F0KHRhcmdldHMpLm1hcChwcm92aWRlciA9PiB7XG4gICAgaWYgKHByZXNldHNbcHJvdmlkZXJdKSB7XG4gICAgICByZXR1cm4gcHJlc2V0c1twcm92aWRlcl0ubWFwKGxvY2F0aW9uID0+ICh7IHR5cGU6IHByb3ZpZGVyLCBsb2NhdGlvbiwgcHJvdG9jb2w6IGdldFByb3RvY29sKGxvY2F0aW9uKSB9KSlcbiAgICB9IGVsc2Uge1xuICAgICAgcmV0dXJuIHsgdHlwZTogJ2N1c3RvbScsIGxvY2F0aW9uOiBwcm92aWRlciwgcHJvdG9jb2w6IGdldFByb3RvY29sKHByb3ZpZGVyKSB9XG4gICAgfVxuICB9KSkuZmlsdGVyKHByb3ZpZGVyID0+IHtcbiAgICBpZiAocHJvdmlkZXIucHJvdG9jb2wgfHwgcHJvdmlkZXIudHlwZSA9PT0gJ2luamVjdGVkJykge1xuICAgICAgcmV0dXJuIHRydWVcbiAgICB9IGVsc2Uge1xuICAgICAgY29uc29sZS5sb2coJ2V0aC1wcm92aWRlciB8IEludmFsaWQgcHJvdmlkZXIgcHJlc2V0L2xvY2F0aW9uOiBcIicgKyBwcm92aWRlci5sb2NhdGlvbiArICdcIicpXG4gICAgICByZXR1cm4gZmFsc2VcbiAgICB9XG4gIH0pXG59XG4iLCIvLyBDb3B5cmlnaHQgSm95ZW50LCBJbmMuIGFuZCBvdGhlciBOb2RlIGNvbnRyaWJ1dG9ycy5cbi8vXG4vLyBQZXJtaXNzaW9uIGlzIGhlcmVieSBncmFudGVkLCBmcmVlIG9mIGNoYXJnZSwgdG8gYW55IHBlcnNvbiBvYnRhaW5pbmcgYVxuLy8gY29weSBvZiB0aGlzIHNvZnR3YXJlIGFuZCBhc3NvY2lhdGVkIGRvY3VtZW50YXRpb24gZmlsZXMgKHRoZVxuLy8gXCJTb2Z0d2FyZVwiKSwgdG8gZGVhbCBpbiB0aGUgU29mdHdhcmUgd2l0aG91dCByZXN0cmljdGlvbiwgaW5jbHVkaW5nXG4vLyB3aXRob3V0IGxpbWl0YXRpb24gdGhlIHJpZ2h0cyB0byB1c2UsIGNvcHksIG1vZGlmeSwgbWVyZ2UsIHB1Ymxpc2gsXG4vLyBkaXN0cmlidXRlLCBzdWJsaWNlbnNlLCBhbmQvb3Igc2VsbCBjb3BpZXMgb2YgdGhlIFNvZnR3YXJlLCBhbmQgdG8gcGVybWl0XG4vLyBwZXJzb25zIHRvIHdob20gdGhlIFNvZnR3YXJlIGlzIGZ1cm5pc2hlZCB0byBkbyBzbywgc3ViamVjdCB0byB0aGVcbi8vIGZvbGxvd2luZyBjb25kaXRpb25zOlxuLy9cbi8vIFRoZSBhYm92ZSBjb3B5cmlnaHQgbm90aWNlIGFuZCB0aGlzIHBlcm1pc3Npb24gbm90aWNlIHNoYWxsIGJlIGluY2x1ZGVkXG4vLyBpbiBhbGwgY29waWVzIG9yIHN1YnN0YW50aWFsIHBvcnRpb25zIG9mIHRoZSBTb2Z0d2FyZS5cbi8vXG4vLyBUSEUgU09GVFdBUkUgSVMgUFJPVklERUQgXCJBUyBJU1wiLCBXSVRIT1VUIFdBUlJBTlRZIE9GIEFOWSBLSU5ELCBFWFBSRVNTXG4vLyBPUiBJTVBMSUVELCBJTkNMVURJTkcgQlVUIE5PVCBMSU1JVEVEIFRPIFRIRSBXQVJSQU5USUVTIE9GXG4vLyBNRVJDSEFOVEFCSUxJVFksIEZJVE5FU1MgRk9SIEEgUEFSVElDVUxBUiBQVVJQT1NFIEFORCBOT05JTkZSSU5HRU1FTlQuIElOXG4vLyBOTyBFVkVOVCBTSEFMTCBUSEUgQVVUSE9SUyBPUiBDT1BZUklHSFQgSE9MREVSUyBCRSBMSUFCTEUgRk9SIEFOWSBDTEFJTSxcbi8vIERBTUFHRVMgT1IgT1RIRVIgTElBQklMSVRZLCBXSEVUSEVSIElOIEFOIEFDVElPTiBPRiBDT05UUkFDVCwgVE9SVCBPUlxuLy8gT1RIRVJXSVNFLCBBUklTSU5HIEZST00sIE9VVCBPRiBPUiBJTiBDT05ORUNUSU9OIFdJVEggVEhFIFNPRlRXQVJFIE9SIFRIRVxuLy8gVVNFIE9SIE9USEVSIERFQUxJTkdTIElOIFRIRSBTT0ZUV0FSRS5cblxuJ3VzZSBzdHJpY3QnO1xuXG52YXIgUiA9IHR5cGVvZiBSZWZsZWN0ID09PSAnb2JqZWN0JyA/IFJlZmxlY3QgOiBudWxsXG52YXIgUmVmbGVjdEFwcGx5ID0gUiAmJiB0eXBlb2YgUi5hcHBseSA9PT0gJ2Z1bmN0aW9uJ1xuICA/IFIuYXBwbHlcbiAgOiBmdW5jdGlvbiBSZWZsZWN0QXBwbHkodGFyZ2V0LCByZWNlaXZlciwgYXJncykge1xuICAgIHJldHVybiBGdW5jdGlvbi5wcm90b3R5cGUuYXBwbHkuY2FsbCh0YXJnZXQsIHJlY2VpdmVyLCBhcmdzKTtcbiAgfVxuXG52YXIgUmVmbGVjdE93bktleXNcbmlmIChSICYmIHR5cGVvZiBSLm93bktleXMgPT09ICdmdW5jdGlvbicpIHtcbiAgUmVmbGVjdE93bktleXMgPSBSLm93bktleXNcbn0gZWxzZSBpZiAoT2JqZWN0LmdldE93blByb3BlcnR5U3ltYm9scykge1xuICBSZWZsZWN0T3duS2V5cyA9IGZ1bmN0aW9uIFJlZmxlY3RPd25LZXlzKHRhcmdldCkge1xuICAgIHJldHVybiBPYmplY3QuZ2V0T3duUHJvcGVydHlOYW1lcyh0YXJnZXQpXG4gICAgICAuY29uY2F0KE9iamVjdC5nZXRPd25Qcm9wZXJ0eVN5bWJvbHModGFyZ2V0KSk7XG4gIH07XG59IGVsc2Uge1xuICBSZWZsZWN0T3duS2V5cyA9IGZ1bmN0aW9uIFJlZmxlY3RPd25LZXlzKHRhcmdldCkge1xuICAgIHJldHVybiBPYmplY3QuZ2V0T3duUHJvcGVydHlOYW1lcyh0YXJnZXQpO1xuICB9O1xufVxuXG5mdW5jdGlvbiBQcm9jZXNzRW1pdFdhcm5pbmcod2FybmluZykge1xuICBpZiAoY29uc29sZSAmJiBjb25zb2xlLndhcm4pIGNvbnNvbGUud2Fybih3YXJuaW5nKTtcbn1cblxudmFyIE51bWJlcklzTmFOID0gTnVtYmVyLmlzTmFOIHx8IGZ1bmN0aW9uIE51bWJlcklzTmFOKHZhbHVlKSB7XG4gIHJldHVybiB2YWx1ZSAhPT0gdmFsdWU7XG59XG5cbmZ1bmN0aW9uIEV2ZW50RW1pdHRlcigpIHtcbiAgRXZlbnRFbWl0dGVyLmluaXQuY2FsbCh0aGlzKTtcbn1cbm1vZHVsZS5leHBvcnRzID0gRXZlbnRFbWl0dGVyO1xubW9kdWxlLmV4cG9ydHMub25jZSA9IG9uY2U7XG5cbi8vIEJhY2t3YXJkcy1jb21wYXQgd2l0aCBub2RlIDAuMTAueFxuRXZlbnRFbWl0dGVyLkV2ZW50RW1pdHRlciA9IEV2ZW50RW1pdHRlcjtcblxuRXZlbnRFbWl0dGVyLnByb3RvdHlwZS5fZXZlbnRzID0gdW5kZWZpbmVkO1xuRXZlbnRFbWl0dGVyLnByb3RvdHlwZS5fZXZlbnRzQ291bnQgPSAwO1xuRXZlbnRFbWl0dGVyLnByb3RvdHlwZS5fbWF4TGlzdGVuZXJzID0gdW5kZWZpbmVkO1xuXG4vLyBCeSBkZWZhdWx0IEV2ZW50RW1pdHRlcnMgd2lsbCBwcmludCBhIHdhcm5pbmcgaWYgbW9yZSB0aGFuIDEwIGxpc3RlbmVycyBhcmVcbi8vIGFkZGVkIHRvIGl0LiBUaGlzIGlzIGEgdXNlZnVsIGRlZmF1bHQgd2hpY2ggaGVscHMgZmluZGluZyBtZW1vcnkgbGVha3MuXG52YXIgZGVmYXVsdE1heExpc3RlbmVycyA9IDEwO1xuXG5mdW5jdGlvbiBjaGVja0xpc3RlbmVyKGxpc3RlbmVyKSB7XG4gIGlmICh0eXBlb2YgbGlzdGVuZXIgIT09ICdmdW5jdGlvbicpIHtcbiAgICB0aHJvdyBuZXcgVHlwZUVycm9yKCdUaGUgXCJsaXN0ZW5lclwiIGFyZ3VtZW50IG11c3QgYmUgb2YgdHlwZSBGdW5jdGlvbi4gUmVjZWl2ZWQgdHlwZSAnICsgdHlwZW9mIGxpc3RlbmVyKTtcbiAgfVxufVxuXG5PYmplY3QuZGVmaW5lUHJvcGVydHkoRXZlbnRFbWl0dGVyLCAnZGVmYXVsdE1heExpc3RlbmVycycsIHtcbiAgZW51bWVyYWJsZTogdHJ1ZSxcbiAgZ2V0OiBmdW5jdGlvbigpIHtcbiAgICByZXR1cm4gZGVmYXVsdE1heExpc3RlbmVycztcbiAgfSxcbiAgc2V0OiBmdW5jdGlvbihhcmcpIHtcbiAgICBpZiAodHlwZW9mIGFyZyAhPT0gJ251bWJlcicgfHwgYXJnIDwgMCB8fCBOdW1iZXJJc05hTihhcmcpKSB7XG4gICAgICB0aHJvdyBuZXcgUmFuZ2VFcnJvcignVGhlIHZhbHVlIG9mIFwiZGVmYXVsdE1heExpc3RlbmVyc1wiIGlzIG91dCBvZiByYW5nZS4gSXQgbXVzdCBiZSBhIG5vbi1uZWdhdGl2ZSBudW1iZXIuIFJlY2VpdmVkICcgKyBhcmcgKyAnLicpO1xuICAgIH1cbiAgICBkZWZhdWx0TWF4TGlzdGVuZXJzID0gYXJnO1xuICB9XG59KTtcblxuRXZlbnRFbWl0dGVyLmluaXQgPSBmdW5jdGlvbigpIHtcblxuICBpZiAodGhpcy5fZXZlbnRzID09PSB1bmRlZmluZWQgfHxcbiAgICAgIHRoaXMuX2V2ZW50cyA9PT0gT2JqZWN0LmdldFByb3RvdHlwZU9mKHRoaXMpLl9ldmVudHMpIHtcbiAgICB0aGlzLl9ldmVudHMgPSBPYmplY3QuY3JlYXRlKG51bGwpO1xuICAgIHRoaXMuX2V2ZW50c0NvdW50ID0gMDtcbiAgfVxuXG4gIHRoaXMuX21heExpc3RlbmVycyA9IHRoaXMuX21heExpc3RlbmVycyB8fCB1bmRlZmluZWQ7XG59O1xuXG4vLyBPYnZpb3VzbHkgbm90IGFsbCBFbWl0dGVycyBzaG91bGQgYmUgbGltaXRlZCB0byAxMC4gVGhpcyBmdW5jdGlvbiBhbGxvd3Ncbi8vIHRoYXQgdG8gYmUgaW5jcmVhc2VkLiBTZXQgdG8gemVybyBmb3IgdW5saW1pdGVkLlxuRXZlbnRFbWl0dGVyLnByb3RvdHlwZS5zZXRNYXhMaXN0ZW5lcnMgPSBmdW5jdGlvbiBzZXRNYXhMaXN0ZW5lcnMobikge1xuICBpZiAodHlwZW9mIG4gIT09ICdudW1iZXInIHx8IG4gPCAwIHx8IE51bWJlcklzTmFOKG4pKSB7XG4gICAgdGhyb3cgbmV3IFJhbmdlRXJyb3IoJ1RoZSB2YWx1ZSBvZiBcIm5cIiBpcyBvdXQgb2YgcmFuZ2UuIEl0IG11c3QgYmUgYSBub24tbmVnYXRpdmUgbnVtYmVyLiBSZWNlaXZlZCAnICsgbiArICcuJyk7XG4gIH1cbiAgdGhpcy5fbWF4TGlzdGVuZXJzID0gbjtcbiAgcmV0dXJuIHRoaXM7XG59O1xuXG5mdW5jdGlvbiBfZ2V0TWF4TGlzdGVuZXJzKHRoYXQpIHtcbiAgaWYgKHRoYXQuX21heExpc3RlbmVycyA9PT0gdW5kZWZpbmVkKVxuICAgIHJldHVybiBFdmVudEVtaXR0ZXIuZGVmYXVsdE1heExpc3RlbmVycztcbiAgcmV0dXJuIHRoYXQuX21heExpc3RlbmVycztcbn1cblxuRXZlbnRFbWl0dGVyLnByb3RvdHlwZS5nZXRNYXhMaXN0ZW5lcnMgPSBmdW5jdGlvbiBnZXRNYXhMaXN0ZW5lcnMoKSB7XG4gIHJldHVybiBfZ2V0TWF4TGlzdGVuZXJzKHRoaXMpO1xufTtcblxuRXZlbnRFbWl0dGVyLnByb3RvdHlwZS5lbWl0ID0gZnVuY3Rpb24gZW1pdCh0eXBlKSB7XG4gIHZhciBhcmdzID0gW107XG4gIGZvciAodmFyIGkgPSAxOyBpIDwgYXJndW1lbnRzLmxlbmd0aDsgaSsrKSBhcmdzLnB1c2goYXJndW1lbnRzW2ldKTtcbiAgdmFyIGRvRXJyb3IgPSAodHlwZSA9PT0gJ2Vycm9yJyk7XG5cbiAgdmFyIGV2ZW50cyA9IHRoaXMuX2V2ZW50cztcbiAgaWYgKGV2ZW50cyAhPT0gdW5kZWZpbmVkKVxuICAgIGRvRXJyb3IgPSAoZG9FcnJvciAmJiBldmVudHMuZXJyb3IgPT09IHVuZGVmaW5lZCk7XG4gIGVsc2UgaWYgKCFkb0Vycm9yKVxuICAgIHJldHVybiBmYWxzZTtcblxuICAvLyBJZiB0aGVyZSBpcyBubyAnZXJyb3InIGV2ZW50IGxpc3RlbmVyIHRoZW4gdGhyb3cuXG4gIGlmIChkb0Vycm9yKSB7XG4gICAgdmFyIGVyO1xuICAgIGlmIChhcmdzLmxlbmd0aCA+IDApXG4gICAgICBlciA9IGFyZ3NbMF07XG4gICAgaWYgKGVyIGluc3RhbmNlb2YgRXJyb3IpIHtcbiAgICAgIC8vIE5vdGU6IFRoZSBjb21tZW50cyBvbiB0aGUgYHRocm93YCBsaW5lcyBhcmUgaW50ZW50aW9uYWwsIHRoZXkgc2hvd1xuICAgICAgLy8gdXAgaW4gTm9kZSdzIG91dHB1dCBpZiB0aGlzIHJlc3VsdHMgaW4gYW4gdW5oYW5kbGVkIGV4Y2VwdGlvbi5cbiAgICAgIHRocm93IGVyOyAvLyBVbmhhbmRsZWQgJ2Vycm9yJyBldmVudFxuICAgIH1cbiAgICAvLyBBdCBsZWFzdCBnaXZlIHNvbWUga2luZCBvZiBjb250ZXh0IHRvIHRoZSB1c2VyXG4gICAgdmFyIGVyciA9IG5ldyBFcnJvcignVW5oYW5kbGVkIGVycm9yLicgKyAoZXIgPyAnICgnICsgZXIubWVzc2FnZSArICcpJyA6ICcnKSk7XG4gICAgZXJyLmNvbnRleHQgPSBlcjtcbiAgICB0aHJvdyBlcnI7IC8vIFVuaGFuZGxlZCAnZXJyb3InIGV2ZW50XG4gIH1cblxuICB2YXIgaGFuZGxlciA9IGV2ZW50c1t0eXBlXTtcblxuICBpZiAoaGFuZGxlciA9PT0gdW5kZWZpbmVkKVxuICAgIHJldHVybiBmYWxzZTtcblxuICBpZiAodHlwZW9mIGhhbmRsZXIgPT09ICdmdW5jdGlvbicpIHtcbiAgICBSZWZsZWN0QXBwbHkoaGFuZGxlciwgdGhpcywgYXJncyk7XG4gIH0gZWxzZSB7XG4gICAgdmFyIGxlbiA9IGhhbmRsZXIubGVuZ3RoO1xuICAgIHZhciBsaXN0ZW5lcnMgPSBhcnJheUNsb25lKGhhbmRsZXIsIGxlbik7XG4gICAgZm9yICh2YXIgaSA9IDA7IGkgPCBsZW47ICsraSlcbiAgICAgIFJlZmxlY3RBcHBseShsaXN0ZW5lcnNbaV0sIHRoaXMsIGFyZ3MpO1xuICB9XG5cbiAgcmV0dXJuIHRydWU7XG59O1xuXG5mdW5jdGlvbiBfYWRkTGlzdGVuZXIodGFyZ2V0LCB0eXBlLCBsaXN0ZW5lciwgcHJlcGVuZCkge1xuICB2YXIgbTtcbiAgdmFyIGV2ZW50cztcbiAgdmFyIGV4aXN0aW5nO1xuXG4gIGNoZWNrTGlzdGVuZXIobGlzdGVuZXIpO1xuXG4gIGV2ZW50cyA9IHRhcmdldC5fZXZlbnRzO1xuICBpZiAoZXZlbnRzID09PSB1bmRlZmluZWQpIHtcbiAgICBldmVudHMgPSB0YXJnZXQuX2V2ZW50cyA9IE9iamVjdC5jcmVhdGUobnVsbCk7XG4gICAgdGFyZ2V0Ll9ldmVudHNDb3VudCA9IDA7XG4gIH0gZWxzZSB7XG4gICAgLy8gVG8gYXZvaWQgcmVjdXJzaW9uIGluIHRoZSBjYXNlIHRoYXQgdHlwZSA9PT0gXCJuZXdMaXN0ZW5lclwiISBCZWZvcmVcbiAgICAvLyBhZGRpbmcgaXQgdG8gdGhlIGxpc3RlbmVycywgZmlyc3QgZW1pdCBcIm5ld0xpc3RlbmVyXCIuXG4gICAgaWYgKGV2ZW50cy5uZXdMaXN0ZW5lciAhPT0gdW5kZWZpbmVkKSB7XG4gICAgICB0YXJnZXQuZW1pdCgnbmV3TGlzdGVuZXInLCB0eXBlLFxuICAgICAgICAgICAgICAgICAgbGlzdGVuZXIubGlzdGVuZXIgPyBsaXN0ZW5lci5saXN0ZW5lciA6IGxpc3RlbmVyKTtcblxuICAgICAgLy8gUmUtYXNzaWduIGBldmVudHNgIGJlY2F1c2UgYSBuZXdMaXN0ZW5lciBoYW5kbGVyIGNvdWxkIGhhdmUgY2F1c2VkIHRoZVxuICAgICAgLy8gdGhpcy5fZXZlbnRzIHRvIGJlIGFzc2lnbmVkIHRvIGEgbmV3IG9iamVjdFxuICAgICAgZXZlbnRzID0gdGFyZ2V0Ll9ldmVudHM7XG4gICAgfVxuICAgIGV4aXN0aW5nID0gZXZlbnRzW3R5cGVdO1xuICB9XG5cbiAgaWYgKGV4aXN0aW5nID09PSB1bmRlZmluZWQpIHtcbiAgICAvLyBPcHRpbWl6ZSB0aGUgY2FzZSBvZiBvbmUgbGlzdGVuZXIuIERvbid0IG5lZWQgdGhlIGV4dHJhIGFycmF5IG9iamVjdC5cbiAgICBleGlzdGluZyA9IGV2ZW50c1t0eXBlXSA9IGxpc3RlbmVyO1xuICAgICsrdGFyZ2V0Ll9ldmVudHNDb3VudDtcbiAgfSBlbHNlIHtcbiAgICBpZiAodHlwZW9mIGV4aXN0aW5nID09PSAnZnVuY3Rpb24nKSB7XG4gICAgICAvLyBBZGRpbmcgdGhlIHNlY29uZCBlbGVtZW50LCBuZWVkIHRvIGNoYW5nZSB0byBhcnJheS5cbiAgICAgIGV4aXN0aW5nID0gZXZlbnRzW3R5cGVdID1cbiAgICAgICAgcHJlcGVuZCA/IFtsaXN0ZW5lciwgZXhpc3RpbmddIDogW2V4aXN0aW5nLCBsaXN0ZW5lcl07XG4gICAgICAvLyBJZiB3ZSd2ZSBhbHJlYWR5IGdvdCBhbiBhcnJheSwganVzdCBhcHBlbmQuXG4gICAgfSBlbHNlIGlmIChwcmVwZW5kKSB7XG4gICAgICBleGlzdGluZy51bnNoaWZ0KGxpc3RlbmVyKTtcbiAgICB9IGVsc2Uge1xuICAgICAgZXhpc3RpbmcucHVzaChsaXN0ZW5lcik7XG4gICAgfVxuXG4gICAgLy8gQ2hlY2sgZm9yIGxpc3RlbmVyIGxlYWtcbiAgICBtID0gX2dldE1heExpc3RlbmVycyh0YXJnZXQpO1xuICAgIGlmIChtID4gMCAmJiBleGlzdGluZy5sZW5ndGggPiBtICYmICFleGlzdGluZy53YXJuZWQpIHtcbiAgICAgIGV4aXN0aW5nLndhcm5lZCA9IHRydWU7XG4gICAgICAvLyBObyBlcnJvciBjb2RlIGZvciB0aGlzIHNpbmNlIGl0IGlzIGEgV2FybmluZ1xuICAgICAgLy8gZXNsaW50LWRpc2FibGUtbmV4dC1saW5lIG5vLXJlc3RyaWN0ZWQtc3ludGF4XG4gICAgICB2YXIgdyA9IG5ldyBFcnJvcignUG9zc2libGUgRXZlbnRFbWl0dGVyIG1lbW9yeSBsZWFrIGRldGVjdGVkLiAnICtcbiAgICAgICAgICAgICAgICAgICAgICAgICAgZXhpc3RpbmcubGVuZ3RoICsgJyAnICsgU3RyaW5nKHR5cGUpICsgJyBsaXN0ZW5lcnMgJyArXG4gICAgICAgICAgICAgICAgICAgICAgICAgICdhZGRlZC4gVXNlIGVtaXR0ZXIuc2V0TWF4TGlzdGVuZXJzKCkgdG8gJyArXG4gICAgICAgICAgICAgICAgICAgICAgICAgICdpbmNyZWFzZSBsaW1pdCcpO1xuICAgICAgdy5uYW1lID0gJ01heExpc3RlbmVyc0V4Y2VlZGVkV2FybmluZyc7XG4gICAgICB3LmVtaXR0ZXIgPSB0YXJnZXQ7XG4gICAgICB3LnR5cGUgPSB0eXBlO1xuICAgICAgdy5jb3VudCA9IGV4aXN0aW5nLmxlbmd0aDtcbiAgICAgIFByb2Nlc3NFbWl0V2FybmluZyh3KTtcbiAgICB9XG4gIH1cblxuICByZXR1cm4gdGFyZ2V0O1xufVxuXG5FdmVudEVtaXR0ZXIucHJvdG90eXBlLmFkZExpc3RlbmVyID0gZnVuY3Rpb24gYWRkTGlzdGVuZXIodHlwZSwgbGlzdGVuZXIpIHtcbiAgcmV0dXJuIF9hZGRMaXN0ZW5lcih0aGlzLCB0eXBlLCBsaXN0ZW5lciwgZmFsc2UpO1xufTtcblxuRXZlbnRFbWl0dGVyLnByb3RvdHlwZS5vbiA9IEV2ZW50RW1pdHRlci5wcm90b3R5cGUuYWRkTGlzdGVuZXI7XG5cbkV2ZW50RW1pdHRlci5wcm90b3R5cGUucHJlcGVuZExpc3RlbmVyID1cbiAgICBmdW5jdGlvbiBwcmVwZW5kTGlzdGVuZXIodHlwZSwgbGlzdGVuZXIpIHtcbiAgICAgIHJldHVybiBfYWRkTGlzdGVuZXIodGhpcywgdHlwZSwgbGlzdGVuZXIsIHRydWUpO1xuICAgIH07XG5cbmZ1bmN0aW9uIG9uY2VXcmFwcGVyKCkge1xuICBpZiAoIXRoaXMuZmlyZWQpIHtcbiAgICB0aGlzLnRhcmdldC5yZW1vdmVMaXN0ZW5lcih0aGlzLnR5cGUsIHRoaXMud3JhcEZuKTtcbiAgICB0aGlzLmZpcmVkID0gdHJ1ZTtcbiAgICBpZiAoYXJndW1lbnRzLmxlbmd0aCA9PT0gMClcbiAgICAgIHJldHVybiB0aGlzLmxpc3RlbmVyLmNhbGwodGhpcy50YXJnZXQpO1xuICAgIHJldHVybiB0aGlzLmxpc3RlbmVyLmFwcGx5KHRoaXMudGFyZ2V0LCBhcmd1bWVudHMpO1xuICB9XG59XG5cbmZ1bmN0aW9uIF9vbmNlV3JhcCh0YXJnZXQsIHR5cGUsIGxpc3RlbmVyKSB7XG4gIHZhciBzdGF0ZSA9IHsgZmlyZWQ6IGZhbHNlLCB3cmFwRm46IHVuZGVmaW5lZCwgdGFyZ2V0OiB0YXJnZXQsIHR5cGU6IHR5cGUsIGxpc3RlbmVyOiBsaXN0ZW5lciB9O1xuICB2YXIgd3JhcHBlZCA9IG9uY2VXcmFwcGVyLmJpbmQoc3RhdGUpO1xuICB3cmFwcGVkLmxpc3RlbmVyID0gbGlzdGVuZXI7XG4gIHN0YXRlLndyYXBGbiA9IHdyYXBwZWQ7XG4gIHJldHVybiB3cmFwcGVkO1xufVxuXG5FdmVudEVtaXR0ZXIucHJvdG90eXBlLm9uY2UgPSBmdW5jdGlvbiBvbmNlKHR5cGUsIGxpc3RlbmVyKSB7XG4gIGNoZWNrTGlzdGVuZXIobGlzdGVuZXIpO1xuICB0aGlzLm9uKHR5cGUsIF9vbmNlV3JhcCh0aGlzLCB0eXBlLCBsaXN0ZW5lcikpO1xuICByZXR1cm4gdGhpcztcbn07XG5cbkV2ZW50RW1pdHRlci5wcm90b3R5cGUucHJlcGVuZE9uY2VMaXN0ZW5lciA9XG4gICAgZnVuY3Rpb24gcHJlcGVuZE9uY2VMaXN0ZW5lcih0eXBlLCBsaXN0ZW5lcikge1xuICAgICAgY2hlY2tMaXN0ZW5lcihsaXN0ZW5lcik7XG4gICAgICB0aGlzLnByZXBlbmRMaXN0ZW5lcih0eXBlLCBfb25jZVdyYXAodGhpcywgdHlwZSwgbGlzdGVuZXIpKTtcbiAgICAgIHJldHVybiB0aGlzO1xuICAgIH07XG5cbi8vIEVtaXRzIGEgJ3JlbW92ZUxpc3RlbmVyJyBldmVudCBpZiBhbmQgb25seSBpZiB0aGUgbGlzdGVuZXIgd2FzIHJlbW92ZWQuXG5FdmVudEVtaXR0ZXIucHJvdG90eXBlLnJlbW92ZUxpc3RlbmVyID1cbiAgICBmdW5jdGlvbiByZW1vdmVMaXN0ZW5lcih0eXBlLCBsaXN0ZW5lcikge1xuICAgICAgdmFyIGxpc3QsIGV2ZW50cywgcG9zaXRpb24sIGksIG9yaWdpbmFsTGlzdGVuZXI7XG5cbiAgICAgIGNoZWNrTGlzdGVuZXIobGlzdGVuZXIpO1xuXG4gICAgICBldmVudHMgPSB0aGlzLl9ldmVudHM7XG4gICAgICBpZiAoZXZlbnRzID09PSB1bmRlZmluZWQpXG4gICAgICAgIHJldHVybiB0aGlzO1xuXG4gICAgICBsaXN0ID0gZXZlbnRzW3R5cGVdO1xuICAgICAgaWYgKGxpc3QgPT09IHVuZGVmaW5lZClcbiAgICAgICAgcmV0dXJuIHRoaXM7XG5cbiAgICAgIGlmIChsaXN0ID09PSBsaXN0ZW5lciB8fCBsaXN0Lmxpc3RlbmVyID09PSBsaXN0ZW5lcikge1xuICAgICAgICBpZiAoLS10aGlzLl9ldmVudHNDb3VudCA9PT0gMClcbiAgICAgICAgICB0aGlzLl9ldmVudHMgPSBPYmplY3QuY3JlYXRlKG51bGwpO1xuICAgICAgICBlbHNlIHtcbiAgICAgICAgICBkZWxldGUgZXZlbnRzW3R5cGVdO1xuICAgICAgICAgIGlmIChldmVudHMucmVtb3ZlTGlzdGVuZXIpXG4gICAgICAgICAgICB0aGlzLmVtaXQoJ3JlbW92ZUxpc3RlbmVyJywgdHlwZSwgbGlzdC5saXN0ZW5lciB8fCBsaXN0ZW5lcik7XG4gICAgICAgIH1cbiAgICAgIH0gZWxzZSBpZiAodHlwZW9mIGxpc3QgIT09ICdmdW5jdGlvbicpIHtcbiAgICAgICAgcG9zaXRpb24gPSAtMTtcblxuICAgICAgICBmb3IgKGkgPSBsaXN0Lmxlbmd0aCAtIDE7IGkgPj0gMDsgaS0tKSB7XG4gICAgICAgICAgaWYgKGxpc3RbaV0gPT09IGxpc3RlbmVyIHx8IGxpc3RbaV0ubGlzdGVuZXIgPT09IGxpc3RlbmVyKSB7XG4gICAgICAgICAgICBvcmlnaW5hbExpc3RlbmVyID0gbGlzdFtpXS5saXN0ZW5lcjtcbiAgICAgICAgICAgIHBvc2l0aW9uID0gaTtcbiAgICAgICAgICAgIGJyZWFrO1xuICAgICAgICAgIH1cbiAgICAgICAgfVxuXG4gICAgICAgIGlmIChwb3NpdGlvbiA8IDApXG4gICAgICAgICAgcmV0dXJuIHRoaXM7XG5cbiAgICAgICAgaWYgKHBvc2l0aW9uID09PSAwKVxuICAgICAgICAgIGxpc3Quc2hpZnQoKTtcbiAgICAgICAgZWxzZSB7XG4gICAgICAgICAgc3BsaWNlT25lKGxpc3QsIHBvc2l0aW9uKTtcbiAgICAgICAgfVxuXG4gICAgICAgIGlmIChsaXN0Lmxlbmd0aCA9PT0gMSlcbiAgICAgICAgICBldmVudHNbdHlwZV0gPSBsaXN0WzBdO1xuXG4gICAgICAgIGlmIChldmVudHMucmVtb3ZlTGlzdGVuZXIgIT09IHVuZGVmaW5lZClcbiAgICAgICAgICB0aGlzLmVtaXQoJ3JlbW92ZUxpc3RlbmVyJywgdHlwZSwgb3JpZ2luYWxMaXN0ZW5lciB8fCBsaXN0ZW5lcik7XG4gICAgICB9XG5cbiAgICAgIHJldHVybiB0aGlzO1xuICAgIH07XG5cbkV2ZW50RW1pdHRlci5wcm90b3R5cGUub2ZmID0gRXZlbnRFbWl0dGVyLnByb3RvdHlwZS5yZW1vdmVMaXN0ZW5lcjtcblxuRXZlbnRFbWl0dGVyLnByb3RvdHlwZS5yZW1vdmVBbGxMaXN0ZW5lcnMgPVxuICAgIGZ1bmN0aW9uIHJlbW92ZUFsbExpc3RlbmVycyh0eXBlKSB7XG4gICAgICB2YXIgbGlzdGVuZXJzLCBldmVudHMsIGk7XG5cbiAgICAgIGV2ZW50cyA9IHRoaXMuX2V2ZW50cztcbiAgICAgIGlmIChldmVudHMgPT09IHVuZGVmaW5lZClcbiAgICAgICAgcmV0dXJuIHRoaXM7XG5cbiAgICAgIC8vIG5vdCBsaXN0ZW5pbmcgZm9yIHJlbW92ZUxpc3RlbmVyLCBubyBuZWVkIHRvIGVtaXRcbiAgICAgIGlmIChldmVudHMucmVtb3ZlTGlzdGVuZXIgPT09IHVuZGVmaW5lZCkge1xuICAgICAgICBpZiAoYXJndW1lbnRzLmxlbmd0aCA9PT0gMCkge1xuICAgICAgICAgIHRoaXMuX2V2ZW50cyA9IE9iamVjdC5jcmVhdGUobnVsbCk7XG4gICAgICAgICAgdGhpcy5fZXZlbnRzQ291bnQgPSAwO1xuICAgICAgICB9IGVsc2UgaWYgKGV2ZW50c1t0eXBlXSAhPT0gdW5kZWZpbmVkKSB7XG4gICAgICAgICAgaWYgKC0tdGhpcy5fZXZlbnRzQ291bnQgPT09IDApXG4gICAgICAgICAgICB0aGlzLl9ldmVudHMgPSBPYmplY3QuY3JlYXRlKG51bGwpO1xuICAgICAgICAgIGVsc2VcbiAgICAgICAgICAgIGRlbGV0ZSBldmVudHNbdHlwZV07XG4gICAgICAgIH1cbiAgICAgICAgcmV0dXJuIHRoaXM7XG4gICAgICB9XG5cbiAgICAgIC8vIGVtaXQgcmVtb3ZlTGlzdGVuZXIgZm9yIGFsbCBsaXN0ZW5lcnMgb24gYWxsIGV2ZW50c1xuICAgICAgaWYgKGFyZ3VtZW50cy5sZW5ndGggPT09IDApIHtcbiAgICAgICAgdmFyIGtleXMgPSBPYmplY3Qua2V5cyhldmVudHMpO1xuICAgICAgICB2YXIga2V5O1xuICAgICAgICBmb3IgKGkgPSAwOyBpIDwga2V5cy5sZW5ndGg7ICsraSkge1xuICAgICAgICAgIGtleSA9IGtleXNbaV07XG4gICAgICAgICAgaWYgKGtleSA9PT0gJ3JlbW92ZUxpc3RlbmVyJykgY29udGludWU7XG4gICAgICAgICAgdGhpcy5yZW1vdmVBbGxMaXN0ZW5lcnMoa2V5KTtcbiAgICAgICAgfVxuICAgICAgICB0aGlzLnJlbW92ZUFsbExpc3RlbmVycygncmVtb3ZlTGlzdGVuZXInKTtcbiAgICAgICAgdGhpcy5fZXZlbnRzID0gT2JqZWN0LmNyZWF0ZShudWxsKTtcbiAgICAgICAgdGhpcy5fZXZlbnRzQ291bnQgPSAwO1xuICAgICAgICByZXR1cm4gdGhpcztcbiAgICAgIH1cblxuICAgICAgbGlzdGVuZXJzID0gZXZlbnRzW3R5cGVdO1xuXG4gICAgICBpZiAodHlwZW9mIGxpc3RlbmVycyA9PT0gJ2Z1bmN0aW9uJykge1xuICAgICAgICB0aGlzLnJlbW92ZUxpc3RlbmVyKHR5cGUsIGxpc3RlbmVycyk7XG4gICAgICB9IGVsc2UgaWYgKGxpc3RlbmVycyAhPT0gdW5kZWZpbmVkKSB7XG4gICAgICAgIC8vIExJRk8gb3JkZXJcbiAgICAgICAgZm9yIChpID0gbGlzdGVuZXJzLmxlbmd0aCAtIDE7IGkgPj0gMDsgaS0tKSB7XG4gICAgICAgICAgdGhpcy5yZW1vdmVMaXN0ZW5lcih0eXBlLCBsaXN0ZW5lcnNbaV0pO1xuICAgICAgICB9XG4gICAgICB9XG5cbiAgICAgIHJldHVybiB0aGlzO1xuICAgIH07XG5cbmZ1bmN0aW9uIF9saXN0ZW5lcnModGFyZ2V0LCB0eXBlLCB1bndyYXApIHtcbiAgdmFyIGV2ZW50cyA9IHRhcmdldC5fZXZlbnRzO1xuXG4gIGlmIChldmVudHMgPT09IHVuZGVmaW5lZClcbiAgICByZXR1cm4gW107XG5cbiAgdmFyIGV2bGlzdGVuZXIgPSBldmVudHNbdHlwZV07XG4gIGlmIChldmxpc3RlbmVyID09PSB1bmRlZmluZWQpXG4gICAgcmV0dXJuIFtdO1xuXG4gIGlmICh0eXBlb2YgZXZsaXN0ZW5lciA9PT0gJ2Z1bmN0aW9uJylcbiAgICByZXR1cm4gdW53cmFwID8gW2V2bGlzdGVuZXIubGlzdGVuZXIgfHwgZXZsaXN0ZW5lcl0gOiBbZXZsaXN0ZW5lcl07XG5cbiAgcmV0dXJuIHVud3JhcCA/XG4gICAgdW53cmFwTGlzdGVuZXJzKGV2bGlzdGVuZXIpIDogYXJyYXlDbG9uZShldmxpc3RlbmVyLCBldmxpc3RlbmVyLmxlbmd0aCk7XG59XG5cbkV2ZW50RW1pdHRlci5wcm90b3R5cGUubGlzdGVuZXJzID0gZnVuY3Rpb24gbGlzdGVuZXJzKHR5cGUpIHtcbiAgcmV0dXJuIF9saXN0ZW5lcnModGhpcywgdHlwZSwgdHJ1ZSk7XG59O1xuXG5FdmVudEVtaXR0ZXIucHJvdG90eXBlLnJhd0xpc3RlbmVycyA9IGZ1bmN0aW9uIHJhd0xpc3RlbmVycyh0eXBlKSB7XG4gIHJldHVybiBfbGlzdGVuZXJzKHRoaXMsIHR5cGUsIGZhbHNlKTtcbn07XG5cbkV2ZW50RW1pdHRlci5saXN0ZW5lckNvdW50ID0gZnVuY3Rpb24oZW1pdHRlciwgdHlwZSkge1xuICBpZiAodHlwZW9mIGVtaXR0ZXIubGlzdGVuZXJDb3VudCA9PT0gJ2Z1bmN0aW9uJykge1xuICAgIHJldHVybiBlbWl0dGVyLmxpc3RlbmVyQ291bnQodHlwZSk7XG4gIH0gZWxzZSB7XG4gICAgcmV0dXJuIGxpc3RlbmVyQ291bnQuY2FsbChlbWl0dGVyLCB0eXBlKTtcbiAgfVxufTtcblxuRXZlbnRFbWl0dGVyLnByb3RvdHlwZS5saXN0ZW5lckNvdW50ID0gbGlzdGVuZXJDb3VudDtcbmZ1bmN0aW9uIGxpc3RlbmVyQ291bnQodHlwZSkge1xuICB2YXIgZXZlbnRzID0gdGhpcy5fZXZlbnRzO1xuXG4gIGlmIChldmVudHMgIT09IHVuZGVmaW5lZCkge1xuICAgIHZhciBldmxpc3RlbmVyID0gZXZlbnRzW3R5cGVdO1xuXG4gICAgaWYgKHR5cGVvZiBldmxpc3RlbmVyID09PSAnZnVuY3Rpb24nKSB7XG4gICAgICByZXR1cm4gMTtcbiAgICB9IGVsc2UgaWYgKGV2bGlzdGVuZXIgIT09IHVuZGVmaW5lZCkge1xuICAgICAgcmV0dXJuIGV2bGlzdGVuZXIubGVuZ3RoO1xuICAgIH1cbiAgfVxuXG4gIHJldHVybiAwO1xufVxuXG5FdmVudEVtaXR0ZXIucHJvdG90eXBlLmV2ZW50TmFtZXMgPSBmdW5jdGlvbiBldmVudE5hbWVzKCkge1xuICByZXR1cm4gdGhpcy5fZXZlbnRzQ291bnQgPiAwID8gUmVmbGVjdE93bktleXModGhpcy5fZXZlbnRzKSA6IFtdO1xufTtcblxuZnVuY3Rpb24gYXJyYXlDbG9uZShhcnIsIG4pIHtcbiAgdmFyIGNvcHkgPSBuZXcgQXJyYXkobik7XG4gIGZvciAodmFyIGkgPSAwOyBpIDwgbjsgKytpKVxuICAgIGNvcHlbaV0gPSBhcnJbaV07XG4gIHJldHVybiBjb3B5O1xufVxuXG5mdW5jdGlvbiBzcGxpY2VPbmUobGlzdCwgaW5kZXgpIHtcbiAgZm9yICg7IGluZGV4ICsgMSA8IGxpc3QubGVuZ3RoOyBpbmRleCsrKVxuICAgIGxpc3RbaW5kZXhdID0gbGlzdFtpbmRleCArIDFdO1xuICBsaXN0LnBvcCgpO1xufVxuXG5mdW5jdGlvbiB1bndyYXBMaXN0ZW5lcnMoYXJyKSB7XG4gIHZhciByZXQgPSBuZXcgQXJyYXkoYXJyLmxlbmd0aCk7XG4gIGZvciAodmFyIGkgPSAwOyBpIDwgcmV0Lmxlbmd0aDsgKytpKSB7XG4gICAgcmV0W2ldID0gYXJyW2ldLmxpc3RlbmVyIHx8IGFycltpXTtcbiAgfVxuICByZXR1cm4gcmV0O1xufVxuXG5mdW5jdGlvbiBvbmNlKGVtaXR0ZXIsIG5hbWUpIHtcbiAgcmV0dXJuIG5ldyBQcm9taXNlKGZ1bmN0aW9uIChyZXNvbHZlLCByZWplY3QpIHtcbiAgICBmdW5jdGlvbiBlcnJvckxpc3RlbmVyKGVycikge1xuICAgICAgZW1pdHRlci5yZW1vdmVMaXN0ZW5lcihuYW1lLCByZXNvbHZlcik7XG4gICAgICByZWplY3QoZXJyKTtcbiAgICB9XG5cbiAgICBmdW5jdGlvbiByZXNvbHZlcigpIHtcbiAgICAgIGlmICh0eXBlb2YgZW1pdHRlci5yZW1vdmVMaXN0ZW5lciA9PT0gJ2Z1bmN0aW9uJykge1xuICAgICAgICBlbWl0dGVyLnJlbW92ZUxpc3RlbmVyKCdlcnJvcicsIGVycm9yTGlzdGVuZXIpO1xuICAgICAgfVxuICAgICAgcmVzb2x2ZShbXS5zbGljZS5jYWxsKGFyZ3VtZW50cykpO1xuICAgIH07XG5cbiAgICBldmVudFRhcmdldEFnbm9zdGljQWRkTGlzdGVuZXIoZW1pdHRlciwgbmFtZSwgcmVzb2x2ZXIsIHsgb25jZTogdHJ1ZSB9KTtcbiAgICBpZiAobmFtZSAhPT0gJ2Vycm9yJykge1xuICAgICAgYWRkRXJyb3JIYW5kbGVySWZFdmVudEVtaXR0ZXIoZW1pdHRlciwgZXJyb3JMaXN0ZW5lciwgeyBvbmNlOiB0cnVlIH0pO1xuICAgIH1cbiAgfSk7XG59XG5cbmZ1bmN0aW9uIGFkZEVycm9ySGFuZGxlcklmRXZlbnRFbWl0dGVyKGVtaXR0ZXIsIGhhbmRsZXIsIGZsYWdzKSB7XG4gIGlmICh0eXBlb2YgZW1pdHRlci5vbiA9PT0gJ2Z1bmN0aW9uJykge1xuICAgIGV2ZW50VGFyZ2V0QWdub3N0aWNBZGRMaXN0ZW5lcihlbWl0dGVyLCAnZXJyb3InLCBoYW5kbGVyLCBmbGFncyk7XG4gIH1cbn1cblxuZnVuY3Rpb24gZXZlbnRUYXJnZXRBZ25vc3RpY0FkZExpc3RlbmVyKGVtaXR0ZXIsIG5hbWUsIGxpc3RlbmVyLCBmbGFncykge1xuICBpZiAodHlwZW9mIGVtaXR0ZXIub24gPT09ICdmdW5jdGlvbicpIHtcbiAgICBpZiAoZmxhZ3Mub25jZSkge1xuICAgICAgZW1pdHRlci5vbmNlKG5hbWUsIGxpc3RlbmVyKTtcbiAgICB9IGVsc2Uge1xuICAgICAgZW1pdHRlci5vbihuYW1lLCBsaXN0ZW5lcik7XG4gICAgfVxuICB9IGVsc2UgaWYgKHR5cGVvZiBlbWl0dGVyLmFkZEV2ZW50TGlzdGVuZXIgPT09ICdmdW5jdGlvbicpIHtcbiAgICAvLyBFdmVudFRhcmdldCBkb2VzIG5vdCBoYXZlIGBlcnJvcmAgZXZlbnQgc2VtYW50aWNzIGxpa2UgTm9kZVxuICAgIC8vIEV2ZW50RW1pdHRlcnMsIHdlIGRvIG5vdCBsaXN0ZW4gZm9yIGBlcnJvcmAgZXZlbnRzIGhlcmUuXG4gICAgZW1pdHRlci5hZGRFdmVudExpc3RlbmVyKG5hbWUsIGZ1bmN0aW9uIHdyYXBMaXN0ZW5lcihhcmcpIHtcbiAgICAgIC8vIElFIGRvZXMgbm90IGhhdmUgYnVpbHRpbiBgeyBvbmNlOiB0cnVlIH1gIHN1cHBvcnQgc28gd2VcbiAgICAgIC8vIGhhdmUgdG8gZG8gaXQgbWFudWFsbHkuXG4gICAgICBpZiAoZmxhZ3Mub25jZSkge1xuICAgICAgICBlbWl0dGVyLnJlbW92ZUV2ZW50TGlzdGVuZXIobmFtZSwgd3JhcExpc3RlbmVyKTtcbiAgICAgIH1cbiAgICAgIGxpc3RlbmVyKGFyZyk7XG4gICAgfSk7XG4gIH0gZWxzZSB7XG4gICAgdGhyb3cgbmV3IFR5cGVFcnJvcignVGhlIFwiZW1pdHRlclwiIGFyZ3VtZW50IG11c3QgYmUgb2YgdHlwZSBFdmVudEVtaXR0ZXIuIFJlY2VpdmVkIHR5cGUgJyArIHR5cGVvZiBlbWl0dGVyKTtcbiAgfVxufVxuIiwiZXhwb3J0IHsgZGVmYXVsdCBhcyB2MSB9IGZyb20gJy4vdjEuanMnO1xuZXhwb3J0IHsgZGVmYXVsdCBhcyB2MyB9IGZyb20gJy4vdjMuanMnO1xuZXhwb3J0IHsgZGVmYXVsdCBhcyB2NCB9IGZyb20gJy4vdjQuanMnO1xuZXhwb3J0IHsgZGVmYXVsdCBhcyB2NSB9IGZyb20gJy4vdjUuanMnO1xuZXhwb3J0IHsgZGVmYXVsdCBhcyBOSUwgfSBmcm9tICcuL25pbC5qcyc7XG5leHBvcnQgeyBkZWZhdWx0IGFzIHZlcnNpb24gfSBmcm9tICcuL3ZlcnNpb24uanMnO1xuZXhwb3J0IHsgZGVmYXVsdCBhcyB2YWxpZGF0ZSB9IGZyb20gJy4vdmFsaWRhdGUuanMnO1xuZXhwb3J0IHsgZGVmYXVsdCBhcyBzdHJpbmdpZnkgfSBmcm9tICcuL3N0cmluZ2lmeS5qcyc7XG5leHBvcnQgeyBkZWZhdWx0IGFzIHBhcnNlIH0gZnJvbSAnLi9wYXJzZS5qcyc7IiwiLypcbiAqIEJyb3dzZXItY29tcGF0aWJsZSBKYXZhU2NyaXB0IE1ENVxuICpcbiAqIE1vZGlmaWNhdGlvbiBvZiBKYXZhU2NyaXB0IE1ENVxuICogaHR0cHM6Ly9naXRodWIuY29tL2JsdWVpbXAvSmF2YVNjcmlwdC1NRDVcbiAqXG4gKiBDb3B5cmlnaHQgMjAxMSwgU2ViYXN0aWFuIFRzY2hhblxuICogaHR0cHM6Ly9ibHVlaW1wLm5ldFxuICpcbiAqIExpY2Vuc2VkIHVuZGVyIHRoZSBNSVQgbGljZW5zZTpcbiAqIGh0dHBzOi8vb3BlbnNvdXJjZS5vcmcvbGljZW5zZXMvTUlUXG4gKlxuICogQmFzZWQgb25cbiAqIEEgSmF2YVNjcmlwdCBpbXBsZW1lbnRhdGlvbiBvZiB0aGUgUlNBIERhdGEgU2VjdXJpdHksIEluYy4gTUQ1IE1lc3NhZ2VcbiAqIERpZ2VzdCBBbGdvcml0aG0sIGFzIGRlZmluZWQgaW4gUkZDIDEzMjEuXG4gKiBWZXJzaW9uIDIuMiBDb3B5cmlnaHQgKEMpIFBhdWwgSm9obnN0b24gMTk5OSAtIDIwMDlcbiAqIE90aGVyIGNvbnRyaWJ1dG9yczogR3JlZyBIb2x0LCBBbmRyZXcgS2VwZXJ0LCBZZG5hciwgTG9zdGluZXRcbiAqIERpc3RyaWJ1dGVkIHVuZGVyIHRoZSBCU0QgTGljZW5zZVxuICogU2VlIGh0dHA6Ly9wYWpob21lLm9yZy51ay9jcnlwdC9tZDUgZm9yIG1vcmUgaW5mby5cbiAqL1xuZnVuY3Rpb24gbWQ1KGJ5dGVzKSB7XG4gIGlmICh0eXBlb2YgYnl0ZXMgPT09ICdzdHJpbmcnKSB7XG4gICAgdmFyIG1zZyA9IHVuZXNjYXBlKGVuY29kZVVSSUNvbXBvbmVudChieXRlcykpOyAvLyBVVEY4IGVzY2FwZVxuXG4gICAgYnl0ZXMgPSBuZXcgVWludDhBcnJheShtc2cubGVuZ3RoKTtcblxuICAgIGZvciAodmFyIGkgPSAwOyBpIDwgbXNnLmxlbmd0aDsgKytpKSB7XG4gICAgICBieXRlc1tpXSA9IG1zZy5jaGFyQ29kZUF0KGkpO1xuICAgIH1cbiAgfVxuXG4gIHJldHVybiBtZDVUb0hleEVuY29kZWRBcnJheSh3b3Jkc1RvTWQ1KGJ5dGVzVG9Xb3JkcyhieXRlcyksIGJ5dGVzLmxlbmd0aCAqIDgpKTtcbn1cbi8qXG4gKiBDb252ZXJ0IGFuIGFycmF5IG9mIGxpdHRsZS1lbmRpYW4gd29yZHMgdG8gYW4gYXJyYXkgb2YgYnl0ZXNcbiAqL1xuXG5cbmZ1bmN0aW9uIG1kNVRvSGV4RW5jb2RlZEFycmF5KGlucHV0KSB7XG4gIHZhciBvdXRwdXQgPSBbXTtcbiAgdmFyIGxlbmd0aDMyID0gaW5wdXQubGVuZ3RoICogMzI7XG4gIHZhciBoZXhUYWIgPSAnMDEyMzQ1Njc4OWFiY2RlZic7XG5cbiAgZm9yICh2YXIgaSA9IDA7IGkgPCBsZW5ndGgzMjsgaSArPSA4KSB7XG4gICAgdmFyIHggPSBpbnB1dFtpID4+IDVdID4+PiBpICUgMzIgJiAweGZmO1xuICAgIHZhciBoZXggPSBwYXJzZUludChoZXhUYWIuY2hhckF0KHggPj4+IDQgJiAweDBmKSArIGhleFRhYi5jaGFyQXQoeCAmIDB4MGYpLCAxNik7XG4gICAgb3V0cHV0LnB1c2goaGV4KTtcbiAgfVxuXG4gIHJldHVybiBvdXRwdXQ7XG59XG4vKipcbiAqIENhbGN1bGF0ZSBvdXRwdXQgbGVuZ3RoIHdpdGggcGFkZGluZyBhbmQgYml0IGxlbmd0aFxuICovXG5cblxuZnVuY3Rpb24gZ2V0T3V0cHV0TGVuZ3RoKGlucHV0TGVuZ3RoOCkge1xuICByZXR1cm4gKGlucHV0TGVuZ3RoOCArIDY0ID4+PiA5IDw8IDQpICsgMTQgKyAxO1xufVxuLypcbiAqIENhbGN1bGF0ZSB0aGUgTUQ1IG9mIGFuIGFycmF5IG9mIGxpdHRsZS1lbmRpYW4gd29yZHMsIGFuZCBhIGJpdCBsZW5ndGguXG4gKi9cblxuXG5mdW5jdGlvbiB3b3Jkc1RvTWQ1KHgsIGxlbikge1xuICAvKiBhcHBlbmQgcGFkZGluZyAqL1xuICB4W2xlbiA+PiA1XSB8PSAweDgwIDw8IGxlbiAlIDMyO1xuICB4W2dldE91dHB1dExlbmd0aChsZW4pIC0gMV0gPSBsZW47XG4gIHZhciBhID0gMTczMjU4NDE5MztcbiAgdmFyIGIgPSAtMjcxNzMzODc5O1xuICB2YXIgYyA9IC0xNzMyNTg0MTk0O1xuICB2YXIgZCA9IDI3MTczMzg3ODtcblxuICBmb3IgKHZhciBpID0gMDsgaSA8IHgubGVuZ3RoOyBpICs9IDE2KSB7XG4gICAgdmFyIG9sZGEgPSBhO1xuICAgIHZhciBvbGRiID0gYjtcbiAgICB2YXIgb2xkYyA9IGM7XG4gICAgdmFyIG9sZGQgPSBkO1xuICAgIGEgPSBtZDVmZihhLCBiLCBjLCBkLCB4W2ldLCA3LCAtNjgwODc2OTM2KTtcbiAgICBkID0gbWQ1ZmYoZCwgYSwgYiwgYywgeFtpICsgMV0sIDEyLCAtMzg5NTY0NTg2KTtcbiAgICBjID0gbWQ1ZmYoYywgZCwgYSwgYiwgeFtpICsgMl0sIDE3LCA2MDYxMDU4MTkpO1xuICAgIGIgPSBtZDVmZihiLCBjLCBkLCBhLCB4W2kgKyAzXSwgMjIsIC0xMDQ0NTI1MzMwKTtcbiAgICBhID0gbWQ1ZmYoYSwgYiwgYywgZCwgeFtpICsgNF0sIDcsIC0xNzY0MTg4OTcpO1xuICAgIGQgPSBtZDVmZihkLCBhLCBiLCBjLCB4W2kgKyA1XSwgMTIsIDEyMDAwODA0MjYpO1xuICAgIGMgPSBtZDVmZihjLCBkLCBhLCBiLCB4W2kgKyA2XSwgMTcsIC0xNDczMjMxMzQxKTtcbiAgICBiID0gbWQ1ZmYoYiwgYywgZCwgYSwgeFtpICsgN10sIDIyLCAtNDU3MDU5ODMpO1xuICAgIGEgPSBtZDVmZihhLCBiLCBjLCBkLCB4W2kgKyA4XSwgNywgMTc3MDAzNTQxNik7XG4gICAgZCA9IG1kNWZmKGQsIGEsIGIsIGMsIHhbaSArIDldLCAxMiwgLTE5NTg0MTQ0MTcpO1xuICAgIGMgPSBtZDVmZihjLCBkLCBhLCBiLCB4W2kgKyAxMF0sIDE3LCAtNDIwNjMpO1xuICAgIGIgPSBtZDVmZihiLCBjLCBkLCBhLCB4W2kgKyAxMV0sIDIyLCAtMTk5MDQwNDE2Mik7XG4gICAgYSA9IG1kNWZmKGEsIGIsIGMsIGQsIHhbaSArIDEyXSwgNywgMTgwNDYwMzY4Mik7XG4gICAgZCA9IG1kNWZmKGQsIGEsIGIsIGMsIHhbaSArIDEzXSwgMTIsIC00MDM0MTEwMSk7XG4gICAgYyA9IG1kNWZmKGMsIGQsIGEsIGIsIHhbaSArIDE0XSwgMTcsIC0xNTAyMDAyMjkwKTtcbiAgICBiID0gbWQ1ZmYoYiwgYywgZCwgYSwgeFtpICsgMTVdLCAyMiwgMTIzNjUzNTMyOSk7XG4gICAgYSA9IG1kNWdnKGEsIGIsIGMsIGQsIHhbaSArIDFdLCA1LCAtMTY1Nzk2NTEwKTtcbiAgICBkID0gbWQ1Z2coZCwgYSwgYiwgYywgeFtpICsgNl0sIDksIC0xMDY5NTAxNjMyKTtcbiAgICBjID0gbWQ1Z2coYywgZCwgYSwgYiwgeFtpICsgMTFdLCAxNCwgNjQzNzE3NzEzKTtcbiAgICBiID0gbWQ1Z2coYiwgYywgZCwgYSwgeFtpXSwgMjAsIC0zNzM4OTczMDIpO1xuICAgIGEgPSBtZDVnZyhhLCBiLCBjLCBkLCB4W2kgKyA1XSwgNSwgLTcwMTU1ODY5MSk7XG4gICAgZCA9IG1kNWdnKGQsIGEsIGIsIGMsIHhbaSArIDEwXSwgOSwgMzgwMTYwODMpO1xuICAgIGMgPSBtZDVnZyhjLCBkLCBhLCBiLCB4W2kgKyAxNV0sIDE0LCAtNjYwNDc4MzM1KTtcbiAgICBiID0gbWQ1Z2coYiwgYywgZCwgYSwgeFtpICsgNF0sIDIwLCAtNDA1NTM3ODQ4KTtcbiAgICBhID0gbWQ1Z2coYSwgYiwgYywgZCwgeFtpICsgOV0sIDUsIDU2ODQ0NjQzOCk7XG4gICAgZCA9IG1kNWdnKGQsIGEsIGIsIGMsIHhbaSArIDE0XSwgOSwgLTEwMTk4MDM2OTApO1xuICAgIGMgPSBtZDVnZyhjLCBkLCBhLCBiLCB4W2kgKyAzXSwgMTQsIC0xODczNjM5NjEpO1xuICAgIGIgPSBtZDVnZyhiLCBjLCBkLCBhLCB4W2kgKyA4XSwgMjAsIDExNjM1MzE1MDEpO1xuICAgIGEgPSBtZDVnZyhhLCBiLCBjLCBkLCB4W2kgKyAxM10sIDUsIC0xNDQ0NjgxNDY3KTtcbiAgICBkID0gbWQ1Z2coZCwgYSwgYiwgYywgeFtpICsgMl0sIDksIC01MTQwMzc4NCk7XG4gICAgYyA9IG1kNWdnKGMsIGQsIGEsIGIsIHhbaSArIDddLCAxNCwgMTczNTMyODQ3Myk7XG4gICAgYiA9IG1kNWdnKGIsIGMsIGQsIGEsIHhbaSArIDEyXSwgMjAsIC0xOTI2NjA3NzM0KTtcbiAgICBhID0gbWQ1aGgoYSwgYiwgYywgZCwgeFtpICsgNV0sIDQsIC0zNzg1NTgpO1xuICAgIGQgPSBtZDVoaChkLCBhLCBiLCBjLCB4W2kgKyA4XSwgMTEsIC0yMDIyNTc0NDYzKTtcbiAgICBjID0gbWQ1aGgoYywgZCwgYSwgYiwgeFtpICsgMTFdLCAxNiwgMTgzOTAzMDU2Mik7XG4gICAgYiA9IG1kNWhoKGIsIGMsIGQsIGEsIHhbaSArIDE0XSwgMjMsIC0zNTMwOTU1Nik7XG4gICAgYSA9IG1kNWhoKGEsIGIsIGMsIGQsIHhbaSArIDFdLCA0LCAtMTUzMDk5MjA2MCk7XG4gICAgZCA9IG1kNWhoKGQsIGEsIGIsIGMsIHhbaSArIDRdLCAxMSwgMTI3Mjg5MzM1Myk7XG4gICAgYyA9IG1kNWhoKGMsIGQsIGEsIGIsIHhbaSArIDddLCAxNiwgLTE1NTQ5NzYzMik7XG4gICAgYiA9IG1kNWhoKGIsIGMsIGQsIGEsIHhbaSArIDEwXSwgMjMsIC0xMDk0NzMwNjQwKTtcbiAgICBhID0gbWQ1aGgoYSwgYiwgYywgZCwgeFtpICsgMTNdLCA0LCA2ODEyNzkxNzQpO1xuICAgIGQgPSBtZDVoaChkLCBhLCBiLCBjLCB4W2ldLCAxMSwgLTM1ODUzNzIyMik7XG4gICAgYyA9IG1kNWhoKGMsIGQsIGEsIGIsIHhbaSArIDNdLCAxNiwgLTcyMjUyMTk3OSk7XG4gICAgYiA9IG1kNWhoKGIsIGMsIGQsIGEsIHhbaSArIDZdLCAyMywgNzYwMjkxODkpO1xuICAgIGEgPSBtZDVoaChhLCBiLCBjLCBkLCB4W2kgKyA5XSwgNCwgLTY0MDM2NDQ4Nyk7XG4gICAgZCA9IG1kNWhoKGQsIGEsIGIsIGMsIHhbaSArIDEyXSwgMTEsIC00MjE4MTU4MzUpO1xuICAgIGMgPSBtZDVoaChjLCBkLCBhLCBiLCB4W2kgKyAxNV0sIDE2LCA1MzA3NDI1MjApO1xuICAgIGIgPSBtZDVoaChiLCBjLCBkLCBhLCB4W2kgKyAyXSwgMjMsIC05OTUzMzg2NTEpO1xuICAgIGEgPSBtZDVpaShhLCBiLCBjLCBkLCB4W2ldLCA2LCAtMTk4NjMwODQ0KTtcbiAgICBkID0gbWQ1aWkoZCwgYSwgYiwgYywgeFtpICsgN10sIDEwLCAxMTI2ODkxNDE1KTtcbiAgICBjID0gbWQ1aWkoYywgZCwgYSwgYiwgeFtpICsgMTRdLCAxNSwgLTE0MTYzNTQ5MDUpO1xuICAgIGIgPSBtZDVpaShiLCBjLCBkLCBhLCB4W2kgKyA1XSwgMjEsIC01NzQzNDA1NSk7XG4gICAgYSA9IG1kNWlpKGEsIGIsIGMsIGQsIHhbaSArIDEyXSwgNiwgMTcwMDQ4NTU3MSk7XG4gICAgZCA9IG1kNWlpKGQsIGEsIGIsIGMsIHhbaSArIDNdLCAxMCwgLTE4OTQ5ODY2MDYpO1xuICAgIGMgPSBtZDVpaShjLCBkLCBhLCBiLCB4W2kgKyAxMF0sIDE1LCAtMTA1MTUyMyk7XG4gICAgYiA9IG1kNWlpKGIsIGMsIGQsIGEsIHhbaSArIDFdLCAyMSwgLTIwNTQ5MjI3OTkpO1xuICAgIGEgPSBtZDVpaShhLCBiLCBjLCBkLCB4W2kgKyA4XSwgNiwgMTg3MzMxMzM1OSk7XG4gICAgZCA9IG1kNWlpKGQsIGEsIGIsIGMsIHhbaSArIDE1XSwgMTAsIC0zMDYxMTc0NCk7XG4gICAgYyA9IG1kNWlpKGMsIGQsIGEsIGIsIHhbaSArIDZdLCAxNSwgLTE1NjAxOTgzODApO1xuICAgIGIgPSBtZDVpaShiLCBjLCBkLCBhLCB4W2kgKyAxM10sIDIxLCAxMzA5MTUxNjQ5KTtcbiAgICBhID0gbWQ1aWkoYSwgYiwgYywgZCwgeFtpICsgNF0sIDYsIC0xNDU1MjMwNzApO1xuICAgIGQgPSBtZDVpaShkLCBhLCBiLCBjLCB4W2kgKyAxMV0sIDEwLCAtMTEyMDIxMDM3OSk7XG4gICAgYyA9IG1kNWlpKGMsIGQsIGEsIGIsIHhbaSArIDJdLCAxNSwgNzE4Nzg3MjU5KTtcbiAgICBiID0gbWQ1aWkoYiwgYywgZCwgYSwgeFtpICsgOV0sIDIxLCAtMzQzNDg1NTUxKTtcbiAgICBhID0gc2FmZUFkZChhLCBvbGRhKTtcbiAgICBiID0gc2FmZUFkZChiLCBvbGRiKTtcbiAgICBjID0gc2FmZUFkZChjLCBvbGRjKTtcbiAgICBkID0gc2FmZUFkZChkLCBvbGRkKTtcbiAgfVxuXG4gIHJldHVybiBbYSwgYiwgYywgZF07XG59XG4vKlxuICogQ29udmVydCBhbiBhcnJheSBieXRlcyB0byBhbiBhcnJheSBvZiBsaXR0bGUtZW5kaWFuIHdvcmRzXG4gKiBDaGFyYWN0ZXJzID4yNTUgaGF2ZSB0aGVpciBoaWdoLWJ5dGUgc2lsZW50bHkgaWdub3JlZC5cbiAqL1xuXG5cbmZ1bmN0aW9uIGJ5dGVzVG9Xb3JkcyhpbnB1dCkge1xuICBpZiAoaW5wdXQubGVuZ3RoID09PSAwKSB7XG4gICAgcmV0dXJuIFtdO1xuICB9XG5cbiAgdmFyIGxlbmd0aDggPSBpbnB1dC5sZW5ndGggKiA4O1xuICB2YXIgb3V0cHV0ID0gbmV3IFVpbnQzMkFycmF5KGdldE91dHB1dExlbmd0aChsZW5ndGg4KSk7XG5cbiAgZm9yICh2YXIgaSA9IDA7IGkgPCBsZW5ndGg4OyBpICs9IDgpIHtcbiAgICBvdXRwdXRbaSA+PiA1XSB8PSAoaW5wdXRbaSAvIDhdICYgMHhmZikgPDwgaSAlIDMyO1xuICB9XG5cbiAgcmV0dXJuIG91dHB1dDtcbn1cbi8qXG4gKiBBZGQgaW50ZWdlcnMsIHdyYXBwaW5nIGF0IDJeMzIuIFRoaXMgdXNlcyAxNi1iaXQgb3BlcmF0aW9ucyBpbnRlcm5hbGx5XG4gKiB0byB3b3JrIGFyb3VuZCBidWdzIGluIHNvbWUgSlMgaW50ZXJwcmV0ZXJzLlxuICovXG5cblxuZnVuY3Rpb24gc2FmZUFkZCh4LCB5KSB7XG4gIHZhciBsc3cgPSAoeCAmIDB4ZmZmZikgKyAoeSAmIDB4ZmZmZik7XG4gIHZhciBtc3cgPSAoeCA+PiAxNikgKyAoeSA+PiAxNikgKyAobHN3ID4+IDE2KTtcbiAgcmV0dXJuIG1zdyA8PCAxNiB8IGxzdyAmIDB4ZmZmZjtcbn1cbi8qXG4gKiBCaXR3aXNlIHJvdGF0ZSBhIDMyLWJpdCBudW1iZXIgdG8gdGhlIGxlZnQuXG4gKi9cblxuXG5mdW5jdGlvbiBiaXRSb3RhdGVMZWZ0KG51bSwgY250KSB7XG4gIHJldHVybiBudW0gPDwgY250IHwgbnVtID4+PiAzMiAtIGNudDtcbn1cbi8qXG4gKiBUaGVzZSBmdW5jdGlvbnMgaW1wbGVtZW50IHRoZSBmb3VyIGJhc2ljIG9wZXJhdGlvbnMgdGhlIGFsZ29yaXRobSB1c2VzLlxuICovXG5cblxuZnVuY3Rpb24gbWQ1Y21uKHEsIGEsIGIsIHgsIHMsIHQpIHtcbiAgcmV0dXJuIHNhZmVBZGQoYml0Um90YXRlTGVmdChzYWZlQWRkKHNhZmVBZGQoYSwgcSksIHNhZmVBZGQoeCwgdCkpLCBzKSwgYik7XG59XG5cbmZ1bmN0aW9uIG1kNWZmKGEsIGIsIGMsIGQsIHgsIHMsIHQpIHtcbiAgcmV0dXJuIG1kNWNtbihiICYgYyB8IH5iICYgZCwgYSwgYiwgeCwgcywgdCk7XG59XG5cbmZ1bmN0aW9uIG1kNWdnKGEsIGIsIGMsIGQsIHgsIHMsIHQpIHtcbiAgcmV0dXJuIG1kNWNtbihiICYgZCB8IGMgJiB+ZCwgYSwgYiwgeCwgcywgdCk7XG59XG5cbmZ1bmN0aW9uIG1kNWhoKGEsIGIsIGMsIGQsIHgsIHMsIHQpIHtcbiAgcmV0dXJuIG1kNWNtbihiIF4gYyBeIGQsIGEsIGIsIHgsIHMsIHQpO1xufVxuXG5mdW5jdGlvbiBtZDVpaShhLCBiLCBjLCBkLCB4LCBzLCB0KSB7XG4gIHJldHVybiBtZDVjbW4oYyBeIChiIHwgfmQpLCBhLCBiLCB4LCBzLCB0KTtcbn1cblxuZXhwb3J0IGRlZmF1bHQgbWQ1OyIsImV4cG9ydCBkZWZhdWx0ICcwMDAwMDAwMC0wMDAwLTAwMDAtMDAwMC0wMDAwMDAwMDAwMDAnOyIsImltcG9ydCB2YWxpZGF0ZSBmcm9tICcuL3ZhbGlkYXRlLmpzJztcblxuZnVuY3Rpb24gcGFyc2UodXVpZCkge1xuICBpZiAoIXZhbGlkYXRlKHV1aWQpKSB7XG4gICAgdGhyb3cgVHlwZUVycm9yKCdJbnZhbGlkIFVVSUQnKTtcbiAgfVxuXG4gIHZhciB2O1xuICB2YXIgYXJyID0gbmV3IFVpbnQ4QXJyYXkoMTYpOyAvLyBQYXJzZSAjIyMjIyMjIy0uLi4uLS4uLi4tLi4uLi0uLi4uLi4uLi4uLi5cblxuICBhcnJbMF0gPSAodiA9IHBhcnNlSW50KHV1aWQuc2xpY2UoMCwgOCksIDE2KSkgPj4+IDI0O1xuICBhcnJbMV0gPSB2ID4+PiAxNiAmIDB4ZmY7XG4gIGFyclsyXSA9IHYgPj4+IDggJiAweGZmO1xuICBhcnJbM10gPSB2ICYgMHhmZjsgLy8gUGFyc2UgLi4uLi4uLi4tIyMjIy0uLi4uLS4uLi4tLi4uLi4uLi4uLi4uXG5cbiAgYXJyWzRdID0gKHYgPSBwYXJzZUludCh1dWlkLnNsaWNlKDksIDEzKSwgMTYpKSA+Pj4gODtcbiAgYXJyWzVdID0gdiAmIDB4ZmY7IC8vIFBhcnNlIC4uLi4uLi4uLS4uLi4tIyMjIy0uLi4uLS4uLi4uLi4uLi4uLlxuXG4gIGFycls2XSA9ICh2ID0gcGFyc2VJbnQodXVpZC5zbGljZSgxNCwgMTgpLCAxNikpID4+PiA4O1xuICBhcnJbN10gPSB2ICYgMHhmZjsgLy8gUGFyc2UgLi4uLi4uLi4tLi4uLi0uLi4uLSMjIyMtLi4uLi4uLi4uLi4uXG5cbiAgYXJyWzhdID0gKHYgPSBwYXJzZUludCh1dWlkLnNsaWNlKDE5LCAyMyksIDE2KSkgPj4+IDg7XG4gIGFycls5XSA9IHYgJiAweGZmOyAvLyBQYXJzZSAuLi4uLi4uLi0uLi4uLS4uLi4tLi4uLi0jIyMjIyMjIyMjIyNcbiAgLy8gKFVzZSBcIi9cIiB0byBhdm9pZCAzMi1iaXQgdHJ1bmNhdGlvbiB3aGVuIGJpdC1zaGlmdGluZyBoaWdoLW9yZGVyIGJ5dGVzKVxuXG4gIGFyclsxMF0gPSAodiA9IHBhcnNlSW50KHV1aWQuc2xpY2UoMjQsIDM2KSwgMTYpKSAvIDB4MTAwMDAwMDAwMDAgJiAweGZmO1xuICBhcnJbMTFdID0gdiAvIDB4MTAwMDAwMDAwICYgMHhmZjtcbiAgYXJyWzEyXSA9IHYgPj4+IDI0ICYgMHhmZjtcbiAgYXJyWzEzXSA9IHYgPj4+IDE2ICYgMHhmZjtcbiAgYXJyWzE0XSA9IHYgPj4+IDggJiAweGZmO1xuICBhcnJbMTVdID0gdiAmIDB4ZmY7XG4gIHJldHVybiBhcnI7XG59XG5cbmV4cG9ydCBkZWZhdWx0IHBhcnNlOyIsImV4cG9ydCBkZWZhdWx0IC9eKD86WzAtOWEtZl17OH0tWzAtOWEtZl17NH0tWzEtNV1bMC05YS1mXXszfS1bODlhYl1bMC05YS1mXXszfS1bMC05YS1mXXsxMn18MDAwMDAwMDAtMDAwMC0wMDAwLTAwMDAtMDAwMDAwMDAwMDAwKSQvaTsiLCIvLyBVbmlxdWUgSUQgY3JlYXRpb24gcmVxdWlyZXMgYSBoaWdoIHF1YWxpdHkgcmFuZG9tICMgZ2VuZXJhdG9yLiBJbiB0aGUgYnJvd3NlciB3ZSB0aGVyZWZvcmVcbi8vIHJlcXVpcmUgdGhlIGNyeXB0byBBUEkgYW5kIGRvIG5vdCBzdXBwb3J0IGJ1aWx0LWluIGZhbGxiYWNrIHRvIGxvd2VyIHF1YWxpdHkgcmFuZG9tIG51bWJlclxuLy8gZ2VuZXJhdG9ycyAobGlrZSBNYXRoLnJhbmRvbSgpKS5cbnZhciBnZXRSYW5kb21WYWx1ZXM7XG52YXIgcm5kczggPSBuZXcgVWludDhBcnJheSgxNik7XG5leHBvcnQgZGVmYXVsdCBmdW5jdGlvbiBybmcoKSB7XG4gIC8vIGxhenkgbG9hZCBzbyB0aGF0IGVudmlyb25tZW50cyB0aGF0IG5lZWQgdG8gcG9seWZpbGwgaGF2ZSBhIGNoYW5jZSB0byBkbyBzb1xuICBpZiAoIWdldFJhbmRvbVZhbHVlcykge1xuICAgIC8vIGdldFJhbmRvbVZhbHVlcyBuZWVkcyB0byBiZSBpbnZva2VkIGluIGEgY29udGV4dCB3aGVyZSBcInRoaXNcIiBpcyBhIENyeXB0byBpbXBsZW1lbnRhdGlvbi4gQWxzbyxcbiAgICAvLyBmaW5kIHRoZSBjb21wbGV0ZSBpbXBsZW1lbnRhdGlvbiBvZiBjcnlwdG8gKG1zQ3J5cHRvKSBvbiBJRTExLlxuICAgIGdldFJhbmRvbVZhbHVlcyA9IHR5cGVvZiBjcnlwdG8gIT09ICd1bmRlZmluZWQnICYmIGNyeXB0by5nZXRSYW5kb21WYWx1ZXMgJiYgY3J5cHRvLmdldFJhbmRvbVZhbHVlcy5iaW5kKGNyeXB0bykgfHwgdHlwZW9mIG1zQ3J5cHRvICE9PSAndW5kZWZpbmVkJyAmJiB0eXBlb2YgbXNDcnlwdG8uZ2V0UmFuZG9tVmFsdWVzID09PSAnZnVuY3Rpb24nICYmIG1zQ3J5cHRvLmdldFJhbmRvbVZhbHVlcy5iaW5kKG1zQ3J5cHRvKTtcblxuICAgIGlmICghZ2V0UmFuZG9tVmFsdWVzKSB7XG4gICAgICB0aHJvdyBuZXcgRXJyb3IoJ2NyeXB0by5nZXRSYW5kb21WYWx1ZXMoKSBub3Qgc3VwcG9ydGVkLiBTZWUgaHR0cHM6Ly9naXRodWIuY29tL3V1aWRqcy91dWlkI2dldHJhbmRvbXZhbHVlcy1ub3Qtc3VwcG9ydGVkJyk7XG4gICAgfVxuICB9XG5cbiAgcmV0dXJuIGdldFJhbmRvbVZhbHVlcyhybmRzOCk7XG59IiwiLy8gQWRhcHRlZCBmcm9tIENocmlzIFZlbmVzcycgU0hBMSBjb2RlIGF0XG4vLyBodHRwOi8vd3d3Lm1vdmFibGUtdHlwZS5jby51ay9zY3JpcHRzL3NoYTEuaHRtbFxuZnVuY3Rpb24gZihzLCB4LCB5LCB6KSB7XG4gIHN3aXRjaCAocykge1xuICAgIGNhc2UgMDpcbiAgICAgIHJldHVybiB4ICYgeSBeIH54ICYgejtcblxuICAgIGNhc2UgMTpcbiAgICAgIHJldHVybiB4IF4geSBeIHo7XG5cbiAgICBjYXNlIDI6XG4gICAgICByZXR1cm4geCAmIHkgXiB4ICYgeiBeIHkgJiB6O1xuXG4gICAgY2FzZSAzOlxuICAgICAgcmV0dXJuIHggXiB5IF4gejtcbiAgfVxufVxuXG5mdW5jdGlvbiBST1RMKHgsIG4pIHtcbiAgcmV0dXJuIHggPDwgbiB8IHggPj4+IDMyIC0gbjtcbn1cblxuZnVuY3Rpb24gc2hhMShieXRlcykge1xuICB2YXIgSyA9IFsweDVhODI3OTk5LCAweDZlZDllYmExLCAweDhmMWJiY2RjLCAweGNhNjJjMWQ2XTtcbiAgdmFyIEggPSBbMHg2NzQ1MjMwMSwgMHhlZmNkYWI4OSwgMHg5OGJhZGNmZSwgMHgxMDMyNTQ3NiwgMHhjM2QyZTFmMF07XG5cbiAgaWYgKHR5cGVvZiBieXRlcyA9PT0gJ3N0cmluZycpIHtcbiAgICB2YXIgbXNnID0gdW5lc2NhcGUoZW5jb2RlVVJJQ29tcG9uZW50KGJ5dGVzKSk7IC8vIFVURjggZXNjYXBlXG5cbiAgICBieXRlcyA9IFtdO1xuXG4gICAgZm9yICh2YXIgaSA9IDA7IGkgPCBtc2cubGVuZ3RoOyArK2kpIHtcbiAgICAgIGJ5dGVzLnB1c2gobXNnLmNoYXJDb2RlQXQoaSkpO1xuICAgIH1cbiAgfSBlbHNlIGlmICghQXJyYXkuaXNBcnJheShieXRlcykpIHtcbiAgICAvLyBDb252ZXJ0IEFycmF5LWxpa2UgdG8gQXJyYXlcbiAgICBieXRlcyA9IEFycmF5LnByb3RvdHlwZS5zbGljZS5jYWxsKGJ5dGVzKTtcbiAgfVxuXG4gIGJ5dGVzLnB1c2goMHg4MCk7XG4gIHZhciBsID0gYnl0ZXMubGVuZ3RoIC8gNCArIDI7XG4gIHZhciBOID0gTWF0aC5jZWlsKGwgLyAxNik7XG4gIHZhciBNID0gbmV3IEFycmF5KE4pO1xuXG4gIGZvciAodmFyIF9pID0gMDsgX2kgPCBOOyArK19pKSB7XG4gICAgdmFyIGFyciA9IG5ldyBVaW50MzJBcnJheSgxNik7XG5cbiAgICBmb3IgKHZhciBqID0gMDsgaiA8IDE2OyArK2opIHtcbiAgICAgIGFycltqXSA9IGJ5dGVzW19pICogNjQgKyBqICogNF0gPDwgMjQgfCBieXRlc1tfaSAqIDY0ICsgaiAqIDQgKyAxXSA8PCAxNiB8IGJ5dGVzW19pICogNjQgKyBqICogNCArIDJdIDw8IDggfCBieXRlc1tfaSAqIDY0ICsgaiAqIDQgKyAzXTtcbiAgICB9XG5cbiAgICBNW19pXSA9IGFycjtcbiAgfVxuXG4gIE1bTiAtIDFdWzE0XSA9IChieXRlcy5sZW5ndGggLSAxKSAqIDggLyBNYXRoLnBvdygyLCAzMik7XG4gIE1bTiAtIDFdWzE0XSA9IE1hdGguZmxvb3IoTVtOIC0gMV1bMTRdKTtcbiAgTVtOIC0gMV1bMTVdID0gKGJ5dGVzLmxlbmd0aCAtIDEpICogOCAmIDB4ZmZmZmZmZmY7XG5cbiAgZm9yICh2YXIgX2kyID0gMDsgX2kyIDwgTjsgKytfaTIpIHtcbiAgICB2YXIgVyA9IG5ldyBVaW50MzJBcnJheSg4MCk7XG5cbiAgICBmb3IgKHZhciB0ID0gMDsgdCA8IDE2OyArK3QpIHtcbiAgICAgIFdbdF0gPSBNW19pMl1bdF07XG4gICAgfVxuXG4gICAgZm9yICh2YXIgX3QgPSAxNjsgX3QgPCA4MDsgKytfdCkge1xuICAgICAgV1tfdF0gPSBST1RMKFdbX3QgLSAzXSBeIFdbX3QgLSA4XSBeIFdbX3QgLSAxNF0gXiBXW190IC0gMTZdLCAxKTtcbiAgICB9XG5cbiAgICB2YXIgYSA9IEhbMF07XG4gICAgdmFyIGIgPSBIWzFdO1xuICAgIHZhciBjID0gSFsyXTtcbiAgICB2YXIgZCA9IEhbM107XG4gICAgdmFyIGUgPSBIWzRdO1xuXG4gICAgZm9yICh2YXIgX3QyID0gMDsgX3QyIDwgODA7ICsrX3QyKSB7XG4gICAgICB2YXIgcyA9IE1hdGguZmxvb3IoX3QyIC8gMjApO1xuICAgICAgdmFyIFQgPSBST1RMKGEsIDUpICsgZihzLCBiLCBjLCBkKSArIGUgKyBLW3NdICsgV1tfdDJdID4+PiAwO1xuICAgICAgZSA9IGQ7XG4gICAgICBkID0gYztcbiAgICAgIGMgPSBST1RMKGIsIDMwKSA+Pj4gMDtcbiAgICAgIGIgPSBhO1xuICAgICAgYSA9IFQ7XG4gICAgfVxuXG4gICAgSFswXSA9IEhbMF0gKyBhID4+PiAwO1xuICAgIEhbMV0gPSBIWzFdICsgYiA+Pj4gMDtcbiAgICBIWzJdID0gSFsyXSArIGMgPj4+IDA7XG4gICAgSFszXSA9IEhbM10gKyBkID4+PiAwO1xuICAgIEhbNF0gPSBIWzRdICsgZSA+Pj4gMDtcbiAgfVxuXG4gIHJldHVybiBbSFswXSA+PiAyNCAmIDB4ZmYsIEhbMF0gPj4gMTYgJiAweGZmLCBIWzBdID4+IDggJiAweGZmLCBIWzBdICYgMHhmZiwgSFsxXSA+PiAyNCAmIDB4ZmYsIEhbMV0gPj4gMTYgJiAweGZmLCBIWzFdID4+IDggJiAweGZmLCBIWzFdICYgMHhmZiwgSFsyXSA+PiAyNCAmIDB4ZmYsIEhbMl0gPj4gMTYgJiAweGZmLCBIWzJdID4+IDggJiAweGZmLCBIWzJdICYgMHhmZiwgSFszXSA+PiAyNCAmIDB4ZmYsIEhbM10gPj4gMTYgJiAweGZmLCBIWzNdID4+IDggJiAweGZmLCBIWzNdICYgMHhmZiwgSFs0XSA+PiAyNCAmIDB4ZmYsIEhbNF0gPj4gMTYgJiAweGZmLCBIWzRdID4+IDggJiAweGZmLCBIWzRdICYgMHhmZl07XG59XG5cbmV4cG9ydCBkZWZhdWx0IHNoYTE7IiwiaW1wb3J0IHZhbGlkYXRlIGZyb20gJy4vdmFsaWRhdGUuanMnO1xuLyoqXG4gKiBDb252ZXJ0IGFycmF5IG9mIDE2IGJ5dGUgdmFsdWVzIHRvIFVVSUQgc3RyaW5nIGZvcm1hdCBvZiB0aGUgZm9ybTpcbiAqIFhYWFhYWFhYLVhYWFgtWFhYWC1YWFhYLVhYWFhYWFhYWFhYWFxuICovXG5cbnZhciBieXRlVG9IZXggPSBbXTtcblxuZm9yICh2YXIgaSA9IDA7IGkgPCAyNTY7ICsraSkge1xuICBieXRlVG9IZXgucHVzaCgoaSArIDB4MTAwKS50b1N0cmluZygxNikuc3Vic3RyKDEpKTtcbn1cblxuZnVuY3Rpb24gc3RyaW5naWZ5KGFycikge1xuICB2YXIgb2Zmc2V0ID0gYXJndW1lbnRzLmxlbmd0aCA+IDEgJiYgYXJndW1lbnRzWzFdICE9PSB1bmRlZmluZWQgPyBhcmd1bWVudHNbMV0gOiAwO1xuICAvLyBOb3RlOiBCZSBjYXJlZnVsIGVkaXRpbmcgdGhpcyBjb2RlISAgSXQncyBiZWVuIHR1bmVkIGZvciBwZXJmb3JtYW5jZVxuICAvLyBhbmQgd29ya3MgaW4gd2F5cyB5b3UgbWF5IG5vdCBleHBlY3QuIFNlZSBodHRwczovL2dpdGh1Yi5jb20vdXVpZGpzL3V1aWQvcHVsbC80MzRcbiAgdmFyIHV1aWQgPSAoYnl0ZVRvSGV4W2FycltvZmZzZXQgKyAwXV0gKyBieXRlVG9IZXhbYXJyW29mZnNldCArIDFdXSArIGJ5dGVUb0hleFthcnJbb2Zmc2V0ICsgMl1dICsgYnl0ZVRvSGV4W2FycltvZmZzZXQgKyAzXV0gKyAnLScgKyBieXRlVG9IZXhbYXJyW29mZnNldCArIDRdXSArIGJ5dGVUb0hleFthcnJbb2Zmc2V0ICsgNV1dICsgJy0nICsgYnl0ZVRvSGV4W2FycltvZmZzZXQgKyA2XV0gKyBieXRlVG9IZXhbYXJyW29mZnNldCArIDddXSArICctJyArIGJ5dGVUb0hleFthcnJbb2Zmc2V0ICsgOF1dICsgYnl0ZVRvSGV4W2FycltvZmZzZXQgKyA5XV0gKyAnLScgKyBieXRlVG9IZXhbYXJyW29mZnNldCArIDEwXV0gKyBieXRlVG9IZXhbYXJyW29mZnNldCArIDExXV0gKyBieXRlVG9IZXhbYXJyW29mZnNldCArIDEyXV0gKyBieXRlVG9IZXhbYXJyW29mZnNldCArIDEzXV0gKyBieXRlVG9IZXhbYXJyW29mZnNldCArIDE0XV0gKyBieXRlVG9IZXhbYXJyW29mZnNldCArIDE1XV0pLnRvTG93ZXJDYXNlKCk7IC8vIENvbnNpc3RlbmN5IGNoZWNrIGZvciB2YWxpZCBVVUlELiAgSWYgdGhpcyB0aHJvd3MsIGl0J3MgbGlrZWx5IGR1ZSB0byBvbmVcbiAgLy8gb2YgdGhlIGZvbGxvd2luZzpcbiAgLy8gLSBPbmUgb3IgbW9yZSBpbnB1dCBhcnJheSB2YWx1ZXMgZG9uJ3QgbWFwIHRvIGEgaGV4IG9jdGV0IChsZWFkaW5nIHRvXG4gIC8vIFwidW5kZWZpbmVkXCIgaW4gdGhlIHV1aWQpXG4gIC8vIC0gSW52YWxpZCBpbnB1dCB2YWx1ZXMgZm9yIHRoZSBSRkMgYHZlcnNpb25gIG9yIGB2YXJpYW50YCBmaWVsZHNcblxuICBpZiAoIXZhbGlkYXRlKHV1aWQpKSB7XG4gICAgdGhyb3cgVHlwZUVycm9yKCdTdHJpbmdpZmllZCBVVUlEIGlzIGludmFsaWQnKTtcbiAgfVxuXG4gIHJldHVybiB1dWlkO1xufVxuXG5leHBvcnQgZGVmYXVsdCBzdHJpbmdpZnk7IiwiaW1wb3J0IHJuZyBmcm9tICcuL3JuZy5qcyc7XG5pbXBvcnQgc3RyaW5naWZ5IGZyb20gJy4vc3RyaW5naWZ5LmpzJzsgLy8gKipgdjEoKWAgLSBHZW5lcmF0ZSB0aW1lLWJhc2VkIFVVSUQqKlxuLy9cbi8vIEluc3BpcmVkIGJ5IGh0dHBzOi8vZ2l0aHViLmNvbS9MaW9zSy9VVUlELmpzXG4vLyBhbmQgaHR0cDovL2RvY3MucHl0aG9uLm9yZy9saWJyYXJ5L3V1aWQuaHRtbFxuXG52YXIgX25vZGVJZDtcblxudmFyIF9jbG9ja3NlcTsgLy8gUHJldmlvdXMgdXVpZCBjcmVhdGlvbiB0aW1lXG5cblxudmFyIF9sYXN0TVNlY3MgPSAwO1xudmFyIF9sYXN0TlNlY3MgPSAwOyAvLyBTZWUgaHR0cHM6Ly9naXRodWIuY29tL3V1aWRqcy91dWlkIGZvciBBUEkgZGV0YWlsc1xuXG5mdW5jdGlvbiB2MShvcHRpb25zLCBidWYsIG9mZnNldCkge1xuICB2YXIgaSA9IGJ1ZiAmJiBvZmZzZXQgfHwgMDtcbiAgdmFyIGIgPSBidWYgfHwgbmV3IEFycmF5KDE2KTtcbiAgb3B0aW9ucyA9IG9wdGlvbnMgfHwge307XG4gIHZhciBub2RlID0gb3B0aW9ucy5ub2RlIHx8IF9ub2RlSWQ7XG4gIHZhciBjbG9ja3NlcSA9IG9wdGlvbnMuY2xvY2tzZXEgIT09IHVuZGVmaW5lZCA/IG9wdGlvbnMuY2xvY2tzZXEgOiBfY2xvY2tzZXE7IC8vIG5vZGUgYW5kIGNsb2Nrc2VxIG5lZWQgdG8gYmUgaW5pdGlhbGl6ZWQgdG8gcmFuZG9tIHZhbHVlcyBpZiB0aGV5J3JlIG5vdFxuICAvLyBzcGVjaWZpZWQuICBXZSBkbyB0aGlzIGxhemlseSB0byBtaW5pbWl6ZSBpc3N1ZXMgcmVsYXRlZCB0byBpbnN1ZmZpY2llbnRcbiAgLy8gc3lzdGVtIGVudHJvcHkuICBTZWUgIzE4OVxuXG4gIGlmIChub2RlID09IG51bGwgfHwgY2xvY2tzZXEgPT0gbnVsbCkge1xuICAgIHZhciBzZWVkQnl0ZXMgPSBvcHRpb25zLnJhbmRvbSB8fCAob3B0aW9ucy5ybmcgfHwgcm5nKSgpO1xuXG4gICAgaWYgKG5vZGUgPT0gbnVsbCkge1xuICAgICAgLy8gUGVyIDQuNSwgY3JlYXRlIGFuZCA0OC1iaXQgbm9kZSBpZCwgKDQ3IHJhbmRvbSBiaXRzICsgbXVsdGljYXN0IGJpdCA9IDEpXG4gICAgICBub2RlID0gX25vZGVJZCA9IFtzZWVkQnl0ZXNbMF0gfCAweDAxLCBzZWVkQnl0ZXNbMV0sIHNlZWRCeXRlc1syXSwgc2VlZEJ5dGVzWzNdLCBzZWVkQnl0ZXNbNF0sIHNlZWRCeXRlc1s1XV07XG4gICAgfVxuXG4gICAgaWYgKGNsb2Nrc2VxID09IG51bGwpIHtcbiAgICAgIC8vIFBlciA0LjIuMiwgcmFuZG9taXplICgxNCBiaXQpIGNsb2Nrc2VxXG4gICAgICBjbG9ja3NlcSA9IF9jbG9ja3NlcSA9IChzZWVkQnl0ZXNbNl0gPDwgOCB8IHNlZWRCeXRlc1s3XSkgJiAweDNmZmY7XG4gICAgfVxuICB9IC8vIFVVSUQgdGltZXN0YW1wcyBhcmUgMTAwIG5hbm8tc2Vjb25kIHVuaXRzIHNpbmNlIHRoZSBHcmVnb3JpYW4gZXBvY2gsXG4gIC8vICgxNTgyLTEwLTE1IDAwOjAwKS4gIEpTTnVtYmVycyBhcmVuJ3QgcHJlY2lzZSBlbm91Z2ggZm9yIHRoaXMsIHNvXG4gIC8vIHRpbWUgaXMgaGFuZGxlZCBpbnRlcm5hbGx5IGFzICdtc2VjcycgKGludGVnZXIgbWlsbGlzZWNvbmRzKSBhbmQgJ25zZWNzJ1xuICAvLyAoMTAwLW5hbm9zZWNvbmRzIG9mZnNldCBmcm9tIG1zZWNzKSBzaW5jZSB1bml4IGVwb2NoLCAxOTcwLTAxLTAxIDAwOjAwLlxuXG5cbiAgdmFyIG1zZWNzID0gb3B0aW9ucy5tc2VjcyAhPT0gdW5kZWZpbmVkID8gb3B0aW9ucy5tc2VjcyA6IERhdGUubm93KCk7IC8vIFBlciA0LjIuMS4yLCB1c2UgY291bnQgb2YgdXVpZCdzIGdlbmVyYXRlZCBkdXJpbmcgdGhlIGN1cnJlbnQgY2xvY2tcbiAgLy8gY3ljbGUgdG8gc2ltdWxhdGUgaGlnaGVyIHJlc29sdXRpb24gY2xvY2tcblxuICB2YXIgbnNlY3MgPSBvcHRpb25zLm5zZWNzICE9PSB1bmRlZmluZWQgPyBvcHRpb25zLm5zZWNzIDogX2xhc3ROU2VjcyArIDE7IC8vIFRpbWUgc2luY2UgbGFzdCB1dWlkIGNyZWF0aW9uIChpbiBtc2VjcylcblxuICB2YXIgZHQgPSBtc2VjcyAtIF9sYXN0TVNlY3MgKyAobnNlY3MgLSBfbGFzdE5TZWNzKSAvIDEwMDAwOyAvLyBQZXIgNC4yLjEuMiwgQnVtcCBjbG9ja3NlcSBvbiBjbG9jayByZWdyZXNzaW9uXG5cbiAgaWYgKGR0IDwgMCAmJiBvcHRpb25zLmNsb2Nrc2VxID09PSB1bmRlZmluZWQpIHtcbiAgICBjbG9ja3NlcSA9IGNsb2Nrc2VxICsgMSAmIDB4M2ZmZjtcbiAgfSAvLyBSZXNldCBuc2VjcyBpZiBjbG9jayByZWdyZXNzZXMgKG5ldyBjbG9ja3NlcSkgb3Igd2UndmUgbW92ZWQgb250byBhIG5ld1xuICAvLyB0aW1lIGludGVydmFsXG5cblxuICBpZiAoKGR0IDwgMCB8fCBtc2VjcyA+IF9sYXN0TVNlY3MpICYmIG9wdGlvbnMubnNlY3MgPT09IHVuZGVmaW5lZCkge1xuICAgIG5zZWNzID0gMDtcbiAgfSAvLyBQZXIgNC4yLjEuMiBUaHJvdyBlcnJvciBpZiB0b28gbWFueSB1dWlkcyBhcmUgcmVxdWVzdGVkXG5cblxuICBpZiAobnNlY3MgPj0gMTAwMDApIHtcbiAgICB0aHJvdyBuZXcgRXJyb3IoXCJ1dWlkLnYxKCk6IENhbid0IGNyZWF0ZSBtb3JlIHRoYW4gMTBNIHV1aWRzL3NlY1wiKTtcbiAgfVxuXG4gIF9sYXN0TVNlY3MgPSBtc2VjcztcbiAgX2xhc3ROU2VjcyA9IG5zZWNzO1xuICBfY2xvY2tzZXEgPSBjbG9ja3NlcTsgLy8gUGVyIDQuMS40IC0gQ29udmVydCBmcm9tIHVuaXggZXBvY2ggdG8gR3JlZ29yaWFuIGVwb2NoXG5cbiAgbXNlY3MgKz0gMTIyMTkyOTI4MDAwMDA7IC8vIGB0aW1lX2xvd2BcblxuICB2YXIgdGwgPSAoKG1zZWNzICYgMHhmZmZmZmZmKSAqIDEwMDAwICsgbnNlY3MpICUgMHgxMDAwMDAwMDA7XG4gIGJbaSsrXSA9IHRsID4+PiAyNCAmIDB4ZmY7XG4gIGJbaSsrXSA9IHRsID4+PiAxNiAmIDB4ZmY7XG4gIGJbaSsrXSA9IHRsID4+PiA4ICYgMHhmZjtcbiAgYltpKytdID0gdGwgJiAweGZmOyAvLyBgdGltZV9taWRgXG5cbiAgdmFyIHRtaCA9IG1zZWNzIC8gMHgxMDAwMDAwMDAgKiAxMDAwMCAmIDB4ZmZmZmZmZjtcbiAgYltpKytdID0gdG1oID4+PiA4ICYgMHhmZjtcbiAgYltpKytdID0gdG1oICYgMHhmZjsgLy8gYHRpbWVfaGlnaF9hbmRfdmVyc2lvbmBcblxuICBiW2krK10gPSB0bWggPj4+IDI0ICYgMHhmIHwgMHgxMDsgLy8gaW5jbHVkZSB2ZXJzaW9uXG5cbiAgYltpKytdID0gdG1oID4+PiAxNiAmIDB4ZmY7IC8vIGBjbG9ja19zZXFfaGlfYW5kX3Jlc2VydmVkYCAoUGVyIDQuMi4yIC0gaW5jbHVkZSB2YXJpYW50KVxuXG4gIGJbaSsrXSA9IGNsb2Nrc2VxID4+PiA4IHwgMHg4MDsgLy8gYGNsb2NrX3NlcV9sb3dgXG5cbiAgYltpKytdID0gY2xvY2tzZXEgJiAweGZmOyAvLyBgbm9kZWBcblxuICBmb3IgKHZhciBuID0gMDsgbiA8IDY7ICsrbikge1xuICAgIGJbaSArIG5dID0gbm9kZVtuXTtcbiAgfVxuXG4gIHJldHVybiBidWYgfHwgc3RyaW5naWZ5KGIpO1xufVxuXG5leHBvcnQgZGVmYXVsdCB2MTsiLCJpbXBvcnQgdjM1IGZyb20gJy4vdjM1LmpzJztcbmltcG9ydCBtZDUgZnJvbSAnLi9tZDUuanMnO1xudmFyIHYzID0gdjM1KCd2MycsIDB4MzAsIG1kNSk7XG5leHBvcnQgZGVmYXVsdCB2MzsiLCJpbXBvcnQgc3RyaW5naWZ5IGZyb20gJy4vc3RyaW5naWZ5LmpzJztcbmltcG9ydCBwYXJzZSBmcm9tICcuL3BhcnNlLmpzJztcblxuZnVuY3Rpb24gc3RyaW5nVG9CeXRlcyhzdHIpIHtcbiAgc3RyID0gdW5lc2NhcGUoZW5jb2RlVVJJQ29tcG9uZW50KHN0cikpOyAvLyBVVEY4IGVzY2FwZVxuXG4gIHZhciBieXRlcyA9IFtdO1xuXG4gIGZvciAodmFyIGkgPSAwOyBpIDwgc3RyLmxlbmd0aDsgKytpKSB7XG4gICAgYnl0ZXMucHVzaChzdHIuY2hhckNvZGVBdChpKSk7XG4gIH1cblxuICByZXR1cm4gYnl0ZXM7XG59XG5cbmV4cG9ydCB2YXIgRE5TID0gJzZiYTdiODEwLTlkYWQtMTFkMS04MGI0LTAwYzA0ZmQ0MzBjOCc7XG5leHBvcnQgdmFyIFVSTCA9ICc2YmE3YjgxMS05ZGFkLTExZDEtODBiNC0wMGMwNGZkNDMwYzgnO1xuZXhwb3J0IGRlZmF1bHQgZnVuY3Rpb24gKG5hbWUsIHZlcnNpb24sIGhhc2hmdW5jKSB7XG4gIGZ1bmN0aW9uIGdlbmVyYXRlVVVJRCh2YWx1ZSwgbmFtZXNwYWNlLCBidWYsIG9mZnNldCkge1xuICAgIGlmICh0eXBlb2YgdmFsdWUgPT09ICdzdHJpbmcnKSB7XG4gICAgICB2YWx1ZSA9IHN0cmluZ1RvQnl0ZXModmFsdWUpO1xuICAgIH1cblxuICAgIGlmICh0eXBlb2YgbmFtZXNwYWNlID09PSAnc3RyaW5nJykge1xuICAgICAgbmFtZXNwYWNlID0gcGFyc2UobmFtZXNwYWNlKTtcbiAgICB9XG5cbiAgICBpZiAobmFtZXNwYWNlLmxlbmd0aCAhPT0gMTYpIHtcbiAgICAgIHRocm93IFR5cGVFcnJvcignTmFtZXNwYWNlIG11c3QgYmUgYXJyYXktbGlrZSAoMTYgaXRlcmFibGUgaW50ZWdlciB2YWx1ZXMsIDAtMjU1KScpO1xuICAgIH0gLy8gQ29tcHV0ZSBoYXNoIG9mIG5hbWVzcGFjZSBhbmQgdmFsdWUsIFBlciA0LjNcbiAgICAvLyBGdXR1cmU6IFVzZSBzcHJlYWQgc3ludGF4IHdoZW4gc3VwcG9ydGVkIG9uIGFsbCBwbGF0Zm9ybXMsIGUuZy4gYGJ5dGVzID1cbiAgICAvLyBoYXNoZnVuYyhbLi4ubmFtZXNwYWNlLCAuLi4gdmFsdWVdKWBcblxuXG4gICAgdmFyIGJ5dGVzID0gbmV3IFVpbnQ4QXJyYXkoMTYgKyB2YWx1ZS5sZW5ndGgpO1xuICAgIGJ5dGVzLnNldChuYW1lc3BhY2UpO1xuICAgIGJ5dGVzLnNldCh2YWx1ZSwgbmFtZXNwYWNlLmxlbmd0aCk7XG4gICAgYnl0ZXMgPSBoYXNoZnVuYyhieXRlcyk7XG4gICAgYnl0ZXNbNl0gPSBieXRlc1s2XSAmIDB4MGYgfCB2ZXJzaW9uO1xuICAgIGJ5dGVzWzhdID0gYnl0ZXNbOF0gJiAweDNmIHwgMHg4MDtcblxuICAgIGlmIChidWYpIHtcbiAgICAgIG9mZnNldCA9IG9mZnNldCB8fCAwO1xuXG4gICAgICBmb3IgKHZhciBpID0gMDsgaSA8IDE2OyArK2kpIHtcbiAgICAgICAgYnVmW29mZnNldCArIGldID0gYnl0ZXNbaV07XG4gICAgICB9XG5cbiAgICAgIHJldHVybiBidWY7XG4gICAgfVxuXG4gICAgcmV0dXJuIHN0cmluZ2lmeShieXRlcyk7XG4gIH0gLy8gRnVuY3Rpb24jbmFtZSBpcyBub3Qgc2V0dGFibGUgb24gc29tZSBwbGF0Zm9ybXMgKCMyNzApXG5cblxuICB0cnkge1xuICAgIGdlbmVyYXRlVVVJRC5uYW1lID0gbmFtZTsgLy8gZXNsaW50LWRpc2FibGUtbmV4dC1saW5lIG5vLWVtcHR5XG4gIH0gY2F0Y2ggKGVycikge30gLy8gRm9yIENvbW1vbkpTIGRlZmF1bHQgZXhwb3J0IHN1cHBvcnRcblxuXG4gIGdlbmVyYXRlVVVJRC5ETlMgPSBETlM7XG4gIGdlbmVyYXRlVVVJRC5VUkwgPSBVUkw7XG4gIHJldHVybiBnZW5lcmF0ZVVVSUQ7XG59IiwiaW1wb3J0IHJuZyBmcm9tICcuL3JuZy5qcyc7XG5pbXBvcnQgc3RyaW5naWZ5IGZyb20gJy4vc3RyaW5naWZ5LmpzJztcblxuZnVuY3Rpb24gdjQob3B0aW9ucywgYnVmLCBvZmZzZXQpIHtcbiAgb3B0aW9ucyA9IG9wdGlvbnMgfHwge307XG4gIHZhciBybmRzID0gb3B0aW9ucy5yYW5kb20gfHwgKG9wdGlvbnMucm5nIHx8IHJuZykoKTsgLy8gUGVyIDQuNCwgc2V0IGJpdHMgZm9yIHZlcnNpb24gYW5kIGBjbG9ja19zZXFfaGlfYW5kX3Jlc2VydmVkYFxuXG4gIHJuZHNbNl0gPSBybmRzWzZdICYgMHgwZiB8IDB4NDA7XG4gIHJuZHNbOF0gPSBybmRzWzhdICYgMHgzZiB8IDB4ODA7IC8vIENvcHkgYnl0ZXMgdG8gYnVmZmVyLCBpZiBwcm92aWRlZFxuXG4gIGlmIChidWYpIHtcbiAgICBvZmZzZXQgPSBvZmZzZXQgfHwgMDtcblxuICAgIGZvciAodmFyIGkgPSAwOyBpIDwgMTY7ICsraSkge1xuICAgICAgYnVmW29mZnNldCArIGldID0gcm5kc1tpXTtcbiAgICB9XG5cbiAgICByZXR1cm4gYnVmO1xuICB9XG5cbiAgcmV0dXJuIHN0cmluZ2lmeShybmRzKTtcbn1cblxuZXhwb3J0IGRlZmF1bHQgdjQ7IiwiaW1wb3J0IHYzNSBmcm9tICcuL3YzNS5qcyc7XG5pbXBvcnQgc2hhMSBmcm9tICcuL3NoYTEuanMnO1xudmFyIHY1ID0gdjM1KCd2NScsIDB4NTAsIHNoYTEpO1xuZXhwb3J0IGRlZmF1bHQgdjU7IiwiaW1wb3J0IFJFR0VYIGZyb20gJy4vcmVnZXguanMnO1xuXG5mdW5jdGlvbiB2YWxpZGF0ZSh1dWlkKSB7XG4gIHJldHVybiB0eXBlb2YgdXVpZCA9PT0gJ3N0cmluZycgJiYgUkVHRVgudGVzdCh1dWlkKTtcbn1cblxuZXhwb3J0IGRlZmF1bHQgdmFsaWRhdGU7IiwiaW1wb3J0IHZhbGlkYXRlIGZyb20gJy4vdmFsaWRhdGUuanMnO1xuXG5mdW5jdGlvbiB2ZXJzaW9uKHV1aWQpIHtcbiAgaWYgKCF2YWxpZGF0ZSh1dWlkKSkge1xuICAgIHRocm93IFR5cGVFcnJvcignSW52YWxpZCBVVUlEJyk7XG4gIH1cblxuICByZXR1cm4gcGFyc2VJbnQodXVpZC5zdWJzdHIoMTQsIDEpLCAxNik7XG59XG5cbmV4cG9ydCBkZWZhdWx0IHZlcnNpb247IiwiLy8gVGhlIG1vZHVsZSBjYWNoZVxudmFyIF9fd2VicGFja19tb2R1bGVfY2FjaGVfXyA9IHt9O1xuXG4vLyBUaGUgcmVxdWlyZSBmdW5jdGlvblxuZnVuY3Rpb24gX193ZWJwYWNrX3JlcXVpcmVfXyhtb2R1bGVJZCkge1xuXHQvLyBDaGVjayBpZiBtb2R1bGUgaXMgaW4gY2FjaGVcblx0dmFyIGNhY2hlZE1vZHVsZSA9IF9fd2VicGFja19tb2R1bGVfY2FjaGVfX1ttb2R1bGVJZF07XG5cdGlmIChjYWNoZWRNb2R1bGUgIT09IHVuZGVmaW5lZCkge1xuXHRcdHJldHVybiBjYWNoZWRNb2R1bGUuZXhwb3J0cztcblx0fVxuXHQvLyBDcmVhdGUgYSBuZXcgbW9kdWxlIChhbmQgcHV0IGl0IGludG8gdGhlIGNhY2hlKVxuXHR2YXIgbW9kdWxlID0gX193ZWJwYWNrX21vZHVsZV9jYWNoZV9fW21vZHVsZUlkXSA9IHtcblx0XHQvLyBubyBtb2R1bGUuaWQgbmVlZGVkXG5cdFx0Ly8gbm8gbW9kdWxlLmxvYWRlZCBuZWVkZWRcblx0XHRleHBvcnRzOiB7fVxuXHR9O1xuXG5cdC8vIEV4ZWN1dGUgdGhlIG1vZHVsZSBmdW5jdGlvblxuXHRfX3dlYnBhY2tfbW9kdWxlc19fW21vZHVsZUlkXShtb2R1bGUsIG1vZHVsZS5leHBvcnRzLCBfX3dlYnBhY2tfcmVxdWlyZV9fKTtcblxuXHQvLyBSZXR1cm4gdGhlIGV4cG9ydHMgb2YgdGhlIG1vZHVsZVxuXHRyZXR1cm4gbW9kdWxlLmV4cG9ydHM7XG59XG5cbiIsIi8vIGRlZmluZSBnZXR0ZXIgZnVuY3Rpb25zIGZvciBoYXJtb255IGV4cG9ydHNcbl9fd2VicGFja19yZXF1aXJlX18uZCA9IChleHBvcnRzLCBkZWZpbml0aW9uKSA9PiB7XG5cdGZvcih2YXIga2V5IGluIGRlZmluaXRpb24pIHtcblx0XHRpZihfX3dlYnBhY2tfcmVxdWlyZV9fLm8oZGVmaW5pdGlvbiwga2V5KSAmJiAhX193ZWJwYWNrX3JlcXVpcmVfXy5vKGV4cG9ydHMsIGtleSkpIHtcblx0XHRcdE9iamVjdC5kZWZpbmVQcm9wZXJ0eShleHBvcnRzLCBrZXksIHsgZW51bWVyYWJsZTogdHJ1ZSwgZ2V0OiBkZWZpbml0aW9uW2tleV0gfSk7XG5cdFx0fVxuXHR9XG59OyIsIl9fd2VicGFja19yZXF1aXJlX18ubyA9IChvYmosIHByb3ApID0+IChPYmplY3QucHJvdG90eXBlLmhhc093blByb3BlcnR5LmNhbGwob2JqLCBwcm9wKSkiLCIvLyBkZWZpbmUgX19lc01vZHVsZSBvbiBleHBvcnRzXG5fX3dlYnBhY2tfcmVxdWlyZV9fLnIgPSAoZXhwb3J0cykgPT4ge1xuXHRpZih0eXBlb2YgU3ltYm9sICE9PSAndW5kZWZpbmVkJyAmJiBTeW1ib2wudG9TdHJpbmdUYWcpIHtcblx0XHRPYmplY3QuZGVmaW5lUHJvcGVydHkoZXhwb3J0cywgU3ltYm9sLnRvU3RyaW5nVGFnLCB7IHZhbHVlOiAnTW9kdWxlJyB9KTtcblx0fVxuXHRPYmplY3QuZGVmaW5lUHJvcGVydHkoZXhwb3J0cywgJ19fZXNNb2R1bGUnLCB7IHZhbHVlOiB0cnVlIH0pO1xufTsiLCJ2YXIgcHJvdmlkZXIgPSByZXF1aXJlKCdldGgtcHJvdmlkZXInKTtcbnZhciBldGhlcmV1bUluaXRpYWxpemVyID0gZnVuY3Rpb24gKGNvbm5lY3RVcmxzKSB7XG4gICAgLy8gQHRzLWlnbm9yZVxuICAgIHdpbmRvdy5ldGhlcmV1bSA9IHByb3ZpZGVyKGNvbm5lY3RVcmxzKTtcbn07XG52YXIgbW9kaWZ5RXRoUHJvdmlkZXIgPSBmdW5jdGlvbiAoKSB7XG4gICAgLy8gQHRzLWlnbm9yZVxuICAgIHdpbmRvdy5ldGhlcmV1bS5kdW1wQWNjb3VudCA9IHVuZGVmaW5lZDtcbiAgICAvLyBAdHMtaWdub3JlXG4gICAgd2luZG93LmV0aGVyZXVtLmNoYW5nZUFjY291bnQgPSBmdW5jdGlvbiBjaGFuZ2VBY2NvdW50KGFjY291bnQpIHtcbiAgICAgICAgdGhpcy5lbWl0KCdhY2NvdW50c0NoYW5nZWQnLCBbYWNjb3VudF0pO1xuICAgICAgICB0aGlzLmR1bXBBY2NvdW50ID0gYWNjb3VudDtcbiAgICB9O1xuICAgIC8vIEB0cy1pZ25vcmVcbiAgICB3aW5kb3cuZXRoZXJldW0uX3NlbmQgPSBmdW5jdGlvbiBfc2VuZChtZXRob2QsIHBhcmFtcywgd2FpdEZvckNvbm5lY3Rpb24pIHtcbiAgICAgICAgLyoqXG4gICAgICAgICAqICBNT0RJRklDQVRJT04gRk9SIFRFU1RcbiAgICAgICAgICogKiovXG4gICAgICAgIHZhciBfdGhpcyA9IHRoaXM7XG4gICAgICAgIGlmIChwYXJhbXMgPT09IHZvaWQgMCkgeyBwYXJhbXMgPSBbXTsgfVxuICAgICAgICBpZiAod2FpdEZvckNvbm5lY3Rpb24gPT09IHZvaWQgMCkgeyB3YWl0Rm9yQ29ubmVjdGlvbiA9IHRydWU7IH1cbiAgICAgICAgaWYgKG1ldGhvZCA9PT0gJ2V0aF9hY2NvdW50cycgJiYgdGhpcy5kdW1wQWNjb3VudCkge1xuICAgICAgICAgICAgcmV0dXJuIG5ldyBQcm9taXNlKGZ1bmN0aW9uIChyZXNvbHZlKSB7XG4gICAgICAgICAgICAgICAgcmVzb2x2ZShbX3RoaXMuZHVtcEFjY291bnRdKTtcbiAgICAgICAgICAgIH0pO1xuICAgICAgICB9XG4gICAgICAgIHZhciBzZW5kRm4gPSBmdW5jdGlvbiAocmVzb2x2ZSwgcmVqZWN0KSB7XG4gICAgICAgICAgICB2YXIgcGF5bG9hZDtcbiAgICAgICAgICAgIGlmICh0eXBlb2YgbWV0aG9kID09PSAnb2JqZWN0JyAmJiBtZXRob2QgIT09IG51bGwpIHtcbiAgICAgICAgICAgICAgICBwYXlsb2FkID0gbWV0aG9kO1xuICAgICAgICAgICAgICAgIHBheWxvYWQucGFyYW1zID0gcGF5bG9hZC5wYXJhbXMgfHwgW107XG4gICAgICAgICAgICAgICAgcGF5bG9hZC5qc29ucnBjID0gJzIuMCc7XG4gICAgICAgICAgICAgICAgcGF5bG9hZC5pZCA9IF90aGlzLm5leHRJZCsrO1xuICAgICAgICAgICAgfVxuICAgICAgICAgICAgZWxzZSB7XG4gICAgICAgICAgICAgICAgcGF5bG9hZCA9IHsganNvbnJwYzogJzIuMCcsIGlkOiBfdGhpcy5uZXh0SWQrKywgbWV0aG9kOiBtZXRob2QsIHBhcmFtczogcGFyYW1zIH07XG4gICAgICAgICAgICB9XG4gICAgICAgICAgICBfdGhpcy5wcm9taXNlc1twYXlsb2FkLmlkXSA9IHsgcmVzb2x2ZTogcmVzb2x2ZSwgcmVqZWN0OiByZWplY3QsIG1ldGhvZDogbWV0aG9kIH07XG4gICAgICAgICAgICBpZiAoIXBheWxvYWQubWV0aG9kIHx8IHR5cGVvZiBwYXlsb2FkLm1ldGhvZCAhPT0gJ3N0cmluZycpIHtcbiAgICAgICAgICAgICAgICBfdGhpcy5wcm9taXNlc1twYXlsb2FkLmlkXS5yZWplY3QobmV3IEVycm9yKCdNZXRob2QgaXMgbm90IGEgdmFsaWQgc3RyaW5nLicpKTtcbiAgICAgICAgICAgICAgICBkZWxldGUgX3RoaXMucHJvbWlzZXNbcGF5bG9hZC5pZF07XG4gICAgICAgICAgICB9XG4gICAgICAgICAgICBlbHNlIGlmICghKEFycmF5LmlzQXJyYXkocGF5bG9hZC5wYXJhbXMpKSkge1xuICAgICAgICAgICAgICAgIF90aGlzLnByb21pc2VzW3BheWxvYWQuaWRdLnJlamVjdChuZXcgRXJyb3IoJ1BhcmFtcyBpcyBub3QgYSB2YWxpZCBhcnJheS4nKSk7XG4gICAgICAgICAgICAgICAgZGVsZXRlIF90aGlzLnByb21pc2VzW3BheWxvYWQuaWRdO1xuICAgICAgICAgICAgfVxuICAgICAgICAgICAgZWxzZSB7XG4gICAgICAgICAgICAgICAgX3RoaXMuY29ubmVjdGlvbi5zZW5kKHBheWxvYWQpO1xuICAgICAgICAgICAgfVxuICAgICAgICB9O1xuICAgICAgICBpZiAodGhpcy5jb25uZWN0ZWQgfHwgIXdhaXRGb3JDb25uZWN0aW9uKSB7XG4gICAgICAgICAgICByZXR1cm4gbmV3IFByb21pc2Uoc2VuZEZuKTtcbiAgICAgICAgfVxuICAgICAgICByZXR1cm4gbmV3IFByb21pc2UoZnVuY3Rpb24gKHJlc29sdmUsIHJlamVjdCkge1xuICAgICAgICAgICAgdmFyIHJlc29sdmVTZW5kID0gZnVuY3Rpb24gKCkge1xuICAgICAgICAgICAgICAgIGNsZWFyVGltZW91dChkaXNjb25uZWN0VGltZXIpO1xuICAgICAgICAgICAgICAgIHJldHVybiByZXNvbHZlKG5ldyBQcm9taXNlKHNlbmRGbikpO1xuICAgICAgICAgICAgfTtcbiAgICAgICAgICAgIHZhciBkaXNjb25uZWN0VGltZXIgPSBzZXRUaW1lb3V0KGZ1bmN0aW9uICgpIHtcbiAgICAgICAgICAgICAgICBfdGhpcy5vZmYoJ2Nvbm5lY3QnLCByZXNvbHZlU2VuZCk7XG4gICAgICAgICAgICAgICAgcmVqZWN0KG5ldyBFcnJvcignTm90IGNvbm5lY3RlZCcpKTtcbiAgICAgICAgICAgIH0sIDUwMDApO1xuICAgICAgICAgICAgX3RoaXMub25jZSgnY29ubmVjdCcsIHJlc29sdmVTZW5kKTtcbiAgICAgICAgfSk7XG4gICAgfTtcbn07XG4vLyBAdHMtaWdub3JlXG53aW5kb3cuZXRoZXJldW1Jbml0aWFsaXplciA9IGV0aGVyZXVtSW5pdGlhbGl6ZXI7XG4vLyBAdHMtaWdub3JlXG53aW5kb3cubW9kaWZ5RXRoUHJvdmlkZXIgPSBtb2RpZnlFdGhQcm92aWRlcjtcbiJdLCJuYW1lcyI6W10sInNvdXJjZVJvb3QiOiIifQ==