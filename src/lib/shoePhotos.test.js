import { describe, it, expect } from 'vitest';
import {
  isValidImageUrl,
  normalizeShoePhoto,
  sanitizeShoePhotos,
  readShoePhotos,
  getBrandInfo,
  SHOE_PHOTOS_KEY
} from './shoePhotos';

describe('shoePhotos', () => {
  describe('isValidImageUrl', () => {
    it('acepta URLs http y https', () => {
      expect(isValidImageUrl('https://example.com/shoe.jpg')).toBe(true);
      expect(isValidImageUrl('http://static.nike.com/shoe.png?size=large')).toBe(true);
    });

    it('acepta data URLs de imágenes en base64', () => {
      const dataUrl = 'data:image/webp;base64,UklGRkAAAABXRUJQVlA4IDQAAADwAQCdASoBAAEAAQAcJaACdLoB+AA/vA8AAA==';
      expect(isValidImageUrl(dataUrl)).toBe(true);
    });

    it('rechaza strings no válidos, vacíos o protocolos peligrosos', () => {
      expect(isValidImageUrl('')).toBe(false);
      expect(isValidImageUrl('   ')).toBe(false);
      expect(isValidImageUrl('not-a-url')).toBe(false);
      expect(isValidImageUrl('javascript:alert(1)')).toBe(false);
      expect(isValidImageUrl(null)).toBe(false);
      expect(isValidImageUrl(12345)).toBe(false);
    });
  });

  describe('sanitizeShoePhotos', () => {
    it('mantiene entradas válidas y descarta inválidas', () => {
      const raw = {
        'g123': 'https://example.com/boston.jpg',
        'g456': 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==',
        'g789': 'javascript:void(0)',
        '': 'https://example.com/invalid-key.jpg',
        'bad': null
      };

      const cleaned = sanitizeShoePhotos(raw);
      expect(Object.keys(cleaned)).toEqual(['g123', 'g456']);
      expect(cleaned['g123']).toBe('https://example.com/boston.jpg');
    });

    it('preserva y acota objetos con zoom y pan', () => {
      const raw = {
        'shoe_custom': {
          url: 'https://example.com/custom.jpg',
          zoom: 1.75,
          x: 12.3,
          y: -8.4
        },
        'shoe_overzoom': {
          url: 'https://example.com/huge.jpg',
          zoom: 10,
          x: 100,
          y: -100
        }
      };

      const cleaned = sanitizeShoePhotos(raw);
      expect(cleaned.shoe_custom).toEqual({
        url: 'https://example.com/custom.jpg',
        zoom: 1.75,
        x: 12.3,
        y: -8.4,
        flipH: false
      });
      // Al quedar con zoom 1 y pan 0 sin flip, se compacta a string
      expect(cleaned.shoe_overzoom).toBe('https://example.com/huge.jpg');
    });

    it('preserva objeto si solo tiene flipH activo', () => {
      const raw = {
        'shoe_flipped': {
          url: 'https://example.com/flipped.jpg',
          flipH: true
        }
      };
      const cleaned = sanitizeShoePhotos(raw);
      expect(cleaned.shoe_flipped).toEqual({
        url: 'https://example.com/flipped.jpg',
        zoom: 1,
        x: 0,
        y: 0,
        flipH: true
      });
    });

    it('devuelve objeto vacío si la entrada no es un objeto', () => {
      expect(sanitizeShoePhotos(null)).toEqual({});
      expect(sanitizeShoePhotos('bad string')).toEqual({});
      expect(sanitizeShoePhotos([1, 2, 3])).toEqual({});
    });
  });

  describe('normalizeShoePhoto', () => {
    it('normaliza strings a objeto con zoom 1, pan 0 y flipH false', () => {
      const norm = normalizeShoePhoto('https://example.com/shoe.png');
      expect(norm).toEqual({
        url: 'https://example.com/shoe.png',
        zoom: 1,
        x: 0,
        y: 0,
        flipH: false
      });
    });

    it('normaliza y acota objetos con zoom, pan y flipH', () => {
      const norm = normalizeShoePhoto({
        url: 'https://example.com/shoe.png',
        zoom: 2.25,
        x: 15,
        y: -10,
        flipH: true
      });
      expect(norm).toEqual({
        url: 'https://example.com/shoe.png',
        zoom: 2.25,
        x: 15,
        y: -10,
        flipH: true
      });
    });

    it('devuelve null si es inválido', () => {
      expect(normalizeShoePhoto(null)).toBeNull();
      expect(normalizeShoePhoto('')).toBeNull();
      expect(normalizeShoePhoto({ url: 'not-valid' })).toBeNull();
    });
  });

  describe('readShoePhotos', () => {
    it('lee y sanitiza desde el storage', () => {
      const mockStorage = {
        getItem: (key) => {
          if (key === SHOE_PHOTOS_KEY) {
            return JSON.stringify({
              'shoe_1': 'https://images.com/pegasus.jpg',
              'shoe_bad': 'ftp://nope'
            });
          }
          return null;
        }
      };

      const photos = readShoePhotos(mockStorage);
      expect(photos).toEqual({ 'shoe_1': 'https://images.com/pegasus.jpg' });
    });

    it('devuelve objeto vacío si no hay clave o el JSON es corrupto', () => {
      const emptyStorage = { getItem: () => null };
      expect(readShoePhotos(emptyStorage)).toEqual({});

      const corruptStorage = { getItem: () => '{ bad json' };
      expect(readShoePhotos(corruptStorage)).toEqual({});
    });
  });

  describe('getBrandInfo', () => {
    it('detecta marcas populares', () => {
      expect(getBrandInfo('Nike Vaporfly 3').brand).toBe('Nike');
      expect(getBrandInfo('Adidas Adizero Boston 12').brand).toBe('Adidas');
      expect(getBrandInfo('Hoka Clifton 9').brand).toBe('Hoka');
      expect(getBrandInfo('Asics Novablast 4').brand).toBe('Asics');
      expect(getBrandInfo('Saucony Endorphin Speed 4').brand).toBe('Saucony');
      expect(getBrandInfo('Brooks Ghost 16').brand).toBe('Brooks');
      expect(getBrandInfo('New Balance FuelCell Rebel v4').brand).toBe('New Balance');
      expect(getBrandInfo('Puma Deviate Nitro 3').brand).toBe('Puma');
      expect(getBrandInfo('On Cloudmonster 2').brand).toBe('On Running');
    });

    it('aplica fallback con iniciales cuando no se detecta la marca', () => {
      const info = getBrandInfo('Zapa Desconocida');
      expect(info.brand).toBe('Zapa');
      expect(info.short).toBe('ZD');
    });
  });
});
