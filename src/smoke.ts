// Live check against the real APIs:
//   npm run smoke -- <token address>            prints the card
//   npm run smoke -- <token address> --debug    also prints the signals behind the score
import { formatScan } from './bot/format.js';
import { scanToken } from './scanner/index.js';
import { extractAddress } from './util.js';

const args = process.argv.slice(2);
const debug = args.includes('--debug');
const arg = args.find((a) => !a.startsWith('--')) ?? '0x4200000000000000000000000000000000000006'; // WETH on Base
const found = extractAddress(arg);
if (!found) {
  console.error('Pass a token contract address: npm run smoke -- 0x...');
  process.exit(1);
}

const result = await scanToken(found, { log: (m) => console.warn('WARN', m) });
console.log(formatScan(result, { maxRisk: 60 }).replace(/<[^>]+>/g, ''));
console.log('\nflags:', result.report.flags.map((f) => `${f.id}(${f.weight})`).join(', ') || 'none');
console.log('contract safety data:', result.safety ? 'received' : 'MISSING (check the WARN line above)');

if (debug) {
  const { safety, market, report } = result;
  console.log('\n--- debug (paste this when reporting a wrong score) ---');
  console.log(
    JSON.stringify(
      {
        chain: result.chain.key,
        dex: market.dex,
        pairAddress: market.pairAddress,
        isConcentratedPool: market.isConcentratedPool,
        liquidityUsd: market.liquidityUsd,
        score: report.score,
        hardBlock: report.hardBlock,
        top10Percent: report.top10Percent,
        safety: safety && {
          ownershipRenounced: safety.ownershipRenounced,
          canTakeBackOwnership: safety.canTakeBackOwnership,
          hiddenOwner: safety.hiddenOwner,
          transferPausable: safety.transferPausable,
          hasBlacklist: safety.hasBlacklist,
          isMintable: safety.isMintable,
          isProxy: safety.isProxy,
          isOpenSource: safety.isOpenSource,
          buyTax: safety.buyTax,
          sellTax: safety.sellTax,
          lpLockedPercent: safety.lpLockedPercent,
          holderCount: safety.holderCount,
          topHolders: safety.topHolders.slice(0, 5),
        },
      },
      null,
      2,
    ),
  );
}
