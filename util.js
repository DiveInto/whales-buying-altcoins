const fs = require('fs')

class LastUpdatedBlocks {
    constructor(chain) {
        this.filename = `./outputs/lastupdate/${chain}.json`
        try {
            this.lastupdates = JSON.parse(fs.readFileSync(this.filename, 'utf8'))
        } catch(e) {
            this.lastupdates = {}
        }
    }

    get(address) {
        return this.lastupdates[address];
    }

    update(address, block) {
        this.lastupdates[address] = block
        fs.writeFileSync(this.filename, JSON.stringify(this.lastupdates, null, 2))
    }
}


// const filename = './outputs/lastupdate/lastupdate.json'
// let lastupdates


// function get(address) {
//     return lastupdates[address];
// }

// function update(address, block) {
//     lastupdates[address] = block
//     fs.writeFileSync(filename, JSON.stringify(lastupdates, null, 2))
// }


module.exports = {
    LastUpdatedBlocks,
    // update
}