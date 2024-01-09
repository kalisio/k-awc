import _ from 'lodash'

const outputDir = './output'

const dbUrl = process.env.DB_URL || 'mongodb://127.0.0.1:27017/awc'
const ttl = +process.env.TTL || (30 * 24 * 60 * 60)  // duration in seconds

export default {
  id: 'metars',
  store: 'fs',
  options: {
    workersLimit: 1
  },
  tasks: [{
    id: 'metars.gz',
    type: 'http',
    options: {
      url: `https://aviationweather.gov/data/cache/metars.cache.csv.gz`
    }
  }],
  hooks: {
    tasks: {
      after: {
        gunzipFromStore: {
          input: { store: 'fs', key: 'metars.gz' },
          output: { store: 'fs', key: 'metars.csv' }
        },
        readCSV: {
          store: 'fs',          
          key: 'metars.csv',
          // skipFirstLines: 5, still not working with the latest release of Papaparses
        },
        apply: {
          function: (item) => {
            let metars = []
            let errors = 0
            for (let i = 6; i < item.data.length; i++) {
              const metar = item.data[i]
              const icaoId = `#${metar[1]}`
              const station = _.find(item.stations, station => {
                return _.get(station, 'properties.icao') === icaoId
              })
              if (station) {
                let feature = {
                  type: 'Feature',
                  time: metar[2],
                  geometry: station.geometry,
                  properties: {
                    key: `${metar[1]}-${metar[2]}`,
                    name: _.get(station, 'properties.site', metar[1]),
                    icao: icaoId,
                    temperature: _.toNumber(metar[5]),
                    dewpoint: _.toNumber(metar[6]),
                    windDirection: _.toNumber(metar[7]),
                    windSpeed: _.toNumber(metar[8]),
                    windGust: _.toNumber(metar[9]),
                    rawOb: metar[0],
                  }
                }
                // visibility
                if (!_.isEmpty(metar[10])) {
                  let visiblity = Math.ceil(_.toNumber(_.replace(metar[10], '+', '')) / 1000) * 1000
                  _.set(feature, 'properties.visibility',visiblity)
                }
                // cloud cover
                if (!_.isEmpty(metar[22])) {
                  _.set(feature, 'properties.cloudCover',metar[22])
                }
                metars.push(feature)
              } else {
                console.warn(`<!> ${i}th element has invalid icao code: ${icaoId}`)
                errors++
              }
            }
            console.log(`<i> Found ${item.data.length - errors} valid metars over ${item.data.length}`)
            item.data = metars
          }
        },
        updateMongoCollection: {
          collection: 'awc-metars',
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
          collection: 'awc-metars',
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
            [{ time: 1 }, { expireAfterSeconds: ttl }], // days in s
            { geometry: '2dsphere' }                                                                                                              
          ],
        },
        readMongoCollection: {
          clientPath: 'taskTemplate.client',
          collection: 'awc-stations',
          dataPath: 'data.taskTemplate.stations'
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
