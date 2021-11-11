import { test, expect } from '@playwright/test';
import { WalletPlaywright as Wallet } from "ethereum-provider-for-e2e-testing/lib/playwright";

Wallet.configure({
  accounts: [
    {
      alias: 'Alice',
      address: '0x15d34AAf54267DB7D7c367839AAf71A00a2C6A65',
    },
    {
      alias: 'Bob',
      address: '0x70997970C51812dc3A010C7d01b50e0d17dc79C8',
    },
  ],
})

test.describe('test transfer', () => {
  test('Check Alice can transfer money to Bob', async ({ page }) => {
    const wallet = await Wallet.create({ page })
    await page.goto('http://localhost:3000')

    await wallet.changeAccount('Alice')
    await page.click('[data-testid="connect-button"]')


    expect(parseInt(await page.innerText('[data-testid="balance-value"]'), 10)).toEqual(9999)

    await wallet.changeAccount('Bob')
    expect(parseInt(await page.innerText('[data-testid="balance-value"]'), 10)).toEqual(9999)

    await page.fill('[data-testid="amount-input"]', '1')
    await page.fill('[data-testid="address-input"]', '0x15d34AAf54267DB7D7c367839AAf71A00a2C6A65')
    await page.click('[data-testid="transfer-button"]')

    expect(parseInt(await page.innerText('[data-testid="balance-value"]'), 10)).toEqual(9998)

    await wallet.changeAccount('Alice')
    expect(parseInt(await page.innerText('[data-testid="balance-value"]'), 10)).toEqual(10000)
  })
})
