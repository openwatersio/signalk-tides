# signalk-tides

A SignalK plugin that provides offline tidal predictions for the vessel's position, powered by [Neaps](https://github.com/neaps/neaps).

Since 2.0, predictions are computed locally from harmonic constituents — no network access or API keys required.

## Installation

Install `signalk-tides` from the SignalK Appstore or manually by running `npm install signalk-tides` in the SignalK server directory (`~/.signalk`).


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

### Tides API

The plugin mounts the [Neaps API](https://github.com/neaps/neaps) at `/signalk/v2/api/tides`, which serves station search, extremes, and timeline predictions. The synthetic station `vessel/current` resolves to the nearest station to the vessel:

```
$ curl http://localhost:3000/signalk/v2/api/tides/stations/vessel/current/extremes
```

### Tides resource

It also registers a `tides` resource, which returns the next 7 days of tide extremes for the vessel's position.

```
$ curl http://localhost:3000/signalk/v2/api/resources/tides
```

##### Response

```json
{
   "datum": "MLLW",
   "units": "meters",
   "station": {
      "id": "noaa/9414290",
      "name": "San Francisco",
      "latitude": 37.806,
      "longitude": -122.465
   },
   "extremes": [
      { "time": "2025-03-29T00:45:00.000Z", "level": 0.025, "high": false, "low": true, "label": "Low" },
      { "time": "2025-03-29T07:20:00.000Z", "level": 1.928, "high": true, "low": false, "label": "High" }
   ]
}
```

## License

This plugin is a fork of the [signalk-tides-api](https://github.com/joabakk/signalk-tides-api) plugin (which is no longer working) and is licensed under the [Apache License 2.0](LICENSE). Kudos to @joabakk and @sbender9 for the original work.
