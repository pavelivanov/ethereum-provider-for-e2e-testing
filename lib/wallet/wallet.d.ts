import { Account, IWallet } from "./types";
declare global {
    interface Window {
        ethereum: any;
        ethereumInitializer: (connectedUrls: string[]) => void;
        modifyEthProvider: () => void;
    }
}
export declare class WalletProvider {
    accounts: Account[];
    connectUrls: string[];
    constructor(accounts: Account[], connectUrls: string[]);
    getAddress: (selectedAddress: string, isEthAddress: boolean) => Account | undefined;
    getAccount: (selectedAccount: string) => Account | undefined;
}
export declare const Wallet: IWallet;
