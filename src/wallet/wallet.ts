import { Account, IWallet } from "./types";
import { defaultConnectUrls } from "../consts/defaultConnectUrls";
import {validateEthAddress} from "../helpers";

declare global {
  interface Window {
    ethereum: any; // TODO: type this properly
    ethereumInitializer: (connectedUrls: string[]) => void
    modifyEthProvider: () => void
  }
}

export class WalletProvider {
  accounts: Account[];
  connectUrls: string[]
  constructor(accounts: Account[], connectUrls: string[]) {
    this.accounts = accounts || []
    this.connectUrls = connectUrls
  }

  getAddress = (selectedAddress: string, isEthAddress: boolean) => {
    return this.accounts.find((account) => {
      if(isEthAddress) {
        return account.address === selectedAddress
      } else {
        return account.alias === selectedAddress
      }
    })
  }

  getAccount = (selectedAccount: string) => {
    const isEthAddress = validateEthAddress(selectedAccount)
    return this.getAddress(selectedAccount, isEthAddress)
  }
}

export const Wallet: IWallet = {
  localAccounts: [],
  connectUrls: defaultConnectUrls,

  configure: function configure({ accounts, connectUrls }) {
    this.localAccounts = accounts

    if(connectUrls) {
      this.connectUrls = connectUrls
    }
  },
}

