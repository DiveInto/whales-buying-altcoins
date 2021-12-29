require('dotenv').config()
const { Client } = require("@notionhq/client")

// Initializing a client
const notion = new Client({
  auth: process.env.NOTION_TOKEN,
})


function getText(property) {
  type = property['type']
  if (type == 'title') {
    return property['title'][0]['plain_text']
  } else if(type == 'select') {
    return property['select']['name']
  }
}

async function setIgnoreAddress(token_address, chain, tags){
  try{
    const response = await notion.pages.create({
      parent: {
        database_id: '9cf7a38696824a7b85dd7aaed0b5bf8b',
      },
      properties: {
        'Address': addText('title', token_address),
        'Chain': addText('select', chain),
        'Tags': addText('select', tags),
     }
    })
  } catch (e) {
    console.log(e)
    console.log('Write to notion error, ignore for now')
  }

}

async function getIgnoreAddress() {
  const rows = await notion.databases.query({
    database_id: "9cf7a38696824a7b85dd7aaed0b5bf8b",
    // filter: {
    //   property: "name",
    //   text: {
    //     contains: "bnb",
    //   },
    // },
  })
  ignoreFrom = [];
  ignoreTo = [];
  for (let row of rows['results']) {
    address = getText(row['properties']['Address'])
    tags =  getText(row['properties']['Tags'])
    ignoreTo.push(address);

    if(tags == 'StakingContract') {
      ignoreFrom.push(address)
    }
  }

  return {
    'from': ignoreFrom,
    'to': ignoreTo
  }
}


function addText(type, value) {
  if (type == 'title') {
    return  {
      'title': [
        {
          'text': {
            'content': value,
          },
        },
      ],
    }
  } else if (type == 'rich_text') {
      return {
        'rich_text': [
          {
            "type": "text",
            "text": {
              'content': value,
            },
          },
        ],
      }
  } else if (type == 'number') {
    return { number: value}
  } else if (type == 'select') {
    return {select: { name: value}}
  }
}

async function createLargeHolder(symbol, token_address, chain, account_holder, balInUSD, txHash, txValue,) {
  console.log('Save to db', symbol, token_address, chain, account_holder, balInUSD, txHash, txValue);

  const response = await notion.pages.create({
    parent: {
      database_id: '73cac93c3fd44751937ca31195d03cdb',
    },
    properties: {
      'Token': addText('title', symbol),
      'TokenAddress': addText('rich_text', token_address),
      'Chain': addText('rich_text', chain),
      'Holder': addText('rich_text', account_holder),
      'BalanceInUSD': addText('number', Math.round(balInUSD)),
      'txHash': addText('rich_text', txHash),
      'txValue': addText('number', Math.round(txValue)),
      // // 'Food group': {
      //   select: {
      //     name: '🥦 Vegetable',
      //   },
      // },
      // Price: {
      //   number: 2.5,
      // },
   }
  });
}

async function ceateLastUpdated(token_address, lastBlock) {
  const response = await notion.pages.create({
    parent: {
      database_id: 'b8a249f3728a4c04b3717b3a081423ef',
    },
    properties: {
      Address: addText('title', 'sdfsdfsdf'),
      LastBlock: addText('rich_text', '123')
      // // 'Food group': {
      //   select: {
      //     name: '🥦 Vegetable',
      //   },
      // },
      // Price: {
      //   number: 2.5,
      // },
   }
  });
  console.log(response)
}

// ;(async () => {
//   // await createLargeHolder('Immutable X', '0xf57e7e7c23978c3caec3c3548e3d615c346e79ff','eth', '0xa910f92acdaf488fa6ef02174fb86208ad7722ba', 2456700, '0xf17b5f70b79c66b1bffb16b314d2d8860c96436c28a432cb1f30200d5af0b2b9', 51288);
//   // await setIgnoreAddress('sdfsdfsd', 'avax', 'cotract')
//   var a = await getIgnoreAddress()
//   console.log(a)
// })()


module.exports = {
  getIgnoreAddress,
  setIgnoreAddress,
  createLargeHolder,
}