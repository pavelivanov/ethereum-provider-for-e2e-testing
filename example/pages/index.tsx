import React, { useRef, useState, useEffect } from 'react'
import type { NextPage } from 'next'
import { useWeb3React } from '@web3-react/core'
import { InjectedConnector } from '@web3-react/injected-connector'
import { formatEther, parseEther } from '@ethersproject/units'
import type { Web3Provider } from '@ethersproject/providers'

const injected = new InjectedConnector({
  supportedChainIds: [ 1, 4, 1337 ],
})

const Account = () => {
  const { account, activate, deactivate } = useWeb3React()

  const handleConnectClick = () => {
    activate(injected)
  }

  const handleDisconnectClick = () => {
    deactivate()
  }

  if (account) {
    return (
      <div>
        {account}
        <button data-testid="disconnect-button" onClick={handleDisconnectClick}>Disconnect</button>
      </div>
    )
  }

  return (
    <button data-testid="connect-button" onClick={handleConnectClick}>Connect</button>
  )
}

const Transfer = () => {
  const [ isSubmitting, setSubmitting ] = useState<boolean>(false)
  const [ balance, setBalance ] = useState<string>('')
  const { library, account } = useWeb3React<Web3Provider>()

  const amountInputRef = useRef<HTMLInputElement>(null)
  const recipientInputRef = useRef<HTMLInputElement>(null)

  const fetchBalance = async () => {
    // @ts-ignore
    const balance = await library.getBalance(account)

    setBalance(formatEther(balance))
  }

  useEffect(() => {
    if (library && account) {
      fetchBalance()
    }
  }, [ library, account ])

  const handleSubmit = async (event: React.KeyboardEvent<HTMLFormElement>) => {
    if (!library || !amountInputRef.current || !recipientInputRef.current) {
      return
    }

    setSubmitting(true)

    event.preventDefault()

    const amount = amountInputRef.current.value
    const recipient = recipientInputRef.current.value

    const signer = library.getSigner()
    console.log(signer)
    const receipt = await signer.sendTransaction({
      to: recipient,
      value: parseEther(amount),
    })

    await receipt.wait()

    fetchBalance()

    setSubmitting(false)
  }

  return (
    <div>
      {
        isSubmitting && (
          <div data-testid="processing">Processing...</div>
        )
      }
      <div>
        Balance: {balance === '' ? null : <span data-testid="balance-value">{balance}</span>} ETH
      </div>
      <form onSubmit={handleSubmit}>
        <input ref={amountInputRef} data-testid="amount-input" type="text" placeholder="Amount" />
        <input ref={recipientInputRef} data-testid="address-input" type="text" placeholder="Recipient address" />
        <button type="submit" data-testid="transfer-button">Transfer</button>
      </form>
    </div>
  )
}

const Home: NextPage = () => {

  const handleClick = () => {

  }

  return (
    <div>
      <Account />
      <br />
      <Transfer />
    </div>
  )
}

export default Home
