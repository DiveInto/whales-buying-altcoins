const { ethers } = require("hardhat")
const { getTransferEvents } = require("./erc20")
const { appendToFile, overwriteFile } = require("./file")
const { default: axios } = require("axios")
const { getIgnoreAddress, createLargeHolder, setIgnoreAddress } = require("./db")

const {LastUpdatedBlocks} = require("./util")


// TODO:  
// 1. getErc20FromCMCListings: there are some tokens without platform, e.g, DESO, fix this with hand?
// 2. add coinmarketcap as the two platform seems different

const rpcs = {
    'ethereum': 'https://mainnet.infura.io/v3/9aa3d95b3bc440fa88ea12eaa4456161',
    'binance-coin': 'https://bsc-dataseed1.binance.org',
    'avalanche': "https://api.avax.network/ext/bc/C/rpc",
    'polygon': "https://polygon-rpc.com",
    'fantom': "https://rpcapi.fantom.network",
    // 108: 'https://mainnet-rpc.thundercore.com',
    // 128: "https://http-mainnet.hecochain.com",
    // 100: "https://rpc.xdaichain.com",
    // 42161: "https://arb1.arbitrum.io/rpc",
    // 1666600000: "https://api.harmony.one",
    // 1666600001: "https://s1.api.harmony.one",
    // 1666600002: "https://s2.api.harmony.one",
    // 1666600003: "https://s3.api.harmony.one",
    // 122: "https://rpc.fuse.io",
    // 66: "https://exchainrpc.okex.org",
    // 4689: "https://babel-api.mainnet.iotex.io",
    // 321: "https://rpc-mainnet.kcc.network",
    // 10000: "https://global.uat.cash",
    // 333999: "https://rpc.polis.tech",
    // 25: "https://rpc.crodex.app/"
}

const multicallContractMainnetAdxs = {
    'ethereum': '0x5BA1e12693Dc8F9c48aAD8770482f4739bEeD696',
    'avalanche': '0x98e2060F672FD1656a07bc12D7253b5e41bF3876',
    'binance-coin': '0x41263cba59eb80dc200f3e2544eda4ed6a90e76c',
    'polygon': '0x11ce4B23bD875D7F5C6a31084f55fDe1e9A87507',
    'fantom': '0xD98e3dBE5950Ca8Ce5a4b59630a5652110403E5c',
}


class ChainScanner {
    constructor(chain) {
        this.chain = chain
        this.provider =  new ethers.providers.JsonRpcProvider(rpcs[chain])
        this.lastUpdatedBlock = new LastUpdatedBlocks(chain)
        this.multicallContractMainnetAdx = multicallContractMainnetAdxs[chain]
        this.rpc = rpcs[chain]
    }

    async initNotListedTokens() {
        const blackList = ['CRO','OKB','HT','WBNB','vBNB', 'LUSD', 'HUSD', 'WAVAX', 'WETH', 'WBTC', 'WMATIC', 'WFTM',
            'FLX', // AVAX-X chain token
        ]
        const erc20Tokens = await getErc20FromCMCListings(this.chain)
        const binanceTradingPairs = await getBinanceTradingPairs()
        const notListedErc20Tokens = [];
        for (let erc20Token of erc20Tokens) {
            if (isInBinanceTradingPair(erc20Token, binanceTradingPairs) || 
                blackList.includes(erc20Token.symbol) ) {
                continue
            }

            try {
                ethers.utils.getAddress(erc20Token.token_address)
            } catch(e) {
                console.log('>>>>>>>>>> Invalid token address', erc20Token.symbol, erc20Token.token_address)
                continue
            }
            notListedErc20Tokens.push(erc20Token)
        }
        this.notListedToken = notListedErc20Tokens;
    }

    async exportToCsv() {
        const tokensFile = `./outputs/token.csv`
        await overwriteFile(tokensFile, 'name, symbol, cmcRank, tokenAddress, platform, tags\n')
        for (let token of NotListedToken) {
            const { name, symbol, platform, cmc_rank, token_address, usdPrice, tags } = token
            const content = `${name}, ${symbol}, ${cmc_rank}, ${token_address}, ${platform}, ${tags.join(' ')}\n`
            await appendToFile(tokensFile, content)
        }
    }

    async checkIsContract(addresses) {
        const calls = []
        addresses.forEach(x => calls.push( this.provider.getCode(x)))
        const results = await Promise.all(calls)
        const isContract = {};
        // results = dict(zip(addresses, results))

        for (var i = 0; i < addresses.length; i++) {
            const codeAtAddress = results[i];
            isContract[addresses[i]] = codeAtAddress.length > 10;
            if (isContract[addresses[i]]) {
                setIgnoreAddress(addresses[i], this.chain, 'Contract')
            }
        }
        return isContract
    }

    async checkIsDirectTranser(txs) {
        const calls = []
        txs.forEach(x => calls.push(this.provider.getTransaction(x)))
        const results = await Promise.all(calls)
        
        const finalResult = [];
        for (var i = 0; i < results.length; i++) {
                        
            const isDirectTransfer = 
                results[i].data.startsWith(ethers.utils.id('transfer(address,uint256)').substring(0, 8 + 2)) ||
                results[i].data.startsWith(ethers.utils.id('distribute()').substring(0, 8 + 2))   // babyswap distribute
            if (!isDirectTransfer) {
                finalResult.push(txs[i])
            }
        }
        return finalResult
    }
}


async function main() {
    while (true){
        await scan('polygon');
        await scan("avalanche");
        await scan("fantom");
        await scan("binance-coin");
        await scan("ethereum");
    }
}

async function scan(chain) {
    const scanner = new ChainScanner(chain)

    await scanner.initNotListedTokens();
    const notListedToken = scanner.notListedToken;
    // const notListedToken = await getErc20FromCMCListings(chain);

    const ignoreAddress = await getIgnoreAddress()
    console.log(`${chain} not listed at binance:`, notListedToken.length)

    const curBlock = await scanner.provider.getBlock()

    // const dateStr = new Date().toISOString().split('T')[0]

    for (let i = 0; i < notListedToken.length; i++) {
        const token = notListedToken[i]
        console.log(`\nprogressing token ${i}/${ notListedToken.length}`)
        console.log('!', JSON.stringify(token))

        try {
            let fromBlockNumber = scanner.lastUpdatedBlock.get(token.token_address) || curBlock.number - Math.floor(24 * 60 * 60 / 13);
            let toBlockNumber = curBlock.number - 1

            // let fromBlockNumber = 13897760
            // let toBlockNumber = 13897761

            console.log('block range:', fromBlockNumber + 1, toBlockNumber)
            await getLargeHolderMap(ignoreAddress, token, scanner, { fromBlockNumber, toBlockNumber })
            scanner.lastUpdatedBlock.update(token.token_address, toBlockNumber)
        } catch (error) {
            console.log('fail to getLargeHolderMap of:', token, 'error:', error)
        }
    }
    console.log(chain, 'done')
}


async function getLargeHolderMap(ignoreAddress, token, scanner, {
    fromBlockNumber = -50,
    toBlockNumber = 'latest'
} = {}) {
    const largeHolderMap = new Map()

    const canBeIgnoredUserMap = new Map()

    const provider = scanner.provider
    const transferEvents = await getTransferEvents(token.token_address, {
        fromBlockNumber,
        toBlockNumber,
        provider,
    })
    const possibleAccounts = {}
    
    for (let event of transferEvents) {
        const val = ethers.BigNumber.from(event.data)
        const valInUSD = val / 10 ** 18 * token.usdPrice
        const from = event.args[0].toLowerCase()
        // const to = event.args[1]
        const toAdx = '0x' + event.topics[2].substring(24 + 2)

        if (valInUSD <= 10000) {
            continue
        }

        //  ignore exchange & contract address
        if (ignoreAddress['to'].includes(toAdx) || ignoreAddress['from'].includes(from) || from == '0x0000000000000000000000000000000000000000') {
            continue
        }

        // use dict since some transcation might be duplicate
        possibleAccounts[toAdx] = possibleAccounts[toAdx] || {}
        possibleAccounts[toAdx][event.transactionHash] = {
            hash: event.transactionHash,
            from: event.args[0],
            to: event.args[1],
            valInUSD: valInUSD
        }
    }

    console.log('Events count', transferEvents.length)
    const distinctPossibleAccounts = Object.keys(possibleAccounts)
    console.log('distinctPossibleAccounts:', distinctPossibleAccounts.length)

    const tokenBalanceMap = await getTokenBalanceMap(scanner, token.token_address, distinctPossibleAccounts)
    const isContract = await scanner.checkIsContract(distinctPossibleAccounts)

    for (let account of distinctPossibleAccounts) {
        // check receiver balance
        const bal = tokenBalanceMap.get(account)
        const balInUSD = bal / 10 ** 18 * token.usdPrice
        if (balInUSD <= 15_0000) {
            continue
        }
        
        if (isContract[account]) {
            continue
        }

        // filter if this is direct transfer call
        trxs = Object.keys(possibleAccounts[account])
        nonDirectTransferTrxs = await scanner.checkIsDirectTranser(trxs)
        if (nonDirectTransferTrxs.length == 0) {
            continue
        }

        await createLargeHolder(token.symbol, token.token_address, token.platform, account, balInUSD, nonDirectTransferTrxs.join('\n'), nonDirectTransferTrxs.length)
        // largeHolderMap.set(toAdx, {
        //     bal,
        //     balInUSD,
        //     txs: [{ hash: event.transactionHash, valInUSD }]
        // })
    }
}

async function getErc20FromCMCListings(chain) {
    const topN = 3000
    const cmcResp = await axios.get(`https://api.coinmarketcap.com/data-api/v3/cryptocurrency/listing?limit=${topN}&sortBy=market_cap&sortType=desc&convert=USD&cryptoType=all&tagType=all&audited=false`)

    const tokens = cmcResp.data.data.cryptoCurrencyList

    const erc20Tokens = []
    for (let token of tokens) {
        const platform = token.platform

        if (!platform || platform.slug != chain) {
            continue
        }

        if (platform.token_address.indexOf('https') == 0) {
            var slices = platform.token_address.split('/')
            platform.token_address = slices[slices.length - 1]
        } 

        const tokenInfo = {
            name: token.name,
            symbol: token.symbol,
            platform: platform.slug,
            cmc_rank: token.cmcRank,
            token_address: platform.token_address,
            tags: token.tags,
        }

        for (let quote of token.quotes) {
            if (quote.name != 'USD') {
                continue
            }

            tokenInfo.usdPrice = quote.price
        }

        erc20Tokens.push(tokenInfo)
    }

    console.log('erc20 tokens cnt:', erc20Tokens.length)

    return erc20Tokens
}

async function getBinanceTradingPairs() {
    const resp = await axios.get('https://api.binance.com/api/v3/exchangeInfo')
    const symbols = resp.data.symbols

    const tradingPairs = []
    for (let { symbol, baseAsset, quoteAsset } of symbols) {
        tradingPairs.push({
            symbol,
            baseAsset,
            quoteAsset,
        })
    }

    return tradingPairs
}


function isInBinanceTradingPair(erc20Token, binanceTradingPairs) {
    for (let { baseAsset, quoteAsset } of binanceTradingPairs) {
        const { symbol } = erc20Token

        if (baseAsset === symbol || quoteAsset === symbol) {
            return true
        }
    }

    return false
}

async function getTokenBalanceMap(scanner, tokenAdx, accountList) {
    const multicallContractMainnetAdx = scanner.multicallContractMainnetAdx

    const humanReadableAbi = [
        "function balanceOf(address) public view returns (uint256)",
        "function aggregate(tuple(address target, bytes callData)[] calls) public returns (uint256 blockNumber, bytes[] memory returnData)",
    ]
    const iface = new ethers.utils.Interface(humanReadableAbi);

    const tokenBalanceMap = new Map()

    const step = 30
    for (let i = 0; i < accountList.length; i += step) {
        const j = Math.min(i + step - 1, accountList.length - 1)

        const calls = []
        for (let m = i; m <= j; m++) {
            const callData = iface.encodeFunctionData('balanceOf', [accountList[m]])

            calls.push({
                target: tokenAdx,
                callData,
            })
        }

        const calldata = iface.encodeFunctionData('aggregate', [calls])

        try {
            const resp = await axios.post(scanner.rpc, {
                "jsonrpc": "2.0",
                "method": "eth_call",
                "params": [{
                    to: multicallContractMainnetAdx,
                    data: calldata,
                }, 'latest'],
                "id": 1
            }, {
                headers: {
                    'Content-Type': 'application/json',
                }
            })
            // console.log('resp:', resp.data)

            const { returnData } = iface.decodeFunctionResult('aggregate', resp.data.result)

            for (let m = i; m <= j; m++) {
                const balance = ethers.BigNumber.from(returnData[m - i])
                // console.log('bal', accountList[m], balance / 10 ** 18)

                tokenBalanceMap.set(accountList[m], balance)
            }
        } catch (error) {
            console.log('multicallContract.callStatic.tryBlockAndAggregate fail, err:', error)
        }
    }

    return tokenBalanceMap
}

function sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
}

main().then(() => process.exit(0))
// testEvents().then(() => process.exit(0))