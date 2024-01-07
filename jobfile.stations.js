import _ from 'lodash'

const outputDir = './output'

const dbUrl = process.env.DB_URL || 'mongodb://127.0.0.1:27017/metar-taf'

export default {
  id: 'metar-taf',
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
            console.log('<i> Found', stations.length, 'stations')
            item.data = stations
          }
        },
        updateMongoCollection: {
          collection: 'metar-taf-stations',
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
              path: outputDir
            } 
          }
        ],
        connectMongo: {
          url: dbUrl,
          // Required so that client is forwarded from job to tasks
          clientPath: 'taskTemplate.client'
        },
        createMongoCollection: {
          clientPath: 'taskTemplate.client',
          collection: 'metar-taf-stations',
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
        removeStores: ['memory', 'fs']
      },
      error: {
        disconnectMongo: {
          clientPath: 'taskTemplate.client'
        },
        removeStores: ['memory', 'fs']
      }
    }
  }
}
