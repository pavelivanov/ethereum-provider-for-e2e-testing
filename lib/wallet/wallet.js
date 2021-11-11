"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.Wallet = exports.WalletProvider = void 0;
const defaultConnectUrls_1 = require("../consts/defaultConnectUrls");
const helpers_1 = require("../helpers");
class WalletProvider {
    constructor(accounts, connectUrls) {
        this.getAddress = (selectedAddress, isEthAddress) => {
            return this.accounts.find((account) => {
                if (isEthAddress) {
                    return account.address === selectedAddress;
                }
                else {
                    return account.alias === selectedAddress;
                }
            });
        };
        this.getAccount = (selectedAccount) => {
            const isEthAddress = (0, helpers_1.validateEthAddress)(selectedAccount);
            return this.getAddress(selectedAccount, isEthAddress);
        };
        this.accounts = accounts || [];
        this.connectUrls = connectUrls;
    }
}
exports.WalletProvider = WalletProvider;
exports.Wallet = {
    localAccounts: [],
    connectUrls: defaultConnectUrls_1.defaultConnectUrls,
    configure: function configure({ accounts, connectUrls }) {
        this.localAccounts = accounts;
        if (connectUrls) {
            this.connectUrls = connectUrls;
        }
    },
};
