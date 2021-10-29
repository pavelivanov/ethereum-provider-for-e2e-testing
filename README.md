# ethereum-provider-for-e2e-testing
Ethereum provider for E2E testing


## Usage with Playwright

```
import { test as base } from '@playwright/test'
import { Wallet } from 'lib'

Wallet.configure({
  accounts: [
    {
      alias: 'Alice',
      address: '0x0..',
    },
    {
      alias: 'Bob',
      address: '0x1..',
    },
  ],
}) 

test('Check Alice can transfer money to Bob', ({ page }) => {
  const wallet = new Wallet({ page })
  
  wallet.connect([ 'Alice', 'Bob' ])
  wallet.changeAccount('Bob')
  
  expect(await page.text('data-test-id=banalce')).toEqual(0)

  wallet.changeAccount('Alice') 
  expect(await page.text('data-test-id=banalce')).toEqual(100)
  
  await page.fill('data-test-id=amount', 1)
  await page.click('data-test-id=transfer')
   
  expect(await page.text('data-test-id=banalce')).toEqual(99)
  
  wallet.changeAccount('bob') 
  expect(await page.text('data-test-id=banalce')).toEqual(1)
})

// OR

test('Check Alice can transfer money to Bob', ({ browserContext, page: alicePage }) => {
  const bobPage = browserContext.newPage()
  const bobWallet = new Wallet({ page: bobPage })
  
  bobPage.bringToFront()
  bobWallet.connect([ 'Bob' ])
  
  expect(await page.text('data-test-id=banalce')).toEqual(0)

  alicePage.bringToFront() 
  expect(await page.text('data-test-id=banalce')).toEqual(100)
  
  await page.fill('data-test-id=amount', 1)
  await page.click('data-test-id=transfer')
   
  expect(await page.text('data-test-id=banalce')).toEqual(99)
  
  bobPage.bringToFront()
  expect(await page.text('data-test-id=banalce')).toEqual(1)
})
```
