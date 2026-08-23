import React, { useState, useEffect, useMemo } from 'react';
import { buildHtmlDocument, isFullDocument } from '../lib/htmlDocument';

// ============================================================================
// HtmlDocument — visor de HTML pegado por el usuario (planes de entrenamiento
// exportados de una web, de Excel, del correo del entrenador…).
//
// Se pinta en un <iframe sandbox> con `srcdoc` en vez de inyectarlo en la página:
//   · Aislamiento de CSS en los dos sentidos. El reset de Tailwind ya no le pisa
//     los márgenes al documento pegado, y sus estilos no se escapan a la app.
//   · Sus propios <style> sobreviven, así que el plan se ve como lo diseñó quien
//     lo escribió, en vez de con nuestras reglas forzadas encima.
//   · Los scripts quedan inertes POR EL NAVEGADOR (sandbox sin allow-scripts),
//     no solo por el saneado. El HTML puede venir del MCP: dos barreras, no una.
//
// El peaje del sandbox: sin allow-scripts no se puede medir el alto desde dentro,
// así que el marco tiene altura fija y hace scroll interno.
// ============================================================================

/**
 * @param {string} html      HTML del usuario, sin sanear.
 * @param {string} height    Altura CSS del marco (hace scroll por dentro).
 */
const HtmlDocument = ({ html, height = '26rem' }) => {
    const [doc, setDoc] = useState(null);
    const [failed, setFailed] = useState(false);
    const fullDocument = useMemo(() => isFullDocument(html), [html]);

    useEffect(() => {
        let cancelled = false;
        setFailed(false);
        import('dompurify')
            .then(({ default: DOMPurify }) => {
                // Aislado en el iframe, sus <style> ya no pueden contaminar la app,
                // así que se conservan: es lo que hace que el plan se vea "como es".
                const clean = DOMPurify.sanitize(html || '', {
                    USE_PROFILES: { html: true },
                    ADD_TAGS: ['style'],
                    WHOLE_DOCUMENT: fullDocument,
                });
                if (!cancelled) setDoc(buildHtmlDocument(clean, { fullDocument }));
            })
            .catch(() => { if (!cancelled) setFailed(true); });
        return () => { cancelled = true; };
    }, [html, fullDocument]);

    // Sin saneado no se pinta HTML: se enseña el fuente.
    if (failed || doc == null) {
        return (
            <pre className="text-[11px] leading-relaxed text-slate-500 font-mono whitespace-pre-wrap break-words">{html}</pre>
        );
    }

    return (
        <iframe
            title="plan"
            srcDoc={doc}
            style={{ height }}
            className="w-full block border-0 bg-white rounded-lg"
            // Sin allow-scripts: el navegador no ejecuta nada del documento. Los
            // permisos de pop-up son solo para que un enlace pueda abrirse fuera.
            sandbox="allow-popups allow-popups-to-escape-sandbox"
            referrerPolicy="no-referrer"
            loading="lazy"
        />
    );
};

export default HtmlDocument;
