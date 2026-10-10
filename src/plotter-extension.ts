/**
 * The tide widget this plugin offers to chart plotters that implement the
 * Signal K Plotter Extensions API, such as Freeboard-SK, where the user places
 * it on the chart. Both pages are part of the webapp, which the server serves
 * at /signalk-tides/.
 */
const WEBAPP_PATH = "/signalk-tides/";

export const PLOTTER_EXTENSION_ID = "signalk-tides";

export const plotterExtensionManifest = {
  name: "Tides",
  description:
    "The tide at the vessel's position: the level now and the next high or low water.",
  apiVersion: "1",
  requires: ["widgets"],
  // Without them the widget still shows the tide; tapping it opens the panel.
  optional: ["panels.iframe", "ui"],
  widgets: [
    {
      id: "tides",
      title: "Tides",
      type: "iframe",
      url: `${WEBAPP_PATH}widget.html`,
      size: "2x1",
      lifecycle: "whileEnabled",
    },
  ],
  panels: [
    {
      id: "tides",
      title: "Tides",
      type: "iframe",
      url: WEBAPP_PATH,
      lifecycle: "onOpen",
    },
  ],
};
