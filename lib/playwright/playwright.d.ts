import type { Page } from 'playwright';
import { Account, IWalletPlaywright } from "../wallet/types";
import { WalletProvider } from "../wallet";
declare global {
    interface Window {
        ethereum: any;
        ethereumInitializer: (connectedUrls: string[]) => void;
        modifyEthProvider: () => void;
    }
}
export declare class WalletProviderPlaywright extends WalletProvider {
    page: Page;
    constructor(page: Page, accounts: Account[], connectUrls: string[]);
    changeAccount: (selectedAccount: string) => Promise<void>;
    injectProvider: () => Promise<void>;
    connect: (selectedAccount: string) => Promise<void>;
}
export declare const WalletPlaywright: IWalletPlaywright;
