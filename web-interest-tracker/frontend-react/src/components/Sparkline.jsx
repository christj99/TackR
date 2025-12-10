import React from "react";

export function Sparkline({ points, width = 120, height = 40 }) {
  if (!points || points.length < 2) return null;

  const values = points
    .map((p) => (typeof p.v === "number" ? p.v : null))
    .filter((v) => v != null);

  if (values.length < 2) return null;

  const min = Math.min(...values);
  const max = Math.max(...values);
  const span = max - min || 1;

  const stepX =
    values.length > 1 ? width / (values.length - 1) : width;

  const d = values
    .map((v, i) => {
      const x = i * stepX;
      const norm = (v - min) / span;
      const y = height - norm * height;
      return `${i === 0 ? "M" : "L"}${x},${y}`;
    })
    .join(" ");

  return (
    <svg
      width={width}
      height={height}
      viewBox={`0 0 ${width} ${height}`}
      className="sparkline"
    >
      <path d={d} fill="none" stroke="currentColor" strokeWidth="1.5" />
    </svg>
  );
}
