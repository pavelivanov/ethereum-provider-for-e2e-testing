export const validateEthAddress = (address: string) => {
  return /^(0x)?[0-9a-f]{40}$/i.test(address)
};
