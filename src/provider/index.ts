const provider = require('eth-provider')


const ethereumInitializer = (connectUrls: string[]) => {
  // @ts-ignore
  window.ethereum = provider(connectUrls)
}

const modifyEthProvider = () => {
  // @ts-ignore
  window.ethereum.dumpAccount = undefined;
  // @ts-ignore
  window.ethereum.changeAccount = function changeAccount(account: string) {
    this.emit('accountsChanged', [account])
    this.dumpAccount = account
  }

  // @ts-ignore
  window.ethereum._send = function _send(method: string, params = [], waitForConnection = true) {
    /**
     *  MODIFICATION FOR TEST
     * **/

    if (method === 'eth_accounts' && this.dumpAccount) {
      return new Promise((resolve) => {
        resolve([this.dumpAccount])
      })
    }

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
      } else if (!(Array.isArray(payload.params))) {
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
}

// @ts-ignore
window.ethereumInitializer = ethereumInitializer
// @ts-ignore
window.modifyEthProvider = modifyEthProvider
