import {Page as PlaywrightPage} from "playwright";
import {Page as PuppeteerPage} from "puppeteer-core";
import {WalletProviderPlaywright} from "../playwright/playwright";
import {WalletProviderPuppeteer} from "../puppeteer/puppeteer";

export type Account = {
  alias: string
  address: string
}

export interface IWallet {
  localAccounts: Account[]
  connectUrls: string[]
  configure: ({ accounts, connectUrls }: { accounts: Account[], connectUrls?: string[] }) => void
}

export interface IWalletPlaywright extends IWallet {
  create: ({ page } : { page: PlaywrightPage }) => Promise<WalletProviderPlaywright>
}

export interface IWalletPuppeteer extends IWallet {
  create: ({ page } : { page: PuppeteerPage }) => Promise<WalletProviderPuppeteer>
}
