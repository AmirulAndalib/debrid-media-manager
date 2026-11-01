import { albumArtUrl } from '@/utils/posterHost';
import { act, renderHook } from '@testing-library/react';
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

	it('leaves the header untinted when a posters host serves the cover without CORS', () => {
		// posters3.debridmediamanager.com answered without Access-Control-Allow-Origin
		// on 2026-11-01, so the CORS load of a copied cover fails.
		const images: { crossOrigin: string | null; src: string; onerror?: () => void }[] = [];
		vi.stubGlobal(
			'Image',
			class {
				crossOrigin: string | null = null;
				src = '';
				onerror?: () => void;
				constructor() {
					images.push(this);
				}
			}
		);
		const cover = albumArtUrl('48e8b712-4f5d-34e0-9492-22f936854662');

		const { result, rerender } = renderHook(() => useCoverTint(cover));
		expect(images[0]).toMatchObject({ src: cover, crossOrigin: 'anonymous' });
		act(() => images[0].onerror?.());
		rerender();

		expect(result.current).toBeNull();
		renderHook(() => useCoverTint(cover));
		expect(images).toHaveLength(1); // not asked again
	});
});
