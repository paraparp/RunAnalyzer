import { useState, useEffect, useRef } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { useTranslation } from 'react-i18next';
import { 
  XMarkIcon, 
  ArrowUpTrayIcon, 
  LinkIcon, 
  TrashIcon, 
  PhotoIcon,
  CheckCircleIcon,
  ExclamationCircleIcon,
  MagnifyingGlassPlusIcon,
  MagnifyingGlassMinusIcon,
  ArrowPathIcon,
  ArrowsRightLeftIcon
} from '@heroicons/react/24/outline';
import { compressImageFile, isValidImageUrl, getBrandInfo, normalizeShoePhoto } from '../lib/shoePhotos';

export default function ShoePhotoModal({
  isOpen,
  onClose,
  gear,
  currentPhoto = null,
  onSavePhoto,
  onRemovePhoto
}) {
  const { t } = useTranslation();
  const [activeTab, setActiveTab] = useState('upload'); // 'upload' | 'url'
  const [urlInput, setUrlInput] = useState('');
  const [preview, setPreview] = useState('');
  const [zoom, setZoom] = useState(1);
  const [pan, setPan] = useState({ x: 0, y: 0 });
  const [flipH, setFlipH] = useState(false);
  const [isPanning, setIsPanning] = useState(false);
  const [isOptimizing, setIsOptimizing] = useState(false);
  const [optimizedKb, setOptimizedKb] = useState(null);
  const [errorMsg, setErrorMsg] = useState(null);
  const [isDragging, setIsDragging] = useState(false);

  const fileInputRef = useRef(null);
  const dragStartRef = useRef({ x: 0, y: 0, panX: 0, panY: 0 });

  // Reiniciar o sincronizar estado cada vez que se abre con una zapatilla
  useEffect(() => {
    if (isOpen) {
      const norm = normalizeShoePhoto(currentPhoto);
      setPreview(norm ? norm.url : '');
      setZoom(norm ? norm.zoom : 1);
      setPan({ x: norm ? norm.x : 0, y: norm ? norm.y : 0 });
      setFlipH(norm ? Boolean(norm.flipH) : false);
      setUrlInput(norm && !norm.url.startsWith('data:') ? norm.url : '');
      setOptimizedKb(null);
      setErrorMsg(null);
      setActiveTab(norm && !norm.url.startsWith('data:') ? 'url' : 'upload');
    }
  }, [isOpen, currentPhoto]);

  // Manejador tecla Escape
  useEffect(() => {
    const handleKeyDown = (e) => {
      if (e.key === 'Escape' && isOpen) onClose();
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isOpen, onClose]);

  // Arrastre interactivo para encuadrar / centrar la zapatilla
  const onPointerDown = (e) => {
    if (!preview) return;
    setIsPanning(true);
    const clientX = e.touches ? e.touches[0].clientX : e.clientX;
    const clientY = e.touches ? e.touches[0].clientY : e.clientY;
    dragStartRef.current = {
      x: clientX,
      y: clientY,
      panX: pan.x,
      panY: pan.y
    };
  };

  useEffect(() => {
    if (!isPanning) return;

    const onPointerMove = (e) => {
      const clientX = e.touches ? e.touches[0].clientX : e.clientX;
      const clientY = e.touches ? e.touches[0].clientY : e.clientY;
      const dx = clientX - dragStartRef.current.x;
      const dy = clientY - dragStartRef.current.y;

      const scale = 0.9 * zoom;
      const dxEffective = flipH ? -dx : dx;
      const nextX = Math.max(-50, Math.min(50, dragStartRef.current.panX + dxEffective / scale));
      const nextY = Math.max(-50, Math.min(50, dragStartRef.current.panY + dy / scale));
      setPan({
        x: Math.round(nextX * 10) / 10,
        y: Math.round(nextY * 10) / 10
      });
    };

    const onPointerUp = () => {
      setIsPanning(false);
    };

    window.addEventListener('mousemove', onPointerMove);
    window.addEventListener('mouseup', onPointerUp);
    window.addEventListener('touchmove', onPointerMove);
    window.addEventListener('touchend', onPointerUp);

    return () => {
      window.removeEventListener('mousemove', onPointerMove);
      window.removeEventListener('mouseup', onPointerUp);
      window.removeEventListener('touchmove', onPointerMove);
      window.removeEventListener('touchend', onPointerUp);
    };
  }, [isPanning, zoom, flipH]);

  if (!isOpen || !gear) return null;

  const brandInfo = getBrandInfo(gear.name);

  const handleFileProcess = async (file) => {
    if (!file) return;
    if (!file.type.startsWith('image/')) {
      setErrorMsg(t('gear.photos.drop_subhint'));
      return;
    }

    setErrorMsg(null);
    setIsOptimizing(true);
    try {
      const result = await compressImageFile(file, { maxWidth: 420, maxHeight: 420, quality: 0.82 });
      setPreview(result.dataUrl);
      setZoom(1);
      setPan({ x: 0, y: 0 });
      setFlipH(false);
      setOptimizedKb(Math.round(result.sizeBytes / 1024));
    } catch (err) {
      console.error('Error al procesar la imagen:', err);
      setErrorMsg(err.message || 'Error al procesar la imagen.');
    } finally {
      setIsOptimizing(false);
    }
  };

  const handleFileChange = (e) => {
    const file = e.target.files?.[0];
    if (file) handleFileProcess(file);
  };

  const handleDrop = (e) => {
    e.preventDefault();
    setIsDragging(false);
    const file = e.dataTransfer.files?.[0];
    if (file) handleFileProcess(file);
  };

  const handleUrlApply = () => {
    const trimmed = urlInput.trim();
    if (!trimmed) {
      setErrorMsg(t('gear.photos.url_invalid'));
      return;
    }
    if (!isValidImageUrl(trimmed)) {
      setErrorMsg(t('gear.photos.url_invalid'));
      return;
    }
    setErrorMsg(null);
    setOptimizedKb(null);
    setPreview(trimmed);
    setZoom(1);
    setPan({ x: 0, y: 0 });
    setFlipH(false);
  };

  const handleSave = () => {
    if (!preview) return;
    if (zoom === 1 && pan.x === 0 && pan.y === 0 && !flipH) {
      onSavePhoto(preview);
    } else {
      onSavePhoto({
        url: preview,
        zoom: Math.round(zoom * 100) / 100,
        x: pan.x,
        y: pan.y,
        flipH
      });
    }
    onClose();
  };

  const handleRemove = () => {
    onRemovePhoto();
    onClose();
  };

  const normCurrent = normalizeShoePhoto(currentPhoto);
  const isUnchanged = normCurrent && 
    normCurrent.url === preview && 
    normCurrent.zoom === zoom && 
    normCurrent.x === pan.x && 
    normCurrent.y === pan.y &&
    Boolean(normCurrent.flipH) === flipH;

  return (
    <AnimatePresence>
      <div className="fixed inset-0 z-50 flex items-center justify-center p-4 sm:p-6 overflow-y-auto">
        {/* Backdrop */}
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          onClick={onClose}
          className="fixed inset-0 bg-slate-900/60 backdrop-blur-sm"
        />

        {/* Modal Window */}
        <motion.div
          initial={{ opacity: 0, scale: 0.95, y: 10 }}
          animate={{ opacity: 1, scale: 1, y: 0 }}
          exit={{ opacity: 0, scale: 0.95, y: 10 }}
          transition={{ duration: 0.2 }}
          className="relative w-full max-w-lg bg-white rounded-3xl shadow-2xl border border-slate-100 overflow-hidden z-10"
        >
          {/* Header */}
          <div className="p-6 pb-4 border-b border-slate-100 flex items-start justify-between gap-4">
            <div>
              <div className="flex items-center gap-2">
                <span className={`px-2 py-0.5 rounded-md text-[10px] font-black uppercase tracking-wider ${brandInfo.bg} ${brandInfo.text} border ${brandInfo.border}`}>
                  {brandInfo.brand}
                </span>
                <h3 className="text-lg font-black text-slate-900 tracking-tight">
                  {t('gear.photos.modal_title')}
                </h3>
              </div>
              <p className="text-sm font-semibold text-slate-500 mt-1 line-clamp-1">
                {gear.name}
              </p>
            </div>
            <button
              type="button"
              onClick={onClose}
              className="p-1.5 text-slate-400 hover:text-slate-600 hover:bg-slate-100 rounded-xl transition-colors"
            >
              <XMarkIcon className="w-5 h-5" />
            </button>
          </div>

          <div className="p-6 space-y-6">
            {/* Preview Box con tamaño idéntico al listado real */}
            <div className="flex flex-col items-center">
              <div className="p-3.5 bg-slate-50 rounded-2xl border border-slate-200/80 flex items-center gap-4 max-w-sm w-full shadow-inner">
                {/* Marco con exactamente el mismo tamaño que la tarjeta: w-20 h-20 sm:w-24 sm:h-24 */}
                <div
                  onMouseDown={onPointerDown}
                  onTouchStart={onPointerDown}
                  title={t('gear.photos.drag_hint')}
                  className={`w-20 h-20 sm:w-24 sm:h-24 shrink-0 rounded-2xl border border-slate-200/80 bg-white relative overflow-hidden flex items-center justify-center select-none shadow-xs group/box ${
                    preview ? (isPanning ? 'cursor-grabbing' : 'cursor-grab') : 'cursor-default'
                  }`}
                >
                  {preview ? (
                    <div className="w-full h-full flex items-center justify-center overflow-hidden pointer-events-none">
                      <img
                        src={preview}
                        alt={gear.name}
                        referrerPolicy="no-referrer"
                        draggable={false}
                        style={{
                          transform: `scale(${zoom}) translate(${pan.x}%, ${pan.y}%) scaleX(${flipH ? -1 : 1})`,
                          transformOrigin: 'center center'
                        }}
                        onError={() => setErrorMsg(t('gear.photos.load_failed'))}
                        className="w-full h-full object-contain p-1.5 select-none pointer-events-none transition-transform duration-75"
                      />
                    </div>
                  ) : (
                    <div className="flex flex-col items-center justify-center text-slate-300">
                      <PhotoIcon className="w-8 h-8 stroke-1" />
                      <span className="text-[10px] font-bold uppercase tracking-wider mt-0.5 text-slate-400">
                        {brandInfo.short}
                      </span>
                    </div>
                  )}

                  {isOptimizing && (
                    <div className="absolute inset-0 bg-slate-900/60 backdrop-blur-xs flex flex-col items-center justify-center text-white">
                      <div className="w-5 h-5 border-2 border-white/30 border-t-white rounded-full animate-spin mb-1" />
                      <span className="text-[10px] font-bold">{t('gear.photos.optimizing')}</span>
                    </div>
                  )}
                </div>

                {/* Contexto del par (nombre y marca) */}
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2 mb-1">
                    <h5 className="font-black text-slate-900 text-xs truncate uppercase tracking-tight">
                      {gear.name}
                    </h5>
                  </div>
                  <span className={`px-2 py-0.5 rounded-md text-[9px] font-black uppercase tracking-wider ${brandInfo.bg} ${brandInfo.text} border ${brandInfo.border}`}>
                    {brandInfo.brand}
                  </span>
                  <p className="text-[10px] font-bold text-slate-400 uppercase tracking-widest mt-2">
                    {t('gear.photos.preview')}
                  </p>
                </div>
              </div>

              {/* Controles de Zoom, Encuadre y Flip */}
              {preview && (
                <div className="w-full max-w-sm mt-3 flex flex-col items-center gap-1">
                  <div className="w-full flex items-center gap-2 bg-slate-50 border border-slate-200/80 px-3 py-1.5 rounded-xl shadow-xs">
                    <button
                      type="button"
                      onClick={() => setZoom((z) => Math.max(1, Math.round((z - 0.1) * 100) / 100))}
                      disabled={zoom <= 1}
                      title="Reducir zoom"
                      className="p-1 rounded-lg text-slate-500 hover:text-slate-800 hover:bg-slate-200/60 disabled:opacity-30 disabled:hover:bg-transparent transition-colors"
                    >
                      <MagnifyingGlassMinusIcon className="w-4 h-4" />
                    </button>

                    <input
                      type="range"
                      min="1"
                      max="2.5"
                      step="0.05"
                      value={zoom}
                      onChange={(e) => setZoom(parseFloat(e.target.value))}
                      className="flex-1 accent-slate-900 cursor-pointer h-1.5 bg-slate-200 rounded-lg"
                    />

                    <button
                      type="button"
                      onClick={() => setZoom((z) => Math.min(2.5, Math.round((z + 0.1) * 100) / 100))}
                      disabled={zoom >= 2.5}
                      title="Aumentar zoom"
                      className="p-1 rounded-lg text-slate-500 hover:text-slate-800 hover:bg-slate-200/60 disabled:opacity-30 disabled:hover:bg-transparent transition-colors"
                    >
                      <MagnifyingGlassPlusIcon className="w-4 h-4" />
                    </button>

                    <span className="text-[11px] font-black tabular-nums text-slate-700 min-w-[32px] text-right">
                      {zoom.toFixed(2)}×
                    </span>

                    {/* Botón Voltear horizontalmente */}
                    <button
                      type="button"
                      onClick={() => setFlipH((f) => !f)}
                      title={t('gear.photos.flip')}
                      className={`p-1 px-1.5 rounded-lg text-xs font-bold flex items-center gap-1 transition-all ${
                        flipH
                          ? 'bg-slate-900 text-white shadow-xs'
                          : 'text-slate-500 hover:text-slate-800 hover:bg-slate-200/60'
                      }`}
                    >
                      <ArrowsRightLeftIcon className="w-3.5 h-3.5" />
                      <span className="text-[10px] hidden sm:inline">{t('gear.photos.flip')}</span>
                    </button>

                    {/* Botón Restablecer encuadre */}
                    {(zoom > 1 || pan.x !== 0 || pan.y !== 0 || flipH) && (
                      <button
                        type="button"
                        onClick={() => { setZoom(1); setPan({ x: 0, y: 0 }); setFlipH(false); }}
                        title={t('gear.photos.reset_frame')}
                        className="p-1 text-slate-400 hover:text-slate-700 hover:bg-slate-200/60 rounded-lg transition-colors ml-0.5"
                      >
                        <ArrowPathIcon className="w-3.5 h-3.5" />
                      </button>
                    )}
                  </div>

                  <p className="text-[10px] font-medium text-slate-400">
                    {t('gear.photos.drag_hint')}
                  </p>
                </div>
              )}

              {optimizedKb !== null && (
                <div className="mt-2.5 flex items-center gap-1.5 text-[11px] font-bold text-emerald-600 bg-emerald-50 px-2.5 py-1 rounded-full border border-emerald-100">
                  <CheckCircleIcon className="w-3.5 h-3.5" />
                  <span>{t('gear.photos.optimized_badge', { kb: optimizedKb })}</span>
                </div>
              )}

              {errorMsg && (
                <div className="mt-2.5 flex items-center gap-1.5 text-[11px] font-bold text-rose-600 bg-rose-50 px-2.5 py-1 rounded-full border border-rose-100">
                  <ExclamationCircleIcon className="w-3.5 h-3.5" />
                  <span>{errorMsg}</span>
                </div>
              )}
            </div>

            {/* Tabs */}
            <div className="flex p-1 bg-slate-100 rounded-xl">
              <button
                type="button"
                onClick={() => { setActiveTab('upload'); setErrorMsg(null); }}
                className={`flex-1 flex items-center justify-center gap-2 py-2 text-xs font-black rounded-lg transition-all ${
                  activeTab === 'upload' 
                    ? 'bg-white text-slate-900 shadow-sm' 
                    : 'text-slate-500 hover:text-slate-800'
                }`}
              >
                <ArrowUpTrayIcon className="w-4 h-4" />
                <span>{t('gear.photos.upload_tab')}</span>
              </button>

              <button
                type="button"
                onClick={() => { setActiveTab('url'); setErrorMsg(null); }}
                className={`flex-1 flex items-center justify-center gap-2 py-2 text-xs font-black rounded-lg transition-all ${
                  activeTab === 'url' 
                    ? 'bg-white text-slate-900 shadow-sm' 
                    : 'text-slate-500 hover:text-slate-800'
                }`}
              >
                <LinkIcon className="w-4 h-4" />
                <span>{t('gear.photos.url_tab')}</span>
              </button>
            </div>

            {/* Tab: Subir archivo */}
            {activeTab === 'upload' && (
              <div
                onDragOver={(e) => { e.preventDefault(); setIsDragging(true); }}
                onDragLeave={() => setIsDragging(false)}
                onDrop={handleDrop}
                onClick={() => fileInputRef.current?.click()}
                className={`border-2 border-dashed rounded-2xl p-6 text-center cursor-pointer transition-all ${
                  isDragging 
                    ? 'border-indigo-500 bg-indigo-50/50' 
                    : 'border-slate-200 hover:border-slate-300 hover:bg-slate-50/70 bg-white'
                }`}
              >
                <input
                  ref={fileInputRef}
                  type="file"
                  accept="image/png,image/jpeg,image/jpg,image/webp,image/avif"
                  onChange={handleFileChange}
                  className="hidden"
                />
                <div className="w-10 h-10 mx-auto rounded-full bg-slate-100 flex items-center justify-center text-slate-500 mb-2">
                  <ArrowUpTrayIcon className="w-5 h-5" />
                </div>
                <p className="text-xs font-bold text-slate-700">
                  {t('gear.photos.drop_hint')}
                </p>
                <p className="text-[11px] font-medium text-slate-400 mt-1">
                  {t('gear.photos.drop_subhint')}
                </p>
              </div>
            )}

            {/* Tab: Pegar URL */}
            {activeTab === 'url' && (
              <div className="space-y-3">
                <div className="flex gap-2">
                  <input
                    type="url"
                    value={urlInput}
                    onChange={(e) => { setUrlInput(e.target.value); setErrorMsg(null); }}
                    onKeyDown={(e) => { if (e.key === 'Enter') handleUrlApply(); }}
                    placeholder={t('gear.photos.url_placeholder')}
                    className="flex-1 px-3.5 py-2 text-xs font-medium text-slate-900 border border-slate-200 rounded-xl focus:outline-none focus:border-slate-400"
                  />
                  <button
                    type="button"
                    onClick={handleUrlApply}
                    className="px-4 py-2 text-xs font-black text-white bg-slate-900 hover:bg-slate-800 rounded-xl transition-colors shrink-0"
                  >
                    {t('gear.photos.preview')}
                  </button>
                </div>
                <p className="text-[11px] font-medium text-slate-400">
                  {t('gear.photos.url_hint')}
                </p>
              </div>
            )}
          </div>

          {/* Footer Actions */}
          <div className="p-6 pt-4 bg-slate-50 border-t border-slate-100 flex items-center justify-between gap-3">
            {currentPhoto ? (
              <button
                type="button"
                onClick={handleRemove}
                className="flex items-center gap-1.5 px-3 py-2 text-xs font-bold text-rose-600 hover:text-rose-700 hover:bg-rose-50 rounded-xl transition-colors"
              >
                <TrashIcon className="w-4 h-4" />
                <span>{t('gear.photos.remove')}</span>
              </button>
            ) : (
              <div />
            )}

            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={onClose}
                className="px-4 py-2 text-xs font-bold text-slate-600 hover:bg-slate-200/60 rounded-xl transition-colors"
              >
                {t('gear.photos.cancel')}
              </button>

              <button
                type="button"
                onClick={handleSave}
                disabled={!preview || isUnchanged}
                className="px-5 py-2 text-xs font-black text-white bg-emerald-600 hover:bg-emerald-500 disabled:opacity-40 disabled:hover:bg-emerald-600 rounded-xl shadow-sm transition-all"
              >
                {t('gear.photos.save')}
              </button>
            </div>
          </div>
        </motion.div>
      </div>
    </AnimatePresence>
  );
}
