const { ethers } = require("hardhat")
const { getTransferEvents } = require("./erc20")
const { appendToFile, overwriteFile } = require("./file")
const { default: axios } = require("axios")

const manualListed = [
    '0x956F47F50A910163D8BF957Cf5846D573E7f87CA'.toLowerCase(), //FEI
    '0xdf574c24545e5ffecb9a659c229253d4111d87e1'.toLowerCase(), //HUSD
    '0xf34960d9d60be18cC1D5Afc1A6F012A723a28811'.toLowerCase(), //KuCoin
]

async function main() {
    let provider;
    if (process.env.PROVIDER_URL) {
        provider = ethers.providers.getDefaultProvider(process.env.PROVIDER_URL)
        console.log('init provider using env:', process.env.PROVIDER_URL)
    } else {
        provider = ethers.provider
    }

    const curBlock = await provider.getBlock()
    const toBlockNumber = curBlock.number
    const fromBlockNumber = curBlock.number - Math.floor(24 * 60 * 60 / 13)
    console.log('block range:', fromBlockNumber, toBlockNumber)

    const dateStr = new Date().toISOString().split('T')[0]

    const erc20Tokens = await getErc20FromCMCListings()
    const binanceTradingPairs = await getBinanceTradingPairs()

    const notListedErc20Tokens = getNotListedErc20Tokens(erc20Tokens, binanceTradingPairs)
    console.log('not listed at binance:', notListedErc20Tokens.length)

    const afterRank100NotListedToken = []

    const tokensFile = `./outputs/${dateStr}-${fromBlockNumber}-token.csv`
    await overwriteFile(tokensFile, 'name, symbol, cmcRank, tokenAddress, usdPrice, tags\n')

    for (let token of notListedErc20Tokens) {
        if (token.cmc_rank <= 100) {
            continue
        }

        afterRank100NotListedToken.push(token)

        const { name, symbol, cmc_rank, token_address, usdPrice, tags = [] } = token

        const content = `${name}, ${symbol}, ${cmc_rank}, ${token_address}, ${usdPrice}, ${tags.join(' ')}\n`
        await appendToFile(tokensFile, content)
    }
    console.log('rank > 100, not listed at binance:', afterRank100NotListedToken.length)

    // filter events and find 
    // map(token -> account -> {balance, recentBuy}
    const tokenHolderMap = new Map()


    for (let i = 0; i < afterRank100NotListedToken.length; i++) {
        console.log(`\nprogressing token ${i}/${afterRank100NotListedToken.length}`)

        const token = afterRank100NotListedToken[i]
        // const token = { "name": "KingDeFi", "symbol": "KRW", "cmc_rank": 2801, "token_address": "0x499568c250Ab2a42292261d6121525d70691894b ", "tags": ["binance-smart-chain"], "usdPrice": 0.0008199324107718525 }

        console.log('!', JSON.stringify(token))

        token.token_address = token.token_address.trim()

        //test
        // if (token.token_address != '0x853d955acef822db058eb8505911ed77f175b99e') {
        //     continue
        // }

        try {
            const largeHolderMap = await getLargeHolderMap(token, provider, { fromBlockNumber, toBlockNumber })
            if (largeHolderMap.size <= 0) {
                continue
            }

            tokenHolderMap.set(token.token_address, largeHolderMap)
        } catch (error) {
            console.log('fail to getLargeHolderMap of:', token, 'error:', error)
        }
    }
    console.log('tokens done')

    // console.log(tokenHolderMap)
    const adxToTokenMap = new Map()
    for (let token of erc20Tokens) {
        adxToTokenMap.set(token.token_address, token)
    }

    const etherscanProvider = new ethers.providers.EtherscanProvider('homestead', process.env.ETHERSCAN_KEY);

    const summaryFileName = `./outputs/${dateStr}-${fromBlockNumber}-account.csv`
    await overwriteFile(summaryFileName, `token, holder, balanceInUSD\n`)

    for (let [tokenAdx, largeHolders] of tokenHolderMap) {
        const token = adxToTokenMap.get(tokenAdx)

        for (let [holder, holderInfo] of largeHolders) {
            // console.log(`${token.name}, ${token.token_address}, ${holder}, ${holderInfo.balInUSD}, ${holderInfo.txs}`)
            // let isLowActivity = false

            // let txCntLast30days = '-';
            // const txCnt = await provider.getTransactionCount(holder)
            // if (txCnt <= 1000) {
            //     isLowActivity = true
            // } else {
            //     // less than 50 tx in a month is low activity too
            //     try {
            //         const fromBlockNum = curBlock.number - 30 * 24 * 60 * 60 / 13
            //         const toBlockNum = curBlock.number

            //         console.log('using etherscan provider...')
            //         const his = await etherscanProvider.getHistory(holder, fromBlockNum, toBlockNum)
            //         if (his.length <= 50) {
            //             isLowActivity = true
            //             txCntLast30days = his.length
            //         }
            //     } catch (err) {
            //         console.log('etherscan err, ignored', err)
            //         sleep(5 * 1000)
            //     }
            // }

            // if (!isLowActivity) {
            //     continue
            // }

            const content = `${token.name}(${token.token_address}), ${holder}, ${holderInfo.balInUSD}\n`
            await appendToFile(summaryFileName, content)
        }
    }
}

// {
//   adx => {
//     bal,
//     balInUSD, 
//     txs: [{hash, valInUSD}, {}]
//   }
// }
async function getLargeHolderMap(token, provider, {
    fromBlockNumber = -50,
    toBlockNumber = 'latest'
} = {}) {
    const largeHolderMap = new Map()

    const transferEvents = await getTransferEvents(token.token_address, {
        fromBlockNumber,
        toBlockNumber,
        provider,
    })

    const canBeIgnoredUserMap = new Map()

    const possibleAccounts = []
    for (let event of transferEvents) {
        const val = ethers.BigNumber.from(event.data)
        const valInUSD = val / 10 ** 18 * token.usdPrice
        if (valInUSD <= 10000) {
            continue
        }

        const toAdx = '0x' + event.topics[2].substring(24 + 2)
        if (canBeIgnoredUserMap.get(toAdx)) {
            continue
        }

        possibleAccounts.push(toAdx)
    }

    const distinctPossibleAccounts = [...new Set(possibleAccounts)]
    console.log('distinctPossibleAccounts:', distinctPossibleAccounts.length)

    const tokenBalanceMap = await getTokenBalanceMap(token.token_address, distinctPossibleAccounts)
    console.log('tokenBalanceMap:', tokenBalanceMap.size)

    for (let event of transferEvents) {

        const val = ethers.BigNumber.from(event.data)
        const valInUSD = val / 10 ** 18 * token.usdPrice
        if (valInUSD <= 10000) {
            continue
        }

        const toAdx = '0x' + event.topics[2].substring(24 + 2)
        if (canBeIgnoredUserMap.get(toAdx)) {
            continue
        }

        const existInfo = largeHolderMap.get(toAdx)
        if (existInfo) {
            // check duplicate
            const lastTxInfo = existInfo.txs[existInfo.txs.length - 1]
            if (lastTxInfo.hash === event.transactionHash) {
                continue
            }

            // push tx info
            existInfo.txs.push({
                hash: event.transactionHash,
                valInUSD,
            })

            continue
        }

        // check receiver balance
        const bal = tokenBalanceMap.get(toAdx)
        if (!bal) {
            continue
        }

        const balInUSD = bal / 10 ** 18 * token.usdPrice
        if (balInUSD <= 15_0000) {
            // ignore low balance user
            canBeIgnoredUserMap.set(toAdx, true)
            continue
        }

        // check if is contract
        try {
            const codeAtAddress = await provider.getCode(toAdx)
            if (codeAtAddress.length > 10) { //0x
                canBeIgnoredUserMap.set(toAdx, true)
                continue
            }

            // filter if this is direct transfer call
            const tx = await provider.getTransaction(event.transactionHash)
            const isTransferFuncCall = tx.data.startsWith(ethers.utils.id('transfer(address,uint256)').substring(0, 8 + 2))
            if (isTransferFuncCall) {
                continue
            }
        } catch (error) {
            console.log("error when getCode or getTransaction, skip and ignore", toAdx, event.transactionHash, error)
            continue
        }

        console.log('large (indirect) transfer of', token.name, event.transactionHash)
        console.log('large holder of', token.name, balInUSD, toAdx)

        largeHolderMap.set(toAdx, {
            bal,
            balInUSD,
            txs: [{ hash: event.transactionHash, valInUSD }]
        })
    }

    console.log('num of large holder of', token.symbol, largeHolderMap.size)
    console.log('largeHolderMap', largeHolderMap)

    return largeHolderMap
}

async function getErc20FromCMCListings() {
    const topN = 3000
    const cmcResp = await axios.get(`https://api.coinmarketcap.com/data-api/v3/cryptocurrency/listing?limit=${topN}&sortBy=market_cap&sortType=desc&convert=USD&cryptoType=all&tagType=all&audited=false`)

    const tokens = cmcResp.data.data.cryptoCurrencyList

    const erc20Tokens = []
    for (let token of tokens) {
        const platform = token.platform
        if (!platform || platform.name !== 'Ethereum') {
            continue
        }

        const tokenInfo = {
            name: token.name,
            symbol: token.symbol,
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

function getNotListedErc20Tokens(erc20Tokens, binanceTradingPairs) {
    const notListedErc20Tokens = []
    for (let erc20Token of erc20Tokens) {
        const isInBinance = isInBinanceTradingPair(erc20Token, binanceTradingPairs)
        if (isInBinance) {
            continue
        }

        if (manualListed.includes(erc20Token.token_address.toLowerCase())) {
            continue
        }

        notListedErc20Tokens.push(erc20Token)
    }

    return notListedErc20Tokens
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

async function getTokenBalanceMap(tokenAdx, accountList) {
    const multicallContractMainnetAdx = "0x5BA1e12693Dc8F9c48aAD8770482f4739bEeD696"

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
            const resp = await axios.post(process.env.PROVIDER_URL, {
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