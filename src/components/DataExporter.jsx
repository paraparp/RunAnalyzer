import React, { useState, useEffect, useMemo } from 'react';
import { Card, Title, Text, Button, Select, SelectItem, Grid, NumberInput, DateRangePicker, ProgressBar } from "@tremor/react";
import { ClipboardDocumentListIcon, CheckIcon, ArrowPathIcon } from "@heroicons/react/24/outline";
import { es } from 'date-fns/locale';

const DataExporter = ({ activities, onEnrichActivity }) => {
    // Default to last 3 months
    const [dateRange, setDateRange] = useState({
        from: new Date(new Date().setMonth(new Date().getMonth() - 3)),
        to: new Date()
    });
    const [minDist, setMinDist] = useState(0); // Minimum distance filter in km
    const [format, setFormat] = useState('json');
    const [exportedData, setExportedData] = useState('');
    const [copied, setCopied] = useState(false);
    const [enriching, setEnriching] = useState(false);
    const [enrichProgress, setEnrichProgress] = useState(0);

    const filteredActivities = useMemo(() => {
        if (!activities) return [];

        // 1. Filter by Date Range from Picker
        const fromDate = dateRange?.from || new Date(0);
        const toDate = dateRange?.to || new Date();

        // Set to end of day for 'to' date to include activities on that day
        const adjustedToDate = new Date(toDate);
        adjustedToDate.setHours(23, 59, 59, 999);

        // Set 'from' to beginning of day just in case
        const adjustedFromDate = new Date(fromDate);
        adjustedFromDate.setHours(0, 0, 0, 0);

        // 2. Filter logic
        const minDistVal = Number(minDist) || 0;

        return activities
            .filter(a => {
                const activityDate = new Date(a.start_date);
                return activityDate >= adjustedFromDate && activityDate <= adjustedToDate;
            })
            .filter(a => (a.distance / 1000) >= minDistVal)
            .sort((a, b) => new Date(b.start_date) - new Date(a.start_date)); // Newest first
    }, [activities, dateRange, minDist]);

    const calculatePace = (speed) => {
        if (!speed || speed === 0) return '0:00';
        const pace = 16.6667 / speed; // min/km
        const minutes = Math.floor(pace);
        const seconds = Math.floor((pace - minutes) * 60);
        return `${minutes}:${seconds.toString().padStart(2, '0')}`;
    };

    useEffect(() => {
        // 3. Format Data
        let dataStr = '';
        const filtered = filteredActivities;

        if (format === 'json') {
            const cleanData = filtered.map(a => ({
                id: a.id,
                name: a.name,
                date: a.start_date,
                distance_km: parseFloat((a.distance / 1000).toFixed(2)),
                time_min: parseFloat((a.moving_time / 60).toFixed(2)),
                avg_hr: a.average_heartrate,
                max_hr: a.max_heartrate,
                elevation_gain: a.total_elevation_gain,
                type: a.type,
                avg_speed: a.average_speed,
                kudos: a.kudos_count,
                splits: a.splits_metric || [] // Include splits if available
            }));
            dataStr = JSON.stringify(cleanData, null, 2);
        } else if (format === 'csv') {
            const headers = ['Date', 'Name', 'Type', 'Distance (km)', 'Time (min)', 'Avg HR', 'Elevation (m)'];
            // CSV simplified, no splits
            const rows = filtered.map(a => [
                new Date(a.start_date).toLocaleDateString(),
                `"${a.name.replace(/"/g, '""')}"`, // Escape quotes
                a.type,
                (a.distance / 1000).toFixed(2),
                (a.moving_time / 60).toFixed(2),
                a.average_heartrate || '',
                a.total_elevation_gain
            ]);
            dataStr = [headers.join(','), ...rows.map(r => r.join(','))].join('\n');
        } else if (format === 'text') {
            dataStr = filtered.map(a => {
                const dist = (a.distance / 1000).toFixed(2);
                const time = (a.moving_time / 60).toFixed(0);
                const hr = a.average_heartrate ? `${Math.round(a.average_heartrate)}bpm` : 'N/A';

                let line = `• ${new Date(a.start_date).toLocaleDateString()} - ${a.name}: ${dist}km in ${time}min, HR: ${hr}, Elev: ${a.total_elevation_gain}m`;

                if (a.splits_metric && a.splits_metric.length > 0) {
                    const splits = a.splits_metric.map(s => `[Km ${s.split}: ${calculatePace(s.average_speed)}]`).join(' ');
                    line += `\n    ${splits}`;
                }
                return line;
            }).join('\n');
        }

        setExportedData(dataStr);
    }, [filteredActivities, format]);

    const handleCopy = () => {
        navigator.clipboard.writeText(exportedData);
        setCopied(true);
        setTimeout(() => setCopied(false), 2000);
    };

    const handleEnrichData = async () => {
        if (!onEnrichActivity) return;
        setEnriching(true);
        setEnrichProgress(0);

        // Find activities that need enrichment (no splits)
        const toEnrich = filteredActivities.filter(a => !a.splits_metric);
        let completed = 0;

        // If all already enriched, just finish
        if (toEnrich.length === 0) {
            setEnriching(false);
            return;
        }

        // Process sequentially to avoid rate limits
        for (const activity of toEnrich) {
            await onEnrichActivity(activity.id);
            completed++;
            setEnrichProgress(Math.round((completed / toEnrich.length) * 100));
            // Small delay
            await new Promise(r => setTimeout(r, 400));
        }

        setEnriching(false);
        setEnrichProgress(0);
    };

    const missingSplitsCount = filteredActivities.filter(a => !a.splits_metric).length;

    return (
        <div className="space-y-6">
            <Card className="p-6 ring-1 ring-slate-200 shadow-sm bg-white">
                <div className="flex items-center gap-3 mb-4">
                    <div className="p-2 bg-emerald-100 rounded-xl">
                        <ClipboardDocumentListIcon className="w-6 h-6 text-emerald-600" />
                    </div>
                    <div>
                        <Title className="text-xl font-bold text-slate-900">Exportador de Datos</Title>
                        <Text className="text-slate-500 text-sm">Copia tus actividades para usarlas en otras herramientas o análisis.</Text>
                    </div>
                </div>

                <Grid numItems={1} numItemsSm={3} className="gap-6 mb-6">
                    <div>
                        <Text className="mb-1.5 font-bold text-xs uppercase text-slate-500">Rango de Fechas</Text>
                        <DateRangePicker
                            className="w-full"
                            value={dateRange}
                            onValueChange={setDateRange}
                            locale={es}
                            selectPlaceholder="Seleccionar rango"
                            color="indigo"
                            enableSelect={false}
                        />
                    </div>
                    <div>
                        <Text className="mb-1.5 font-bold text-xs uppercase text-slate-500">Distancia Mínima (km)</Text>
                        <NumberInput
                            value={minDist}
                            onValueChange={setMinDist}
                            min={0}
                            placeholder="Ej. 5"
                        />
                    </div>
                    <div>
                        <Text className="mb-1.5 font-bold text-xs uppercase text-slate-500">Formato</Text>
                        <Select value={format} onValueChange={setFormat} enableClear={false}>
                            <SelectItem value="json">JSON (Completo)</SelectItem>
                            <SelectItem value="csv">CSV (Excel/Sheets)</SelectItem>
                            <SelectItem value="text">Texto (Resumen)</SelectItem>
                        </Select>
                    </div>
                </Grid>

                <div className="flex justify-between items-center mb-2">
                    <Text className="font-bold text-slate-700">Vista Previa</Text>
                    {missingSplitsCount > 0 && onEnrichActivity && (
                        <div className="flex items-center gap-2">
                            <Text className="text-xs text-slate-500">{missingSplitsCount} actividades sin parciales</Text>
                            <Button
                                size="xs"
                                variant="light"
                                color="indigo"
                                icon={ArrowPathIcon}
                                loading={enriching}
                                onClick={handleEnrichData}
                            >
                                Obtener Parciales
                            </Button>
                        </div>
                    )}
                </div>

                {enriching && (
                    <div className="mb-3">
                        <ProgressBar value={enrichProgress} color="indigo" className="mt-1" />
                        <Text className="text-xs text-center mt-1 text-slate-500">Descargando datos detallados de Strava... esto puede tardar unos segundos.</Text>
                    </div>
                )}

                <div className="relative">
                    <textarea
                        className="w-full h-96 p-4 font-mono text-sm bg-slate-50 border border-slate-200 rounded-xl focus:ring-2 focus:ring-emerald-500 focus:border-transparent outline-none resize-none mx-0"
                        value={exportedData}
                        readOnly
                    />
                    <div className="absolute top-4 right-4">
                        <Button
                            size="xs"
                            variant="secondary"
                            color={copied ? "emerald" : "slate"}
                            onClick={handleCopy}
                            icon={copied ? CheckIcon : ClipboardDocumentListIcon}
                        >
                            {copied ? "Copiado!" : "Copiar al portapapeles"}
                        </Button>
                    </div>
                </div>

                <div className="mt-4 flex justify-between items-center text-slate-400 text-xs">
                    <div className="flex gap-2">
                        <span>Actividades filtradas: <span className="font-bold text-slate-600">{filteredActivities.length}</span></span>
                        <span>de {activities?.length || 0}</span>
                    </div>
                    <span>Caracteres: {exportedData.length}</span>
                </div>
            </Card>
        </div>
    );
};

export default DataExporter;
