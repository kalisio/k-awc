# k-awc

[![Latest Release](https://img.shields.io/github/v/tag/kalisio/k-awc?sort=semver&label=latest)](https://github.com/kalisio/k-awc/releases)
[![ci](https://github.com/kalisio/k-awc/actions/workflows/main.yaml/badge.svg)](https://github.com/kalisio/k-awc/actions/workflows/main.yaml)

A [Krawler](https://kalisio.github.io/krawler/) based service to download [METAR](https://en.wikipedia.org/wiki/METAR) and [TAF](https://en.wikipedia.org/wiki/Terminal_aerodrome_forecast) data from the [Aviation Weather Center](https://www.aviationweather.gov/).

## Description

The **k-awc** jobs allow to scrape data using the [api](https://aviationweather.gov/data/api/) provided by the **Avioation Weather Center**. 

The downloaded data are stored within a [MongoDB](https://www.mongodb.com/) database and more precisely in 3 collections:
* `awc-metars` that stores the **METAR** data
* `awc-tafs` that stores the **TAF** data
* `awc-stations` that stores the stations data

All records are stored in [GeoJson](https://fr.wikipedia.org/wiki/GeoJSON) format.

The job is executed according a specific cron expression. By default, every hours.

## Implementation

As far as possible, jobs use the [cache files](https://aviationweather.gov/data/api/#cache).

## Configuration

### stations

| Variable | Description |
|--- | --- |
| `DB_URL` | The mongoDB database URL. The default value is `mongodb://127.0.0.1:27017/awc` |
| `DEBUG` | Enables debug output. Set it to `krawler*` to enable full output. By default it is undefined. |

### metars

| Variable | Description |
|--- | --- |
| `DB_URL` | The mongoDB database URL. The default value is `mongodb://127.0.0.1:27017/awc` |
| `TTL` | The data time to live. It must be expressed in seconds and the default value is `2592000` (30 days) |
| `DEBUG` | Enables debug output. Set it to `krawler*` to enable full output. By default it is undefined. |

## Deployment

We personally use [Kargo](https://kalisio.github.io/kargo/) to deploy the service.

## Contributing

Please refer to [contribution section](./CONTRIBUTING.md) for more details.

## Authors

This project is sponsored by 

![Kalisio](https://s3.eu-central-1.amazonaws.com/kalisioscope/kalisio/kalisio-logo-black-256x84.png)

## License

This project is licensed under the MIT License - see the [license file](./LICENSE) for details
