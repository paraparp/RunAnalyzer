import { useState, useEffect, useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { Card, Title, Text, Button, Select, SelectItem, Grid, NumberInput, DateRangePicker, ProgressBar } from "@tremor/react";
import { ClipboardDocumentListIcon, CheckIcon, ArrowPathIcon, ArrowDownTrayIcon, TableCellsIcon, CodeBracketIcon } from "@heroicons/react/24/outline";
import { es } from 'date-fns/locale';

const ALL_FIELDS = [
    { key: 'date',           label: 'Fecha' },
    { key: 'name',           label: 'Nombre' },
    { key: 'type',           label: 'Tipo' },
    { key: 'distance_km',    label: 'Distancia (km)' },
    { key: 'time_min',       label: 'Tiempo (min)' },
    { key: 'pace',           label: 'Ritmo / Velocidad' },
    { key: 'avg_hr',         label: 'FC Media' },
    { key: 'max_hr',         label: 'FC Máx' },
    { key: 'elevation_gain', label: 'Desnivel (m)' },
    { key: 'avg_speed',      label: 'Velocidad (m/s)' },
    { key: 'kudos',          label: 'Kudos' },
    { key: 'id',             label: 'ID' },
    { key: 'laps',           label: 'Parciales' },
];

const DEFAULT_FIELDS = new Set(['date', 'name', 'type', 'distance_km', 'time_min', 'pace', 'avg_hr', 'elevation_gain', 'laps']);

const RUNNING_TYPES = ['Run', 'TrailRun', 'VirtualRun'];

const calculatePace = (speed) => {
    if (!speed || speed === 0) return '0:00';
    const pace    = 16.6667 / speed;
    const minutes = Math.floor(pace);
    const seconds = Math.floor((pace - minutes) * 60);
    return `${minutes}:${seconds.toString().padStart(2, '0')}`;
};

const isRunning = (a) => RUNNING_TYPES.includes(a.type) || RUNNING_TYPES.includes(a.sport_type);

const DataExporter = ({ activities, onEnrichActivity }) => {
    const { t } = useTranslation();

    const [dateRange, setDateRange] = useState({
        from: new Date(new Date().setMonth(new Date().getMonth() - 3)),
        to: new Date()
    });
    const [minDist, setMinDist]     = useState(0);
    const [minElev, setMinElev]     = useState(0);
    const [minHR, setMinHR]         = useState(0);
    const [maxHR, setMaxHR]         = useState(0);
    const [exportAll, setExportAll] = useState(false);
    const [lapsFilter, setLapsFilter]   = useState('all'); // 'all' | 'with' | 'without'
    const [onlyRunning, setOnlyRunning] = useState(false);
    const [format, setFormat]                 = useState('json');
    const [selectedFields, setSelectedFields] = useState(DEFAULT_FIELDS);
    const [previewMode, setPreviewMode]       = useState('raw'); // 'raw' | 'table'
    const [exportedData, setExportedData]     = useState('');
    const [copied, setCopied]                 = useState(false);
    const [enriching, setEnriching]           = useState(false);
    const [enrichProgress, setEnrichProgress] = useState(0);
    const [enrichingId, setEnrichingId]       = useState(null);

    const filteredActivities = useMemo(() => {
        if (!activities) return [];

        if (exportAll) {
            return [...activities].sort((a, b) => new Date(b.start_date) - new Date(a.start_date));
        }

        const fromDate = dateRange?.from || new Date(0);
        const toDate   = dateRange?.to   || new Date();
        const adjustedToDate   = new Date(toDate);   adjustedToDate.setHours(23, 59, 59, 999);
        const adjustedFromDate = new Date(fromDate);  adjustedFromDate.setHours(0, 0, 0, 0);

        const minDistVal = Number(minDist) || 0;
        const minElevVal = Number(minElev) || 0;
        const minHRVal   = Number(minHR)   || 0;
        const maxHRVal   = Number(maxHR)   || 0;

        return activities
            .filter(a => {
                const d = new Date(a.start_date);
                return d >= adjustedFromDate && d <= adjustedToDate;
            })
            .filter(a => (a.distance / 1000) >= minDistVal)
            .filter(a => minElevVal === 0 || (a.total_elevation_gain || 0) >= minElevVal)
            .filter(a => minHRVal === 0 || (a.average_heartrate || 0) >= minHRVal)
            .filter(a => maxHRVal === 0 || (a.average_heartrate || 0) <= maxHRVal)
            .filter(a => {
                if (lapsFilter === 'with')    return a.laps && a.laps.length > 0;
                if (lapsFilter === 'without') return !a.laps || a.laps.length === 0;
                return true;
            })
            .filter(a => !onlyRunning || isRunning(a))
            .sort((a, b) => new Date(b.start_date) - new Date(a.start_date));
    }, [activities, dateRange, minDist, minElev, minHR, maxHR, exportAll, lapsFilter, onlyRunning]);

    const typeCounts = useMemo(() => {
        const counts = {};
        filteredActivities.forEach(a => { counts[a.type] = (counts[a.type] || 0) + 1; });
        return counts;
    }, [filteredActivities]);

    const buildActivityObj = useMemo(() => (a) => {
        const obj = {};
        if (selectedFields.has('id'))             obj.id             = a.id;
        if (selectedFields.has('name'))           obj.name           = a.name;
        if (selectedFields.has('date'))           obj.date           = a.start_date;
        if (selectedFields.has('type'))           obj.type           = a.type;
        if (selectedFields.has('distance_km'))    obj.distance_km    = parseFloat((a.distance / 1000).toFixed(2));
        if (selectedFields.has('time_min'))       obj.time_min       = parseFloat((a.moving_time / 60).toFixed(2));
        // pace only makes sense for running; other types get speed in km/h instead
        if (selectedFields.has('pace')) {
            if (isRunning(a)) obj.pace = calculatePace(a.average_speed);
            else              obj.speed_kmh = parseFloat(((a.average_speed || 0) * 3.6).toFixed(1));
        }
        if (selectedFields.has('avg_hr'))         obj.avg_hr         = a.average_heartrate;
        if (selectedFields.has('max_hr'))         obj.max_hr         = a.max_heartrate;
        if (selectedFields.has('elevation_gain')) obj.elevation_gain = a.total_elevation_gain;
        if (selectedFields.has('avg_speed'))      obj.avg_speed_ms   = a.average_speed;
        if (selectedFields.has('kudos'))          obj.kudos          = a.kudos_count;
        if (selectedFields.has('laps'))           obj.laps           = (a.laps || []).map(l => ({
            lap_index:       l.lap_index,
            distance_km:     parseFloat((l.distance / 1000).toFixed(2)),
            moving_time_min: parseFloat((l.moving_time / 60).toFixed(2)),
            pace:            isRunning(a) ? calculatePace(l.average_speed) : undefined,
            speed_kmh:       isRunning(a) ? undefined : parseFloat(((l.average_speed || 0) * 3.6).toFixed(1)),
            avg_hr:          l.average_heartrate,
            max_hr:          l.max_heartrate,
            cadence:         l.average_cadence,
            elevation_gain:  l.total_elevation_gain,
        }));
        return obj;
    }, [selectedFields]);

    useEffect(() => {
        let dataStr = '';
        const filtered = filteredActivities;

        if (format === 'json') {
            dataStr = JSON.stringify(filtered.map(buildActivityObj), null, 2);

        } else if (format === 'csv') {
            const activeFields = ALL_FIELDS.filter(f => selectedFields.has(f.key) && f.key !== 'laps');
            const headers = activeFields.map(f => f.label);
            const rows = filtered.map(a => {
                const obj = buildActivityObj(a);
                return activeFields.map(f => {
                    const val = obj[f.key];
                    if (val === undefined || val === null) return '';
                    if (typeof val === 'string' && (val.includes(',') || val.includes('"')))
                        return `"${val.replace(/"/g, '""')}"`;
                    return val;
                });
            });
            dataStr = [headers.join(','), ...rows.map(r => r.join(','))].join('\n');

        } else if (format === 'text') {
            dataStr = filtered.map(a => {
                const obj = buildActivityObj(a);
                let line = `• ${new Date(a.start_date).toLocaleDateString('es-ES')} - ${a.name}: ${obj.distance_km ?? '?'}km en ${obj.time_min ? Math.round(obj.time_min) : '?'}min`;
                if (obj.pace)           line += `, Ritmo: ${obj.pace}/km`;
                if (obj.avg_hr)         line += `, FC: ${Math.round(obj.avg_hr)}bpm`;
                if (obj.elevation_gain) line += `, Desnivel: ${obj.elevation_gain}m`;
                if (obj.laps && obj.laps.length > 0) {
                    const laps = obj.laps.map(l => `[P${l.lap_index}: ${l.pace}]`).join(' ');
                    line += `\n    ${laps}`;
                }
                return line;
            }).join('\n');

        } else if (format === 'markdown') {
            const activeFields = ALL_FIELDS.filter(f => selectedFields.has(f.key) && f.key !== 'laps');
            const header    = `| ${activeFields.map(f => f.label).join(' | ')} |`;
            const separator = `| ${activeFields.map(() => '---').join(' | ')} |`;
            const rows = filtered.map(a => {
                const obj  = buildActivityObj(a);
                const vals = activeFields.map(f => {
                    const val = obj[f.key];
                    if (val === undefined || val === null) return '';
                    if (f.key === 'date') return new Date(val).toLocaleDateString('es-ES');
                    return String(val).replace(/\|/g, '\\|');
                });
                return `| ${vals.join(' | ')} |`;
            });
            let md = `## Actividades exportadas (${filtered.length})\n\n`;
            md += [header, separator, ...rows].join('\n');

            if (selectedFields.has('laps')) {
                const withLaps = filtered.filter(a => a.laps && a.laps.length > 0);
                if (withLaps.length > 0) {
                    md += '\n\n---\n\n### Parciales\n';
                    withLaps.forEach(a => {
                        md += `\n**${a.name}** (${new Date(a.start_date).toLocaleDateString('es-ES')})\n`;
                        md += `| Parcial | Distancia | Tiempo | Ritmo | FC Media |\n`;
                        md += `| --- | --- | --- | --- | --- |\n`;
                        a.laps.forEach(l => {
                            md += `| ${l.lap_index} | ${(l.distance / 1000).toFixed(2)}km | ${Math.round(l.moving_time / 60)}min | ${calculatePace(l.average_speed)}/km | ${l.average_heartrate ? Math.round(l.average_heartrate) : 'N/A'} |\n`;
                        });
                    });
                }
            }
            dataStr = md;
        }

        setExportedData(dataStr);
    }, [filteredActivities, format, selectedFields]);

    const handleCopy = () => {
        navigator.clipboard.writeText(exportedData);
        setCopied(true);
        setTimeout(() => setCopied(false), 2000);
    };

    const handleDownload = () => {
        const ext  = format === 'markdown' ? 'md' : format === 'text' ? 'txt' : format;
        const blob = new Blob([exportedData], { type: 'text/plain;charset=utf-8' });
        const url  = URL.createObjectURL(blob);
        const a    = document.createElement('a');
        a.href     = url;
        a.download = `actividades_${new Date().toISOString().slice(0, 10)}.${ext}`;
        a.click();
        URL.revokeObjectURL(url);
    };

    const handleEnrichAll = async () => {
        if (!onEnrichActivity) return;
        setEnriching(true);
        setEnrichProgress(0);
        const toEnrich = filteredActivities.filter(a => !a.laps);
        if (toEnrich.length === 0) { setEnriching(false); return; }
        let completed = 0;
        for (const activity of toEnrich) {
            await onEnrichActivity(activity.id);
            completed++;
            setEnrichProgress(Math.round((completed / toEnrich.length) * 100));
            await new Promise(r => setTimeout(r, 400));
        }
        setEnriching(false);
        setEnrichProgress(0);
    };

    const handleEnrichOne = async (id) => {
        if (!onEnrichActivity) return;
        setEnrichingId(id);
        await onEnrichActivity(id);
        setEnrichingId(null);
    };

    const toggleField = (key) => {
        setSelectedFields(prev => {
            const next = new Set(prev);
            if (next.has(key)) next.delete(key); else next.add(key);
            return next;
        });
    };

    const missingLapsCount  = filteredActivities.filter(a => !a.laps).length;
    const estimatedTokens   = Math.round(exportedData.length / 4);
    const tableFields       = ALL_FIELDS.filter(f => selectedFields.has(f.key) && f.key !== 'laps');

    return (
        <div className="space-y-4">
            {/* ── Filters card ── */}
            <Card className="p-6 ring-1 ring-slate-200 shadow-sm bg-white">
                <div className="flex items-center gap-3 mb-5">
                    <div className="p-2 bg-emerald-100 rounded-xl">
                        <ClipboardDocumentListIcon className="w-6 h-6 text-emerald-600" />
                    </div>
                    <div>
                        <Title className="text-xl font-bold text-slate-900">{t('exporter.title')}</Title>
                        <Text className="text-slate-500 text-sm">{t('exporter.subtitle')}</Text>
                    </div>
                </div>

                {/* Export all toggle */}
                <div className="flex items-center gap-2 mb-3 p-3 bg-emerald-50 border border-emerald-200 rounded-xl">
                    <input
                        id="export-all-check"
                        type="checkbox"
                        checked={exportAll}
                        onChange={e => setExportAll(e.target.checked)}
                        className="w-4 h-4 accent-emerald-600 cursor-pointer"
                    />
                    <label htmlFor="export-all-check" className="text-sm font-semibold text-emerald-800 cursor-pointer select-none">
                        Exportar todas las actividades (sin ningún filtro)
                    </label>
                    {exportAll && (
                        <span className="ml-auto text-xs text-emerald-600 font-medium">{activities?.length || 0} actividades</span>
                    )}
                </div>

                {/* Main filters */}
                <div className={`space-y-3 transition-opacity ${exportAll ? 'opacity-40 pointer-events-none' : ''}`}>
                    <Grid numItems={1} numItemsSm={2} numItemsMd={4} className="gap-4">
                        <div>
                            <Text className="mb-1.5 font-bold text-xs uppercase text-slate-500">{t('exporter.date_range')}</Text>
                            <DateRangePicker
                                className="w-full"
                                value={dateRange}
                                onValueChange={setDateRange}
                                locale={es}
                                selectPlaceholder={t('exporter.select_range')}
                                color="blue"
                                enableSelect={false}
                            />
                        </div>
                        <div>
                            <Text className="mb-1.5 font-bold text-xs uppercase text-slate-500">Dist. mínima (km)</Text>
                            <NumberInput value={minDist} onValueChange={setMinDist} min={0} placeholder="0" />
                        </div>
                        <div>
                            <Text className="mb-1.5 font-bold text-xs uppercase text-slate-500">Desnivel mínimo (m)</Text>
                            <NumberInput value={minElev} onValueChange={setMinElev} min={0} placeholder="0" />
                        </div>
                        <div>
                            <Text className="mb-1.5 font-bold text-xs uppercase text-slate-500">FC Media (mín – máx)</Text>
                            <div className="flex gap-2">
                                <NumberInput value={minHR} onValueChange={setMinHR} min={0} placeholder="Min" />
                                <NumberInput value={maxHR} onValueChange={setMaxHR} min={0} placeholder="Max" />
                            </div>
                        </div>
                    </Grid>

                    {/* Running only toggle */}
                    <div className="flex items-center gap-2 p-3 bg-slate-50 border border-slate-200 rounded-xl">
                        <input
                            id="only-running-check"
                            type="checkbox"
                            checked={onlyRunning}
                            onChange={e => setOnlyRunning(e.target.checked)}
                            className="w-4 h-4 accent-blue-600 cursor-pointer"
                        />
                        <label htmlFor="only-running-check" className="text-sm font-semibold text-slate-700 cursor-pointer select-none">
                            Solo actividades de running (Run, TrailRun, VirtualRun)
                        </label>
                    </div>

                    {/* Laps filter */}
                    <div className="flex items-center gap-4 p-3 bg-slate-50 border border-slate-200 rounded-xl">
                        <span className="text-xs font-bold uppercase text-slate-500">Parciales</span>
                        {[
                            { value: 'all',     label: 'Indiferente' },
                            { value: 'with',    label: 'Con parciales' },
                            { value: 'without', label: 'Sin parciales' },
                        ].map(opt => (
                            <label key={opt.value} className="flex items-center gap-1.5 cursor-pointer select-none text-sm text-slate-700">
                                <input
                                    type="radio"
                                    name="laps-filter"
                                    value={opt.value}
                                    checked={lapsFilter === opt.value}
                                    onChange={() => setLapsFilter(opt.value)}
                                    className="accent-slate-600 cursor-pointer"
                                />
                                {opt.label}
                            </label>
                        ))}
                    </div>
                </div>

                {/* Stats summary chips */}
                <div className="flex flex-wrap gap-2 mt-4">
                    <span className="px-2.5 py-1 bg-slate-100 text-slate-700 text-xs rounded-lg font-semibold">
                        {filteredActivities.length} / {activities?.length || 0} actividades
                    </span>
                    {Object.entries(typeCounts).map(([type, count]) => (
                        <span key={type} className="px-2.5 py-1 bg-blue-50 text-blue-700 text-xs rounded-lg font-medium">
                            {type}: {count}
                        </span>
                    ))}
                </div>
            </Card>

            {/* ── Fields + Format card ── */}
            <Card className="p-5 ring-1 ring-slate-200 shadow-sm bg-white">
                <div className="flex flex-col md:flex-row gap-6">
                    <div className="flex-1">
                        <Text className="mb-2 font-bold text-xs uppercase text-slate-500">Campos a exportar</Text>
                        <div className="flex flex-wrap gap-2">
                            {ALL_FIELDS.map(f => (
                                <button
                                    key={f.key}
                                    onClick={() => toggleField(f.key)}
                                    className={`px-3 py-1 rounded-full text-xs font-medium border transition-colors ${
                                        selectedFields.has(f.key)
                                            ? 'bg-emerald-600 text-white border-emerald-600'
                                            : 'bg-white text-slate-500 border-slate-300 hover:border-emerald-400'
                                    }`}
                                >
                                    {f.label}
                                </button>
                            ))}
                        </div>
                    </div>
                    <div className="w-full md:w-44 shrink-0">
                        <Text className="mb-2 font-bold text-xs uppercase text-slate-500">Formato</Text>
                        <Select value={format} onValueChange={setFormat} enableClear={false}>
                            <SelectItem value="json">JSON</SelectItem>
                            <SelectItem value="csv">CSV</SelectItem>
                            <SelectItem value="text">Texto</SelectItem>
                            <SelectItem value="markdown">Markdown</SelectItem>
                        </Select>
                    </div>
                </div>
            </Card>

            {/* ── Preview card ── */}
            <Card className="p-5 ring-1 ring-slate-200 shadow-sm bg-white">
                <div className="flex flex-wrap justify-between items-center gap-3 mb-3">
                    {/* View mode toggle */}
                    <div className="flex items-center gap-3">
                        <Text className="font-bold text-slate-700">Vista previa</Text>
                        <div className="flex rounded-lg border border-slate-200 overflow-hidden text-xs">
                            <button
                                onClick={() => setPreviewMode('raw')}
                                className={`px-3 py-1.5 flex items-center gap-1 transition-colors ${previewMode === 'raw' ? 'bg-slate-800 text-white' : 'bg-white text-slate-600 hover:bg-slate-50'}`}
                            >
                                <CodeBracketIcon className="w-3.5 h-3.5" /> Raw
                            </button>
                            <button
                                onClick={() => setPreviewMode('table')}
                                className={`px-3 py-1.5 flex items-center gap-1 transition-colors ${previewMode === 'table' ? 'bg-slate-800 text-white' : 'bg-white text-slate-600 hover:bg-slate-50'}`}
                            >
                                <TableCellsIcon className="w-3.5 h-3.5" /> Tabla
                            </button>
                        </div>
                    </div>

                    {/* Actions */}
                    <div className="flex items-center gap-2 flex-wrap">
                        {missingLapsCount > 0 && onEnrichActivity && (
                            <>
                                <Text className="text-xs text-slate-500">{missingLapsCount} sin parciales</Text>
                                <Button size="xs" variant="light" color="blue" icon={ArrowPathIcon} loading={enriching} onClick={handleEnrichAll}>
                                    Enriquecer todas
                                </Button>
                            </>
                        )}
                        <Button size="xs" variant="secondary" color={copied ? 'emerald' : 'slate'} onClick={handleCopy} icon={copied ? CheckIcon : ClipboardDocumentListIcon}>
                            {copied ? 'Copiado' : 'Copiar'}
                        </Button>
                        <Button size="xs" variant="secondary" color="slate" onClick={handleDownload} icon={ArrowDownTrayIcon}>
                            Descargar
                        </Button>
                    </div>
                </div>

                {enriching && (
                    <div className="mb-3">
                        <ProgressBar value={enrichProgress} color="blue" className="mt-1" />
                        <Text className="text-xs text-center mt-1 text-slate-500">Descargando parciales… {enrichProgress}%</Text>
                    </div>
                )}

                {previewMode === 'table' ? (
                    <div className="overflow-auto max-h-96 border border-slate-200 rounded-xl">
                        <table className="w-full text-xs text-left">
                            <thead className="bg-slate-100 sticky top-0 z-10">
                                <tr>
                                    {tableFields.map(f => (
                                        <th key={f.key} className="px-3 py-2 font-semibold text-slate-600 whitespace-nowrap">{f.label}</th>
                                    ))}
                                    {selectedFields.has('laps') && (
                                        <th className="px-3 py-2 font-semibold text-slate-600">Parciales</th>
                                    )}
                                    {onEnrichActivity && <th className="px-3 py-2 w-8" />}
                                </tr>
                            </thead>
                            <tbody>
                                {filteredActivities.map((a, i) => {
                                    const obj = buildActivityObj(a);
                                    return (
                                        <tr key={a.id} className={i % 2 === 0 ? 'bg-white' : 'bg-slate-50'}>
                                            {tableFields.map(f => (
                                                <td key={f.key} className="px-3 py-2 text-slate-700 whitespace-nowrap">
                                                    {f.key === 'date'
                                                        ? new Date(obj.date).toLocaleDateString('es-ES')
                                                        : (obj[f.key] ?? '—')}
                                                </td>
                                            ))}
                                            {selectedFields.has('laps') && (
                                                <td className="px-3 py-2 text-slate-500 whitespace-nowrap">
                                                    {a.laps ? `${a.laps.length} parciales` : '—'}
                                                </td>
                                            )}
                                            {onEnrichActivity && (
                                                <td className="px-3 py-2">
                                                    {!a.laps && (
                                                        <button
                                                            onClick={() => handleEnrichOne(a.id)}
                                                            disabled={enrichingId === a.id}
                                                            title="Obtener parciales"
                                                            className="text-blue-400 hover:text-blue-600 disabled:opacity-40"
                                                        >
                                                            <ArrowPathIcon className={`w-3.5 h-3.5 ${enrichingId === a.id ? 'animate-spin' : ''}`} />
                                                        </button>
                                                    )}
                                                </td>
                                            )}
                                        </tr>
                                    );
                                })}
                            </tbody>
                        </table>
                    </div>
                ) : (
                    <textarea
                        className="w-full h-96 p-4 font-mono text-sm bg-slate-50 border border-slate-200 rounded-xl focus:ring-2 focus:ring-emerald-500 focus:border-transparent outline-none resize-none"
                        value={exportedData}
                        readOnly
                    />
                )}

                {/* Footer stats */}
                <div className="mt-3 flex justify-between items-center text-slate-400 text-xs">
                    <div className="flex gap-3">
                        <span>
                            Caracteres: <span className="font-bold text-slate-600">{exportedData.length.toLocaleString()}</span>
                        </span>
                        <span>
                            Tokens aprox.:{' '}
                            <span className={`font-bold ${estimatedTokens > 100000 ? 'text-red-500' : estimatedTokens > 50000 ? 'text-amber-500' : 'text-slate-600'}`}>
                                {estimatedTokens.toLocaleString()}
                            </span>
                        </span>
                    </div>
                    <span className="uppercase font-medium">{format}</span>
                </div>
            </Card>
        </div>
    );
};

export default DataExporter;
