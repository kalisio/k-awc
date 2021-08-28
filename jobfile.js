const krawler = require('@kalisio/krawler')
const hooks = krawler.hooks
const _ = require('lodash')
const path = require('path')

const dbUrl = process.env.DB_URL || 'mongodb://127.0.0.1:27017/metar-taf'
const ttl = +process.env.TTL || (7 * 24 * 60 * 60)  // duration in seconds
const data = process.env.DATA || 'metar'
const footprint = process.env.FOOTPRINT || false

// computed var
const script = _.capitalize(data) + 'JSON.php'
const collection = data === 'metar' ? 'observations' : 'forecasts'
const timePath = data === 'metar' ? 'properties.obsTime' : 'properties.issueTime'

// Create a custom hook to generate tasks
let generateTasks = (options) => {
  return (hook) => {
    let footprintCollection = {
      type: 'FeatureCollection',
      'features': [] 
    }
    let tasks = []
    _.forEach(options.grids, grid => {
      const cellWidth = (grid.bbox[2] - grid.bbox[0]) / grid.columns
      const cellHeight = (grid.bbox[3] - grid.bbox[1]) / grid.rows
      for (let i = 0; i < grid.columns; i++) {
        for (let j = 0; j < grid.rows; j++) {
          const east=grid.bbox[0] + (i * cellWidth)
          const south=grid.bbox[1] + (j * cellHeight)
          const west=east + cellWidth
          const north=south + cellHeight
          footprintCollection.features.push({
            type: 'Feature',
            properties: {},
            geometry: {
              type: 'Polygon',
              coordinates: [
                [ [east, south], [west, south], [west, north], [east, north], [east, south] ]
              ]
            } 
          })
          console.log(`Task created for the bbox=${east},${south},${west},${north}`)
          let task = {
            options: {
              url: `https://www.aviationweather.gov/cgi-bin/json/${script}?priority=8&bbox=${east},${south},${west},${north}`
            }
          }
          tasks.push(task)
        }
      }
    })
    hook.data.tasks = tasks
    hook.data.footprint = footprintCollection
    return hook
  }
}
hooks.registerHook('generateTasks', generateTasks)

module.exports = {
  id: 'metar-taf',
  store: 'memory',
  options: {
    workersLimit: 1
  },
  taskTemplate: {
    id: 'metar-taf/<%= taskId %>',
    type: 'http'
  },
  hooks: {
    tasks: {
      before: {
        createMongoAggregation: {
          dataPath: 'data.mostRecentData',
          collection: 'metar-taf-' + collection,
          pipeline: [
            { $sort: { 'properties.icao': 1, time: 1 } },
            { $group: {
                _id: "$properties.icao",
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
                return data._id === feature.properties.id && lastTime === featureTime
              })
              if (existingData === undefined) newData.push(feature)
            })
            console.log(newData.length + ' new data found')
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
              'properties.site': 'properties.name',
              'properties.temp': 'properties.temperature',
              'properties.dewp': 'properties.dewpointTemperature',
              'properties.wspd': 'properties.windSpeed',
              'properties.wdir': 'properties.windDirection',
              'properties.wgst': 'properties.windGust',
              'properties.cover': 'properties.cloudCover',
              'properties.visib': 'properties.visibility',
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
              'properties.obsTime',
              'properties.issueTime',
              'properties.validTimeFrom',
              'properties.validTimeTo',
              'properties.validTime',
              'properties.timeGroup',
              'properties.fcstType',              
              'properties.temperature',
              'properties.dewpointTemperature', 
              'properties.windSpeed', 
              'properties.windDirection',
              'properties.windGust',
              'properties.ceil',
              'properties.cloudCover',
              'properties.cldType1',
              'properties.cldCvg1',
              'properties.cldBas1',
              'properties.cldType2',
              'properties.cldCvg2',
              'properties.cldBas2',
              'properties.cldType3',
              'properties.cldCvg3',
              'properties.cldBas3',
              'properties.cldType4',
              'properties.cldCvg4',
              'properties.cldBas4',
              'properties.visibility',
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
        createStores: [
          { id: 'memory' },
          { 
            id: 'fs', 
            options: { 
              path: path.join(__dirname, '..', 'output') 
            } 
          }
        ],
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
            { time: 1, 'propertiess.icao': 1 },
            { 'properties.temperature': 1 },
            { 'properties.dewpointTemperature': 1 },
            { 'properties.windSpeed': 1 },
            { 'properties.windDirection': 1 },
            { 'properties.windGust': 1 },
            { 'properties.cloudCover': 1 },
            { 'properties.visibility': 1 },
            { 'properties.dataId': 1, 'properties.temperature': 1, time: -1 },
            { 'properties.dataId': 1, 'properties.dewpointTemperature': 1, time: -1 },
            { 'properties.dataId': 1, 'properties.temperature': 1, time: -1 },
            { 'properties.dataId': 1, 'properties.windSpeed': 1, time: -1 },
            { 'properties.dataId': 1, 'properties.windDirection': 1, time: -1 },
            { 'properties.dataId': 1, 'properties.windGust': 1, time: -1 },
            { 'properties.dataId': 1, 'properties.cloudCover': 1, time: -1 },
            { 'properties.dataId': 1, 'properties.visibility': 1, time: -1 },
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
        },
        generateTasks: {
          grids: [
            { bbox: [-180, -80, 180, -40], columns: 2, rows: 1 },
            { bbox: [-180, -40, 180, 20], columns: 6, rows: 3 },
            { bbox: [-180, 20, -130, 60], columns: 1, rows: 2 },
            { bbox: [-130, 20, -60, 30], columns: 4, rows: 1 },
            { bbox: [-130, 30, -60, 50], columns: 8, rows: 4 },
            { bbox: [-130, 50, -60, 60], columns: 4, rows: 1 },
            { bbox: [-60, 20, 0, 60], columns: 1, rows: 2 },
            { bbox: [0, 20, 60, 40], columns: 4, rows: 2 },
            { bbox: [0, 40, 30, 60], columns: 4, rows: 4 },
            { bbox: [30, 40, 60, 60], columns: 2, rows: 2 },
            { bbox: [60, 20, 90, 60], columns: 1, rows: 4 },
            { bbox: [90, 20, 180, 60], columns: 3, rows: 2 },
            { bbox: [-180, 60, 180, 90], columns: 2, rows: 1 }
          ]
        }
      },
      after: {
        writeJson: {
          match: { predicate: () => { return footprint === true } },
          dataPath: 'data.footprint',
          store: 'fs'
        },
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
