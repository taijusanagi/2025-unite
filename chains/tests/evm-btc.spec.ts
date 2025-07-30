import {execSync} from 'child_process'
import {BITCOIN_CLI} from './lib/btc/utils'
import {jest} from '@jest/globals'

jest.setTimeout(1000 * 60)

const ownerPk = 'cQBvEmNH5MLiXDKAFNbGwDrudGM6bWGJNjBtF4HUcKcFTEZqeMDF'
const userPk = 'cP7YndPTRomiUQEDfm3zFCMpNgBYyPZLJ84LoB4dZ73NzqJSny4n'
const resolverPk = 'cUJ4wz3dLzT8v2ZxKtRpU7qyXZ6E1qur87LGCGMehYTkWHnQTMeD'

describe('evm-evm', () => {
    beforeAll(async () => {
        console.log('🚀 Starting Esplora Docker container...')

        execSync(
            `docker run --name esplora -p 50001:50001 -p 8094:80 --rm -d blockstream/esplora bash -c "/srv/explorer/run.sh bitcoin-regtest explorer"`,
            {stdio: 'inherit'}
        )

        console.log('⏳ Waiting for Bitcoin node to be ready...')
        execSync(`sleep 5`)

        console.log('⛏️  Mining and sending funds...')

        execSync(`${BITCOIN_CLI} createwallet mining_address`)

        const miningAddress = execSync(`${BITCOIN_CLI} -rpcwallet=mining_address getnewaddress`).toString().trim()

        execSync(`${BITCOIN_CLI} -rpcwallet=mining_address generatetoaddress 101 ${miningAddress}`)
        execSync(`sleep 5`)

        const testAddresses = [
            'bcrt1qfpfy5r5e3xvcdzxv95vetjsn8jtxdc97zhvn5q',
            'bcrt1qvt45lgurdr30xk265nqg9wdkzm8n6kcmcrq4fz',
            'bcrt1qc8whyxx6x637j6328weljzw4clgq9sff64d4zc'
        ]

        testAddresses.forEach((addr) => {
            execSync(`${BITCOIN_CLI} -rpcwallet=mining_address sendtoaddress ${addr} 0.001`)
        })

        console.log('✅ Bitcoin regtest ready.')
    })

    afterAll(() => {
        try {
            console.log('🧹 Stopping Esplora Docker container...')
            execSync('docker stop esplora', {stdio: 'inherit'})
        } catch (err) {
            console.warn('⚠️ Could not stop esplora container — it may have already stopped.')
        }
    })

    describe('integrate', () => {
        it('should work', async () => {})
    })
})
