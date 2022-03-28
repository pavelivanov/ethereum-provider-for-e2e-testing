import * as path from "path";
import { Account, IWalletPuppeteer } from "../wallet/types";
import { Wallet, WalletProvider } from "../wallet";
import { Page } from 'puppeteer-core'

declare global {
  interface Window {
    ethereum: any; // TODO: type this properly
    ethereumInitializer: (connectedUrls: string[]) => void
    modifyEthProvider: () => void
  }
}

export class WalletProviderPuppeteer extends WalletProvider {
  page: Page;
  constructor(page: Page, accounts: Account[], connectUrls: string[]) {
    super(accounts, connectUrls)
    this.page = page
  }

  changeAccount = async (selectedAccount: string) => {
    const account = this.getAccount(selectedAccount)

    await this.page.evaluate((address) => {
      if(!address) {
        throw Error("No address found")
      }

      window.ethereum.changeAccount(address)
    }, account?.address || '')
  }

  injectProvider = async () => {
    await this.page.addScriptTag({
      path: path.join(__dirname, '../../build/provider.js')
    })

    await this.page.evaluate((connectedUrls) => {
      window.ethereumInitializer(connectedUrls)
      window.modifyEthProvider()
    }, this.connectUrls)
  }

  connect = async (selectedAccount: string) => {
    await this.changeAccount(selectedAccount)
  }
}

export const WalletPuppeteer: IWalletPuppeteer = {
  ...Wallet,
  create: async function create({ page }) {
    const wallet = new WalletProviderPuppeteer(page, this.localAccounts, this.connectUrls)
    await wallet.injectProvider()
    return wallet;
  }
}

