import { renderHook } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { useCoverTint } from './coverTint';

describe('useCoverTint', () => {
	afterEach(() => vi.unstubAllGlobals());

	it("reads DMM's own cover as its <img> loads it, and asks another host for CORS", () => {
		const images: { crossOrigin: string | null; src: string }[] = [];
		vi.stubGlobal(
			'Image',
			class {
				crossOrigin: string | null = null;
				src = '';
				constructor() {
					images.push(this);
				}
			}
		);
		const own = '/api/music/cover/4853b957-05f2-457b-ba47-18b2565abc69.jpg';
		const itunes = 'https://is1-ssl.mzstatic.com/image/thumb/Music/x/600x600bb.jpg';

		renderHook(() => useCoverTint(own));
		renderHook(() => useCoverTint(itunes));

		expect(images).toMatchObject([
			{ src: own, crossOrigin: null },
			{ src: itunes, crossOrigin: 'anonymous' },
		]);
	});
});
