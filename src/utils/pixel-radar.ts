/**
 * Rasterizes a radar chart onto a small pixel grid at build time.
 *
 * A vector radar would be antialiased at any size, which is exactly the
 * modern-UI look the site avoids. Instead every cell of a GRID×GRID bitmap is
 * classified (disc, ring, polygon fill, polygon edge), then each row is
 * collapsed into runs of the same class. The result is a handful of `<rect>`s
 * that CSS upscales as fat pixels.
 */

export const GRID = 80;

const CENTER = GRID / 2;
/** Radius of a rating of 100. */
const RADIUS = 28;
/** Where the axis labels sit, just outside the disc. */
const LABEL_RADIUS = 35;

export type RadarPixel = 'disc' | 'ring' | 'fill' | 'edge';

export interface RadarRun {
	kind: RadarPixel;
	x: number;
	y: number;
	width: number;
}

export interface RadarLabel {
	/** Percent of the chart box, for absolute positioning. */
	left: number;
	top: number;
}

type Point = [number, number];

/** Axis `i` of `count`, starting straight up and going clockwise. */
function axisPoint(i: number, count: number, radius: number): Point {
	const angle = (Math.PI * 2 * i) / count - Math.PI / 2;
	return [CENTER + radius * Math.cos(angle), CENTER + radius * Math.sin(angle)];
}

/** Even-odd ray cast. */
function insidePolygon([px, py]: Point, polygon: Point[]): boolean {
	let inside = false;
	for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
		const [xi, yi] = polygon[i];
		const [xj, yj] = polygon[j];
		if (yi > py !== yj > py && px < ((xj - xi) * (py - yi)) / (yj - yi) + xi) {
			inside = !inside;
		}
	}
	return inside;
}

/** Ratings are 0–100, in axis order. */
export function rasterizeRadar(values: number[]): RadarRun[] {
	const polygon = values.map((value, i) => axisPoint(i, values.length, (RADIUS * value) / 100));

	const inPoly = (x: number, y: number) => insidePolygon([x + 0.5, y + 0.5], polygon);

	const classify = (x: number, y: number): RadarPixel | null => {
		if (inPoly(x, y)) {
			const onEdge = !inPoly(x - 1, y) || !inPoly(x + 1, y) || !inPoly(x, y - 1) || !inPoly(x, y + 1);
			return onEdge ? 'edge' : 'fill';
		}
		const distance = Math.hypot(x + 0.5 - CENTER, y + 0.5 - CENTER);
		// Guide rings at 100 and 50, one cell thick.
		if (Math.abs(distance - RADIUS) < 0.5 || Math.abs(distance - RADIUS / 2) < 0.5) return 'ring';
		if (distance < RADIUS) return 'disc';
		return null;
	};

	const runs: RadarRun[] = [];
	for (let y = 0; y < GRID; y++) {
		let current: RadarRun | null = null;
		for (let x = 0; x < GRID; x++) {
			const kind = classify(x, y);
			if (current && current.kind === kind) {
				current.width++;
				continue;
			}
			current = kind ? { kind, x, y, width: 1 } : null;
			if (current) runs.push(current);
		}
	}
	return runs;
}

/** Label anchors for `count` axes, in the same order as the values. */
export function radarLabels(count: number): RadarLabel[] {
	return Array.from({ length: count }, (_, i) => {
		const [x, y] = axisPoint(i, count, LABEL_RADIUS);
		return { left: (x / GRID) * 100, top: (y / GRID) * 100 };
	});
}
