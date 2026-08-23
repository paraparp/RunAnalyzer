import React, { useState, useEffect, useMemo, useRef } from 'react';
import { buildHtmlDocument, isFullDocument, isInteractive } from '../lib/htmlDocument';

// ============================================================================
// HtmlDocument — visor de HTML pegado por el usuario (planes de entrenamiento
// exportados de una web, de Excel, del correo del entrenador… o generados como
// una mini-app que se dibuja sola con JavaScript).
//
// Se pinta en un <iframe sandbox> con `srcdoc` en vez de inyectarlo en la página:
//   · Aislamiento de CSS en los dos sentidos. El reset de Tailwind ya no le pisa
//     los márgenes al documento pegado, y sus estilos no se escapan a la app.
//   · Sus propios <style> sobreviven, así que el plan se ve como lo diseñó quien
//     lo escribió, en vez de con nuestras reglas forzadas encima.
//   · El sandbox NUNCA lleva `allow-same-origin`: el marco vive en un origen
//     opaco, así que no puede leer cookies, sesión ni almacenamiento de la app,
//     ni tocar su DOM. Combinar allow-scripts con allow-same-origin anularía el
//     sandbox entero, y por eso no se hace.
//
// Dos modos según el contenido:
//   estático     → se sanea con DOMPurify y sus scripts se descartan.
//   interactivo  → el documento SE DIBUJA con JS (trae <script>), así que sanearlo
//                  lo dejaría en blanco. Se sirve tal cual y la contención la pone
//                  el sandbox. Lo que ese código puede hacer se queda dentro del
//                  marco: no ve nada de la app.
//
// En ambos casos se inyecta un medidor que publica el alto por postMessage, para
// que el marco se estire con su contenido en vez de tener una altura fija.
// ============================================================================

let seq = 0;

/**
 * @param {string} html        HTML del usuario, sin procesar.
 * @param {string} height      Altura del marco mientras no se conozca la real.
 * @param {boolean} autoHeight Estirar el marco hasta el alto del contenido.
 * @param {number} maxHeight   Tope en px del alto automático.
 */
const HtmlDocument = ({ html, height = '26rem', autoHeight = true, maxHeight = 4000 }) => {
    const [doc, setDoc] = useState(null);
    const [failed, setFailed] = useState(false);
    const [measured, setMeasured] = useState(null);
    const frameId = useRef(`plan-${++seq}-${Math.random().toString(36).slice(2, 8)}`).current;

    const fullDocument = useMemo(() => isFullDocument(html), [html]);
    const interactive = useMemo(() => isInteractive(html), [html]);

    useEffect(() => {
        let cancelled = false;
        setFailed(false);
        setMeasured(null);

        // Interactivo: sanear borraría justo lo que lo hace funcionar. Contiene el
        // sandbox, no el saneado.
        if (interactive) {
            setDoc(buildHtmlDocument(html || '', { fullDocument, frameId }));
            return undefined;
        }

        import('dompurify')
            .then(({ default: DOMPurify }) => {
                // Aislado en el iframe, sus <style> ya no pueden contaminar la app,
                // así que se conservan: es lo que hace que el plan se vea "como es".
                const clean = DOMPurify.sanitize(html || '', {
                    USE_PROFILES: { html: true },
                    ADD_TAGS: ['style'],
                    WHOLE_DOCUMENT: fullDocument,
                });
                if (!cancelled) setDoc(buildHtmlDocument(clean, { fullDocument, frameId }));
            })
            .catch(() => { if (!cancelled) setFailed(true); });
        return () => { cancelled = true; };
    }, [html, fullDocument, interactive, frameId]);

    // El marco publica su alto; aquí solo se acepta el del marco propio.
    useEffect(() => {
        if (!autoHeight) return undefined;
        const onMessage = (e) => {
            const d = e.data;
            if (!d || d.__planFrame !== frameId) return;
            const h = Number(d.height);
            if (Number.isFinite(h) && h > 0) setMeasured(Math.min(Math.ceil(h) + 8, maxHeight));
        };
        window.addEventListener('message', onMessage);
        return () => window.removeEventListener('message', onMessage);
    }, [autoHeight, frameId, maxHeight]);

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
            style={{ height: measured != null ? `${measured}px` : height }}
            className="w-full block border-0 bg-white rounded-lg transition-[height] duration-200"
            // allow-scripts SIN allow-same-origin: el documento se ejecuta en un
            // origen opaco, aislado de la app. allow-popups es para que un enlace
            // pueda abrirse en otra pestaña.
            sandbox="allow-scripts allow-popups allow-popups-to-escape-sandbox"
            referrerPolicy="no-referrer"
        />
    );
};

export default HtmlDocument;
