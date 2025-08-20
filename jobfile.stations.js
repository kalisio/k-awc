import _ from 'lodash'
import winston from 'winston'

const DB_URL = process.env.DB_URL || 'mongodb://127.0.0.1:27017/awc'
const STATIONS_COLLECTION = 'awc-stations'
const OUTPUT_DIR = './output'

export default {
  id: 'stations',
  store: 'fs',
  options: {
    workersLimit: 1
  },
  tasks: [{
    id: 'stations.gz',
    type: 'http',
    options: {
      url: `https://aviationweather.gov/data/cache/stations.cache.json.gz`
    }
  }],
  hooks: {
    tasks: {
      after: {
        gunzipFromStore: {
          input: { store: 'fs', key: 'stations.gz' },
          output: { store: 'fs', key: 'stations.json' }
        },
        readJson: {
          store: 'fs',
          key: 'stations.json'
        },
        apply: {
          function: (item) => {
            let stations = []
            _.forEach(item.data, station => {
              // check whether the coordinates are valid
              if (station.elev !== 9999) {
                stations.push({
                  type: 'Feature',
                  geometry: {
                    type: 'Point',
                    coordinates: [station.lon, station.lat, station.elev]
                  },
                  properties: Object.assign({ icao: `#${station.icaoId}`, name: station.site }, _.omit(station, ['lat', 'lon', 'elev']))
                })
              }
            })
            item.data = stations
          }
        },
        log: (logger, item) => logger.info(`${_.size(item.data)} stations found.`),
        updateMongoCollection: {
          collection: STATIONS_COLLECTION,
          filter: { 'properties.icao': '<%= properties.icao %>' },
          upsert : true,
          chunkSize: 512
        },
        clearData: {}
      }
    },
    jobs: {
      before: {
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
          // Required so that client is forwarded from job to tasks
          clientPath: 'taskTemplate.client'
        },
        createMongoCollection: {
          clientPath: 'taskTemplate.client',
          collection: STATIONS_COLLECTION,
          indices: [
            [{ 'properties.icao': 1 }, { unique: true }],
            { geometry: '2dsphere' }                                                                                                              
          ]
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
