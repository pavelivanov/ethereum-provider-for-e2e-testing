"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.WalletPuppeteer = exports.WalletProviderPuppeteer = void 0;
const tslib_1 = require("tslib");
const path = (0, tslib_1.__importStar)(require("path"));
const wallet_1 = require("../wallet");
class WalletProviderPuppeteer extends wallet_1.WalletProvider {
    constructor(page, accounts, connectUrls) {
        super(accounts, connectUrls);
        this.changeAccount = async (selectedAccount) => {
            const account = this.getAccount(selectedAccount);
            await this.page.evaluate((address) => {
                if (!address) {
                    throw Error("No address found");
                }
                window.ethereum.changeAccount(address);
            }, (account === null || account === void 0 ? void 0 : account.address) || '');
        };
        this.injectProvider = async () => {
            await this.page.addScriptTag({
                path: path.join(__dirname, '../../build/provider.js')
            });
            await this.page.evaluate((connectedUrls) => {
                window.ethereumInitializer(connectedUrls);
                window.modifyEthProvider();
            }, this.connectUrls);
        };
        this.connect = async (selectedAccount) => {
            await this.changeAccount(selectedAccount);
        };
        this.page = page;
    }
}
exports.WalletProviderPuppeteer = WalletProviderPuppeteer;
exports.WalletPuppeteer = {
    ...wallet_1.Wallet,
    create: async function create({ page }) {
        const wallet = new WalletProviderPuppeteer(page, this.localAccounts, this.connectUrls);
        await wallet.injectProvider();
        return wallet;
    }
};
