import { Account, IWalletPuppeteer } from "../wallet/types";
import { WalletProvider } from "../wallet";
import { Page } from 'puppeteer-core';
declare global {
    interface Window {
        ethereum: any;
        ethereumInitializer: (connectedUrls: string[]) => void;
        modifyEthProvider: () => void;
    }
}
export declare class WalletProviderPuppeteer extends WalletProvider {
    page: Page;
    constructor(page: Page, accounts: Account[], connectUrls: string[]);
    changeAccount: (selectedAccount: string) => Promise<void>;
    injectProvider: () => Promise<void>;
    connect: (selectedAccount: string) => Promise<void>;
}
export declare const WalletPuppeteer: IWalletPuppeteer;
