import type { Page } from 'playwright';
import * as path from "path";
import { Account, IWalletPlaywright } from "../wallet/types";
import { Wallet, WalletProvider } from "../wallet";
import * as fs from "fs";

declare global {
  interface Window {
    ethereum: any; // TODO: type this properly
    ethereumInitializer: (connectedUrls: string[]) => void
    modifyEthProvider: () => void
  }
}

export class WalletProviderPlaywright extends WalletProvider {
  page: Page;
  constructor(page: Page, accounts: Account[], connectUrls: string[]) {
    super(accounts, connectUrls)
    this.page = page
  }

  changeAccount = async (selectedAccount: string) => {
    const account = this.getAccount(selectedAccount)

    await this.page.evaluate((address) => {
      window.ethereum.changeAccount(address)
    }, account?.address)
  }

  injectProvider = async () => {
    const provider = fs.readFileSync(
      path.join(__dirname, '../../build/provider.js'),
      'utf-8'
    )

    await this.page.addInitScript(provider)
    await this.page.addInitScript(`
      window.ethereumInitializer(${JSON.stringify(this.connectUrls)})
      window.modifyEthProvider()
    `)
  }

  connect = async (selectedAccount: string) => {
    await this.changeAccount(selectedAccount)
  }
}

export const WalletPlaywright: IWalletPlaywright = {
  ...Wallet,
  create: async function create({ page }) {
    const wallet = new WalletProviderPlaywright(page, this.localAccounts, this.connectUrls)
    await wallet.injectProvider()
    return wallet;
  }
}
