import { useCallback, useEffect, useId, useMemo, useRef, useState } from 'react';
import type { SavedSignature } from '@shared/types';
import {
  DEFAULT_EXTRACT_OPTIONS,
  MAX_EDGE,
  NoInkError,
  SENSITIVITY_RANGE,
  applyExtraction,
  prepareExtraction,
  type ExtractResult,
  type InkColor,
  type Prepared,
  type RgbaImage,
} from './extract';
import './signature.css';

export type SignatureImportDialogProps = {
  open: boolean;
  onClose: () => void;
  /** Called after the signature has been stored (via window.api.addSignature). */
  onSaved?: (signature: SavedSignature) => void;
};

const ACCEPT = 'image/png,image/jpeg,image/webp';
const ACCEPTED_TYPES = new Set(ACCEPT.split(','));
const PREVIEW_DEBOUNCE_MS = 120;

/** Decode an image file (honouring EXIF orientation) and downscale to MAX_EDGE on the long edge. */
async function decodeFile(file: File): Promise<RgbaImage> {
  const bitmap = await createImageBitmap(file, { imageOrientation: 'from-image' });
  try {
    const scale = Math.min(1, MAX_EDGE / Math.max(bitmap.width, bitmap.height));
    const w = Math.max(1, Math.round(bitmap.width * scale));
    const h = Math.max(1, Math.round(bitmap.height * scale));
    const canvas = new OffscreenCanvas(w, h);
    const ctx = canvas.getContext('2d', { willReadFrequently: true });
    if (!ctx) throw new Error('Canvas is not available');
    ctx.drawImage(bitmap, 0, 0, w, h);
    const d = ctx.getImageData(0, 0, w, h);
    return { data: d.data, width: w, height: h };
  } finally {
    bitmap.close();
  }
}

function toImageData(img: RgbaImage): ImageData {
  return new ImageData(new Uint8ClampedArray(img.data), img.width, img.height);
}

function drawTo(canvas: HTMLCanvasElement | null, img: RgbaImage): void {
  if (!canvas) return;
  canvas.width = img.width;
  canvas.height = img.height;
  canvas.getContext('2d')?.putImageData(toImageData(img), 0, 0);
}

function blobToDataUrl(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result as string);
    reader.onerror = () => reject(reader.error ?? new Error('Could not read the image'));
    reader.readAsDataURL(blob);
  });
}

/** Encode the extraction result as a PNG data URL. */
async function encodePng(img: RgbaImage): Promise<string> {
  const canvas = new OffscreenCanvas(img.width, img.height);
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('Canvas is not available');
  ctx.putImageData(toImageData(img), 0, 0);
  return blobToDataUrl(await canvas.convertToBlob({ type: 'image/png' }));
}

export function SignatureImportDialog(props: SignatureImportDialogProps) {
  // The body is a separate component so closing the dialog discards all of its state.
  if (!props.open) return null;
  return <DialogBody onClose={props.onClose} onSaved={props.onSaved} />;
}

function DialogBody({ onClose, onSaved }: Pick<SignatureImportDialogProps, 'onClose' | 'onSaved'>) {
  const titleId = useId();
  const fileInput = useRef<HTMLInputElement>(null);
  const originalCanvas = useRef<HTMLCanvasElement>(null);
  const resultCanvas = useRef<HTMLCanvasElement>(null);

  const [fileName, setFileName] = useState<string | null>(null);
  const [prepared, setPrepared] = useState<Prepared | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [dragOver, setDragOver] = useState(false);
  const [saving, setSaving] = useState(false);

  const [sensitivity, setSensitivity] = useState(DEFAULT_EXTRACT_OPTIONS.sensitivity);
  const [color, setColor] = useState<InkColor>(DEFAULT_EXTRACT_OPTIONS.color);
  const [removeLines, setRemoveLines] = useState(DEFAULT_EXTRACT_OPTIONS.removeLines);
  const [kind, setKind] = useState<'signature' | 'initials'>('signature');
  const [label, setLabel] = useState('');

  const [result, setResult] = useState<ExtractResult | null>(null);
  const [extractError, setExtractError] = useState<string | null>(null);
  // The options the current `result` was computed with (Save waits until the preview is current).
  const [resultFor, setResultFor] = useState<unknown>(null);

  const options = useMemo(
    () => ({ sensitivity, color, removeLines }),
    [sensitivity, color, removeLines],
  );

  // Escape closes.
  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  const loadFile = useCallback(async (file: File) => {
    setError(null);
    if (!ACCEPTED_TYPES.has(file.type)) {
      setError('Please choose a PNG, JPEG or WebP image. (HEIC: export it as JPEG first.)');
      return;
    }
    setLoading(true);
    try {
      const img = await decodeFile(file);
      setPrepared(prepareExtraction(img, MAX_EDGE));
      setResultFor(null);
      setFileName(file.name);
      setSensitivity(DEFAULT_EXTRACT_OPTIONS.sensitivity);
    } catch (err) {
      setPrepared(null);
      setError(
        err instanceof Error && err.name === 'InvalidStateError'
          ? 'That image could not be read.'
          : `That image could not be read${err instanceof Error ? `: ${err.message}` : '.'}`,
      );
    } finally {
      setLoading(false);
    }
  }, []);

  // Show the (downscaled) original once a file is loaded.
  useEffect(() => {
    if (prepared) {
      drawTo(originalCanvas.current, {
        data: prepared.rgba,
        width: prepared.width,
        height: prepared.height,
      });
    }
  }, [prepared]);

  // Live preview: re-run the option-dependent part, debounced.
  useEffect(() => {
    if (!prepared) return;
    const timer = setTimeout(() => {
      try {
        setResult(applyExtraction(prepared, options));
        setResultFor(options);
        setExtractError(null);
      } catch (err) {
        setResult(null);
        setExtractError(
          err instanceof NoInkError ? err.message : 'Something went wrong extracting the ink.',
        );
      }
    }, PREVIEW_DEBOUNCE_MS);
    return () => clearTimeout(timer);
  }, [prepared, options]);

  useEffect(() => {
    if (result) drawTo(resultCanvas.current, result.imageData);
  }, [result]);

  const onDrop = (e: React.DragEvent): void => {
    // Keep the window-level "drop a PDF to open it" handler out of this.
    e.preventDefault();
    e.stopPropagation();
    setDragOver(false);
    const file = e.dataTransfer.files[0];
    if (file) void loadFile(file);
  };

  const save = async (): Promise<void> => {
    if (!result) return;
    setSaving(true);
    setError(null);
    try {
      const pngDataUrl = await encodePng(result.imageData);
      const saved = await window.api.addSignature({
        label: label.trim() || (kind === 'initials' ? 'Initials' : 'Signature'),
        kind,
        pngDataUrl,
      });
      onSaved?.(saved);
      onClose();
    } catch (err) {
      setError(`Could not save: ${err instanceof Error ? err.message : String(err)}`);
      setSaving(false);
    }
  };

  const sensitivityId = useId();
  const colorId = useId();
  const kindId = useId();
  const labelId = useId();

  return (
    <div
      className="sig-backdrop"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div
        className="sig-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        data-testid="signature-import-dialog"
        onDragOver={(e) => {
          e.preventDefault();
          e.stopPropagation();
          setDragOver(true);
        }}
        onDragLeave={() => setDragOver(false)}
        onDrop={onDrop}
      >
        <h2 id={titleId} className="sig-title">
          Add a signature
        </h2>

        <input
          ref={fileInput}
          type="file"
          accept={ACCEPT}
          hidden
          data-testid="signature-file-input"
          onChange={(e) => {
            const file = e.target.files?.[0];
            if (file) void loadFile(file);
            e.target.value = ''; // allow choosing the same file again
          }}
        />

        {!prepared && (
          <div className={`sig-drop${dragOver ? ' sig-drop-active' : ''}`}>
            <p>
              Take a photo or scan of your signature or initials on plain white paper, then choose
              it here or drop it onto this window.
            </p>
            <button type="button" autoFocus onClick={() => fileInput.current?.click()}>
              {loading ? 'Reading image…' : 'Choose image…'}
            </button>
            <p className="sig-hint">PNG, JPEG or WebP</p>
          </div>
        )}

        {prepared && (
          <>
            <div className="sig-previews">
              <figure className="sig-figure">
                <figcaption>Original{fileName ? ` (${fileName})` : ''}</figcaption>
                <canvas ref={originalCanvas} className="sig-canvas" aria-label="Original photo" />
              </figure>
              <figure className="sig-figure">
                <figcaption>Result</figcaption>
                <div className="sig-checker">
                  {result ? (
                    <canvas
                      ref={resultCanvas}
                      className="sig-canvas"
                      aria-label="Extracted signature preview"
                      data-testid="signature-result"
                    />
                  ) : (
                    <p className="sig-hint sig-noresult" role="status">
                      {extractError ?? 'Working…'}
                    </p>
                  )}
                </div>
              </figure>
            </div>

            <div className="sig-controls">
              <label htmlFor={sensitivityId}>Sensitivity</label>
              <input
                id={sensitivityId}
                type="range"
                min={-SENSITIVITY_RANGE}
                max={SENSITIVITY_RANGE}
                step={0.01}
                value={sensitivity}
                onChange={(e) => setSensitivity(Number(e.target.value))}
              />
              <span className="sig-hint">
                {sensitivity > 0 ? '+' : ''}
                {sensitivity.toFixed(2)}
              </span>

              <label htmlFor={colorId}>Ink color</label>
              <select
                id={colorId}
                value={color}
                onChange={(e) => setColor(e.target.value as InkColor)}
              >
                <option value="black">Black</option>
                <option value="blue">Blue</option>
                <option value="original">Original</option>
              </select>
              <span />

              <label htmlFor={kindId}>Type</label>
              <select
                id={kindId}
                value={kind}
                onChange={(e) => setKind(e.target.value as 'signature' | 'initials')}
              >
                <option value="signature">Signature</option>
                <option value="initials">Initials</option>
              </select>
              <span />

              <label htmlFor={labelId}>Name</label>
              <input
                id={labelId}
                type="text"
                maxLength={100}
                value={label}
                placeholder={kind === 'initials' ? 'Initials' : 'Signature'}
                onChange={(e) => setLabel(e.target.value)}
              />
              <span />

              <span />
              <label className="sig-check">
                <input
                  type="checkbox"
                  checked={removeLines}
                  onChange={(e) => setRemoveLines(e.target.checked)}
                />
                Remove lines
              </label>
              <span />
            </div>
          </>
        )}

        {error && (
          <p className="sig-error" role="alert">
            {error}
          </p>
        )}

        <div className="sig-actions">
          {prepared && (
            <button
              type="button"
              onClick={() => {
                setPrepared(null);
                setResult(null);
                setExtractError(null);
                fileInput.current?.click();
              }}
            >
              Choose another…
            </button>
          )}
          <span className="sig-spacer" />
          <button type="button" onClick={onClose}>
            Cancel
          </button>
          <button
            type="button"
            className="sig-primary"
            disabled={!result || resultFor !== options || saving}
            onClick={() => void save()}
          >
            {saving ? 'Saving…' : 'Save'}
          </button>
        </div>
      </div>
    </div>
  );
}
