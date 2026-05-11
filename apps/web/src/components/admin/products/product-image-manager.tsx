"use client";

/**
 * `<ProductImageManager>` — управление картинками товара/варианта в admin'е.
 *
 * **Два режима ввода:**
 *  1. **Device upload** (главный): drag-drop в dropzone или клик → file picker.
 *     Multi-file, per-file progress, blob-preview ДО завершения upload'а,
 *     retry-on-error. POST → `/api/admin/upload` → sharp обрабатывает (WebP,
 *     strip metadata, multi-size) → возвращает `/uploads/...` URL → push в value.
 *  2. **URL paste** (secondary, collapsible): для картинок уже-хостинговых на
 *     внешнем CDN. Кнопка-toggle снизу.
 *
 * **Card actions** (для каждой картинки в value):
 *  - drag-drop reorder (HTML5 DnD, `items-start` от center чтобы name aligned).
 *  - ↑/↓ buttons (mobile fallback).
 *  - alt-edit inline.
 *  - delete с confirm.
 *  - первая = primary (badge ★).
 *
 * **In-flight uploads** показываются в той же сетке inline:
 *  - blob-preview (instant), progress bar overlay, status badge.
 *  - error-state: red border + retry button.
 */

import {
  AlertCircle,
  GripVertical,
  ImagePlus,
  Link as LinkIcon,
  Loader2,
  RotateCw,
  Star,
  Trash2,
  Upload,
} from "lucide-react";
import { useTranslations } from "next-intl";
import { useCallback, useEffect, useRef, useState } from "react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { cn } from "@/lib/utils";

export interface ProductImageInput {
  id?: string;
  url: string;
  alt?: string | null;
  /** WebP multi-size variants для srcset (Phase 5):
   *  `{ w400: "/uploads/.../w400.webp", ... }`. */
  sizes?: Record<string, string> | null;
  /** AVIF multi-size variants (Phase 5b): тот же набор breakpoints. */
  avifSizes?: Record<string, string> | null;
}

interface Props {
  value: ProductImageInput[];
  onChange: (next: ProductImageInput[]) => void;
  disabled?: boolean;
}

interface InFlightUpload {
  localId: string;
  file: File;
  /** Blob-preview URL (URL.createObjectURL). Revoke'ится на complete/error. */
  blobUrl: string;
  status: "uploading" | "error";
  /** 0..100. */
  progress: number;
  /** Сообщение об ошибке для retry-UI. */
  errorReason?: string;
}

const ACCEPT = "image/jpeg,image/png,image/webp,image/gif";

// Маппинг server-reason'ов на i18n-ключи. Unknown reasons → uploadError.generic.
const ERROR_REASON_KEYS = new Set([
  "file_too_large",
  "unsupported_format",
  "image_too_wide",
  "image_too_tall",
  "decode_failed",
  "processing_failed",
  "rate_limited",
  "network_error",
  "invalid_response",
]);

export function ProductImageManager({ value, onChange, disabled }: Props): JSX.Element {
  const t = useTranslations("admin.products.form.images");
  const [draftUrl, setDraftUrl] = useState("");
  const [draftAlt, setDraftAlt] = useState("");
  const [showUrlInput, setShowUrlInput] = useState(false);
  const [dragIndex, setDragIndex] = useState<number | null>(null);
  const [overIndex, setOverIndex] = useState<number | null>(null);
  const [dropzoneActive, setDropzoneActive] = useState(false);
  const [uploads, setUploads] = useState<InFlightUpload[]>([]);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Cleanup blob URLs on unmount (browser держит их до revoke).
  useEffect(() => {
    return () => {
      for (const u of uploads) URL.revokeObjectURL(u.blobUrl);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const valueRef = useRef(value);
  useEffect(() => {
    valueRef.current = value;
  }, [value]);
  const onChangeRef = useRef(onChange);
  useEffect(() => {
    onChangeRef.current = onChange;
  }, [onChange]);

  // ---- Upload logic ------------------------------------------------------

  /**
   * Старт upload'а через XMLHttpRequest — нужен upload-progress (fetch его
   * не даёт без request-streams, который ещё не везде).
   */
  const startUpload = useCallback((u: InFlightUpload): void => {
    const fd = new FormData();
    fd.append("file", u.file);
    const xhr = new XMLHttpRequest();
    xhr.open("POST", "/api/admin/upload");
    xhr.upload.onprogress = (e) => {
      if (!e.lengthComputable) return;
      const pct = Math.round((e.loaded / e.total) * 100);
      setUploads((arr) =>
        arr.map((it) =>
          it.localId === u.localId && it.status === "uploading" ? { ...it, progress: pct } : it,
        ),
      );
    };
    xhr.onload = () => {
      try {
        const json = JSON.parse(xhr.responseText) as
          | {
              ok: true;
              url: string;
              sizes?: Record<string, string>;
              avifSizes?: Record<string, string>;
            }
          | { ok: false; reason: string };
        if (xhr.status >= 200 && xhr.status < 300 && json.ok) {
          // Push в value, удаляем из uploads, revoke blob.
          URL.revokeObjectURL(u.blobUrl);
          const next: ProductImageInput = { url: json.url, alt: null };
          if (json.sizes && Object.keys(json.sizes).length > 0) {
            next.sizes = json.sizes;
          }
          if (json.avifSizes && Object.keys(json.avifSizes).length > 0) {
            next.avifSizes = json.avifSizes;
          }
          onChangeRef.current([...valueRef.current, next]);
          setUploads((arr) => arr.filter((it) => it.localId !== u.localId));
        } else {
          const reason = !json.ok ? json.reason : "unknown_error";
          setUploads((arr) =>
            arr.map((it) =>
              it.localId === u.localId
                ? { ...it, status: "error" as const, errorReason: reason }
                : it,
            ),
          );
        }
      } catch {
        setUploads((arr) =>
          arr.map((it) =>
            it.localId === u.localId
              ? { ...it, status: "error" as const, errorReason: "invalid_response" }
              : it,
          ),
        );
      }
    };
    xhr.onerror = () => {
      setUploads((arr) =>
        arr.map((it) =>
          it.localId === u.localId
            ? { ...it, status: "error" as const, errorReason: "network_error" }
            : it,
        ),
      );
    };
    xhr.send(fd);
  }, []);

  const enqueueFiles = useCallback(
    (files: FileList | File[]): void => {
      const list = Array.from(files);
      const accepted = list.filter((f) => f.type.startsWith("image/"));
      const newUploads: InFlightUpload[] = accepted.map((file) => ({
        localId: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
        file,
        blobUrl: URL.createObjectURL(file),
        status: "uploading",
        progress: 0,
      }));
      setUploads((arr) => [...arr, ...newUploads]);
      for (const u of newUploads) startUpload(u);
    },
    [startUpload],
  );

  const retryUpload = (localId: string): void => {
    setUploads((arr) =>
      arr.map((it) => {
        if (it.localId !== localId) return it;
        const { errorReason: _omit, ...rest } = it;
        void _omit;
        return { ...rest, status: "uploading" as const, progress: 0 };
      }),
    );
    const u = uploads.find((it) => it.localId === localId);
    if (u) startUpload({ ...u, status: "uploading", progress: 0 });
  };

  const dismissError = (localId: string): void => {
    setUploads((arr) => {
      const target = arr.find((it) => it.localId === localId);
      if (target) URL.revokeObjectURL(target.blobUrl);
      return arr.filter((it) => it.localId !== localId);
    });
  };

  // ---- URL-paste path ----------------------------------------------------

  const addUrlDraft = (): void => {
    const url = draftUrl.trim();
    if (url === "") return;
    const next: ProductImageInput = { url };
    const alt = draftAlt.trim();
    if (alt !== "") next.alt = alt;
    onChange([...value, next]);
    setDraftUrl("");
    setDraftAlt("");
  };

  // ---- Reorder / edit / remove ------------------------------------------

  const updateAt = (i: number, patch: Partial<ProductImageInput>): void => {
    onChange(value.map((img, idx) => (idx === i ? { ...img, ...patch } : img)));
  };
  const removeAt = (i: number): void => {
    if (typeof window !== "undefined" && !window.confirm(t("removeConfirm"))) return;
    onChange(value.filter((_, idx) => idx !== i));
  };
  const moveTo = (from: number, to: number): void => {
    if (from === to || to < 0 || to >= value.length) return;
    const next = value.slice();
    const [item] = next.splice(from, 1);
    if (item) next.splice(to, 0, item);
    onChange(next);
  };

  // ---- Dropzone DnD ------------------------------------------------------

  const onDropFiles = (e: React.DragEvent<HTMLDivElement>): void => {
    e.preventDefault();
    setDropzoneActive(false);
    if (disabled) return;
    if (e.dataTransfer.files.length > 0) enqueueFiles(e.dataTransfer.files);
  };

  return (
    <section className="space-y-3" data-testid="product-image-manager">
      <header className="flex items-center justify-between gap-2">
        <div>
          <Label className="text-base font-semibold">{t("title")}</Label>
          <p className="text-xs text-muted-foreground">
            {value.length === 0 && uploads.length === 0
              ? t("hintEmpty")
              : t("hint", { count: value.length })}
          </p>
        </div>
      </header>

      {/* Dropzone — главный способ загрузки. */}
      <div
        onDragOver={(e) => {
          e.preventDefault();
          if (!disabled) setDropzoneActive(true);
        }}
        onDragLeave={() => setDropzoneActive(false)}
        onDrop={onDropFiles}
        onClick={() => fileInputRef.current?.click()}
        className={cn(
          "group flex cursor-pointer flex-col items-center justify-center gap-2 rounded-xl border-2 border-dashed bg-muted/20 px-4 py-8 text-center transition-all",
          "hover:border-primary/40 hover:bg-accent/30",
          dropzoneActive && "border-primary bg-primary/5",
          disabled && "pointer-events-none opacity-50",
        )}
        role="button"
        tabIndex={0}
        onKeyDown={(e) => {
          if ((e.key === "Enter" || e.key === " ") && !disabled) {
            e.preventDefault();
            fileInputRef.current?.click();
          }
        }}
        data-testid="product-image-dropzone"
      >
        <span
          className={cn(
            "inline-flex h-12 w-12 items-center justify-center rounded-full bg-primary/10 text-primary transition-transform group-hover:scale-105",
            dropzoneActive && "scale-110",
          )}
          aria-hidden
        >
          <Upload className="h-5 w-5" />
        </span>
        <div>
          <p className="text-sm font-medium">
            {dropzoneActive ? t("dropzoneActive") : t("dropzoneTitle")}
          </p>
          <p className="text-xs text-muted-foreground">{t("dropzoneSubtitle")}</p>
        </div>
        <input
          ref={fileInputRef}
          type="file"
          accept={ACCEPT}
          multiple
          className="sr-only"
          onChange={(e) => {
            if (e.target.files && e.target.files.length > 0) enqueueFiles(e.target.files);
            e.target.value = ""; // allow re-select того же файла
          }}
          disabled={disabled}
          data-testid="product-image-file-input"
        />
      </div>

      {/* Grid существующих + in-flight uploads. */}
      {value.length > 0 || uploads.length > 0 ? (
        <ul
          className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4"
          data-testid="product-image-list"
        >
          {value.map((img, i) => {
            const isPrimary = i === 0;
            const isDragging = dragIndex === i;
            const isDropTarget = overIndex === i && dragIndex !== i;
            return (
              <li
                key={img.id ?? `new-${i}-${img.url}`}
                draggable={!disabled}
                onDragStart={(e) => {
                  setDragIndex(i);
                  e.dataTransfer.effectAllowed = "move";
                  e.dataTransfer.setData("text/plain", String(i));
                }}
                onDragOver={(e) => {
                  e.preventDefault();
                  if (dragIndex !== null && dragIndex !== i) setOverIndex(i);
                }}
                onDragLeave={() => {
                  if (overIndex === i) setOverIndex(null);
                }}
                onDrop={(e) => {
                  e.preventDefault();
                  if (dragIndex !== null) moveTo(dragIndex, i);
                  setDragIndex(null);
                  setOverIndex(null);
                }}
                onDragEnd={() => {
                  setDragIndex(null);
                  setOverIndex(null);
                }}
                className={cn(
                  "group relative flex flex-col overflow-hidden rounded-lg border bg-card transition-all",
                  isDragging && "opacity-40",
                  isDropTarget && "ring-2 ring-primary ring-offset-2",
                  isPrimary && "border-primary/40",
                  disabled && "pointer-events-none opacity-60",
                )}
                data-testid="product-image-card"
                data-primary={isPrimary ? "true" : "false"}
              >
                <div className="relative aspect-square overflow-hidden bg-muted">
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img
                    src={img.url}
                    alt={img.alt ?? ""}
                    className="h-full w-full object-cover"
                    onError={(e) => {
                      (e.currentTarget as HTMLImageElement).style.display = "none";
                    }}
                  />
                  {isPrimary ? (
                    <span className="absolute left-1.5 top-1.5 inline-flex items-center gap-1 rounded-full bg-primary px-2 py-0.5 text-[10px] font-semibold text-primary-foreground shadow-sm">
                      <Star className="h-3 w-3 fill-current" aria-hidden />
                      {t("primary")}
                    </span>
                  ) : null}
                  <span
                    aria-hidden
                    className="absolute right-1.5 top-1.5 inline-flex h-6 w-6 cursor-grab items-center justify-center rounded-md bg-background/80 text-muted-foreground opacity-0 backdrop-blur transition-opacity group-hover:opacity-100"
                    title={t("dragHint")}
                  >
                    <GripVertical className="h-3.5 w-3.5" />
                  </span>
                  <span className="absolute bottom-1.5 left-1.5 inline-flex h-6 min-w-6 items-center justify-center rounded-full bg-background/85 px-1.5 text-xs font-semibold tabular-nums shadow-sm backdrop-blur">
                    {i + 1}
                  </span>
                  <button
                    type="button"
                    onClick={() => removeAt(i)}
                    disabled={disabled}
                    className="absolute bottom-1.5 right-1.5 inline-flex h-7 w-7 items-center justify-center rounded-md bg-destructive/90 text-destructive-foreground opacity-0 shadow-sm transition-all hover:bg-destructive group-hover:opacity-100 focus-visible:opacity-100"
                    aria-label={t("remove")}
                    data-testid="product-image-remove"
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                  </button>
                </div>
                <div className="space-y-2 border-t bg-card/50 p-2">
                  <Input
                    type="text"
                    value={img.alt ?? ""}
                    onChange={(e) =>
                      updateAt(i, { alt: e.target.value === "" ? null : e.target.value })
                    }
                    placeholder={t("altPlaceholder")}
                    disabled={disabled}
                    className="h-8 text-xs"
                    aria-label={t("altAria", { n: i + 1 })}
                    data-testid="product-image-alt"
                  />
                  <div className="flex items-center justify-between gap-1 sm:hidden">
                    <Button
                      type="button"
                      size="sm"
                      variant="outline"
                      className="h-7 flex-1 px-2 text-xs"
                      disabled={disabled || i === 0}
                      onClick={() => moveTo(i, i - 1)}
                    >
                      ↑ {t("moveUp")}
                    </Button>
                    <Button
                      type="button"
                      size="sm"
                      variant="outline"
                      className="h-7 flex-1 px-2 text-xs"
                      disabled={disabled || i === value.length - 1}
                      onClick={() => moveTo(i, i + 1)}
                    >
                      ↓ {t("moveDown")}
                    </Button>
                  </div>
                </div>
              </li>
            );
          })}

          {/* In-flight uploads — те же карточки, но с progress overlay / error UI. */}
          {uploads.map((u) => (
            <li
              key={u.localId}
              className={cn(
                "relative flex flex-col overflow-hidden rounded-lg border bg-card",
                u.status === "error" && "border-destructive/60",
              )}
              data-testid="product-image-upload-card"
              data-status={u.status}
            >
              <div className="relative aspect-square overflow-hidden bg-muted">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  src={u.blobUrl}
                  alt=""
                  className={cn(
                    "h-full w-full object-cover",
                    u.status === "uploading" && "opacity-70",
                  )}
                />
                {u.status === "uploading" ? (
                  <>
                    <div className="absolute inset-0 flex items-center justify-center bg-background/40 backdrop-blur-[1px]">
                      <Loader2 className="h-6 w-6 animate-spin text-primary" aria-hidden />
                    </div>
                    <div className="absolute bottom-0 left-0 right-0 h-1 bg-background/40">
                      <div
                        className="h-full bg-primary transition-[width] duration-200"
                        style={{ width: `${u.progress}%` }}
                      />
                    </div>
                  </>
                ) : (
                  <div className="absolute inset-0 flex flex-col items-center justify-center gap-2 bg-destructive/10 p-3 text-center">
                    <AlertCircle className="h-6 w-6 text-destructive" aria-hidden />
                    <p className="text-[11px] text-destructive">
                      {u.errorReason !== undefined && ERROR_REASON_KEYS.has(u.errorReason)
                        ? t(`uploadError.${u.errorReason}` as never)
                        : t("uploadError.generic")}
                    </p>
                    <div className="flex gap-1">
                      <Button
                        type="button"
                        size="sm"
                        variant="outline"
                        className="h-7 px-2 text-xs"
                        onClick={() => retryUpload(u.localId)}
                      >
                        <RotateCw className="mr-1 h-3 w-3" />
                        {t("retry")}
                      </Button>
                      <Button
                        type="button"
                        size="sm"
                        variant="ghost"
                        className="h-7 px-2 text-xs"
                        onClick={() => dismissError(u.localId)}
                      >
                        {t("dismiss")}
                      </Button>
                    </div>
                  </div>
                )}
              </div>
              <div className="border-t bg-card/50 p-2">
                <p className="truncate text-[11px] text-muted-foreground" title={u.file.name}>
                  {u.file.name}
                </p>
              </div>
            </li>
          ))}
        </ul>
      ) : null}

      {/* URL-paste (collapsible, secondary). */}
      <div className="rounded-lg border bg-muted/20 p-3">
        <button
          type="button"
          onClick={() => setShowUrlInput((v) => !v)}
          className="flex w-full items-center justify-between gap-2 text-left text-xs font-medium uppercase tracking-wider text-muted-foreground transition-colors hover:text-foreground"
          aria-expanded={showUrlInput}
          data-testid="product-image-url-toggle"
        >
          <span className="flex items-center gap-2">
            <LinkIcon className="h-3.5 w-3.5" aria-hidden />
            {t("urlMode")}
          </span>
          <span>{showUrlInput ? "−" : "+"}</span>
        </button>
        {showUrlInput ? (
          <div className="mt-2 grid gap-2 sm:grid-cols-[1fr_1fr_auto]">
            <Input
              type="url"
              inputMode="url"
              value={draftUrl}
              onChange={(e) => setDraftUrl(e.target.value)}
              placeholder={t("urlPlaceholder")}
              disabled={disabled}
              data-testid="product-image-draft-url"
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  e.preventDefault();
                  addUrlDraft();
                }
              }}
            />
            <Input
              type="text"
              value={draftAlt}
              onChange={(e) => setDraftAlt(e.target.value)}
              placeholder={t("altPlaceholder")}
              disabled={disabled}
              data-testid="product-image-draft-alt"
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  e.preventDefault();
                  addUrlDraft();
                }
              }}
            />
            <Button
              type="button"
              onClick={addUrlDraft}
              disabled={disabled || draftUrl.trim() === ""}
              data-testid="product-image-add"
            >
              <ImagePlus className="mr-2 h-4 w-4" aria-hidden />
              {t("add")}
            </Button>
          </div>
        ) : null}
        {showUrlInput ? (
          <p className="mt-1.5 text-[11px] text-muted-foreground">{t("urlHint")}</p>
        ) : null}
      </div>
    </section>
  );
}
