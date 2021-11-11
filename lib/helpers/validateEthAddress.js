"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.validateEthAddress = void 0;
const validateEthAddress = (address) => {
    return /^(0x)?[0-9a-f]{40}$/i.test(address);
};
exports.validateEthAddress = validateEthAddress;
