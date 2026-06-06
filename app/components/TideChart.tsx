import { useEffect, useMemo, useRef } from "react";
import * as d3 from "d3";
import { TideExtreme } from "../hooks/useTideData";
import { useContainerDimensions } from "../hooks/useContainerDimensions";

type TideChartProps = {
  width?: number;
  height?: number;
  marginTop?: number;
  marginRight?: number;
  marginBottom?: number;
  marginLeft?: number;
  units?: "m" | "ft";
  data: TideExtreme[];
};

export function TideChart({
  data,
  marginTop = 20,
  marginRight = 6,
  marginBottom = 30,
  marginLeft = 6,
  units = "m",
}: TideChartProps) {
  const container = useRef<HTMLDivElement>(null);
  const nowLine = useRef<SVGLineElement>(null);
  const { height = 0 } = useContainerDimensions(container) || {};
  const width = useMemo(() => height / 4 * data.length, [height, data])
  const gx = useRef<SVGGElement>(null);
  const textPadding = 25;
  const yPadding = 0.3; // meters

  function displayDepth(level: number) {
    return units === "m" ? `${level.toFixed(2)} m` : `${(level * 3.28084).toFixed(1)} ft`;
  }

  function displayTime(value: string) {
    return new Intl.DateTimeFormat(navigator.language, {
      timeStyle: "short",
    }).format(new Date(value));
  }

  const scales = useMemo(() => {
    if (!data.length || !width || !height) return null;

    const [min = 0, max = 0] = d3.extent(data, d => new Date(d.time));

    const xScale = d3.scaleTime()
      .domain([min, max])
      .range([marginLeft, width - marginRight]);

    const [yMin = 0, yMax = 0] = d3.extent(data, d => d.level)
    const yPad = (yMax - yMin) * .3;

    const yScale = d3.scaleLinear()
      .domain([yMin - yPad, yMax + yPad])
      .range([height - marginBottom, marginTop]);

    const areaGen = d3.area<TideExtreme>()
      .curve(d3.curveMonotoneX)
      .x(d => xScale(new Date(d.time)))
      .y0(yScale(d3.min(data, d => d.level - yPadding) ?? 0))
      .y1(d => yScale(d.level));

    const lineGen = d3.line<TideExtreme>()
      .curve(d3.curveMonotoneX)
      .x(d => xScale(new Date(d.time)))
      .y(d => yScale(d.level))

    return { x: xScale, y: yScale, area: areaGen, line: lineGen };
  }, [data, height, width, marginBottom, marginLeft, marginRight, marginTop])

  // Imperatively render the x-axis via d3
  useEffect(() => {
    if (scales && gx.current) {
      d3.select(gx.current).call(d3.axisBottom(scales.x));
    }
  }, [scales])

  useEffect(() => {
    nowLine.current?.scrollIntoView({ block: 'center', inline: 'center' })
  }, [data, width])

  return (
    <div className="TideChart" ref={container}>
      <svg width={width} height={height}>
        <defs>
          <linearGradient id="gradient" gradientTransform="rotate(90)">
            <stop className="TideChart__Gradient--stop1" offset="0" />
            <stop className="TideChart__Gradient--stop2" offset="100%" />
          </linearGradient>
        </defs>
        <g className="TideChart__XAxis" ref={gx} transform={`translate(0,${height - marginBottom})`} />

        <line
          className="TideChart__LowWater"
          x1={marginLeft}
          x2={width - marginRight}
          y1={scales?.y(0)}
          y2={scales?.y(0)}
        />

        <path fill="url(#gradient)" d={scales?.area(data) || ''} />
        <path className="TideChart__Line" d={scales?.line(data) || ''} />

        <line
          ref={nowLine}
          className="TideChart__Now"
          x1={scales?.x(new Date())}
          x2={scales?.x(new Date())}
          y1={marginTop}
          y2={height - marginTop}
        />

        <g>
          {
            data.map((d, i) => (
              <g key={i}>
                <circle
                  className="TideChart__DataPoint"
                  cx={scales?.x(new Date(d.time))}
                  cy={scales?.y(d.level)}
                  r={5}
                />
                {
                  (i !== 0 && i !== data.length - 1) &&
                  <text
                    className={["TideChart__Text", `TideChart__Text--${d.label}`].join(" ")}
                    y={d.label === "High" ? marginTop + textPadding : height - marginBottom - textPadding}
                  >
                    <tspan className="TideChart__Depth" x={scales?.x(new Date(d.time))} dy={d.label === "High" ? "1.5em" : "-1.5em"}>
                      {displayDepth(d.level)}
                    </tspan>
                    <tspan className="TideChart__Time" x={scales?.x(new Date(d.time))} dy={d.label === "High" ? "-1.5em" : "1.5em"}>
                      {displayTime(d.time)}
                    </tspan>
                  </text>
                }
              </g>
            ))
          }
        </g>
      </svg>
    </div>
  );
}
