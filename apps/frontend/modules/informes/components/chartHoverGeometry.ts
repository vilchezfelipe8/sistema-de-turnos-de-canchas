import type { MouseEvent } from 'react';

export type ChartRect = {
  x: number;
  y: number;
  width: number;
  height: number;
};

export const getRelativePoint = (event: MouseEvent<HTMLElement | SVGElement>) => {
  const rect = event.currentTarget.getBoundingClientRect();
  return {
    x: event.clientX - rect.left,
    y: event.clientY - rect.top,
  };
};

export const isPointInsideRect = (point: { x: number; y: number }, rect: ChartRect) => (
  point.x >= rect.x
  && point.x <= rect.x + rect.width
  && point.y >= rect.y
  && point.y <= rect.y + rect.height
);

export const getBarRect = (entry: ChartRect): ChartRect => ({
  x: Number(entry.x || 0),
  y: Number(entry.y || 0),
  width: Number(entry.width || 0),
  height: Number(entry.height || 0),
});

export const isPointerInsideBarRect = (entry: ChartRect, event: MouseEvent<SVGElement>) => {
  const svg = event.currentTarget.ownerSVGElement;
  const rect = svg?.getBoundingClientRect();

  if (!rect) return true;

  return isPointInsideRect(
    {
      x: event.clientX - rect.left,
      y: event.clientY - rect.top,
    },
    getBarRect(entry)
  );
};

export const isPointerInsideSvgFill = (event: MouseEvent<SVGElement>) => {
  const target = event.currentTarget as SVGGraphicsElement & {
    isPointInFill?: (point: DOMPoint) => boolean;
  };
  const svg = target.ownerSVGElement;
  const screenMatrix = target.getScreenCTM();

  if (!svg || !screenMatrix || typeof target.isPointInFill !== 'function') return true;

  const point = svg.createSVGPoint();
  point.x = event.clientX;
  point.y = event.clientY;

  return target.isPointInFill(point.matrixTransform(screenMatrix.inverse()));
};
