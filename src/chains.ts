import type { ChainInfo } from './types.js';

const evm = (
  key: string,
  name: string,
  dexscreenerId: string,
  goplusId: string,
  explorerPrefix: string,
): ChainInfo => ({
  key,
  name,
  dexscreenerId,
  goplusId,
  evm: true,
  explorerTokenUrl: (a) => `${explorerPrefix}${a}`,
});

// To add a chain: add one line here. Chains GoPlus doesn't cover still work,
// they just show "contract data unavailable" instead of tax/honeypot checks.
export const CHAINS: ChainInfo[] = [
  evm('ethereum', 'Ethereum', 'ethereum', '1', 'https://etherscan.io/token/'),
  evm('bsc', 'BNB Chain', 'bsc', '56', 'https://bscscan.com/token/'),
  evm('base', 'Base', 'base', '8453', 'https://basescan.org/token/'),
  evm('arbitrum', 'Arbitrum', 'arbitrum', '42161', 'https://arbiscan.io/token/'),
  evm('polygon', 'Polygon', 'polygon', '137', 'https://polygonscan.com/token/'),
  evm('optimism', 'Optimism', 'optimism', '10', 'https://optimistic.etherscan.io/token/'),
  evm('avalanche', 'Avalanche', 'avalanche', '43114', 'https://snowtrace.io/token/'),
  evm('linea', 'Linea', 'linea', '59144', 'https://lineascan.build/token/'),
  evm('zksync', 'zkSync Era', 'zksync', '324', 'https://explorer.zksync.io/address/'),
  evm('scroll', 'Scroll', 'scroll', '534352', 'https://scrollscan.com/token/'),
  evm('mantle', 'Mantle', 'mantle', '5000', 'https://mantlescan.xyz/token/'),
  evm('blast', 'Blast', 'blast', '81457', 'https://blastscan.io/token/'),
  evm('sonic', 'Sonic', 'sonic', '146', 'https://sonicscan.org/token/'),
  evm('berachain', 'Berachain', 'berachain', '80094', 'https://berascan.com/token/'),
  {
    key: 'solana',
    name: 'Solana',
    dexscreenerId: 'solana',
    goplusId: null,
    evm: false,
    explorerTokenUrl: (a) => `https://solscan.io/token/${a}`,
  },
];

export const CHAIN_BY_KEY = new Map(CHAINS.map((c) => [c.key, c]));
export const CHAIN_BY_DEX_ID = new Map(CHAINS.map((c) => [c.dexscreenerId, c]));
