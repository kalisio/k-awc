import _ from 'lodash'
import winston from 'winston'

const TTL = +process.env.TTL || (30 * 24 * 60 * 60)  // duration in seconds
const DB_URL = process.env.DB_URL || 'mongodb://127.0.0.1:27017/awc'
const STATIONS_COLLECTION = 'awc-stations'
const DATA = process.env.DATA || 'metars'
const DATA_COLLECTION = `awc-${DATA}`
const OUTPUT_DIR = './output'

export default {
  id: `awc-metars-tafs`,
  store: 'fs',
  options: {
    workersLimit: 1
  },
  tasks: [{
    id: `${DATA}.gz`,
    type: 'http',
    options: {
      url: `https://aviationweather.gov/data/cache/${DATA}.cache.csv.gz`
    }
  }],
  hooks: {
    tasks: {
      after: {
        gunzipFromStore: {
          input: { store: 'fs', key: `${DATA}.gz` },
          output: { store: 'fs', key: `${DATA}.csv` }
        },
        readCSV: {
          store: 'fs',          
          key: `${DATA}.csv`,
          skipFirstNLines: 6
        },
        apply: {
          function: (item) => {
            if (_.isEmpty(item.data)) return
            let features = []
            let errors = 0
            let i = 0
            for (const data of item.data) {
                i++
                const icaoId = `#${data[1]}`
                const station = _.find(item.stations, (station) => {
                  return _.get(station, 'properties.icao') === icaoId
                })
              if (station) {
                let feature = {
                  type: 'Feature',
                  time: data[2],
                  geometry: station.geometry,
                  properties: {
                    key: `${data[1]}-${data[2]}`,
                    name: _.get(station, 'properties.site', data[1]),
                    icao: icaoId,
                    temperature: _.toNumber(data[5]),
                    dewpoint: _.toNumber(data[6]),
                    windDirection: _.toNumber(data[7]),
                    windSpeed: _.toNumber(data[8]),
                    windGust: _.toNumber(data[9]),
                    rawOb: data[0],
                  }
                }
                // visibility
                if (!_.isEmpty(data[10])) {
                  let visiblity = Math.ceil(_.toNumber(_.replace(data[10], '+', '')) / 1000) * 1000
                  _.set(feature, 'properties.visibility',visiblity)
                }
                // cloud cover
                if (!_.isEmpty(data[22])) {
                  _.set(feature, 'properties.cloudCover',data[22])
                }
                features.push(feature)
              } else {
                console.warn(`<!> ${i}th element has invalid icao code: ${icaoId}`)
                errors++
              }
            }
            item.data = features
          }
        },
        log: (logger, item) => logger.info(`${_.size(item.data)} ${DATA} found.`),
        updateMongoCollection: {
          collection: DATA_COLLECTION,
          filter: { 'properties.key': '<%= properties.key %>' },
          upsert : true,
          transform: {
            unitMapping: { time: { asDate: 'utc' } } 
          },
          chunkSize: 512
        },
        clearData: {}
      }
    },
    jobs: {
      before: {
        printEnv: {
          DATA: DATA,
          TTL: TTL
        },
        createStores: [
          { id: 'memory' },
          { 
            id: 'fs', 
            options: { 
              path: OUTPUT_DIR
            } 
          }
        ],
        createLogger: {
          loggerPath: 'taskTemplate.logger',
          Console: {
            format: winston.format.printf(log => winston.format.colorize().colorize(log.level, `${log.level}: ${log.message}`)),
            level: 'verbose'
          }
        },        
        connectMongo: {
          url: DB_URL,
          clientPath: 'taskTemplate.client'
        },
        createMongoCollection: {
          clientPath: 'taskTemplate.client',
          collection: DATA_COLLECTION,
          indices: [
            [{'properties.key': 1 }, { unique: true }],
            { 'properties.icao': 1 },
            [{ 'properties.icao': 1, time: -1 }, { background: true }],
            [{ 'properties.icao': 1, 'properties.temperature': 1, time: -1 }, { background: true }],
            [{ 'properties.icao': 1, 'properties.dewpoint': 1, time: -1 }, { background: true }],
            [{ 'properties.icao': 1, 'properties.windSpeed': 1, time: -1 }, { background: true }],
            [{ 'properties.icao': 1, 'properties.windDirection': 1, time: -1 }, { background: true }],
            [{ 'properties.icao': 1, 'properties.windGust': 1, time: -1 }, { background: true }],
            [{ 'properties.icao': 1, 'properties.cloudCover': 1, time: -1 }, { background: true }],
            [{ 'properties.icao': 1, 'properties.visibility': 1, time: -1 }, { background: true }],
            { 'properties.temperature': 1 },
            { 'properties.dewpoint': 1 },
            { 'properties.windSpeed': 1 },
            { 'properties.windDirection': 1 },
            { 'properties.windGust': 1 },
            { 'properties.cloudCover': 1 },
            { 'properties.visibility': 1 },
            [{ time: 1 }, { expireAfterSeconds: TTL }], // days in s
            { geometry: '2dsphere' }                                                                                                              
          ],
        },
        readMongoCollection: {
          clientPath: 'taskTemplate.client',
          collection: STATIONS_COLLECTION,
          dataPath: 'data.taskTemplate.stations'
        }
      },
      after: {
        clearData: {},
        disconnectMongo: {
          clientPath: 'taskTemplate.client'
        },
        removeLogger: {
          loggerPath: 'taskTemplate.logger'
        },         
        removeStores: ['memory', 'fs']
      },
      error: {
        disconnectMongo: {
          clientPath: 'taskTemplate.client'
        },
        removeLogger: {
          loggerPath: 'taskTemplate.logger'
        },         
        removeStores: ['memory', 'fs']
      }
    }
  }
}
