import { useState, useEffect, useCallback } from 'react';
import { getAIModel, setAIModel, AI_MODEL_EVENT } from '../lib/aiModel';

/**
 * Modelo IA global: `[model, setModel]`. Cualquier componente que lo use se
 * re-renderiza cuando el usuario lo cambia en el selector del menú de usuario.
 * Las herramientas solo leen `model`; escribirlo es cosa del selector.
 */
export default function useAIModel() {
  const [model, setModel] = useState(getAIModel);

  useEffect(() => {
    const sync = () => setModel(getAIModel());
    window.addEventListener(AI_MODEL_EVENT, sync);
    return () => window.removeEventListener(AI_MODEL_EVENT, sync);
  }, []);

  const update = useCallback((value) => setModel(setAIModel(value)), []);
  return [model, update];
}
