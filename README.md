# signalk-tides

A SignalK plugin that provides tidal predictions for the vessel's position from various [sources](#sources).

## Installation

1. Install `signalk-tides` from the SignalK Appstore or manually by running `npm install signalk-tides` in the SignalK server directory (`~/.signalk`).

2. Optionally go to the plugin settings in "Server => Plugin Config => Tides" and configure which source to use.

## Usage

This plugin depends on `navigation.position`.

It publishes the following [tide data](https://signalk.org/specification/1.7.0/doc/vesselsBranch.html#vesselsregexpenvironmenttide):

* `environment.tide.heightHigh`
* `environment.tide.timeHigh`
* `environment.tide.heightLow`
* `environment.tide.timeLow`
* `environment.tide.heightNow`
* `environment.tide.stationName`
* `environment.tide.state` — tide trend, `rising` or `falling`
* `environment.tide.timeToNextExtreme` — seconds until the next high or low water

### Tides resource

It also registers a `tides` resource, which returns tide predictions for yesterday and the next 6 days for the vessel's position.

```
$ curl http://localhost:3000/signalk/v2/api/resources/tides
```

##### Request Parameters

* `date` (optional) - the date for which to get the tide predictions in the format `YYYY-MM-DD`. Default: yesterday's date.

##### Response

```json
{
   "extremes" : [
      {
         "time" : "2025-03-29T00:45:00.000Z",
         "type" : "Low",
         "value" : 0.025
      },
      {
         "time" : "2025-03-29T07:20:00.000Z",
         "type" : "High",
         "value" : 1.928
      },
      {
         "time" : "2025-03-29T13:18:00.000Z",
         "type" : "Low",
         "value" : 0.044
      },
      {
         "time" : "2025-03-29T19:45:00.000Z",
         "type" : "High",
         "value" : 1.815
      },
      {
         "time" : "2025-03-30T01:24:00.000Z",
         "type" : "Low",
         "value" : 0.164
      },
      {
         "time" : "2025-03-30T07:52:00.000Z",
         "type" : "High",
         "value" : 2.024
      },
      {
         "time" : "2025-03-30T14:05:00.000Z",
         "type" : "Low",
         "value" : -0.131
      },
      {
         "time" : "2025-03-30T20:43:00.000Z",
         "type" : "High",
         "value" : 1.733
      },
      {
         "time" : "2025-03-31T02:05:00.000Z",
         "type" : "Low",
         "value" : 0.334
      },
      {
         "time" : "2025-03-31T08:27:00.000Z",
         "type" : "High",
         "value" : 2.084
      },
      {
         "time" : "2025-03-31T14:53:00.000Z",
         "type" : "Low",
         "value" : -0.247
      },
      {
         "time" : "2025-03-31T21:44:00.000Z",
         "type" : "High",
         "value" : 1.632
      },
      {
         "time" : "2025-04-01T02:48:00.000Z",
         "type" : "Low",
         "value" : 0.517
      },
      {
         "time" : "2025-04-01T09:06:00.000Z",
         "type" : "High",
         "value" : 2.094
      },
      {
         "time" : "2025-04-01T15:46:00.000Z",
         "type" : "Low",
         "value" : -0.29
      },
      {
         "time" : "2025-04-01T22:51:00.000Z",
         "type" : "High",
         "value" : 1.529
      },
      {
         "time" : "2025-04-02T03:37:00.000Z",
         "type" : "Low",
         "value" : 0.695
      },
      {
         "time" : "2025-04-02T09:49:00.000Z",
         "type" : "High",
         "value" : 2.05
      },
      {
         "time" : "2025-04-02T16:43:00.000Z",
         "type" : "Low",
         "value" : -0.263
      },
      {
         "time" : "2025-04-03T00:04:00.000Z",
         "type" : "High",
         "value" : 1.448
      },
      {
         "time" : "2025-04-03T04:35:00.000Z",
         "type" : "Low",
         "value" : 0.847
      },
      {
         "time" : "2025-04-03T10:39:00.000Z",
         "type" : "High",
         "value" : 1.957
      },
      {
         "time" : "2025-04-03T17:50:00.000Z",
         "type" : "Low",
         "value" : -0.189
      },
      {
         "time" : "2025-04-04T01:24:00.000Z",
         "type" : "High",
         "value" : 1.421
      },
      {
         "time" : "2025-04-04T05:49:00.000Z",
         "type" : "Low",
         "value" : 0.946
      },
      {
         "time" : "2025-04-04T11:40:00.000Z",
         "type" : "High",
         "value" : 1.837
      },
      {
         "time" : "2025-04-04T19:07:00.000Z",
         "type" : "Low",
         "value" : -0.11
      },
      {
         "time" : "2025-04-05T02:40:00.000Z",
         "type" : "High",
         "value" : 1.455
      },
      {
         "time" : "2025-04-05T07:19:00.000Z",
         "type" : "Low",
         "value" : 0.958
      },
      {
         "time" : "2025-04-05T12:53:00.000Z",
         "type" : "High",
         "value" : 1.728
      },
      {
         "time" : "2025-04-05T20:25:00.000Z",
         "type" : "Low",
         "value" : -0.061
      }
   ],
   "station" : {
      "name" : "Rincon Point, Pier 22 1/2",
      "position" : {
         "latitude" : 37.79,
         "longitude" : -122.387
      }
   }
}
```

## Sources

- [Neaps](https://github.com/neaps/neaps)
  - Offline, open source, runs locally
  - Coverage: Regional — United States and territories (currently)
- [NOAA](https://tidesandcurrents.noaa.gov/web_services_info.html)
  - Online (NOAA web services)
  - Regional — United States and territories
- [WorldTides API](https://www.worldtides.info/)
  - Online (requires API key, subject to API quotas)
  - Coverage: Global - station and model coverage varies by location
- [StormGlass.io](https://stormglass.io/)
  - Online (requires API key)
  - Coverage: Global - aggregated marine data; tide availability varies

## License

This plugin is a fork of the [signalk-tides-api](https://github.com/joabakk/signalk-tides-api) plugin (which is no longer working) and is licensed under the [Apache License 2.0](LICENSE). Kudos to @joabakk and @sbender9 for the original work.
