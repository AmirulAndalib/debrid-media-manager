import { useEffect, useState } from 'react';

const SAMPLE = 16;
// Per cover URL; null once a cover could not be read.
const tints = new Map<string, string | null>();

/** The image's average color, darkened so white text stays readable; null when it cannot be read. */
export function averageColor(image: CanvasImageSource): string | null {
	try {
		const canvas = document.createElement('canvas');
		canvas.width = canvas.height = SAMPLE;
		const context = canvas.getContext('2d');
		if (!context) return null;
		context.drawImage(image, 0, 0, SAMPLE, SAMPLE);
		const { data } = context.getImageData(0, 0, SAMPLE, SAMPLE);
		const sum = [0, 0, 0];
		for (let i = 0; i < data.length; i += 4) {
			for (let c = 0; c < 3; c++) sum[c] += data[i + c];
		}
		const pixels = data.length / 4;
		return `rgb(${sum.map((total) => Math.round((total / pixels) * 0.6)).join(' ')})`;
	} catch {
		return null; // a cover served without CORS taints the canvas
	}
}

/**
 * The cover's tint for a header background, sampled once per URL in a copy of
 * the image that never holds up the page; null until then, and for no cover.
 */
export function useCoverTint(url: string | null): string | null {
	const [, setSampled] = useState<string | null>(null);
	useEffect(() => {
		if (!url || tints.has(url)) return;
		const image = new Image();
		image.crossOrigin = 'anonymous';
		image.onload = () => {
			tints.set(url, averageColor(image));
			setSampled(url);
		};
		image.onerror = () => tints.set(url, null);
		image.src = url;
	}, [url]);
	return url ? (tints.get(url) ?? null) : null;
}
