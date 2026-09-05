import { describe, it, expect, vi } from 'vitest';

// supabase necesita env de navegador: se stubea para poder importar el módulo.
vi.mock('../lib/supabase', () => ({ supabase: { auth: { getSession: async () => ({ data: null }) } } }));

const { buildProviderChain } = await import('./ai.js');

const ids = (chain) => chain.map(s => `${s.provider}|${s.model}`);

describe('buildProviderChain', () => {
  it('baja de versión dentro de Gemini antes de cambiar de proveedor', () => {
    expect(ids(buildProviderChain({ provider: 'gemini', model: 'gemini-3.8-flash' })).slice(0, 4)).toEqual([
      'gemini|gemini-3.8-flash',
      'gemini|gemini-3.7-flash',
      'gemini|gemini-3.6-flash',
      'gemini|gemini-3.1-flash-lite',
    ]);
  });

  it('no reintenta versiones por encima de la elegida', () => {
    expect(ids(buildProviderChain({ provider: 'gemini', model: 'gemini-3.6-flash' })).slice(0, 2)).toEqual([
      'gemini|gemini-3.6-flash',
      'gemini|gemini-3.1-flash-lite',
    ]);
  });

  it('un modelo Gemini fuera de la escalera la recorre entera', () => {
    expect(ids(buildProviderChain({ provider: 'gemini', model: 'gemini-pro-latest' })).slice(0, 5)).toEqual([
      'gemini|gemini-pro-latest',
      'gemini|gemini-3.8-flash',
      'gemini|gemini-3.7-flash',
      'gemini|gemini-3.6-flash',
      'gemini|gemini-3.1-flash-lite',
    ]);
  });

  it('otro proveedor no arrastra la escalera de Gemini', () => {
    const chain = ids(buildProviderChain({ provider: 'groq', model: 'llama-3.3-70b-versatile' }));
    expect(chain[0]).toBe('groq|llama-3.3-70b-versatile');
    expect(chain.some(s => s.startsWith('gemini|'))).toBe(false);
  });
});
