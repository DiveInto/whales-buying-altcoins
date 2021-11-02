const { ethers } = require("hardhat")
const erc20ABI = require('./ERC20.json')

async function getTransferEvents(tokenAdx, {
    fromBlockNumber = -50,
    toBlockNumber = 'latest',
    provider,
} = {}) {

    if (!provider) {
        provider = ethers.provider
    }

    if (toBlockNumber === 'latest') {
        const block = await provider.getBlock()
        toBlockNumber = block.number
        console.log('update toBlockNumber from latest to ', toBlockNumber)
    }

    if (fromBlockNumber < 0) {
        fromBlockNumber = toBlockNumber + fromBlockNumber
    }
    // console.log(fromBlockNumber, toBlockNumber)

    const erc20Contract = new ethers.Contract(tokenAdx, erc20ABI, provider)

    const filter = erc20Contract.filters.Transfer()

    const rstEvents = []

    const steps = 900
    for (let from = fromBlockNumber; from <= toBlockNumber; from += steps) {
        to = Math.min(from + steps - 1, toBlockNumber)

        const curEvents = await erc20Contract.queryFilter(filter, from, to)
        rstEvents.push(...curEvents)

        // console.log('', from, to, curEvents.length)
    }

    return rstEvents
}

module.exports = {
    getTransferEvents,
}