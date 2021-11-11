import type { AppProps } from 'next/app'
import { Web3ReactProvider } from '@web3-react/core'
import { Web3Provider } from '@ethersproject/providers'

import '../styles/globals.css'
import {useEffect} from "react";


const getWeb3ReactLibrary = (provider: any, connector: any) => {
  const lib = new Web3Provider(provider)
  lib.pollingInterval = 12000

  return lib
}

const MyApp = ({ Component, pageProps }: AppProps) => {

  return (
    <Web3ReactProvider getLibrary={getWeb3ReactLibrary}>
      <Component {...pageProps} />
    </Web3ReactProvider>
  )
}

export default MyApp
