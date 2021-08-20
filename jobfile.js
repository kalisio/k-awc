const _ = require('lodash')

const dbUrl = process.env.DB_URL || 'mongodb://127.0.0.1:27017/metar-taf'
const ttl = +process.env.TTL || (7 * 24 * 60 * 60)  // duration in seconds
const bbox = process.env.BBOX || '-180,-90,180,90'
const data = process.env.DATA || 'metar'

// computed var
const script = _.capitalize(data) + 'JSON.php'
const collection = data === 'metar' ? 'observations' : 'forecasts'
const timePath = data === 'metar' ? 'properties.obsTime' : 'properties.issueTime'

module.exports = {
  id: 'metar-taf',
  store: 'memory',
  options: {
    workersLimit: 1
  },
  tasks: [{
    id: 'metar-taf',
    type: 'http',
    options: {
      url: `https://www.aviationweather.gov/cgi-bin/json/${script}?bbox=${bbox}`
    }
  }],
  hooks: {
    tasks: {
      before: {
        createMongoAggregation: {
          dataPath: 'data.mostRecentData',
          collection: 'metar-taf-' + collection,
          pipeline: [
            { $sort: { 'properties.dataId': 1, time: 1 } },
            { $group: {
                _id: "$properties.dataId",
                lastDate: { $last: "$time" }
              }
            }
          ],
          allowDiskUse: true
        }
      },
      after: {
        readJson: {},
        transformJson: {
          transformPath: 'features',
          filter: { id: { $exists: true } } // Skips the first element
        },
        apply: {
          function: (item) => {
            let newData = []
            _.forEach(item.data.features, (feature) => {
              const featureTime = new Date(_.get(feature, timePath)).getTime()
              let existingData = _.find(item.mostRecentData, (data) => {
                const lastTime = data.lastDate.getTime()
                return data._id === feature.id && lastTime === featureTime
              })
              if (existingData === undefined) newData.push(feature)
            })
            console.log('Found ' + newData.length + ' new data')
            item.data = newData
          }
        },
        writeData: {
          hook: 'writeMongoCollection',
          collection: 'metar-taf-' + collection,
          transform: {
            mapping: {
              [timePath]: { path: 'time', delete: false },
              'id': 'properties.dataId',
              'properties.id': 'properties.icao'
            },
            omit: [
              'properties.data'
            ],
            unitMapping: { time: { asDate: 'utc' } } 
          },
          chunkSize: 256
        },
        updateStations: {
          hook: 'updateMongoCollection',
          collection: 'metar-taf-stations',
          filter: { 'properties.icao': '<%= properties.icao %>' },
          upsert : true,
          transform: {
            omit: [ 
              'time',
              'properties.dataId',
              'properties.prior',
              'properties.obsTime',
              'properties.issueTime',
              'properties.validTimeFrom',
              'properties.validTimeTo',
              'properties.validTime',
              'properties.timeGroup',
              'properties.fcstType',              
              'properties.temp', 
              'properties.dewp', 
              'properties.wspd', 
              'properties.wdir',
              'properties.ceil',
              'properties.cover',
              'properties.cldCvg1',
              'properties.cldBas1',
              'properties.cldCvg2',
              'properties.cldBas2',
              'properties.cldCvg3',
              'properties.cldBas3',
              'properties.cldCvg4',
              'properties.cldBas4',
              'properties.visib',
              'properties.fltcat',
              'properties.altim',
              'properties.slp',
              'properties.wx',
              'properties.rawOb',
              'properties.rawTAF' ]
          },
          chunkSize: 256
        },
        clearData: {}
      }
    },
    jobs: {
      before: {
        createStores: [{ id: 'memory' }],
        connectMongo: {
          url: dbUrl,
          // Required so that client is forwarded from job to tasks
          clientPath: 'taskTemplate.client'
        },
        createDataCollection: {
          hook: 'createMongoCollection',
          clientPath: 'taskTemplate.client',
          collection: 'metar-taf-' + collection,
          indices: [
            [{ time: 1, 'properties.dataId': 1 }, { unique: true }],
            { 'properties.temp': 1 },
            { 'properties.dewp': 1 },
            { 'properties.dataId': 1, 'properties.temp': 1, time: -1 },
            { 'properties.dataId': 1, 'properties.dewp': 1, time: -1 },
            [{ time: 1 }, { expireAfterSeconds: ttl }], // days in s
            { geometry: '2dsphere' }                                                                                                              
          ],
        },
        createStationsCollection: {
          hook: 'createMongoCollection',
          clientPath: 'taskTemplate.client',
          collection: 'metar-taf-stations',
          indices: [
            [{ 'properties.icao': 1 }, { unique: true }],
            { geometry: '2dsphere' }                                                                                                              
          ]
        }
      },
      after: {
        disconnectMongo: {
          clientPath: 'taskTemplate.client'
        },
        removeStores: ['memory']
      },
      error: {
        disconnectMongo: {
          clientPath: 'taskTemplate.client'
        },
        removeStores: ['memory']
      }
    }
  }
}
