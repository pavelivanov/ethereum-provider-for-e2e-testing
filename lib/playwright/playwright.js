"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.WalletPlaywright = exports.WalletProviderPlaywright = void 0;
const tslib_1 = require("tslib");
const path = (0, tslib_1.__importStar)(require("path"));
const wallet_1 = require("../wallet");
const fs = (0, tslib_1.__importStar)(require("fs"));
class WalletProviderPlaywright extends wallet_1.WalletProvider {
    constructor(page, accounts, connectUrls) {
        super(accounts, connectUrls);
        this.changeAccount = async (selectedAccount) => {
            const account = this.getAccount(selectedAccount);
            await this.page.evaluate((address) => {
                window.ethereum.changeAccount(address);
            }, account === null || account === void 0 ? void 0 : account.address);
        };
        this.injectProvider = async () => {
            const provider = fs.readFileSync(path.join(__dirname, '../../build/provider.js'), 'utf-8');
            await this.page.addInitScript(provider);
            await this.page.addInitScript(`
      window.ethereumInitializer(${JSON.stringify(this.connectUrls)})
      window.modifyEthProvider()
    `);
        };
        this.connect = async (selectedAccount) => {
            debugger;
            await this.changeAccount(selectedAccount);
        };
        this.page = page;
    }
}
exports.WalletProviderPlaywright = WalletProviderPlaywright;
exports.WalletPlaywright = {
    ...wallet_1.Wallet,
    create: async function create({ page }) {
        const wallet = new WalletProviderPlaywright(page, this.localAccounts, this.connectUrls);
        await wallet.injectProvider();
        return wallet;
    }
};
