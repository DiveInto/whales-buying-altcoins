const fsPromises = require('fs/promises');

async function appendToFile(fileFullPath, content) {
    await fsPromises.writeFile(fileFullPath, content, {
        flag: 'a', //Open file for appending. The file is created if it does not exist.
    })
}

async function overwriteFile(fileFullPath, content) {
    await fsPromises.writeFile(fileFullPath, content, {
        flag: 'w', //Open file for writing. The file is created (if it does not exist) or truncated (if it exists).
    })
}

module.exports = {
    appendToFile,
    overwriteFile,
}