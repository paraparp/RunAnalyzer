import React, { useState, useRef, useEffect, useMemo } from 'react';

// ============================================================================
// MarkdownText — renderizador markdown ligero y compartido (chat de RunQA y los
// planes de entrenamiento de las carreras objetivo). Cubre lo que de verdad
// aparece en esos textos:
//   bloques : encabezados (#..######), listas anidadas (ul/ol/tareas), tablas
//             con alineación, citas (>), reglas, bloques de código y mermaid
//   inline  : **negrita**, *cursiva*, `código`, ~~tachado~~, [enlace](url)
// No es un parser CommonMark: es deliberadamente pequeño para no arrastrar una
// dependencia de markdown. Los saltos de línea se respetan (un párrafo por
// línea), porque en un plan de entrenamiento cada línea es una sesión.
//
// El HTML pegado por el usuario NO lo pinta este módulo: va aislado en un iframe
// (ver HtmlDocument.jsx), para no mezclar sus estilos con los de la app.
// ============================================================================

// Renderiza diagramas mermaid con carga bajo demanda; si falla (o el código
// aún está incompleto durante el streaming) muestra el código como fallback
export const MermaidDiagram = ({ code }) => {
    const [svg, setSvg] = useState(null);
    const [error, setError] = useState(false);
    const idRef = useRef(`mmd-${Math.random().toString(36).slice(2, 10)}`);

    useEffect(() => {
        let cancelled = false;
        setError(false);
        Promise.all([import('mermaid'), import('dompurify')])
            .then(async ([{ default: mermaid }, { default: DOMPurify }]) => {
                mermaid.initialize({
                    startOnLoad: false,
                    theme: 'neutral',
                    securityLevel: 'strict',
                    flowchart: { htmlLabels: false },
                });
                try {
                    const { svg: rendered } = await mermaid.render(idRef.current, code);
                    const clean = DOMPurify.sanitize(rendered, {
                        USE_PROFILES: { svg: true, svgFilters: true },
                        ADD_TAGS: ['style'],
                    });
                    if (!cancelled) setSvg(clean);
                } catch {
                    if (!cancelled) setError(true);
                }
            })
            .catch(() => { if (!cancelled) setError(true); });
        return () => { cancelled = true; };
    }, [code]);

    if (error || !svg) {
        return (
            <pre className="bg-slate-50 border border-slate-200 rounded-lg p-3 my-3 overflow-x-auto text-xs font-mono text-slate-600">
                <code>{code}</code>
            </pre>
        );
    }
    return (
        <div
            className="my-3 flex justify-center overflow-x-auto [&_svg]:max-w-full"
            dangerouslySetInnerHTML={{ __html: svg }}
        />
    );
};

// ── Inline ──────────────────────────────────────────────────────────────────
// Un único regex con alternativas para recorrer la línea una sola vez. El orden
// importa: `código` primero, para que lo que haya dentro no se re-formatee.
const INLINE_RE = /`([^`]+)`|\*\*([^*\n]+)\*\*|~~([^~\n]+)~~|\[([^\]\n]+)\]\(([^)\s]+)\)|\*([^*\s][^*\n]*?)\*/g;

const parseInline = (text) => {
    const parts = [];
    let key = 0;
    let lastIndex = 0;
    let m;
    INLINE_RE.lastIndex = 0;

    while ((m = INLINE_RE.exec(text)) !== null) {
        if (m.index > lastIndex) parts.push(<span key={key++}>{text.slice(lastIndex, m.index)}</span>);

        if (m[1] !== undefined) {
            parts.push(
                <code key={key++} className="bg-slate-100 text-slate-700 px-1.5 py-0.5 rounded text-[0.85em] font-mono">
                    {m[1]}
                </code>
            );
        } else if (m[2] !== undefined) {
            parts.push(<strong key={key++} className="font-semibold text-slate-900">{m[2]}</strong>);
        } else if (m[3] !== undefined) {
            parts.push(<span key={key++} className="line-through text-slate-400">{m[3]}</span>);
        } else if (m[4] !== undefined) {
            // Solo esquemas seguros: un enlace del plan puede venir del MCP.
            const href = /^(https?:|mailto:)/i.test(m[5]) ? m[5] : null;
            parts.push(href
                ? <a key={key++} href={href} target="_blank" rel="noopener noreferrer"
                    className="text-blue-600 underline decoration-blue-200 underline-offset-2 hover:decoration-blue-500">{m[4]}</a>
                : <span key={key++}>{m[4]}</span>);
        } else {
            parts.push(<em key={key++} className="italic">{m[6]}</em>);
        }
        lastIndex = m.index + m[0].length;
    }

    if (lastIndex < text.length) parts.push(<span key={key++}>{text.slice(lastIndex)}</span>);
    return parts.length > 0 ? parts : text;
};

// ── Listas anidadas ─────────────────────────────────────────────────────────
// Los items llegan planos con su nivel de indentación; aquí se reagrupan en
// árbol para poder emitir <ul>/<ol> dentro de <li>.
const renderItems = (items, keyBase = 'l') => {
    const nodes = [];
    let i = 0;

    while (i < items.length) {
        const { indent, type } = items[i];
        const group = [];

        while (i < items.length && items[i].indent === indent && items[i].type === type) {
            const item = items[i];
            i += 1;
            const children = [];
            while (i < items.length && items[i].indent > indent) { children.push(items[i]); i += 1; }
            group.push({ ...item, children });
        }

        const Tag = type === 'ol' ? 'ol' : 'ul';
        const listClass = type === 'ol'
            ? 'list-decimal list-outside ml-5 space-y-1.5 my-2.5 text-slate-700 marker:text-slate-400 marker:font-semibold'
            : group.some((g) => g.checked != null)
                ? 'list-none ml-0.5 space-y-1.5 my-2.5 text-slate-700'
                : 'list-disc list-outside ml-5 space-y-1.5 my-2.5 text-slate-700 marker:text-slate-300';

        nodes.push(
            <Tag key={`${keyBase}-${nodes.length}`} className={listClass}>
                {group.map((g, gi) => (
                    <li key={gi} value={type === 'ol' ? g.value : undefined} className="leading-relaxed pl-1">
                        {g.checked != null ? (
                            <span className="flex items-start gap-2">
                                <span className={`mt-[3px] w-3.5 h-3.5 shrink-0 rounded border flex items-center justify-center text-[9px] font-black ${g.checked ? 'bg-emerald-500 border-emerald-500 text-white' : 'border-slate-300 text-transparent'}`}>
                                    ✓
                                </span>
                                <span className={g.checked ? 'text-slate-400 line-through' : ''}>{parseInline(g.text)}</span>
                            </span>
                        ) : parseInline(g.text)}
                        {g.children.length > 0 && renderItems(g.children, `${keyBase}-${nodes.length}-${gi}`)}
                    </li>
                ))}
            </Tag>
        );
    }

    return nodes;
};

const ALIGN_CLASS = { left: 'text-left', center: 'text-center', right: 'text-right' };

export const MarkdownText = ({ content }) => {
    const parsedContent = useMemo(() => {
        if (!content) return [];

        const lines = content.split('\n');
        const elements = [];
        let listItems = [];
        let tableRows = [];
        let tableAlign = [];
        let quoteLines = [];
        let olCounter = 0;
        let inCodeBlock = false;
        let codeLang = '';
        let codeLines = [];

        const flushList = () => {
            if (listItems.length === 0) return;
            elements.push(<React.Fragment key={elements.length}>{renderItems(listItems, `l${elements.length}`)}</React.Fragment>);
            listItems = [];
        };

        const flushTable = () => {
            if (tableRows.length === 0) return;
            const [header, ...body] = tableRows;
            const alignOf = (i) => ALIGN_CLASS[tableAlign[i]] || 'text-left';
            elements.push(
                <div key={elements.length} className="overflow-x-auto my-3 rounded-xl border border-slate-200">
                    <table className="min-w-full text-xs border-collapse">
                        <thead className="bg-slate-50">
                            <tr>
                                {header.map((cell, i) => (
                                    <th key={i} className={`px-3 py-2 font-black uppercase tracking-wider text-[10px] text-slate-500 border-b border-slate-200 whitespace-nowrap ${alignOf(i)}`}>
                                        {parseInline(cell)}
                                    </th>
                                ))}
                            </tr>
                        </thead>
                        <tbody>
                            {body.map((row, r) => (
                                <tr key={r} className="even:bg-slate-50/60 hover:bg-blue-50/40 transition-colors">
                                    {row.map((cell, c) => (
                                        <td key={c} className={`px-3 py-2 text-slate-700 border-b border-slate-100 align-top last:border-r-0 ${alignOf(c)}`}>
                                            {parseInline(cell)}
                                        </td>
                                    ))}
                                </tr>
                            ))}
                        </tbody>
                    </table>
                </div>
            );
            tableRows = [];
            tableAlign = [];
        };

        const flushQuote = () => {
            if (quoteLines.length === 0) return;
            elements.push(
                <blockquote key={elements.length} className="my-3 pl-3 border-l-[3px] border-blue-200 bg-blue-50/40 rounded-r-lg py-2 pr-3 text-slate-600 italic">
                    {quoteLines.map((q, i) => <p key={i} className="leading-relaxed">{parseInline(q)}</p>)}
                </blockquote>
            );
            quoteLines = [];
        };

        const flushCode = () => {
            const codeText = codeLines.join('\n');
            if (codeLang === 'mermaid') {
                elements.push(<MermaidDiagram key={elements.length} code={codeText} />);
            } else {
                elements.push(
                    <div key={elements.length} className="my-3 rounded-xl border border-slate-200 overflow-hidden">
                        {codeLang && (
                            <div className="px-3 py-1.5 bg-slate-100 text-[10px] font-black uppercase tracking-widest text-slate-500 border-b border-slate-200">
                                {codeLang}
                            </div>
                        )}
                        <pre className="bg-slate-50 p-3 overflow-x-auto text-xs font-mono text-slate-700 leading-snug">
                            <code>{codeText}</code>
                        </pre>
                    </div>
                );
            }
            inCodeBlock = false;
            codeLang = '';
            codeLines = [];
        };

        // Cierra todo lo que estuviera abierto salvo lo que se indique.
        const flushAll = ({ keepList = false, keepTable = false, keepQuote = false } = {}) => {
            if (!keepList) { flushList(); olCounter = 0; }
            if (!keepTable) flushTable();
            if (!keepQuote) flushQuote();
        };

        lines.forEach((line, idx) => {
            const trimmedLine = line.trim();

            if (inCodeBlock) {
                if (trimmedLine.startsWith('```')) flushCode();
                else codeLines.push(line);
                return;
            }

            if (trimmedLine.startsWith('```')) {
                flushAll();
                inCodeBlock = true;
                codeLang = trimmedLine.slice(3).trim().toLowerCase();
                codeLines = [];
                return;
            }

            if (!trimmedLine) { flushAll(); return; }

            // Tablas: | a | b | ... con fila separadora opcional que fija la alineación.
            if (trimmedLine.startsWith('|') && trimmedLine.includes('|', 1)) {
                flushAll({ keepTable: true });
                if (/^\|[\s:|-]+\|$/.test(trimmedLine)) {
                    tableAlign = trimmedLine.split('|').slice(1, -1).map((c) => {
                        const spec = c.trim();
                        if (spec.startsWith(':') && spec.endsWith(':')) return 'center';
                        if (spec.endsWith(':')) return 'right';
                        return 'left';
                    });
                    return;
                }
                const cells = trimmedLine.split('|').slice(1, -1).map((c) => c.trim());
                if (cells.length > 0) { tableRows.push(cells); return; }
            }

            // Citas: > texto (líneas consecutivas se agrupan)
            const quoteMatch = trimmedLine.match(/^>\s?(.*)$/);
            if (quoteMatch) {
                flushAll({ keepQuote: true });
                quoteLines.push(quoteMatch[1]);
                return;
            }

            if (/^(-{3,}|\*{3,}|_{3,})$/.test(trimmedLine)) {
                flushAll();
                elements.push(<hr key={idx} className="my-4 border-slate-200" />);
                return;
            }

            // Listas: se conserva la indentación para poder anidarlas.
            const indent = Math.floor((line.match(/^[ \t]*/)[0].replace(/\t/g, '    ').length) / 2);

            const ulMatch = trimmedLine.match(/^[*\-+]\s+(.+)/);
            if (ulMatch) {
                flushAll({ keepList: true });
                const task = ulMatch[1].match(/^\[([ xX])\]\s+(.*)$/);
                listItems.push(task
                    ? { indent, type: 'ul', text: task[2], checked: task[1].toLowerCase() === 'x' }
                    : { indent, type: 'ul', text: ulMatch[1] });
                return;
            }

            const olMatch = trimmedLine.match(/^(\d+)[.)]\s+(.+)/);
            if (olMatch) {
                flushAll({ keepList: true });
                // Continúa la numeración si el modelo repite "1." tras viñetas intermedias
                const num = parseInt(olMatch[1], 10);
                const value = indent > 0 ? num : (num > olCounter ? num : olCounter + 1);
                if (indent === 0) olCounter = value;
                listItems.push({ indent, type: 'ol', text: olMatch[2], value });
                return;
            }

            flushAll();

            const hMatch = trimmedLine.match(/^(#{1,6})\s+(.+)/);
            if (hMatch) {
                const level = hMatch[1].length;
                const inner = parseInline(hMatch[2]);
                const styles = {
                    1: 'text-lg font-black text-slate-900 tracking-tight mt-5 mb-2',
                    2: 'text-base font-black text-slate-900 tracking-tight mt-4 mb-2',
                    3: 'text-sm font-black text-slate-800 uppercase tracking-wide mt-4 mb-1.5',
                };
                const cls = styles[level] || 'text-sm font-bold text-slate-700 mt-3 mb-1.5';
                const Tag = `h${Math.min(level + 1, 6)}`;
                elements.push(<Tag key={idx} className={cls}>{inner}</Tag>);
                return;
            }

            elements.push(
                <p key={idx} className="leading-relaxed text-slate-700 my-1.5">
                    {parseInline(trimmedLine)}
                </p>
            );
        });

        if (inCodeBlock) flushCode();
        flushAll();
        return elements;
    }, [content]);

    return <div className="space-y-0.5">{parsedContent}</div>;
};

export default MarkdownText;
