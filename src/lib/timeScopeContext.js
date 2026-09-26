import { createContext } from 'react';
import { DEFAULT_TIME_SCOPE } from './timeScope.js';

// Contexto del período compartido. Vive aparte del proveedor y del hook para que
// el fichero del componente solo exporte componentes (fast refresh).
// Sin proveedor —tests de una vista suelta— cada consumidor ve el default y un
// setter mudo: la vista se pinta igual, solo que no cambia de período.
export const TimeScopeContext = createContext([DEFAULT_TIME_SCOPE, () => {}]);
